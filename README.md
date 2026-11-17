# Lunch & Learn: Federation vs Event-Driven Projections, on Cloudflare

An interactive Lunch & Learn built from
[apollo-federation-vs-kafka-projections-demo](https://github.com/greg-m-k/apollo-federation-vs-kafka-projections-demo),
ported from Kubernetes (Quarkus, Apollo Router, Kafka, Postgres) to eleven Cloudflare Workers.
Live at https://lnl.greg.kitchen.

| apollo-demo | Here |
|---|---|
| Apollo Router + supergraph + timing.rhai | `workers/router`: Hive Gateway over the same supergraph, service bindings to subgraphs |
| hr / employment / security subgraphs | `workers/*-subgraph`: GraphQL Yoga + `@apollo/subgraph`, same SDL, one D1 each |
| Event services with transactional outbox | `workers/*-events`: same REST APIs, entity + outbox row in one D1 batch |
| Outbox relay (`@Scheduled every 1s`) | `OutboxRelay` Durable Object per service and visitor |
| Kafka topics | Cloudflare Queues `lnl-events-*` |
| Projection consumer | `workers/projection-consumer` (queue consumer, idempotent upserts) |
| Query service | `workers/query-service` |
| `kubectl scale … --replicas=0` | Per-visitor switches: a request header for subgraphs, `workers/lesson` for broker and consumer |
| React dashboard | `workers/web`: lesson pages + same-origin `/api` |

Lessons: one question three services, when a service goes down, write then read, when the bus stops,
so which one, how this runs on Cloudflare.

Each visitor has a session: their outage switches and the people they create are theirs alone. Seed
people are shared and read-only; visitor rows are swept 20 minutes after they were written.

## Layout

- `shared/entities.js`: person, employee and badge, defined once for the subgraphs, the event services and the projections.
- `shared/subgraph.js`, `shared/event-service.js`: what every subgraph Worker and every event Worker has in common.
- `shared/rows.js`: the session and seed-row rules. `shared/rest.js`: REST routing. `shared/outbox.js`: outbox and relay.
- `workers/*/src/index.js`: each Worker's own schema, routes or resolvers. `workers/*/migrations`: its D1 schema.
- `workers/web/public`: the lesson pages; `lib/` holds what they share.

## Run locally

    npm install
    npm run dev          # applies local D1 migrations, serves everything on http://localhost:8800

## Test

    npm test             # unit tests: pure logic, REST routing, the consumer against SQLite
    npm run e2e          # end-to-end against the running demo (BASE=https://lnl.greg.kitchen for production)
    npm run ui           # drives every lesson in the installed Edge (playwright-core)

## Deploy

    npm run deploy       # remote D1 migrations, then every Worker in binding order
