// HR events service (apollo-demo hr-events-service), topic hr.person.
import { need } from "../../../shared/rest.js";
import { OutboxRelay } from "../../../shared/outbox.js";
import { eventService } from "../../../shared/event-service.js";
import { person } from "../../../shared/entities.js";
import { given, newId } from "../../../shared/rows.js";

export { OutboxRelay };

export default eventService({
  entity: person, path: "persons", topic: "hr.person", idKey: "personId", label: "Person",
  routes: (persons) => [
    ["POST", "/api/persons", (r) => {
      const { name, email, hireDate } = need(r.body, "name", "email");
      return persons.insert(r, { id: newId("person"), name, email, hireDate: hireDate ?? null, active: true },
        "PersonCreated");
    }, 201],
    ["PUT", "/api/persons/:id", (r) =>
      persons.change(r, "PersonUpdated", given({ name: r.query.get("name"), email: r.query.get("email") }))],
    ["POST", "/api/persons/:id/terminate", (r) => persons.change(r, "PersonTerminated", { active: false })],
  ],
});
