// Query service: read-only API over the local projections (apollo-demo query-service).
// One call, one database, no source service involved.
import { restService, HttpError } from "../../../shared/rest.js";
import { freshness, human } from "../../../shared/freshness.js";
import { VISIBLE, bool } from "../../../shared/rows.js";

const first = (db, table, where, ...args) =>
  db.prepare(`SELECT * FROM ${table} WHERE ${where} AND ${VISIBLE} ORDER BY last_updated DESC LIMIT 1`).bind(...args).first();

export function composed(p, e, b, now = Date.now()) {
  const lags = [p, e, b].filter(Boolean).map((r) => now - r.last_updated);
  const maxLagMs = Math.max(...lags);
  const iso = (r) => (r ? new Date(r.last_updated).toISOString() : null);
  return {
    personId: p.id, name: p.name, email: p.email, hireDate: p.hire_date, personActive: bool(p.active),
    employeeId: e?.id ?? null, title: e?.title ?? null, department: e?.department ?? null, salary: e?.salary ?? null,
    employeeActive: e ? bool(e.active) : false,
    badgeId: b?.id ?? null, badgeNumber: b?.badge_number ?? null, accessLevel: b?.access_level ?? null,
    clearance: b?.clearance ?? null, badgeActive: b ? bool(b.active) : false,
    freshness: {
      personLastUpdated: iso(p), employeeLastUpdated: iso(e), badgeLastUpdated: iso(b),
      maxLagMs, dataFreshness: human(maxLagMs),
    },
  };
}

const rows = async (db, table, session) =>
  (await db.prepare(`SELECT * FROM ${table} WHERE ${VISIBLE} ORDER BY id`).bind(session).all()).results;

const routes = [
  ["GET", /^\/api\/composed\/(?<id>[^/]+)$/, async ({ env, params, session, timing }) => {
    const [p, e, b] = await timing.step("db", () => Promise.all([
      first(env.DB, "person_projections", "id = ?", params.id, session),
      first(env.DB, "employee_projections", "person_id = ?", params.id, session),
      first(env.DB, "badge_projections", "person_id = ?", params.id, session),
    ]));
    if (!p) throw new HttpError(404, { error: "Person not found", personId: params.id });
    return composed(p, e, b);
  }],
  ["GET", /^\/api\/persons$/, ({ env, session }) => rows(env.DB, "person_projections", session)],
  ["GET", /^\/api\/persons\/(?<id>[^/]+)$/, async ({ env, params, session }) => {
    const p = await first(env.DB, "person_projections", "id = ?", params.id, session);
    if (!p) throw new HttpError(404, { error: "Person not found", personId: params.id });
    return p;
  }],
  ["GET", /^\/api\/employees$/, ({ env, session }) => rows(env.DB, "employee_projections", session)],
  ["GET", /^\/api\/badges$/, ({ env, session }) => rows(env.DB, "badge_projections", session)],
  ["GET", /^\/api\/freshness$/, ({ env, session }) => freshness(env.DB, session)],
];

export default { fetch: restService(routes, { timingPrefix: "x-query" }) };
