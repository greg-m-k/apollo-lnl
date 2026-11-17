// Projection consumer: reads the three topics (Cloudflare Queues) and upserts local read
// models (apollo-demo projection-consumer). Events are full snapshots, so every event
// type is the same upsert. Each event is applied once: its id is kept in processed_events.
import { restService, HttpError } from "../../../shared/rest.js";
import { sweeper } from "../../../shared/sweep.js";
import { projectionFor, eventId } from "../../../shared/projections.js";
import { lessonSwitches } from "../../../shared/lesson.js";
import { freshness } from "../../../shared/freshness.js";

const PAUSED_RETRY_S = 2;

export async function apply(env, message, receivedAt) {
  const event = message.body;
  const p = projectionFor(event);
  const id = eventId(p.kind, p.aggregateId, event.timestamp);
  const seen = await env.DB.prepare("SELECT 1 FROM processed_events WHERE event_id = ?").bind(id).first();
  if (seen) return "duplicate";
  const updatedAt = Date.now();
  const cols = { ...p.columns, session: event.session ?? "", last_updated: updatedAt };
  const names = Object.keys(cols);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ${p.table} (id, ${names.join(", ")}) VALUES (?, ${names.map(() => "?").join(", ")})
       ON CONFLICT (id) DO UPDATE SET ${names.map((n) => `${n} = excluded.${n}`).join(", ")},
       event_version = ${p.table}.event_version + 1`,
    ).bind(p.aggregateId, ...Object.values(cols)),
    env.DB.prepare("INSERT INTO processed_events (event_id, session, topic, processed_at) VALUES (?, ?, ?, ?)")
      .bind(id, cols.session, p.topic, updatedAt),
    env.DB.prepare(`INSERT INTO propagation_timing (entity_id, session, event_type, event_created_at, published_at,
       consumer_received_at, projection_updated_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(p.aggregateId, cols.session, event.eventType, Date.parse(event.timestamp), event.publishedAt ?? receivedAt,
        receivedAt, updatedAt, message.attempts ?? 1),
  ]);
  return "applied";
}

async function queue(batch, env) {
  const receivedAt = Date.now();
  for (const message of batch.messages) {
    const { consumerPaused } = await lessonSwitches(env, message.body.session);
    if (consumerPaused) {
      message.retry({ delaySeconds: PAUSED_RETRY_S });  // stays on the topic, like an unread Kafka offset
      continue;
    }
    await apply(env, message, receivedAt);
    message.ack();
  }
}

const routes = [
  ["GET", /^\/api\/metrics\/freshness$/, ({ env, session }) => freshness(env.DB, session)],
  ["GET", /^\/api\/metrics\/counts$/, async ({ env, session }) => {
    const count = async (t) =>
      (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE session IN ('', ?)`).bind(session).first()).n;
    return { persons: await count("person_projections"), employees: await count("employee_projections"),
      badges: await count("badge_projections") };
  }],
  ["GET", /^\/api\/metrics\/timing\/(?<id>[^/]+)$/, async ({ env, params, session }) => {
    const t = await env.DB.prepare(`SELECT * FROM propagation_timing WHERE entity_id = ? AND session IN ('', ?)
      ORDER BY projection_updated_at DESC LIMIT 1`).bind(params.id, session).first();
    if (!t) throw new HttpError(404, { error: `No timing data for ${params.id}` });
    return {
      entityId: t.entity_id, eventType: t.event_type, attempts: t.attempts,
      outboxToQueueMs: t.published_at - t.event_created_at,
      queueToConsumerMs: t.consumer_received_at - t.published_at,
      consumerToProjectionMs: t.projection_updated_at - t.consumer_received_at,
      totalPropagationMs: t.projection_updated_at - t.event_created_at,
      eventCreatedAt: new Date(t.event_created_at).toISOString(),
      publishedAt: new Date(t.published_at).toISOString(),
      consumerReceivedAt: new Date(t.consumer_received_at).toISOString(),
      projectionUpdatedAt: new Date(t.projection_updated_at).toISOString(),
    };
  }],
];

const scheduled = sweeper({ person_projections: "last_updated", employee_projections: "last_updated", badge_projections: "last_updated", processed_events: "processed_at", propagation_timing: "projection_updated_at" });

export default { fetch: restService(routes), queue, scheduled };
