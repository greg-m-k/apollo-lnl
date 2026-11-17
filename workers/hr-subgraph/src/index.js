// HR subgraph: owns Person, the canonical source of identity (apollo-demo hr-subgraph).
import typeDefs from "../../../shared/schema/hr.graphql";
import { sweeper } from "../../../shared/sweep.js";
import { subgraph } from "../../../shared/subgraph.js";
import { VISIBLE, bool, newId, ownRow, requireSession } from "../../../shared/rows.js";

const person = (r) => r && { id: r.id, name: r.name, email: r.email, hireDate: r.hire_date, active: bool(r.active) };
const list = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results.map(person);
const one = async (db, sql, ...args) => person(await db.prepare(sql).bind(...args).first());

export const resolvers = {
  Query: {
    persons: (_, __, { db, session, timing }) =>
      timing.step("db_query", () => list(db, `SELECT * FROM persons WHERE ${VISIBLE} ORDER BY id`, session)),
    person: (_, { id }, { db, session, timing }) =>
      timing.step("db_query", () => one(db, `SELECT * FROM persons WHERE id = ? AND ${VISIBLE}`, id, session)),
    personByEmail: (_, { email }, { db, session, timing }) =>
      timing.step("db_query", () => one(db, `SELECT * FROM persons WHERE email = ? AND ${VISIBLE}`, email, session)),
    activePersons: (_, __, { db, session, timing }) =>
      timing.step("db_query", () => list(db, `SELECT * FROM persons WHERE active = 1 AND ${VISIBLE} ORDER BY id`, session)),
    searchPersons: (_, { name }, { db, session, timing }) =>
      timing.step("db_query", () =>
        list(db, `SELECT * FROM persons WHERE name LIKE ? AND ${VISIBLE} ORDER BY id`, `%${name}%`, session)),
  },
  Mutation: {
    createPerson: async (_, { name, email, hireDate }, { db, session, timing }) => {
      const p = { id: newId("person"), name, email, hireDate: hireDate ?? null, active: true };
      await timing.step("db_write", () =>
        db.prepare("INSERT INTO persons (id, session, name, email, hire_date, active) VALUES (?, ?, ?, ?, ?, 1)")
          .bind(p.id, requireSession(session), name, email, p.hireDate).run());
      return p;
    },
    updatePerson: async (_, { id, name, email }, { db, session, timing }) => {
      const row = await timing.step("db_read", () => ownRow(db, "persons", id, session));
      if (!row) return null;
      const next = { ...person(row), name: name ?? row.name, email: email ?? row.email };
      await timing.step("db_write", () =>
        db.prepare("UPDATE persons SET name = ?, email = ? WHERE id = ?").bind(next.name, next.email, id).run());
      return next;
    },
    terminatePerson: async (_, { id }, { db, session, timing }) => {
      const row = await timing.step("db_read", () => ownRow(db, "persons", id, session));
      if (!row) return null;
      await timing.step("db_write", () => db.prepare("UPDATE persons SET active = 0 WHERE id = ?").bind(id).run());
      return { ...person(row), active: false };
    },
  },
  Person: {
    __resolveReference: ({ id }, { db, session, timing }) =>
      timing.step("db_resolve", () => one(db, `SELECT * FROM persons WHERE id = ? AND ${VISIBLE}`, id, session)),
  },
};

const scheduled = sweeper({ persons: "created_at" });

export default { ...subgraph({ name: "hr", typeDefs, resolvers }), scheduled };
