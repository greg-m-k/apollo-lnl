// Security subgraph: owns BadgeHolder and adds Person.badge (apollo-demo security-subgraph).
import typeDefs from "../../../shared/schema/security.graphql";
import { subgraph } from "../../../shared/subgraph.js";
import { VISIBLE, bool, newId, ownRow, requireSession } from "../../../shared/rows.js";

const badge = (r) => r && {
  id: r.id, personId: r.person_id, badgeNumber: r.badge_number,
  accessLevel: r.access_level, clearance: r.clearance, active: bool(r.active),
};
const list = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results.map(badge);
const one = async (db, sql, ...args) => badge(await db.prepare(sql).bind(...args).first());
const byPerson = (db, personId, session) =>
  one(db, `SELECT * FROM badge_holders WHERE person_id = ? AND ${VISIBLE} ORDER BY created_at LIMIT 1`, personId, session);

// The Quarkus service numbers badges B<epoch ms % 100000>.
export const badgeNumber = (now = Date.now()) => `B${now % 100000}`;

async function change(ctx, id, set) {
  const { db, session, timing } = ctx;
  const row = await timing.step("db_read", () => ownRow(db, "badge_holders", id, session));
  if (!row) return null;
  const next = { ...badge(row), ...set };
  await timing.step("db_write", () =>
    db.prepare("UPDATE badge_holders SET access_level = ?, clearance = ?, active = ? WHERE id = ?")
      .bind(next.accessLevel, next.clearance, next.active ? 1 : 0, id).run());
  return next;
}

export const resolvers = {
  Query: {
    badgeHolders: (_, __, { db, session, timing }) =>
      timing.step("db_query", () => list(db, `SELECT * FROM badge_holders WHERE ${VISIBLE} ORDER BY id`, session)),
    badgeHolder: (_, { id }, { db, session, timing }) =>
      timing.step("db_query", () => one(db, `SELECT * FROM badge_holders WHERE id = ? AND ${VISIBLE}`, id, session)),
    badgeHolderByPersonId: (_, { personId }, { db, session, timing }) =>
      timing.step("db_query", () => byPerson(db, personId, session)),
    badgeHolderByBadgeNumber: (_, { badgeNumber: n }, { db, session, timing }) =>
      timing.step("db_query", () => one(db, `SELECT * FROM badge_holders WHERE badge_number = ? AND ${VISIBLE}`, n, session)),
    badgeHoldersByAccessLevel: (_, { accessLevel }, { db, session, timing }) =>
      timing.step("db_query", () =>
        list(db, `SELECT * FROM badge_holders WHERE access_level = ? AND ${VISIBLE} ORDER BY id`, accessLevel, session)),
    activeBadgeHolders: (_, __, { db, session, timing }) =>
      timing.step("db_query", () => list(db, `SELECT * FROM badge_holders WHERE active = 1 AND ${VISIBLE} ORDER BY id`, session)),
  },
  Mutation: {
    provisionBadge: async (_, { personId, accessLevel, clearance }, { db, session, timing }) => {
      requireSession(session);
      if (await timing.step("db_read", () => byPerson(db, personId, session))) return null;
      const b = { id: newId("badge"), personId, badgeNumber: badgeNumber(), accessLevel, clearance, active: true };
      await timing.step("db_write", () =>
        db.prepare("INSERT INTO badge_holders (id, session, person_id, badge_number, access_level, clearance, active) VALUES (?, ?, ?, ?, ?, ?, 1)")
          .bind(b.id, session, personId, b.badgeNumber, accessLevel, clearance).run());
      return b;
    },
    changeAccessLevel: (_, { id, newAccessLevel }, ctx) => change(ctx, id, { accessLevel: newAccessLevel }),
    changeClearance: (_, { id, newClearance }, ctx) => change(ctx, id, { clearance: newClearance }),
    revokeBadge: (_, { id }, ctx) => change(ctx, id, { active: false }),
  },
  Person: {
    __resolveReference: ({ id }) => ({ id }),
    badge: ({ id }, _, { db, session, timing }) => timing.step("db_query", () => byPerson(db, id, session)),
  },
};

export default subgraph({ name: "security", typeDefs, resolvers });
