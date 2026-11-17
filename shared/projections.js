// How each topic's event lands in its projection table. Pure: no I/O.
import { bool } from "./rows.js";

const b = (v) => (bool(v) ? 1 : 0);

const BY_TOPIC = {
  "hr.person": {
    kind: "person", table: "person_projections", idKey: "personId",
    columns: (d) => ({ name: d.name, email: d.email, hire_date: d.hireDate ?? null, active: b(d.active) }),
  },
  "employment.employee": {
    kind: "employee", table: "employee_projections", idKey: "employeeId",
    columns: (d) => ({ person_id: d.personId, title: d.title, department: d.department, salary: d.salary, active: b(d.active) }),
  },
  "security.badge": {
    kind: "badge", table: "badge_projections", idKey: "badgeId",
    columns: (d) => ({
      person_id: d.personId, badge_number: d.badgeNumber, access_level: d.accessLevel, clearance: d.clearance,
      active: b(d.active),
    }),
  },
};

const TOPIC_OF_EVENT = {
  PersonCreated: "hr.person", PersonUpdated: "hr.person", PersonTerminated: "hr.person",
  EmployeeAssigned: "employment.employee", EmployeePromoted: "employment.employee",
  EmployeeTransferred: "employment.employee", EmployeeTerminated: "employment.employee",
  BadgeProvisioned: "security.badge", AccessLevelChanged: "security.badge",
  ClearanceChanged: "security.badge", BadgeRevoked: "security.badge",
};

export function projectionFor(event) {
  const topic = TOPIC_OF_EVENT[event.eventType];
  if (!topic) throw new Error(`Unknown event type ${event.eventType}`);
  const t = BY_TOPIC[topic];
  return { topic, kind: t.kind, table: t.table, aggregateId: event[t.idKey], columns: t.columns(event.data) };
}

// The Quarkus consumer's idempotency key: kind, aggregate and event timestamp.
export const eventId = (kind, aggregateId, timestamp) => `${kind}-${aggregateId}-${timestamp}`;
