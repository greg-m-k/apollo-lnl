// Employment subgraph: owns Employee and adds Person.employee (apollo-demo employment-subgraph).
import typeDefs from "../../../shared/schema/employment.graphql";
import { subgraph } from "../../../shared/subgraph.js";
import { VISIBLE, bool, newId, ownRow, requireSession } from "../../../shared/rows.js";

const employee = (r) => r && {
  id: r.id, personId: r.person_id, title: r.title, department: r.department, salary: r.salary, active: bool(r.active),
};
const list = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results.map(employee);
const one = async (db, sql, ...args) => employee(await db.prepare(sql).bind(...args).first());
const byPerson = (db, personId, session) =>
  one(db, `SELECT * FROM employees WHERE person_id = ? AND ${VISIBLE} ORDER BY created_at LIMIT 1`, personId, session);

async function change(ctx, id, set) {
  const { db, session, timing } = ctx;
  const row = await timing.step("db_read", () => ownRow(db, "employees", id, session));
  if (!row) return null;
  const next = { ...employee(row), ...set };
  await timing.step("db_write", () =>
    db.prepare("UPDATE employees SET title = ?, department = ?, salary = ?, active = ? WHERE id = ?")
      .bind(next.title, next.department, next.salary, next.active ? 1 : 0, id).run());
  return next;
}

export const resolvers = {
  Query: {
    employees: (_, __, { db, session, timing }) =>
      timing.step("db_query", () => list(db, `SELECT * FROM employees WHERE ${VISIBLE} ORDER BY id`, session)),
    employee: (_, { id }, { db, session, timing }) =>
      timing.step("db_query", () => one(db, `SELECT * FROM employees WHERE id = ? AND ${VISIBLE}`, id, session)),
    employeeByPersonId: (_, { personId }, { db, session, timing }) =>
      timing.step("db_query", () => byPerson(db, personId, session)),
    employeesByDepartment: (_, { department }, { db, session, timing }) =>
      timing.step("db_query", () =>
        list(db, `SELECT * FROM employees WHERE department = ? AND ${VISIBLE} ORDER BY id`, department, session)),
    activeEmployees: (_, __, { db, session, timing }) =>
      timing.step("db_query", () => list(db, `SELECT * FROM employees WHERE active = 1 AND ${VISIBLE} ORDER BY id`, session)),
  },
  Mutation: {
    assignEmployee: async (_, { personId, title, department, salary }, { db, session, timing }) => {
      requireSession(session);
      if (await timing.step("db_read", () => byPerson(db, personId, session))) return null;
      const e = { id: newId("emp"), personId, title, department, salary: Number(salary), active: true };
      await timing.step("db_write", () =>
        db.prepare("INSERT INTO employees (id, session, person_id, title, department, salary, active) VALUES (?, ?, ?, ?, ?, ?, 1)")
          .bind(e.id, session, personId, title, department, e.salary).run());
      return e;
    },
    promoteEmployee: (_, { id, newTitle, newSalary }, ctx) =>
      change(ctx, id, {
        ...(newTitle != null && { title: newTitle }),
        ...(newSalary != null && { salary: Number(newSalary) }),
      }),
    transferEmployee: (_, { id, newDepartment }, ctx) => change(ctx, id, { department: newDepartment }),
    terminateEmployee: (_, { id }, ctx) => change(ctx, id, { active: false }),
  },
  // Like the Quarkus subgraph: a Person reference is a stub, no lookup of its own.
  Person: {
    __resolveReference: ({ id }) => ({ id }),
    employee: ({ id }, _, { db, session, timing }) => timing.step("db_query", () => byPerson(db, id, session)),
  },
};

export default subgraph({ name: "employment", typeDefs, resolvers });
