// PATTERN: Event-driven projections · HR events service
//
// The write side for Person. A port of the Quarkus service in services/event/hr-events-service
// of the apollo-demo. It stands alone: its own REST API, its own database, its own outbox,
// no code shared with the others. Screens do not read from here; they read the projection
// that the consumer builds from this service's events (see ../query-service).
import { DurableObject } from "cloudflare:workers";

const TOPIC = "hr.person";
const MINE = "session IN ('', ?)";  // the seed people plus this visitor's own (plumbing, below)

const toPerson = (row) => row && {
  id: row.id, name: row.name, email: row.email, hireDate: row.hire_date, active: row.active === 1,
};

// ---- The REST API (PersonResource.java) -----------------------------------------------
const routes = {
  "GET /api/persons": listPersons,
  "GET /api/persons/:id": getPerson,
  "POST /api/persons": createPerson,
  "PUT /api/persons/:id": updatePerson,
  "POST /api/persons/:id/terminate": terminatePerson,
  "GET /api/outbox": outboxBacklog,
};

async function listPersons(c) {
  const { results } = await c.db.prepare(`SELECT * FROM persons WHERE ${MINE} ORDER BY id`).bind(c.session).all();
  return json(200, results.map(toPerson));
}

async function getPerson(c) {
  const row = await c.db.prepare(`SELECT * FROM persons WHERE id = ? AND ${MINE}`).bind(c.params.id, c.session).first();
  return row ? json(200, toPerson(row)) : json(404, { error: "Person not found", id: c.params.id });
}

async function createPerson(c) {
  const { name, email, hireDate = null } = c.body ?? {};
  if (!name || !email) return json(400, { error: "name and email are required" });
  // Email identifies a person, so HR refuses a second one with the same address.
  if (await c.db.prepare(`SELECT id FROM persons WHERE email = ? AND ${MINE}`).bind(email, c.session).first())
    return json(409, { error: "HR already has a person with this email", email });
  const person = { id: `person-${crypto.randomUUID().slice(0, 8)}`, name, email, hireDate, active: true };
  await commitWithEvent(c, "PersonCreated", person, c.db.prepare(
    "INSERT INTO persons (id, session, name, email, hire_date, active) VALUES (?, ?, ?, ?, ?, 1)",
  ).bind(person.id, visitor(c), name, email, hireDate));
  return json(201, person);
}

async function updatePerson(c) {
  const person = await ownPerson(c);
  const next = { ...person, name: c.query.get("name") ?? person.name, email: c.query.get("email") ?? person.email };
  await commitWithEvent(c, "PersonUpdated", next,
    c.db.prepare("UPDATE persons SET name = ?, email = ? WHERE id = ?").bind(next.name, next.email, next.id));
  return json(200, next);
}

async function terminatePerson(c) {
  const next = { ...(await ownPerson(c)), active: false };
  await commitWithEvent(c, "PersonTerminated", next, c.db.prepare("UPDATE persons SET active = 0 WHERE id = ?").bind(next.id));
  return json(200, next);
}

// ---- THE OUTBOX PATTERN ---------------------------------------------------------------
// The change and the event that announces it are stored together, in one transaction:
// both or neither. Nothing is sent to the broker here, so a broker outage cannot fail the
// write or lose the event. The event is a full snapshot of the person, as in the apollo-demo.
async function commitWithEvent(c, eventType, person, change) {
  const event = { eventType, personId: person.id, data: person, timestamp: new Date().toISOString() };
  const started = Date.now();
  await c.db.batch([
    change,
    c.db.prepare(
      "INSERT INTO outbox_events (session, aggregate_type, aggregate_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(c.session, TOPIC, person.id, eventType, JSON.stringify(event), Date.parse(event.timestamp)),
  ]);
  c.dbMs = Date.now() - started;
  c.wakeRelay();  // only a nudge, so the relay does not wait for its next poll
}

// ---- THE RELAY (OutboxRelay.java, @Scheduled(every = "1s")) ---------------------------
// Publishes unpublished outbox rows to the topic, then marks them published. The topic is
// a Cloudflare Queue standing in for the Kafka topic events.hr.person. While the broker is
// down the rows stay in the outbox and the relay tries again every second.
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
      env.DB.prepare("DELETE FROM persons WHERE session != '' AND created_at < ?").bind(cutoff),
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
async function ownPerson(c) {
  const row = await c.db.prepare(`SELECT * FROM persons WHERE id = ? AND ${MINE}`).bind(c.params.id, c.session).first();
  if (!row) throw json(404, { error: "Person not found", id: c.params.id });
  if (row.session === "") throw json(403, { error: `${row.id} is seed data and read-only. Create your own to change it.` });
  return toPerson(row);
}

// How many of this visitor's events still wait in the outbox.
async function outboxBacklog(c) {
  const { waiting } = await c.db.prepare(
    "SELECT COUNT(*) AS waiting FROM outbox_events WHERE published = 0 AND session = ?",
  ).bind(c.session).first();
  return json(200, { waiting });
}
