// One event-side write service as a Worker: the REST API over one entity's table, where
// every change commits together with its outbox event (a full snapshot of the entity, as
// in the apollo-demo), plus the routes every such service has.
import { restService, HttpError } from "./rest.js";
import { outboxInsert, kickRelay, backlog } from "./outbox.js";
import { VISIBLE, insertRow, updateRow, ownRow, requireSession } from "./rows.js";
import { sweeper } from "./sweep.js";

// entity: from entities.js. path: "persons" serves /api/persons. topic: the events' topic.
// idKey: the event field that names the aggregate. label: for "… not found".
// onePerPerson: the 409 text when the person already has one; also serves /by-person/:personId.
// routes(store): the service's own write routes, built on store.insert and store.change.
export function eventService({ entity, path, topic, idKey, label, onePerPerson, routes }) {
  const { table, toJson, columns } = entity;
  const base = `/api/${path}`;
  const notFound = (key) => new HttpError(404, { error: `${label} not found`, ...key });

  // The visible entities that match a condition.
  const find = ({ env, session, timing }, condition = "1 = 1", ...args) => timing.step("db_read", async () =>
    (await env.DB.prepare(`SELECT * FROM ${table} WHERE ${condition} AND ${VISIBLE} ORDER BY id`)
      .bind(...args, session).all()).results.map(toJson));

  // A handler for the one visible entity whose `column` equals the route's `param`, or 404.
  const one = (column, param) => async (r) => {
    const [found] = await find(r, `${column} = ?`, r.params[param]);
    if (!found) throw notFound({ [param]: r.params[param] });
    return found;
  };

  // The entity change and its outbox event commit together; then wake the session's relay.
  async function commit({ env, ctx, session, timing }, obj, eventType, statement) {
    const event = { eventType, [idKey]: obj.id, data: obj, timestamp: new Date().toISOString() };
    await timing.step("db_write_and_outbox", () => env.DB.batch([
      statement, outboxInsert(env.DB, { session, topic, aggregateId: obj.id, event }),
    ]));
    kickRelay(env, ctx, session);
    return obj;
  }

  const store = {
    // A new entity for the session.
    async insert(r, obj, eventType) {
      const session = requireSession(r.session);
      if (onePerPerson && (await find(r, "person_id = ?", obj.personId)).length) throw new HttpError(409, onePerPerson);
      return commit(r, obj, eventType, insertRow(r.env.DB, table, { id: obj.id, session, ...columns(obj) }));
    },
    // A change to the entity named by the route's :id, which the session must own. `set`: the changed fields.
    async change(r, eventType, set) {
      const row = await r.timing.step("db_read", () => ownRow(r.env.DB, table, r.params.id, r.session));
      if (!row) throw notFound({ id: r.params.id });
      const next = { ...toJson(row), ...set };
      return commit(r, next, eventType, updateRow(r.env.DB, table, next.id, columns(next)));
    },
  };

  return {
    fetch: restService([
      ["GET", "/api/outbox", async ({ env, session }) => ({ waiting: await backlog(env.DB, session) })],
      ["GET", base, (r) => find(r)],
      ...(onePerPerson ? [["GET", `${base}/by-person/:personId`, one("person_id", "personId")]] : []),
      ["GET", `${base}/:id`, one("id", "id")],
      ...routes(store),
    ]),
    scheduled: sweeper({ [table]: "created_at", outbox_events: "created_at" }),
  };
}
