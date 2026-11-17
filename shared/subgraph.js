// One federation subgraph as a Worker: GraphQL Yoga serving an Apollo subgraph schema
// over the subgraph's own D1 database. The Cloudflare counterpart of one Quarkus
// subgraph service in the apollo-demo.
import { createYoga } from "graphql-yoga";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import { chaosFor, sessionFrom, sleep } from "./chaos.js";
import { Timing } from "./timing.js";
import { VISIBLE, insertRow, updateRow, ownRow, requireSession } from "./rows.js";
import { sweeper } from "./sweep.js";

// name: "hr" | "employment" | "security"; entity: the one it owns (entities.js).
// Resolvers get context { db, session, timing }.
export function subgraph({ name, entity, typeDefs, resolvers }) {
  const yoga = createYoga({
    schema: buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers }]),
    graphqlEndpoint: "/graphql",
    landingPage: false,
    maskedErrors: false,
  });
  return {
    async fetch(request, env, ctx) {
      const timing = new Timing();
      const { down, delayMs } = chaosFor(request, name);
      if (down) return new Response(`${name} subgraph is down (lesson switch)`, { status: 503 });
      if (delayMs) await sleep(delayMs);
      return timing.stamp(await yoga.fetch(request, { db: env.DB, session: sessionFrom(request), timing }, ctx));
    },
    scheduled: sweeper({ [entity.table]: "created_at" }),
  };
}

// Timed reads of an entity's table, limited to what the session may see.
export function reader({ table, toJson }) {
  const query = ({ db, session }, where, args) =>
    db.prepare(`SELECT * FROM ${table} WHERE ${where} AND ${VISIBLE} ORDER BY id`).bind(...args, session);
  return {
    list: (ctx, where = "1 = 1", ...args) =>
      ctx.timing.step("db_query", async () => (await query(ctx, where, args).all()).results.map(toJson)),
    one: (ctx, where, ...args) => ctx.timing.step("db_query", async () => toJson(await query(ctx, where, args).first())),
  };
}

// Insert a new entity for the session.
export async function create({ db, session, timing }, entity, obj) {
  const cols = { id: obj.id, session: requireSession(session), ...entity.columns(obj) };
  await timing.step("db_write", () => insertRow(db, entity.table, cols).run());
  return obj;
}

// Change an entity the session owns: read it, merge `set`, write it back. Null if not visible.
export async function change({ db, session, timing }, entity, id, set) {
  const row = await timing.step("db_read", () => ownRow(db, entity.table, id, session));
  if (!row) return null;
  const next = { ...entity.toJson(row), ...set };
  await timing.step("db_write", () => updateRow(db, entity.table, id, entity.columns(next)).run());
  return next;
}
