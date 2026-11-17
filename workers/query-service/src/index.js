// Query service: read-only API over the local projections (apollo-demo query-service).
// One call, one database, no source service involved.
import { restService, HttpError } from "../../../shared/rest.js";
import { freshness, human } from "../../../shared/freshness.js";
import { VISIBLE, bool } from "../../../shared/rows.js";

const NO_EMPLOYEE = { employeeId: null, title: null, department: null, salary: null, employeeActive: false };
const NO_BADGE = { badgeId: null, badgeNumber: null, accessLevel: null, clearance: null, badgeActive: false };

const employeePart = (e) => (e
  ? { employeeId: e.id, title: e.title, department: e.department, salary: e.salary, employeeActive: bool(e.active) }
  : NO_EMPLOYEE);
const badgePart = (b) => (b
  ? {
    badgeId: b.id, badgeNumber: b.badge_number, accessLevel: b.access_level, clearance: b.clearance,
    badgeActive: bool(b.active),
  }
  : NO_BADGE);
const updated = (row) => (row ? new Date(row.last_updated).toISOString() : null);

// How old the view is: the lag of its least recently updated part.
function freshnessPart(p, e, b, now) {
  const maxLagMs = Math.max(...[p, e, b].filter(Boolean).map((row) => now - row.last_updated));
  return {
    personLastUpdated: updated(p), employeeLastUpdated: updated(e), badgeLastUpdated: updated(b),
    maxLagMs, dataFreshness: human(maxLagMs),
  };
}

// The apollo-demo ComposedView: one flat object from the person, employee and badge projection rows.
export function composed(p, e, b, now = Date.now()) {
  return {
    personId: p.id, name: p.name, email: p.email, hireDate: p.hire_date, personActive: bool(p.active),
    ...employeePart(e), ...badgePart(b), freshness: freshnessPart(p, e, b, now),
  };
}

const first = (db, table, where, ...args) =>
  db.prepare(`SELECT * FROM ${table} WHERE ${where} AND ${VISIBLE} ORDER BY last_updated DESC LIMIT 1`).bind(...args).first();
const rows = (table) => async ({ env, session }) =>
  (await env.DB.prepare(`SELECT * FROM ${table} WHERE ${VISIBLE} ORDER BY id`).bind(session).all()).results;
const notFound = (personId) => new HttpError(404, { error: "Person not found", personId });

const routes = [
  ["GET", "/api/composed/:id", async ({ env, params, session, timing }) => {
    const [p, e, b] = await timing.step("db", () => Promise.all([
      first(env.DB, "person_projections", "id = ?", params.id, session),
      first(env.DB, "employee_projections", "person_id = ?", params.id, session),
      first(env.DB, "badge_projections", "person_id = ?", params.id, session),
    ]));
    if (!p) throw notFound(params.id);
    return composed(p, e, b);
  }],
  ["GET", "/api/persons", rows("person_projections")],
  ["GET", "/api/persons/:id", async ({ env, params, session }) => {
    const p = await first(env.DB, "person_projections", "id = ?", params.id, session);
    if (!p) throw notFound(params.id);
    return p;
  }],
  ["GET", "/api/employees", rows("employee_projections")],
  ["GET", "/api/badges", rows("badge_projections")],
  ["GET", "/api/freshness", ({ env, session }) => freshness(env.DB, session)],
];

export default { fetch: restService(routes) };
