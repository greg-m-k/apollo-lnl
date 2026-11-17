// PATTERN: GraphQL Federation · Security subgraph
//
// Owns BadgeHolder, and adds one field to HR's Person: `badge`. A port of the Quarkus
// service in services/federation/security-subgraph of the apollo-demo. It stands alone:
// its own schema (../schema.graphql), its own database, no code shared with the others.
import { createYoga } from "graphql-yoga";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { GraphQLError, parse } from "graphql";
import typeDefs from "../schema.graphql";

const MINE = "session IN ('', ?)";  // the seed badges plus this visitor's own (plumbing, below)

const toBadge = (row) => row && {
  id: row.id, personId: row.person_id, badgeNumber: row.badge_number,
  accessLevel: row.access_level, clearance: row.clearance, active: row.active === 1,
};

// The badge of one person, if they have one.
const badgeOf = async (ctx, personId) => toBadge(await first(ctx,
  `SELECT * FROM badge_holders WHERE person_id = ? AND ${MINE} ORDER BY created_at LIMIT 1`, personId, ctx.session));

const resolvers = {
  Query: {
    badgeHolders: async (_, __, ctx) =>
      (await all(ctx, `SELECT * FROM badge_holders WHERE ${MINE} ORDER BY id`, ctx.session)).map(toBadge),
    badgeHolder: async (_, { id }, ctx) =>
      toBadge(await first(ctx, `SELECT * FROM badge_holders WHERE id = ? AND ${MINE}`, id, ctx.session)),
    badgeHolderByPersonId: (_, { personId }, ctx) => badgeOf(ctx, personId),
    badgeHolderByBadgeNumber: async (_, { badgeNumber }, ctx) =>
      toBadge(await first(ctx, `SELECT * FROM badge_holders WHERE badge_number = ? AND ${MINE}`, badgeNumber, ctx.session)),
    badgeHoldersByAccessLevel: async (_, { accessLevel }, ctx) =>
      (await all(ctx, `SELECT * FROM badge_holders WHERE access_level = ? AND ${MINE} ORDER BY id`, accessLevel, ctx.session)).map(toBadge),
    activeBadgeHolders: async (_, __, ctx) =>
      (await all(ctx, `SELECT * FROM badge_holders WHERE active = 1 AND ${MINE} ORDER BY id`, ctx.session)).map(toBadge),
  },

  Mutation: {
    // Null when the person already has a badge, as in the Quarkus subgraph.
    provisionBadge: async (_, { personId, accessLevel, clearance }, ctx) => {
      if (await badgeOf(ctx, personId)) return null;
      const badge = {
        id: `badge-${crypto.randomUUID().slice(0, 8)}`, personId, badgeNumber: `B${Date.now() % 100000}`,
        accessLevel, clearance, active: true,
      };
      await run(ctx, "INSERT INTO badge_holders (id, session, person_id, badge_number, access_level, clearance, active) VALUES (?, ?, ?, ?, ?, ?, 1)",
        badge.id, visitor(ctx), personId, badge.badgeNumber, accessLevel, clearance);
      return badge;
    },
    changeAccessLevel: async (_, { id, newAccessLevel }, ctx) => {
      const badge = await ownBadge(ctx, id);
      if (!badge) return null;
      await run(ctx, "UPDATE badge_holders SET access_level = ? WHERE id = ?", newAccessLevel, id);
      return { ...badge, accessLevel: newAccessLevel };
    },
    changeClearance: async (_, { id, newClearance }, ctx) => {
      const badge = await ownBadge(ctx, id);
      if (!badge) return null;
      await run(ctx, "UPDATE badge_holders SET clearance = ? WHERE id = ?", newClearance, id);
      return { ...badge, clearance: newClearance };
    },
    revokeBadge: async (_, { id }, ctx) => {
      const badge = await ownBadge(ctx, id);
      if (!badge) return null;
      await run(ctx, "UPDATE badge_holders SET active = 0 WHERE id = ?", id);
      return { ...badge, active: false };
    },
  },

  // FEDERATION. Person belongs to HR. This subgraph extends it (@key(fields: "id") @extends)
  // with the `badge` field. The router sends a reference, { __typename: "Person", id }, for
  // each person it got from HR. No lookup of the person is needed here: the reference is
  // passed on as it is, and `badge` finds the record that points at that id.
  Person: {
    __resolveReference: ({ id }) => ({ id }),
    badge: ({ id }, _, ctx) => badgeOf(ctx, id),
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
    const lesson = lessonSwitch(request, "security");
    if (lesson.down) return new Response("security subgraph is down (lesson switch)", { status: 503 });
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

  // Every few minutes: clear visitors' badges 20 minutes after they were created. Seed rows stay.
  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM badge_holders WHERE session != '' AND created_at < ?").bind(Date.now() - 20 * 60 * 1000).run();
  },
};

// ---------------------------------------------------------------------------------------
// Lunch & Learn plumbing. Not part of the federation pattern: it gives every visitor their
// own badges, lets them switch this service off or slow it down, and reports timings.
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
async function ownBadge(ctx, id) {
  const row = await first(ctx, `SELECT * FROM badge_holders WHERE id = ? AND ${MINE}`, id, ctx.session);
  if (row?.session === "") throw new GraphQLError(`${id} is seed data and read-only. Create your own to change it.`);
  return toBadge(row);
}

// What the visitor's x-lnl-chaos header asks of this service: {"down": ["security"], "delay": {"security": 300}}.
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
