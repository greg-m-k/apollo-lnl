// Data freshness of the projections, formatted like the apollo-demo query-service.
export function human(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

const TABLES = { person: "person_projections", employee: "employee_projections", badge: "badge_projections" };

export async function freshness(db, session, now = Date.now()) {
  const out = { timestamp: new Date(now).toISOString() };
  for (const [key, table] of Object.entries(TABLES)) {
    const r = await db.prepare(`SELECT MAX(last_updated) AS t FROM ${table} WHERE session IN ('', ?)`).bind(session).first();
    out[key] = r?.t == null
      ? { lastUpdate: "never", lagMs: -1, lagHuman: "N/A" }
      : { lastUpdate: new Date(r.t).toISOString(), lagMs: now - r.t, lagHuman: human(now - r.t) };
  }
  return out;
}
