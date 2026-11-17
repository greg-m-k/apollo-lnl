// PATTERN: Event-driven projections · Query service
//
// The read side: answers "who is this person, what is their job, what badge do they carry"
// from the local projections. A port of the Quarkus service in services/event/query-service
// of the apollo-demo. One call, one database; HR, Employment and Security are not involved,
// so their outages cannot reach it. The cost is that the answer is as old as the last event
// applied. It stands alone and only reads: the projection consumer owns the tables.

const MINE = "session IN ('', ?)";  // the seed rows plus this visitor's own (plumbing, below)

// ---- The REST API (QueryResource.java) ------------------------------------------------
const routes = {
  "GET /api/composed/:id": composedView,
  "GET /api/persons": (c) => list(c, "person_projections"),
  "GET /api/persons/:id": person,
  "GET /api/employees": (c) => list(c, "employee_projections"),
  "GET /api/badges": (c) => list(c, "badge_projections"),
  "GET /api/freshness": freshness,
};

// The whole answer from three local reads. Compare with the federation pattern, where the router calls
// three services to build the same thing.
async function composedView(c) {
  const started = Date.now();
  const [p, e, b] = await Promise.all([
    latest(c, "person_projections", "id", c.params.id),
    latest(c, "employee_projections", "person_id", c.params.id),
    latest(c, "badge_projections", "person_id", c.params.id),
  ]);
  c.dbMs = Date.now() - started;
  return p ? json(200, composed(p, e, b)) : json(404, { error: "Person not found", personId: c.params.id });
}

// The ComposedView of the apollo-demo: one flat object. A person without a job or a badge
// has nulls there. `freshness` says how old the oldest part is.
export function composed(p, e, b, now = Date.now()) {
  const updated = (row) => (row ? new Date(row.last_updated).toISOString() : null);
  const maxLagMs = Math.max(...[p, e, b].filter(Boolean).map((row) => now - row.last_updated));
  return {
    personId: p.id, name: p.name, email: p.email, hireDate: p.hire_date, personActive: p.active === 1,
    ...(e
      ? { employeeId: e.id, title: e.title, department: e.department, salary: e.salary, employeeActive: e.active === 1 }
      : { employeeId: null, title: null, department: null, salary: null, employeeActive: false }),
    ...(b
      ? { badgeId: b.id, badgeNumber: b.badge_number, accessLevel: b.access_level, clearance: b.clearance, badgeActive: b.active === 1 }
      : { badgeId: null, badgeNumber: null, accessLevel: null, clearance: null, badgeActive: false }),
    freshness: {
      personLastUpdated: updated(p), employeeLastUpdated: updated(e), badgeLastUpdated: updated(b),
      maxLagMs, dataFreshness: human(maxLagMs),
    },
  };
}

async function person(c) {
  const row = await latest(c, "person_projections", "id", c.params.id);
  return row ? json(200, row) : json(404, { error: "Person not found", personId: c.params.id });
}

async function list(c, table) {
  const { results } = await c.db.prepare(`SELECT * FROM ${table} WHERE ${MINE} ORDER BY id`).bind(c.session).all();
  return json(200, results);
}

// When each projection last changed, and how long ago that was.
async function freshness(c) {
  const now = Date.now();
  const report = { timestamp: new Date(now).toISOString() };
  for (const kind of ["person", "employee", "badge"]) {
    const { latest: at } = await c.db.prepare(`SELECT MAX(last_updated) AS latest FROM ${kind}_projections WHERE ${MINE}`).bind(c.session).first();
    report[kind] = at == null
      ? { lastUpdate: "never", lagMs: -1, lagHuman: "N/A" }
      : { lastUpdate: new Date(at).toISOString(), lagMs: now - at, lagHuman: human(now - at) };
  }
  return json(200, report);
}

function human(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

let served = 0;  // requests this copy of the service has served; 1 means it has just started
export default {
  async fetch(request, env) {
    const started = Date.now();
    const url = new URL(request.url);
    const c = { db: env.DB, session: sessionOf(request), dbMs: 0 };
    const response = await answer(request.method, url.pathname, c);
    const total = Date.now() - started;
    response.headers.set("x-time-ms", String(total));
    response.headers.set("x-timing-details", JSON.stringify({ db: c.dbMs, total }));
    response.headers.set("x-request", String(++served));
    return response;
  },
};

// ---------------------------------------------------------------------------------------
// Lunch & Learn plumbing. Not part of the pattern: routing and the visitor's session.
// ---------------------------------------------------------------------------------------
const json = (status, body) => Response.json(body, { status });

// The newest visible row of a projection whose `column` has this value.
function latest(c, table, column, value) {
  return c.db.prepare(`SELECT * FROM ${table} WHERE ${column} = ? AND ${MINE} ORDER BY last_updated DESC LIMIT 1`)
    .bind(value, c.session).first();
}

// Run the handler whose "METHOD /path" matches; ":id" matches one path segment.
async function answer(method, path, c) {
  for (const [route, handler] of Object.entries(routes)) {
    const [routeMethod, pattern] = route.split(" ");
    const match = routeMethod === method && path.match(new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`));
    if (!match) continue;
    c.params = match.groups ?? {};
    return handler(c);
  }
  return json(404, { error: "Not found", path });
}

// The visitor's session id. Rows carry it; seed rows have session '' and belong to everyone.
function sessionOf(request) {
  const session = request.headers.get("x-lnl-session") ?? "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(session) ? session : "";
}
