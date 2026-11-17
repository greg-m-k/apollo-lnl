// A D1 database for tests: the same prepare/bind/first/all/run/batch surface over
// Node's built-in SQLite, loaded with a migration's SQL.
import { DatabaseSync } from "node:sqlite";

export function fakeD1(schemaSql) {
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql);
  const statement = (sql, args = []) => ({
    bind: (...bound) => statement(sql, bound),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => void db.prepare(sql).run(...args),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => { for (const s of statements) await s.run(); },
  };
}
