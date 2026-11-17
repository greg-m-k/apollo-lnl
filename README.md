# Lunch & Learn: Federation vs Event-Driven Projections, on Cloudflare

A Lunch & Learn that compares patterns: the same question answered by each, running side by side. Two patterns so far; a new one is a new folder under `patterns/`.
Built from [apollo-federation-vs-kafka-projections-demo](https://github.com/greg-m-k/apollo-federation-vs-kafka-projections-demo)
and ported from Kubernetes (Quarkus, Apollo Router, Kafka, Postgres) to Cloudflare Workers.
Live at https://lnl.greg.kitchen.

- **GraphQL Federation** (`patterns/federation/`): compose the answer on every request.
- **Event-driven projections** (`patterns/event-projections/`): copy the data ahead of time and read the copy.

Every service is one self-contained file (`src/index.js`) with its own database and its own
migrations, as each was its own Quarkus project in the original. Nothing is shared between
services: open a file and the whole pattern is there. Each file ends with a marked block of
"Lunch & Learn plumbing" (visitor sessions, lesson switches, timings) that is not part of the pattern.

## Pattern: GraphQL Federation, `patterns/federation/`

| Service | apollo-demo | What to read it for |
|---|---|---|
| `router` | Apollo Router + `supergraph.graphql` + `timing.rhai` | One endpoint; Hive Gateway plans the query over the same supergraph and calls the subgraphs |
| `hr-subgraph` | hr-subgraph | Owns `Person` (`@key`), entity resolver, direct writes |
| `employment-subgraph` | employment-subgraph | Extends `Person` with `employee` (`@extends`) |
| `security-subgraph` | security-subgraph | Extends `Person` with `badge` (`@extends`) |

## Pattern: event-driven projections, `patterns/event-projections/`

| Service | apollo-demo | What to read it for |
|---|---|---|
| `hr-events` | hr-events-service | REST writes, the outbox pattern, the relay |
| `employment-events` | employment-events-service | The same, for employees |
| `security-events` | security-events-service | The same, for badges |
| `projection-consumer` | projection-consumer | Topics in, projections out; applying each event once |
| `query-service` | query-service | One local read for the whole answer; data freshness |

Kafka topics are Cloudflare Queues (`lnl-events-*`), Postgres databases are D1, and each outbox
relay is a Durable Object.

## The site: `site/`

- `site/web`: the lesson pages (`public/`) and one same-origin `/api` that passes calls on to the patterns.
- `site/lesson`: each visitor's "broker down" and "consumer paused" switches.

Lessons: one question three services, when a service goes down, write then read, when the bus stops,
so which one, how this runs on Cloudflare.

Each visitor has a session: their switches and the people they create are theirs alone. Seed people
are shared and read-only; visitor rows are cleared 20 minutes after they were written.

## Run locally

    npm install
    npm run dev          # applies local D1 migrations, serves everything on http://localhost:8800

## Test

    npm test             # the consumer against SQLite, and the query service's composed view
    npm run e2e          # end-to-end against the running demo (BASE=https://lnl.greg.kitchen for production)
    npm run ui           # drives every lesson in the installed Edge (playwright-core)

## Deploy

    npm run deploy       # remote D1 migrations, then every Worker in binding order
