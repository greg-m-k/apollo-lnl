// Visitors' rows are cleared 20 minutes after they were written; seed rows stay.
const KEEP_MS = 20 * 60 * 1000;

// tables: { table: timeColumn } (time columns hold epoch ms). Returns a scheduled handler.
export function sweeper(tables) {
  return async (_controller, env) => {
    const cutoff = Date.now() - KEEP_MS;
    await env.DB.batch(Object.entries(tables).map(([table, col]) =>
      env.DB.prepare(`DELETE FROM ${table} WHERE session != '' AND ${col} < ?`).bind(cutoff)));
  };
}
