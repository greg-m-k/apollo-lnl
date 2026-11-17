// Employment events service (apollo-demo employment-events-service), topic employment.employee.
import { restService, reply, need, HttpError } from "../../../shared/rest.js";
import { sweeper } from "../../../shared/sweep.js";
import { OutboxRelay, backlog } from "../../../shared/outbox.js";
import { eventEntity } from "../../../shared/event-entity.js";
import { bool, newId } from "../../../shared/rows.js";

export { OutboxRelay };

const employees = eventEntity({
  table: "employees", aggregateType: "employment.employee", idKey: "employeeId", label: "Employee",
  toJson: (r) => r && {
    id: r.id, personId: r.person_id, title: r.title, department: r.department, salary: r.salary, active: bool(r.active),
  },
  columns: (e) => ({ person_id: e.personId, title: e.title, department: e.department, salary: e.salary, active: e.active ? 1 : 0 }),
});

const byPerson = async (env, personId, session) => (await employees.all(env, session, "person_id = ?", personId))[0];

const routes = [
  ["GET", /^\/api\/outbox$/, async ({ env, session }) => ({ waiting: await backlog(env.DB, session) })],
  ["GET", /^\/api\/employees$/, ({ env, session, timing }) => timing.step("db_read", () => employees.all(env, session))],
  ["GET", /^\/api\/employees\/by-person\/(?<personId>[^/]+)$/, async ({ env, params, session }) => {
    const e = await byPerson(env, params.personId, session);
    if (!e) throw new HttpError(404, { error: "Employee not found", personId: params.personId });
    return e;
  }],
  ["GET", /^\/api\/employees\/(?<id>[^/]+)$/, (r) => employees.get(r)],
  ["POST", /^\/api\/employees$/, async (r) => {
    const { personId, title, department, salary } = need(r.body, "personId", "title", "department", "salary");
    if (await byPerson(r.env, personId, r.session)) throw new HttpError(409, "Person already has an employee record");
    const e = { id: newId("emp"), personId, title, department, salary: Number(salary), active: true };
    return reply(201, await employees.insert(r, e, "EmployeeAssigned"));
  }],
  ["PUT", /^\/api\/employees\/(?<id>[^/]+)\/promote$/, async (r) => {
    const e = await employees.own(r);
    const salary = r.query.get("salary");
    return employees.update(r, { ...e, title: r.query.get("title") ?? e.title, salary: salary ? Number(salary) : e.salary },
      "EmployeePromoted");
  }],
  ["PUT", /^\/api\/employees\/(?<id>[^/]+)\/transfer$/, async (r) =>
    employees.update(r, { ...(await employees.own(r)), department: r.query.get("department") }, "EmployeeTransferred")],
  ["POST", /^\/api\/employees\/(?<id>[^/]+)\/terminate$/, async (r) =>
    employees.update(r, { ...(await employees.own(r)), active: false }, "EmployeeTerminated")],
];

const scheduled = sweeper({ employees: "created_at", outbox_events: "created_at" });

export default { fetch: restService(routes, { timingPrefix: "x-employment-events" }), scheduled };
