// Every visitor shares the seed rows (session '') and sees only their own new rows.
// Seed rows are read-only, so one visitor cannot change another visitor's lesson.
import { GraphQLError } from "graphql";

export const VISIBLE = "session IN ('', ?)";

export function newId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function requireSession(session) {
  if (!session) throw new GraphQLError("Writes need a session (x-lnl-session header).");
  return session;
}

// The row a write may change: visible to this session and not seed data.
export async function ownRow(db, table, id, session) {
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND ${VISIBLE}`).bind(id, session).first();
  if (row && row.session === "") {
    throw new GraphQLError(`${id} is seed data and read-only. Create your own to change it.`);
  }
  return row;
}

export const bool = (v) => v === 1 || v === true;
