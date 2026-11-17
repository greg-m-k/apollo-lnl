// PATTERN: Event-driven projections · Employment events service
//
// The write side for Employee. A port of the Quarkus service in
// services/event/employment-events-service of the apollo-demo. It stands alone: its own
// REST API, its own database, its own outbox, no code shared with the others. Screens do
// not read from here; they read the projection built from its events (see ../query-service).
import { DurableObject } from "cloudflare:workers";

const TOPIC = "employment.employee";
const MINE = "session IN ('', ?)";  // the seed employees plus this visitor's own (plumbing, below)

const toEmployee = (row) => row && {
  id: row.id, personId: row.person_id, title: row.title, department: row.department, salary: row.salary,
  active: row.active === 1,
};

// ---- The REST API (EmployeeResource.java) ---------------------------------------------
const routes = {
  "GET /api/employees": listEmployees,
  "GET /api/employees/by-person/:personId": getEmployeeOfPerson,
  "GET /api/employees/:id": getEmployee,
  "POST /api/employees": assignEmployee,
  "PUT /api/employees/:id/promote": promoteEmployee,
  "PUT /api/employees/:id/transfer": transferEmployee,
  "POST /api/employees/:id/terminate": terminateEmployee,
  "GET /api/outbox": outboxBacklog,
};

async function listEmployees(c) {
  const { results } = await c.db.prepare(`SELECT * FROM employees WHERE ${MINE} ORDER BY id`).bind(c.session).all();
  return json(200, results.map(toEmployee));
}

async function getEmployeeOfPerson(c) {
  const row = await employeeRowOf(c, c.params.personId);
  return row ? json(200, toEmployee(row)) : json(404, { error: "Employee not found", personId: c.params.personId });
}

async function getEmployee(c) {
  const row = await c.db.prepare(`SELECT * FROM employees WHERE id = ? AND ${MINE}`).bind(c.params.id, c.session).first();
  return row ? json(200, toEmployee(row)) : json(404, { error: "Employee not found", id: c.params.id });
}

async function assignEmployee(c) {
  const { personId, title, department, salary } = c.body ?? {};
  if (!personId || !title || !department || salary == null) {
    return json(400, { error: "personId, title, department and salary are required" });
  }
  if (await employeeRowOf(c, personId)) return new Response("Person already has an employee record", { status: 409 });
  const employee = { id: `emp-${crypto.randomUUID().slice(0, 8)}`, personId, title, department, salary: Number(salary), active: true };
  await commitWithEvent(c, "EmployeeAssigned", employee, c.db.prepare(
    "INSERT INTO employees (id, session, person_id, title, department, salary, active) VALUES (?, ?, ?, ?, ?, ?, 1)",
  ).bind(employee.id, visitor(c), personId, title, department, employee.salary));
  return json(201, employee);
}

async function promoteEmployee(c) {
  const employee = await ownEmployee(c);
  const salary = c.query.get("salary");
  const next = { ...employee, title: c.query.get("title") ?? employee.title, salary: salary ? Number(salary) : employee.salary };
  await commitWithEvent(c, "EmployeePromoted", next,
    c.db.prepare("UPDATE employees SET title = ?, salary = ? WHERE id = ?").bind(next.title, next.salary, next.id));
  return json(200, next);
}

async function transferEmployee(c) {
  const employee = await ownEmployee(c);
  const next = { ...employee, department: c.query.get("department") ?? employee.department };
  await commitWithEvent(c, "EmployeeTransferred", next,
    c.db.prepare("UPDATE employees SET department = ? WHERE id = ?").bind(next.department, next.id));
  return json(200, next);
}

async function terminateEmployee(c) {
  const next = { ...(await ownEmployee(c)), active: false };
  await commitWithEvent(c, "EmployeeTerminated", next, c.db.prepare("UPDATE employees SET active = 0 WHERE id = ?").bind(next.id));
  return json(200, next);
}

// ---- THE OUTBOX PATTERN ---------------------------------------------------------------
// The change and the event that announces it are stored together, in one transaction:
// both or neither. Nothing is sent to the broker here, so a broker outage cannot fail the
// write or lose the event. The event is a full snapshot of the employee, as in the apollo-demo.
async function commitWithEvent(c, eventType, employee, change) {
  const event = { eventType, employeeId: employee.id, data: employee, timestamp: new Date().toISOString() };
  const started = Date.now();
  await c.db.batch([
    change,
    c.db.prepare(
      "INSERT INTO outbox_events (session, aggregate_type, aggregate_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(c.session, TOPIC, employee.id, eventType, JSON.stringify(event), Date.parse(event.timestamp)),
  ]);
  c.dbMs = Date.now() - started;
  c.wakeRelay();  // only a nudge, so the relay does not wait for its next poll
}

// ---- THE RELAY (OutboxRelay.java, @Scheduled(every = "1s")) ---------------------------
// Publishes unpublished outbox rows to the topic, then marks them published. The topic is
// a Cloudflare Queue standing in for the Kafka topic events.employment.employee. While the
// broker is down the rows stay in the outbox and the relay tries again every second.
// Lunch & Learn: there is one relay per visitor, so a visitor's "broker down" switch holds
// back only their own events.
export class OutboxRelay extends DurableObject {
  async wake(session) {
    if ((await this.ctx.storage.getAlarm()) != null) return;  // already scheduled
    await this.ctx.storage.put("session", session);
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    const session = await this.ctx.storage.get("session");
    const { results: rows } = await this.env.DB.prepare(
      "SELECT * FROM outbox_events WHERE published = 0 AND session = ? ORDER BY id LIMIT 100",
    ).bind(session).all();
    if (rows.length === 0) return;

    const { brokerDown } = await this.env.LESSON.get(this.env.LESSON.idFromName(session)).switches();
    if (!brokerDown) {
      const publishedAt = Date.now();
      await this.env.TOPIC.sendBatch(rows.map((row) => ({
        body: { ...JSON.parse(row.payload), session, publishedAt }, contentType: "json",
      })));
      await this.env.DB.batch(rows.map((row) =>
        this.env.DB.prepare("UPDATE outbox_events SET published = 1, published_at = ? WHERE id = ?").bind(publishedAt, row.id)));
    }
    if (brokerDown || rows.length === 100) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }
}

export default {
  async fetch(request, env, executionContext) {
    const started = Date.now();
    const url = new URL(request.url);
    const session = sessionOf(request);
    const c = {
      db: env.DB, session, query: url.searchParams, dbMs: 0,
      body: request.method === "GET" ? null : await request.json().catch(() => null),
      wakeRelay: () => executionContext.waitUntil(env.RELAY.get(env.RELAY.idFromName(session)).wake(session)),
    };
    const response = await answer(request.method, url.pathname, c);
    const total = Date.now() - started;
    response.headers.set("x-time-ms", String(total));
    response.headers.set("x-timing-details", JSON.stringify({ db: c.dbMs, total }));
    return response;
  },

  // Every few minutes: clear visitors' rows 20 minutes after they were written. Seed rows stay.
  async scheduled(_event, env) {
    const cutoff = Date.now() - 20 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM employees WHERE session != '' AND created_at < ?").bind(cutoff),
      env.DB.prepare("DELETE FROM outbox_events WHERE session != '' AND created_at < ?").bind(cutoff),
    ]);
  },
};

// ---------------------------------------------------------------------------------------
// Lunch & Learn plumbing. Not part of the outbox pattern: routing, the visitor's session,
// and the count of waiting events that the lesson pages show.
// ---------------------------------------------------------------------------------------
const json = (status, body) => Response.json(body, { status });

// Run the handler whose "METHOD /path" matches; ":id" matches one path segment.
// A handler returns a Response, or throws one to stop early.
async function answer(method, path, c) {
  for (const [route, handler] of Object.entries(routes)) {
    const [routeMethod, pattern] = route.split(" ");
    const match = routeMethod === method && path.match(new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`));
    if (!match) continue;
    c.params = match.groups ?? {};
    try { return await handler(c); } catch (thrown) {
      if (thrown instanceof Response) return thrown;
      throw thrown;
    }
  }
  return json(404, { error: "Not found", path });
}

// The visitor's session id. Rows carry it; seed rows have session '' and belong to everyone.
function sessionOf(request) {
  const session = request.headers.get("x-lnl-session") ?? "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(session) ? session : "";
}

// Writes need a session, and may change only the visitor's own rows: seed rows are read-only.
function visitor(c) {
  if (!c.session) throw json(400, { error: "Writes need a session (x-lnl-session header)." });
  return c.session;
}
async function ownEmployee(c) {
  const row = await c.db.prepare(`SELECT * FROM employees WHERE id = ? AND ${MINE}`).bind(c.params.id, c.session).first();
  if (!row) throw json(404, { error: "Employee not found", id: c.params.id });
  if (row.session === "") throw json(403, { error: `${row.id} is seed data and read-only. Create your own to change it.` });
  return toEmployee(row);
}

// The employee row of one person, if they have one.
function employeeRowOf(c, personId) {
  return c.db.prepare(`SELECT * FROM employees WHERE person_id = ? AND ${MINE} ORDER BY created_at LIMIT 1`)
    .bind(personId, c.session).first();
}

// How many of this visitor's events still wait in the outbox.
async function outboxBacklog(c) {
  const { waiting } = await c.db.prepare(
    "SELECT COUNT(*) AS waiting FROM outbox_events WHERE published = 0 AND session = ?",
  ).bind(c.session).first();
  return json(200, { waiting });
}
