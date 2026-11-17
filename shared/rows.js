// Rows and sessions. Every table has a `session` column: seed rows have session '' and
// are shared and read-only; a visitor sees them plus the rows of their own session.
export const VISIBLE = "session IN ('', ?)";

export const newId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
export const bool = (v) => v === 1 || v === true;

// The fields of `o` that were given (not null or undefined): a partial update.
export const given = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

// A request the rules refuse. REST answers with its status; GraphQL reports its message.
export class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireSession(session) {
  if (!session) throw new Refused(400, "Writes need a session (x-lnl-session header).");
  return session;
}

// The row a write may change: visible to this session and not seed data. Null if not visible.
export async function ownRow(db, table, id, session) {
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND ${VISIBLE}`).bind(id, session).first();
  if (row?.session === "") throw new Refused(403, `${id} is seed data and read-only. Create your own to change it.`);
  return row;
}

// Statements built from a { column: value } map.
export function insertRow(db, table, cols) {
  const names = Object.keys(cols);
  return db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .bind(...Object.values(cols));
}

export function updateRow(db, table, id, cols) {
  return db.prepare(`UPDATE ${table} SET ${Object.keys(cols).map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .bind(...Object.values(cols), id);
}
