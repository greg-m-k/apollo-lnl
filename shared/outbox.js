// Transactional outbox, as in the apollo-demo event services: the entity write and its
// outbox row commit together (one D1 batch), and a relay publishes unpublished rows to
// the topic afterwards. The relay is a Durable Object that polls every second while rows
// wait, the counterpart of the Quarkus @Scheduled(every = "1s") OutboxRelay. Cloudflare
// Queues stand in for the Kafka topics.
import { DurableObject } from "cloudflare:workers";
import { lessonSwitches } from "./lesson.js";

const POLL_MS = 1000;
const BATCH = 100;

// The statement that records one event; run it in the same batch as the entity write.
export function outboxInsert(db, { session, topic, aggregateId, event }) {
  return db.prepare(
    "INSERT INTO outbox_events (session, aggregate_type, aggregate_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(session, topic, aggregateId, event.eventType, JSON.stringify(event), Date.parse(event.timestamp));
}

// Wake the session's relay after a write; it keeps polling on its own while rows wait.
export function kickRelay(env, ctx, session) {
  ctx.waitUntil(env.RELAY.get(env.RELAY.idFromName(session)).kick(session));
}

export async function backlog(db, session) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM outbox_events WHERE published = 0 AND session = ?").bind(session).first()).n;
}

// One relay per visitor session, so one visitor's stopped broker never holds up another's events.
export class OutboxRelay extends DurableObject {
  async kick(session) {
    if ((await this.ctx.storage.getAlarm()) != null) return;
    await this.ctx.storage.put("session", session);
    await this.ctx.storage.setAlarm(Date.now());
  }

  // Publish the session's waiting rows; come back in POLL_MS while the broker is down or more may wait.
  async alarm() {
    const session = await this.ctx.storage.get("session");
    const { results: rows } = await this.env.DB.prepare(
      "SELECT * FROM outbox_events WHERE published = 0 AND session = ? ORDER BY id LIMIT ?",
    ).bind(session, BATCH).all();
    if (!rows.length) return;
    const { brokerDown } = await lessonSwitches(this.env, session);
    if (!brokerDown) await this.publish(rows);
    if (brokerDown || rows.length === BATCH) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }

  // The message is the event plus its envelope: whose it is, its topic and aggregate, and when it left.
  async publish(rows) {
    const publishedAt = Date.now();
    await this.env.TOPIC.sendBatch(rows.map((r) => ({
      body: { ...JSON.parse(r.payload), session: r.session, topic: r.aggregate_type, aggregateId: r.aggregate_id, publishedAt },
      contentType: "json",
    })));
    await this.env.DB.batch(rows.map((r) =>
      this.env.DB.prepare("UPDATE outbox_events SET published = 1, published_at = ? WHERE id = ?").bind(publishedAt, r.id)));
  }
}
