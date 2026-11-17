// Data freshness of the projections, formatted like the apollo-demo query-service.
import { PROJECTIONS } from "./projections.js";
import { VISIBLE } from "./rows.js";

export function human(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// { timestamp, person, employee, badge }: when each projection the session sees last changed.
export async function freshness(db, session) {
  const now = Date.now();
  const parts = await Promise.all(Object.values(PROJECTIONS).map(async ({ kind, table }) => {
    const r = await db.prepare(`SELECT MAX(last_updated) AS t FROM ${table} WHERE ${VISIBLE}`).bind(session).first();
    return [kind, r?.t == null
      ? { lastUpdate: "never", lagMs: -1, lagHuman: "N/A" }
      : { lastUpdate: new Date(r.t).toISOString(), lagMs: now - r.t, lagHuman: human(now - r.t) }];
  }));
  return { timestamp: new Date(now).toISOString(), ...Object.fromEntries(parts) };
}
