// Security subgraph: owns BadgeHolder and adds Person.badge (apollo-demo security-subgraph).
import typeDefs from "../../../shared/schema/security.graphql";
import { subgraph, reader, create, change } from "../../../shared/subgraph.js";
import { badge, newBadgeNumber } from "../../../shared/entities.js";
import { newId } from "../../../shared/rows.js";

const { list, one } = reader(badge);
const ofPerson = (ctx, personId) => one(ctx, "person_id = ?", personId);

const resolvers = {
  Query: {
    badgeHolders: (_, __, ctx) => list(ctx),
    badgeHolder: (_, { id }, ctx) => one(ctx, "id = ?", id),
    badgeHolderByPersonId: (_, { personId }, ctx) => ofPerson(ctx, personId),
    badgeHolderByBadgeNumber: (_, { badgeNumber }, ctx) => one(ctx, "badge_number = ?", badgeNumber),
    badgeHoldersByAccessLevel: (_, { accessLevel }, ctx) => list(ctx, "access_level = ?", accessLevel),
    activeBadgeHolders: (_, __, ctx) => list(ctx, "active = 1"),
  },
  Mutation: {
    // Null when the person already has a badge, as in the Quarkus subgraph.
    provisionBadge: async (_, { personId, accessLevel, clearance }, ctx) =>
      (await ofPerson(ctx, personId))
        ? null
        : create(ctx, badge, {
          id: newId("badge"), personId, badgeNumber: newBadgeNumber(), accessLevel, clearance, active: true,
        }),
    changeAccessLevel: (_, { id, newAccessLevel }, ctx) => change(ctx, badge, id, { accessLevel: newAccessLevel }),
    changeClearance: (_, { id, newClearance }, ctx) => change(ctx, badge, id, { clearance: newClearance }),
    revokeBadge: (_, { id }, ctx) => change(ctx, badge, id, { active: false }),
  },
  Person: {
    __resolveReference: ({ id }) => ({ id }),
    badge: ({ id }, _, ctx) => ofPerson(ctx, id),
  },
};

export default subgraph({ name: "security", entity: badge, typeDefs, resolvers });
