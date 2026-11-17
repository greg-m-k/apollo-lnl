// HR events service: REST writes to its own D1 plus an outbox row, published to the
// hr.person topic by the relay (apollo-demo hr-events-service).
import { restService, reply, need } from "../../../shared/rest.js";
import { sweeper } from "../../../shared/sweep.js";
import { OutboxRelay, backlog } from "../../../shared/outbox.js";
import { eventEntity } from "../../../shared/event-entity.js";
import { bool, newId } from "../../../shared/rows.js";

export { OutboxRelay };

const persons = eventEntity({
  table: "persons", aggregateType: "hr.person", idKey: "personId", label: "Person",
  toJson: (r) => r && { id: r.id, name: r.name, email: r.email, hireDate: r.hire_date, active: bool(r.active) },
  columns: (p) => ({ name: p.name, email: p.email, hire_date: p.hireDate, active: p.active ? 1 : 0 }),
});

const routes = [
  ["GET", /^\/api\/outbox$/, async ({ env, session }) => ({ waiting: await backlog(env.DB, session) })],
  ["GET", /^\/api\/persons$/, ({ env, session, timing }) => timing.step("db_read", () => persons.all(env, session))],
  ["GET", /^\/api\/persons\/(?<id>[^/]+)$/, (r) => persons.get(r)],
  ["POST", /^\/api\/persons$/, async (r) => {
    const { name, email, hireDate } = need(r.body, "name", "email");
    const p = { id: newId("person"), name, email, hireDate: hireDate ?? null, active: true };
    return reply(201, await persons.insert(r, p, "PersonCreated"));
  }],
  ["PUT", /^\/api\/persons\/(?<id>[^/]+)$/, async (r) => {
    const p = await persons.own(r);
    return persons.update(r, { ...p, name: r.query.get("name") ?? p.name, email: r.query.get("email") ?? p.email },
      "PersonUpdated");
  }],
  ["POST", /^\/api\/persons\/(?<id>[^/]+)\/terminate$/, async (r) =>
    persons.update(r, { ...(await persons.own(r)), active: false }, "PersonTerminated")],
];

const scheduled = sweeper({ persons: "created_at", outbox_events: "created_at" });

export default { fetch: restService(routes, { timingPrefix: "x-hr-events" }), scheduled };
