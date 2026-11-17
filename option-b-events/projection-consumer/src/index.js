// OPTION B · Event-driven projections · Projection consumer
//
// Reads the three topics and keeps a local copy of what they say: the projections. A port
// of the Quarkus service in services/event/projection-consumer of the apollo-demo, whose
// PersonEventConsumer, EmployeeEventConsumer and BadgeEventConsumer are the three entries
// below. It stands alone: its own database (the projections), no code shared with the others.

// Which projection each topic feeds. An event is a full snapshot of its entity, so
// "created", "updated" and "terminated" are all the same thing here: store the snapshot.
// Keyed by queue name; `topic` is the Kafka topic of the apollo-demo it stands in for.
const PROJECTIONS = {
  "lnl-events-hr-person": {
    topic: "events.hr.person", kind: "person", table: "person_projections",
    columns: (person) => ({ name: person.name, email: person.email, hire_date: person.hireDate, active: person.active ? 1 : 0 }),
  },
  "lnl-events-employment-employee": {
    topic: "events.employment.employee", kind: "employee", table: "employee_projections",
    columns: (employee) => ({
      person_id: employee.personId, title: employee.title, department: employee.department, salary: employee.salary,
      active: employee.active ? 1 : 0,
    }),
  },
  "lnl-events-security-badge": {
    topic: "events.security.badge", kind: "badge", table: "badge_projections",
    columns: (badge) => ({
      person_id: badge.personId, badge_number: badge.badgeNumber, access_level: badge.accessLevel,
      clearance: badge.clearance, active: badge.active ? 1 : 0,
    }),
  },
};

// ---- THE CONSUMER ---------------------------------------------------------------------
// A batch of events from one topic. Each event is applied, then acknowledged. An event
// that is not acknowledged is delivered again, so applying one twice must change nothing.
async function queue(batch, env) {
  const projection = PROJECTIONS[batch.queue];
  const receivedAt = Date.now();
  const paused = await pausedSessions(env, batch.messages);
  const held = batch.messages.filter((message) => paused.has(message.body.session));
  const live = batch.messages.filter((message) => !paused.has(message.body.session));

  for (const message of held) message.retry({ delaySeconds: PAUSED_RETRY_SECONDS });  // stays on the topic
  if (live.length) await env.DB.batch(live.flatMap((message) => applyOnce(env.DB, projection, message, receivedAt)));
  for (const message of live) message.ack();
}

// The statements that apply one event exactly once (the consumer's idempotency, as in the
// apollo-demo): store the snapshot in the projection, note where the event spent its time,
// and remember the event's id. The first two do nothing if that id was already remembered.
const NOT_SEEN = "WHERE NOT EXISTS (SELECT 1 FROM processed_events WHERE event_id = ?)";

function applyOnce(db, { topic, kind, table, columns }, message, receivedAt) {
  const event = message.body;
  const id = event.data.id;
  const eventId = `${kind}-${id}-${event.timestamp}`;
  const now = Date.now();
  const row = { ...columns(event.data), session: event.session, last_updated: now };
  const names = Object.keys(row);
  return [
    db.prepare(
      `INSERT INTO ${table} (id, ${names.join(", ")}) SELECT ?, ${names.map(() => "?").join(", ")} ${NOT_SEEN}
       ON CONFLICT (id) DO UPDATE SET ${names.map((name) => `${name} = excluded.${name}`).join(", ")},
       event_version = ${table}.event_version + 1`,
    ).bind(id, ...Object.values(row), eventId),
    db.prepare(
      `INSERT INTO propagation_timing (entity_id, session, event_type, event_created_at, published_at,
       consumer_received_at, projection_updated_at, attempts) SELECT ?, ?, ?, ?, ?, ?, ?, ? ${NOT_SEEN}`,
    ).bind(id, event.session, event.eventType, Date.parse(event.timestamp), event.publishedAt, receivedAt, now,
      message.attempts ?? 1, eventId),
    db.prepare("INSERT OR IGNORE INTO processed_events (event_id, session, topic, processed_at) VALUES (?, ?, ?, ?)")
      .bind(eventId, event.session, topic, now),
  ];
}

// ---- The metrics API (MetricsResource.java) -------------------------------------------
const MINE = "session IN ('', ?)";  // the seed rows plus this visitor's own

const routes = {
  "GET /api/metrics/freshness": freshness,
  "GET /api/metrics/counts": counts,
  "GET /api/metrics/timing/:id": timing,
};

// When each projection last changed, and how long ago that was.
async function freshness(c) {
  const now = Date.now();
  const report = { timestamp: new Date(now).toISOString() };
  for (const { kind, table } of Object.values(PROJECTIONS)) {
    const { latest } = await c.db.prepare(`SELECT MAX(last_updated) AS latest FROM ${table} WHERE ${MINE}`).bind(c.session).first();
    report[kind] = latest == null
      ? { lastUpdate: "never", lagMs: -1, lagHuman: "N/A" }
      : { lastUpdate: new Date(latest).toISOString(), lagMs: now - latest, lagHuman: human(now - latest) };
  }
  return json(200, report);
}

async function counts(c) {
  const report = {};
  for (const { kind, table } of Object.values(PROJECTIONS)) {
    report[`${kind}s`] = (await c.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${MINE}`).bind(c.session).first()).n;
  }
  return json(200, report);
}

// Where the latest event for one entity spent its time on the way to the projection.
async function timing(c) {
  const t = await c.db.prepare(
    `SELECT * FROM propagation_timing WHERE entity_id = ? AND ${MINE} ORDER BY projection_updated_at DESC LIMIT 1`,
  ).bind(c.params.id, c.session).first();
  if (!t) return json(404, { error: `No timing data for ${c.params.id}` });
  return json(200, {
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
}

export default {
  queue,

  async fetch(request, env) {
    const url = new URL(request.url);
    return answer(request.method, url.pathname, { db: env.DB, session: sessionOf(request) });
  },

  // Every few minutes: clear visitors' rows 20 minutes after they were written. Seed rows stay.
  async scheduled(_event, env) {
    const cutoff = Date.now() - 20 * 60 * 1000;
    await env.DB.batch([
      ...Object.values(PROJECTIONS).map(({ table }) =>
        env.DB.prepare(`DELETE FROM ${table} WHERE session != '' AND last_updated < ?`).bind(cutoff)),
      env.DB.prepare("DELETE FROM processed_events WHERE session != '' AND processed_at < ?").bind(cutoff),
      env.DB.prepare("DELETE FROM propagation_timing WHERE session != '' AND projection_updated_at < ?").bind(cutoff),
    ]);
  },
};

// ---------------------------------------------------------------------------------------
// Lunch & Learn plumbing. Not part of the pattern: the "consumer paused" switch, routing
// and the visitor's session.
// ---------------------------------------------------------------------------------------

// A paused visitor's events go back on the topic for this long, like an offset left
// uncommitted. wrangler.jsonc allows 100 such retries (about 200 s), which outlasts the
// 3 minutes a switch can stay on (site/lesson).
const PAUSED_RETRY_SECONDS = 2;

// The sessions among these messages whose "consumer paused" switch is on.
async function pausedSessions(env, messages) {
  const sessions = [...new Set(messages.map((message) => message.body.session))];
  const switches = await Promise.all(sessions.map((session) => env.LESSON.get(env.LESSON.idFromName(session)).switches()));
  return new Set(sessions.filter((_, i) => switches[i].consumerPaused));
}

function human(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

const json = (status, body) => Response.json(body, { status });

// Run the handler whose "METHOD /path" matches; ":id" matches one path segment.
async function answer(method, path, c) {
  for (const [route, handler] of Object.entries(routes)) {
    const [routeMethod, pattern] = route.split(" ");
    const match = routeMethod === method && path.match(new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`));
    if (!match) continue;
    c.params = match.groups ?? {};
    return handler(c);
  }
  return json(404, { error: "Not found", path });
}

// The visitor's session id. Rows carry it; seed rows have session '' and belong to everyone.
function sessionOf(request) {
  const session = request.headers.get("x-lnl-session") ?? "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(session) ? session : "";
}
