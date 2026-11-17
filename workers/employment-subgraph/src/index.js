// Employment subgraph: owns Employee and adds Person.employee (apollo-demo employment-subgraph).
import typeDefs from "../../../shared/schema/employment.graphql";
import { subgraph, reader, create, change } from "../../../shared/subgraph.js";
import { employee } from "../../../shared/entities.js";
import { given, newId } from "../../../shared/rows.js";

const { list, one } = reader(employee);
const ofPerson = (ctx, personId) => one(ctx, "person_id = ?", personId);

const resolvers = {
  Query: {
    employees: (_, __, ctx) => list(ctx),
    employee: (_, { id }, ctx) => one(ctx, "id = ?", id),
    employeeByPersonId: (_, { personId }, ctx) => ofPerson(ctx, personId),
    employeesByDepartment: (_, { department }, ctx) => list(ctx, "department = ?", department),
    activeEmployees: (_, __, ctx) => list(ctx, "active = 1"),
  },
  Mutation: {
    // Null when the person already has an employee record, as in the Quarkus subgraph.
    assignEmployee: async (_, { personId, title, department, salary }, ctx) =>
      (await ofPerson(ctx, personId))
        ? null
        : create(ctx, employee, { id: newId("emp"), personId, title, department, salary: Number(salary), active: true }),
    promoteEmployee: (_, { id, newTitle, newSalary }, ctx) =>
      change(ctx, employee, id, given({ title: newTitle, salary: newSalary == null ? null : Number(newSalary) })),
    transferEmployee: (_, { id, newDepartment }, ctx) => change(ctx, employee, id, { department: newDepartment }),
    terminateEmployee: (_, { id }, ctx) => change(ctx, employee, id, { active: false }),
  },
  // Like the Quarkus subgraph: a Person reference is a stub, no lookup of its own.
  Person: {
    __resolveReference: ({ id }) => ({ id }),
    employee: ({ id }, _, ctx) => ofPerson(ctx, id),
  },
};

export default subgraph({ name: "employment", entity: employee, typeDefs, resolvers });
