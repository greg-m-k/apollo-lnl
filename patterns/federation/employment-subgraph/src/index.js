// PATTERN: GraphQL Federation · Employment subgraph
//
// Owns Employee, and adds one field to HR's Person: `employee`. A port of the Quarkus
// service in services/federation/employment-subgraph of the apollo-demo. It stands alone:
// its own schema (../schema.graphql), its own database, no code shared with the others.
import { createYoga } from "graphql-yoga";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { GraphQLError, parse } from "graphql";
import typeDefs from "../schema.graphql";

const MINE = "session IN ('', ?)";  // the seed employees plus this visitor's own (plumbing, below)

const toEmployee = (row) => row && {
  id: row.id, personId: row.person_id, title: row.title, department: row.department, salary: row.salary,
  active: row.active === 1,
};

// The employee record of one person, if they have one.
const employeeOf = async (ctx, personId) => toEmployee(await first(ctx,
  `SELECT * FROM employees WHERE person_id = ? AND ${MINE} ORDER BY created_at LIMIT 1`, personId, ctx.session));

const resolvers = {
  Query: {
    employees: async (_, __, ctx) =>
      (await all(ctx, `SELECT * FROM employees WHERE ${MINE} ORDER BY id`, ctx.session)).map(toEmployee),
    employee: async (_, { id }, ctx) =>
      toEmployee(await first(ctx, `SELECT * FROM employees WHERE id = ? AND ${MINE}`, id, ctx.session)),
    employeeByPersonId: (_, { personId }, ctx) => employeeOf(ctx, personId),
    employeesByDepartment: async (_, { department }, ctx) =>
      (await all(ctx, `SELECT * FROM employees WHERE department = ? AND ${MINE} ORDER BY id`, department, ctx.session)).map(toEmployee),
    activeEmployees: async (_, __, ctx) =>
      (await all(ctx, `SELECT * FROM employees WHERE active = 1 AND ${MINE} ORDER BY id`, ctx.session)).map(toEmployee),
  },

  Mutation: {
    // Null when the person already has an employee record, as in the Quarkus subgraph.
    assignEmployee: async (_, { personId, title, department, salary }, ctx) => {
      if (await employeeOf(ctx, personId)) return null;
      const employee = { id: `emp-${crypto.randomUUID().slice(0, 8)}`, personId, title, department, salary: Number(salary), active: true };
      await run(ctx, "INSERT INTO employees (id, session, person_id, title, department, salary, active) VALUES (?, ?, ?, ?, ?, ?, 1)",
        employee.id, visitor(ctx), personId, title, department, employee.salary);
      return employee;
    },
    promoteEmployee: async (_, { id, newTitle, newSalary }, ctx) => {
      const employee = await ownEmployee(ctx, id);
      if (!employee) return null;
      const next = { ...employee, title: newTitle ?? employee.title, salary: newSalary == null ? employee.salary : Number(newSalary) };
      await run(ctx, "UPDATE employees SET title = ?, salary = ? WHERE id = ?", next.title, next.salary, id);
      return next;
    },
    transferEmployee: async (_, { id, newDepartment }, ctx) => {
      const employee = await ownEmployee(ctx, id);
      if (!employee) return null;
      await run(ctx, "UPDATE employees SET department = ? WHERE id = ?", newDepartment, id);
      return { ...employee, department: newDepartment };
    },
    terminateEmployee: async (_, { id }, ctx) => {
      const employee = await ownEmployee(ctx, id);
      if (!employee) return null;
      await run(ctx, "UPDATE employees SET active = 0 WHERE id = ?", id);
      return { ...employee, active: false };
    },
  },

  // FEDERATION. Person belongs to HR. This subgraph extends it (@key(fields: "id") @extends)
  // with the `employee` field. The router sends a reference, { __typename: "Person", id },
  // for each person it got from HR. No lookup of the person is needed here: the reference
  // is passed on as it is, and `employee` finds the record that points at that id.
  Person: {
    __resolveReference: ({ id }) => ({ id }),
    employee: ({ id }, _, ctx) => employeeOf(ctx, id),
  },
};

const yoga = createYoga({
  schema: buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers }]),
  graphqlEndpoint: "/graphql",
  landingPage: false,
  maskedErrors: false,
});

export default {
  async fetch(request, env, executionContext) {
    const started = Date.now();
    const lesson = lessonSwitch(request, "employment");
    if (lesson.down) return new Response("employment subgraph is down (lesson switch)", { status: 503 });
    if (lesson.delayMs) await new Promise((resolve) => setTimeout(resolve, lesson.delayMs));

    const ctx = { db: env.DB, session: sessionOf(request), dbMs: 0 };
    const response = await yoga.fetch(request, ctx, executionContext);

    // Like the Quarkus TimingFilter: how long this subgraph took, and how much of it was the database.
    const headers = new Headers(response.headers);
    const total = Date.now() - started;
    headers.set("x-time-ms", String(total));
    headers.set("x-timing-details", JSON.stringify({ db: ctx.dbMs, total }));
    return new Response(response.body, { status: response.status, headers });
  },

  // Every few minutes: clear visitors' employees 20 minutes after they were created. Seed rows stay.
  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM employees WHERE session != '' AND created_at < ?").bind(Date.now() - 20 * 60 * 1000).run();
  },
};

// ---------------------------------------------------------------------------------------
// Lunch & Learn plumbing. Not part of the federation pattern: it gives every visitor their
// own employees, lets them switch this service off or slow it down, and reports timings.
// ---------------------------------------------------------------------------------------

// The visitor's session id. Rows carry it; seed rows have session '' and belong to everyone.
function sessionOf(request) {
  const session = request.headers.get("x-lnl-session") ?? "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(session) ? session : "";
}

// Writes need a session, and may change only the visitor's own rows: seed rows are read-only.
function visitor(ctx) {
  if (!ctx.session) throw new GraphQLError("Writes need a session (x-lnl-session header).");
  return ctx.session;
}
async function ownEmployee(ctx, id) {
  const row = await first(ctx, `SELECT * FROM employees WHERE id = ? AND ${MINE}`, id, ctx.session);
  if (row?.session === "") throw new GraphQLError(`${id} is seed data and read-only. Create your own to change it.`);
  return toEmployee(row);
}

// What the visitor's x-lnl-chaos header asks of this service: {"down": ["employment"], "delay": {"employment": 300}}.
function lessonSwitch(request, name) {
  let asked = {};
  try { asked = JSON.parse(request.headers.get("x-lnl-chaos") || "{}") ?? {}; } catch { /* malformed: no switch */ }
  const delay = Number(asked.delay?.[name]);
  return { down: Array.isArray(asked.down) && asked.down.includes(name), delayMs: delay > 0 ? Math.min(delay, 5000) : 0 };
}

// Database calls, with their time added up for x-timing-details.
async function timed(ctx, work) {
  const started = Date.now();
  try { return await work; } finally { ctx.dbMs += Date.now() - started; }
}
async function all(ctx, sql, ...args) { return (await timed(ctx, ctx.db.prepare(sql).bind(...args).all())).results; }
function first(ctx, sql, ...args) { return timed(ctx, ctx.db.prepare(sql).bind(...args).first()); }
function run(ctx, sql, ...args) { return timed(ctx, ctx.db.prepare(sql).bind(...args).run()); }
