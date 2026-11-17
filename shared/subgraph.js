// One federation subgraph as a Worker: GraphQL Yoga serving an Apollo subgraph schema
// over the subgraph's own D1 database. The Cloudflare counterpart of one Quarkus
// subgraph service in the apollo-demo.
import { createYoga } from "graphql-yoga";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import { chaosFrom, sessionFrom, sleep } from "./chaos.js";
import { Timing } from "./timing.js";

// name: "hr" | "employment" | "security"; resolvers get context { db, session, timing }.
export function subgraph({ name, typeDefs, resolvers }) {
  const yoga = createYoga({
    schema: buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers }]),
    graphqlEndpoint: "/graphql",
    landingPage: false,
    maskedErrors: false,
  });
  return {
    async fetch(request, env, ctx) {
      const timing = new Timing();
      const chaos = chaosFrom(request);
      if (chaos.down.includes(name)) {
        return new Response(`${name} subgraph is down (lesson switch)`, { status: 503 });
      }
      if (chaos.delay[name]) await sleep(chaos.delay[name]);
      const response = await yoga.fetch(request, { db: env.DB, session: sessionFrom(request), timing }, ctx);
      const headers = new Headers(response.headers);
      headers.set(`x-${name}-time-ms`, String(timing.total()));
      headers.set("x-timing-details", JSON.stringify(timing.details()));
      return new Response(response.body, { status: response.status, headers });
    },
  };
}
