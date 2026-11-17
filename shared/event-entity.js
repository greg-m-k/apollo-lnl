// What every event-side write service does with its one entity table: read what the
// session may see, refuse writes to seed rows, and commit each change together with
// its outbox event (event payloads are full snapshots, as in the apollo-demo).
import { HttpError } from "./rest.js";
import { outboxInsert, kickRelay } from "./outbox.js";
import { VISIBLE } from "./rows.js";

// table: D1 table; aggregateType: topic name; idKey: event field naming the aggregate;
// toJson: row -> API object; columns: API object -> { column: value } for writes.
export function eventEntity({ table, aggregateType, idKey, label, toJson, columns }) {
  const select = (env, where, ...args) =>
    env.DB.prepare(`SELECT * FROM ${table} WHERE ${where} AND ${VISIBLE}`).bind(...args);

  const find = async (env, id, session) => toJson(await select(env, "id = ?", id, session).first());

  const all = async (env, session, where = "1 = 1", ...args) =>
    (await env.DB.prepare(`SELECT * FROM ${table} WHERE ${where} AND ${VISIBLE} ORDER BY id`)
      .bind(...args, session).all()).results.map(toJson);

  async function get({ env, params, session, timing }, id = params.id) {
    const found = await timing.step("db_read", () => find(env, id, session));
    if (!found) throw new HttpError(404, { error: `${label} not found`, id });
    return found;
  }

  async function own(r) {
    const found = await get(r);
    const row = await r.env.DB.prepare(`SELECT session FROM ${table} WHERE id = ?`).bind(found.id).first();
    if (row.session === "") throw new HttpError(403, { error: `${found.id} is seed data and read-only` });
    return found;
  }

  function requireSession(session) {
    if (!session) throw new HttpError(400, { error: "x-lnl-session header is required for writes" });
  }

  async function write({ env, ctx, session, timing }, entity, eventType, statement) {
    const event = { eventType, [idKey]: entity.id, data: entity, timestamp: new Date().toISOString() };
    await timing.step("db_write_and_outbox", () => env.DB.batch([
      statement,
      outboxInsert(env.DB, { session, aggregateType, aggregateId: entity.id, eventType, event }),
    ]));
    kickRelay(env, ctx);
    return entity;
  }

  function insert(r, entity, eventType) {
    requireSession(r.session);
    const cols = { id: entity.id, session: r.session, ...columns(entity) };
    const names = Object.keys(cols);
    return write(r, entity, eventType, r.env.DB.prepare(
      `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    ).bind(...Object.values(cols)));
  }

  function update(r, entity, eventType) {
    const cols = columns(entity);
    return write(r, entity, eventType, r.env.DB.prepare(
      `UPDATE ${table} SET ${Object.keys(cols).map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    ).bind(...Object.values(cols), entity.id));
  }

  return { find, all, get, own, insert, update, select };
}
