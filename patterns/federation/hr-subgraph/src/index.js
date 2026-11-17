// PATTERN: GraphQL Federation · HR subgraph
//
// Owns Person, the canonical source of identity. A port of the Quarkus service in
// services/federation/hr-subgraph of the apollo-demo. Like every service in this demo it
// stands alone: its own schema (../schema.graphql), its own database, no code shared with
// the others.
import { createYoga } from "graphql-yoga";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { GraphQLError, parse } from "graphql";
import typeDefs from "../schema.graphql";

const MINE = "session IN ('', ?)";  // the seed people plus this visitor's own (plumbing, below)

const toPerson = (row) => row && {
  id: row.id, name: row.name, email: row.email, hireDate: row.hire_date, active: row.active === 1,
};

const resolvers = {
  Query: {
    persons: async (_, __, ctx) =>
      (await all(ctx, `SELECT * FROM persons WHERE ${MINE} ORDER BY id`, ctx.session)).map(toPerson),
    person: async (_, { id }, ctx) =>
      toPerson(await first(ctx, `SELECT * FROM persons WHERE id = ? AND ${MINE}`, id, ctx.session)),
    personByEmail: async (_, { email }, ctx) =>
      toPerson(await first(ctx, `SELECT * FROM persons WHERE email = ? AND ${MINE}`, email, ctx.session)),
    activePersons: async (_, __, ctx) =>
      (await all(ctx, `SELECT * FROM persons WHERE active = 1 AND ${MINE} ORDER BY id`, ctx.session)).map(toPerson),
    searchPersons: async (_, { name }, ctx) =>
      (await all(ctx, `SELECT * FROM persons WHERE name LIKE ? AND ${MINE} ORDER BY id`, `%${name}%`, ctx.session)).map(toPerson),
  },

  Mutation: {
    // A write goes straight to the owner's database. When this returns, every read sees it.
    createPerson: async (_, { name, email, hireDate }, ctx) => {
      const person = { id: `person-${crypto.randomUUID().slice(0, 8)}`, name, email, hireDate: hireDate ?? null, active: true };
      await run(ctx, "INSERT INTO persons (id, session, name, email, hire_date, active) VALUES (?, ?, ?, ?, ?, 1)",
        person.id, visitor(ctx), name, email, person.hireDate);
      return person;
    },
    updatePerson: async (_, { id, name, email }, ctx) => {
      const person = await ownPerson(ctx, id);
      if (!person) return null;
      const next = { ...person, name: name ?? person.name, email: email ?? person.email };
      await run(ctx, "UPDATE persons SET name = ?, email = ? WHERE id = ?", next.name, next.email, id);
      return next;
    },
    terminatePerson: async (_, { id }, ctx) => {
      const person = await ownPerson(ctx, id);
      if (!person) return null;
      await run(ctx, "UPDATE persons SET active = 0 WHERE id = ?", id);
      return { ...person, active: false };
    },
  },

  // FEDERATION. Person is declared with @key(fields: "id"). When another subgraph hands the
  // router a reference to a Person ({ id }), the router asks this resolver for the rest.
  Person: {
    __resolveReference: async ({ id }, ctx) =>
      toPerson(await first(ctx, `SELECT * FROM persons WHERE id = ? AND ${MINE}`, id, ctx.session)),
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
    const lesson = lessonSwitch(request, "hr");
    if (lesson.down) return new Response("hr subgraph is down (lesson switch)", { status: 503 });
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

  // Every few minutes: clear visitors' people 20 minutes after they were created. Seed people stay.
  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM persons WHERE session != '' AND created_at < ?").bind(Date.now() - 20 * 60 * 1000).run();
  },
};

// ---------------------------------------------------------------------------------------
// Lunch & Learn plumbing. Not part of the federation pattern: it gives every visitor their
// own people, lets them switch this service off or slow it down, and reports timings.
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
async function ownPerson(ctx, id) {
  const row = await first(ctx, `SELECT * FROM persons WHERE id = ? AND ${MINE}`, id, ctx.session);
  if (row?.session === "") throw new GraphQLError(`${id} is seed data and read-only. Create your own to change it.`);
  return toPerson(row);
}

// What the visitor's x-lnl-chaos header asks of this service: {"down": ["hr"], "delay": {"hr": 300}}.
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
