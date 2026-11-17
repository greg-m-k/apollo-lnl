// Projection consumer: reads the three topics (Cloudflare Queues) and upserts local read
// models (apollo-demo projection-consumer). Events are full snapshots, so every event
// type is the same upsert. Each event is applied once: its id is kept in processed_events.
import { restService, HttpError } from "../../../shared/rest.js";
import { sweeper } from "../../../shared/sweep.js";
import { PROJECTIONS, eventId } from "../../../shared/projections.js";
import { lessonSwitches } from "../../../shared/lesson.js";
import { freshness } from "../../../shared/freshness.js";
import { VISIBLE } from "../../../shared/rows.js";

// A paused session's events go back on the queue for this long. wrangler.jsonc allows 100
// such retries (about 200 s), which must outlast a lesson switch (3 minutes, workers/lesson).
const PAUSED_RETRY_S = 2;
const UNSEEN = "WHERE NOT EXISTS (SELECT 1 FROM processed_events WHERE event_id = ?)";

// The statements that apply one event exactly once: upsert its projection row, record where
// it spent its time, then remember its id. The first two do nothing if the id is already known.
function applying(db, { body: event, attempts = 1 }, receivedAt) {
  const { kind, table, columns } = PROJECTIONS[event.topic];
  const id = eventId(kind, event.aggregateId, event.timestamp);
  const now = Date.now();
  const cols = { ...columns(event.data), session: event.session, last_updated: now };
  const names = Object.keys(cols);
  return [
    db.prepare(`INSERT INTO ${table} (id, ${names.join(", ")}) SELECT ?, ${names.map(() => "?").join(", ")} ${UNSEEN}
      ON CONFLICT (id) DO UPDATE SET ${names.map((n) => `${n} = excluded.${n}`).join(", ")},
      event_version = ${table}.event_version + 1`).bind(event.aggregateId, ...Object.values(cols), id),
    db.prepare(`INSERT INTO propagation_timing (entity_id, session, event_type, event_created_at, published_at,
      consumer_received_at, projection_updated_at, attempts) SELECT ?, ?, ?, ?, ?, ?, ?, ? ${UNSEEN}`)
      .bind(event.aggregateId, event.session, event.eventType, Date.parse(event.timestamp), event.publishedAt,
        receivedAt, now, attempts, id),
    db.prepare("INSERT OR IGNORE INTO processed_events (event_id, session, topic, processed_at) VALUES (?, ?, ?, ?)")
      .bind(id, event.session, event.topic, now),
  ];
}

// The sessions among these messages whose consumer is paused right now.
async function pausedSessions(env, messages) {
  const sessions = [...new Set(messages.map((m) => m.body.session))];
  const switches = await Promise.all(sessions.map((s) => lessonSwitches(env, s)));
  return new Set(sessions.filter((_, i) => switches[i].consumerPaused));
}

async function queue(batch, env) {
  const receivedAt = Date.now();
  const paused = await pausedSessions(env, batch.messages);
  const held = batch.messages.filter((m) => paused.has(m.body.session));
  const live = batch.messages.filter((m) => !paused.has(m.body.session));
  for (const m of held) m.retry({ delaySeconds: PAUSED_RETRY_S });  // stays on the topic, like an unread Kafka offset
  if (live.length) await env.DB.batch(live.flatMap((m) => applying(env.DB, m, receivedAt)));
  for (const m of live) m.ack();
}

// One propagation_timing row as the API reports it: where the event spent its time.
const timingReport = (t) => ({
  entityId: t.entity_id, eventType: t.event_type, attempts: t.attempts,
  outboxToQueueMs: t.published_at - t.event_created_at,
  queueToConsumerMs: t.consumer_received_at - t.published_at,
  consumerToProjectionMs: t.projection_updated_at - t.consumer_received_at,
  totalPropagationMs: t.projection_updated_at - t.event_created_at,
  eventCreatedAt: new Date(t.event_created_at).toISOString(),
  publishedAt: new Date(t.published_at).toISOString(),
  consumerReceivedAt: new Date(t.consumer_received_at).toISOString(),
  projectionUpdatedAt: new Date(t.projection_updated_at).toISOString(),
});

const count = async ({ env, session }, table) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${VISIBLE}`).bind(session).first()).n;

const routes = [
  ["GET", "/api/metrics/freshness", ({ env, session }) => freshness(env.DB, session)],
  // { persons, employees, badges }
  ["GET", "/api/metrics/counts", async (r) => Object.fromEntries(await Promise.all(
    Object.values(PROJECTIONS).map(async ({ kind, table }) => [`${kind}s`, await count(r, table)])))],
  ["GET", "/api/metrics/timing/:id", async ({ env, params, session }) => {
    const t = await env.DB.prepare(`SELECT * FROM propagation_timing WHERE entity_id = ? AND ${VISIBLE}
      ORDER BY projection_updated_at DESC LIMIT 1`).bind(params.id, session).first();
    if (!t) throw new HttpError(404, { error: `No timing data for ${params.id}` });
    return timingReport(t);
  }],
];

const scheduled = sweeper({
  ...Object.fromEntries(Object.values(PROJECTIONS).map(({ table }) => [table, "last_updated"])),
  processed_events: "processed_at", propagation_timing: "projection_updated_at",
});

export default { fetch: restService(routes), queue, scheduled };
