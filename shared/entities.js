// The domain's three entities, defined once: the table that holds one, how a row becomes
// the API object, and how the API object becomes column values. The subgraphs, the event
// services and the projections all store these same shapes.
import { bool } from "./rows.js";

const flag = (v) => (bool(v) ? 1 : 0);

export const person = {
  table: "persons",
  toJson: (r) => r && { id: r.id, name: r.name, email: r.email, hireDate: r.hire_date, active: bool(r.active) },
  columns: (p) => ({ name: p.name, email: p.email, hire_date: p.hireDate ?? null, active: flag(p.active) }),
};

export const employee = {
  table: "employees",
  toJson: (r) => r && {
    id: r.id, personId: r.person_id, title: r.title, department: r.department, salary: r.salary, active: bool(r.active),
  },
  columns: (e) => ({
    person_id: e.personId, title: e.title, department: e.department, salary: e.salary, active: flag(e.active),
  }),
};

export const badge = {
  table: "badge_holders",
  toJson: (r) => r && {
    id: r.id, personId: r.person_id, badgeNumber: r.badge_number,
    accessLevel: r.access_level, clearance: r.clearance, active: bool(r.active),
  },
  columns: (b) => ({
    person_id: b.personId, badge_number: b.badgeNumber, access_level: b.accessLevel, clearance: b.clearance,
    active: flag(b.active),
  }),
};

// The Quarkus security services number badges B<epoch ms % 100000>.
export const newBadgeNumber = () => `B${Date.now() % 100000}`;
