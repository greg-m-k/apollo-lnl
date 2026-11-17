// Transactional outbox, as in the apollo-demo event services: the entity write and its
// outbox row commit together (one D1 batch), and a relay publishes unpublished rows to
// the topic afterwards. The relay is a Durable Object that polls every second while rows
// wait, the counterpart of the Quarkus @Scheduled(every = "1s") OutboxRelay. Cloudflare
// Queues stand in for the Kafka topics.
import { DurableObject } from "cloudflare:workers";
import { lessonSwitches } from "./lesson.js";

export const OUTBOX_TABLE = `CREATE TABLE outbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT NOT NULL DEFAULT '',
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER
);
CREATE INDEX outbox_unpublished ON outbox_events (published, id);`;

const POLL_MS = 1000;
const BATCH = 100;

// The statement that records one event; run it in the same batch as the entity write.
export function outboxInsert(db, { session, aggregateType, aggregateId, eventType, event }) {
  return db.prepare(
    "INSERT INTO outbox_events (session, aggregate_type, aggregate_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(session, aggregateType, aggregateId, eventType, JSON.stringify(event), Date.parse(event.timestamp));
}

// Wake the relay after a write; it also keeps polling on its own while rows wait.
export function kickRelay(env, ctx) {
  const relay = env.RELAY.get(env.RELAY.idFromName("relay"));
  ctx.waitUntil(relay.kick());
}

export class OutboxRelay extends DurableObject {
  async kick() {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    const waiting = await this.drain();
    if (waiting > 0) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }

  // Publish what can be published; returns how many rows still wait.
  async drain() {
    const { results: rows } = await this.env.DB.prepare(
      "SELECT * FROM outbox_events WHERE published = 0 ORDER BY id LIMIT ?",
    ).bind(BATCH).all();
    const blocked = new Set();
    for (const session of new Set(rows.map((r) => r.session))) {
      if (await brokerDown(this.env, session)) blocked.add(session);
    }
    const ready = rows.filter((r) => !blocked.has(r.session));
    if (ready.length) {
      const publishedAt = Date.now();
      await this.env.TOPIC.sendBatch(ready.map((r) => ({
        body: { ...JSON.parse(r.payload), session: r.session, outboxId: r.id, publishedAt },
        contentType: "json",
      })));
      await this.env.DB.batch(ready.map((r) =>
        this.env.DB.prepare("UPDATE outbox_events SET published = 1, published_at = ? WHERE id = ?").bind(publishedAt, r.id)));
    }
    return rows.length - ready.length + (rows.length === BATCH ? 1 : 0);
  }
}

const brokerDown = async (env, session) => (await lessonSwitches(env, session)).brokerDown;

export async function backlog(db, session) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM outbox_events WHERE published = 0 AND session = ?").bind(session).first()).n;
}
