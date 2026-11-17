// HR subgraph: owns Person, the canonical source of identity (apollo-demo hr-subgraph).
import typeDefs from "../../../shared/schema/hr.graphql";
import { subgraph, reader, create, change } from "../../../shared/subgraph.js";
import { person } from "../../../shared/entities.js";
import { given, newId } from "../../../shared/rows.js";

const { list, one } = reader(person);

const resolvers = {
  Query: {
    persons: (_, __, ctx) => list(ctx),
    person: (_, { id }, ctx) => one(ctx, "id = ?", id),
    personByEmail: (_, { email }, ctx) => one(ctx, "email = ?", email),
    activePersons: (_, __, ctx) => list(ctx, "active = 1"),
    searchPersons: (_, { name }, ctx) => list(ctx, "name LIKE ?", `%${name}%`),
  },
  Mutation: {
    createPerson: (_, { name, email, hireDate }, ctx) =>
      create(ctx, person, { id: newId("person"), name, email, hireDate: hireDate ?? null, active: true }),
    updatePerson: (_, { id, name, email }, ctx) => change(ctx, person, id, given({ name, email })),
    terminatePerson: (_, { id }, ctx) => change(ctx, person, id, { active: false }),
  },
  Person: {
    __resolveReference: ({ id }, ctx) => one(ctx, "id = ?", id),
  },
};

export default subgraph({ name: "hr", entity: person, typeDefs, resolvers });
