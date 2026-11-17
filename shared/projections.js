// Where each topic's events land. Events are full snapshots of an entity, so a projection
// row holds the entity's own columns. `kind` names the projection in ids and API fields.
import { person, employee, badge } from "./entities.js";

export const PROJECTIONS = {
  "hr.person": { kind: "person", table: "person_projections", columns: person.columns },
  "employment.employee": { kind: "employee", table: "employee_projections", columns: employee.columns },
  "security.badge": { kind: "badge", table: "badge_projections", columns: badge.columns },
};

// The Quarkus consumer's idempotency key: kind, aggregate and event timestamp.
export const eventId = (kind, aggregateId, timestamp) => `${kind}-${aggregateId}-${timestamp}`;
