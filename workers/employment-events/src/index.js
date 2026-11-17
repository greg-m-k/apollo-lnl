// Employment events service (apollo-demo employment-events-service), topic employment.employee.
import { need } from "../../../shared/rest.js";
import { OutboxRelay } from "../../../shared/outbox.js";
import { eventService } from "../../../shared/event-service.js";
import { employee } from "../../../shared/entities.js";
import { given, newId } from "../../../shared/rows.js";

export { OutboxRelay };

const number = (text) => (text ? Number(text) : null);

export default eventService({
  entity: employee, path: "employees", topic: "employment.employee", idKey: "employeeId", label: "Employee",
  onePerPerson: "Person already has an employee record",
  routes: (employees) => [
    ["POST", "/api/employees", (r) => {
      const { personId, title, department, salary } = need(r.body, "personId", "title", "department", "salary");
      return employees.insert(r, { id: newId("emp"), personId, title, department, salary: Number(salary), active: true },
        "EmployeeAssigned");
    }, 201],
    ["PUT", "/api/employees/:id/promote", (r) => employees.change(r, "EmployeePromoted",
      given({ title: r.query.get("title"), salary: number(r.query.get("salary")) }))],
    ["PUT", "/api/employees/:id/transfer", (r) =>
      employees.change(r, "EmployeeTransferred", given({ department: r.query.get("department") }))],
    ["POST", "/api/employees/:id/terminate", (r) => employees.change(r, "EmployeeTerminated", { active: false })],
  ],
});
