// Security events service (apollo-demo security-events-service), topic security.badge.
import { restService, reply, need, HttpError } from "../../../shared/rest.js";
import { sweeper } from "../../../shared/sweep.js";
import { OutboxRelay, backlog } from "../../../shared/outbox.js";
import { eventEntity } from "../../../shared/event-entity.js";
import { bool, newId } from "../../../shared/rows.js";

export { OutboxRelay };

const LEVELS = ["VISITOR", "STANDARD", "RESTRICTED", "ALL_ACCESS"];
const CLEARANCES = ["NONE", "CONFIDENTIAL", "SECRET", "TOP_SECRET"];
const oneOf = (allowed, v, field) => {
  if (!allowed.includes(v)) throw new HttpError(400, { error: `${field} must be one of ${allowed.join(", ")}` });
  return v;
};

const badges = eventEntity({
  table: "badge_holders", aggregateType: "security.badge", idKey: "badgeId", label: "Badge",
  toJson: (r) => r && {
    id: r.id, personId: r.person_id, badgeNumber: r.badge_number,
    accessLevel: r.access_level, clearance: r.clearance, active: bool(r.active),
  },
  columns: (b) => ({
    person_id: b.personId, badge_number: b.badgeNumber, access_level: b.accessLevel, clearance: b.clearance,
    active: b.active ? 1 : 0,
  }),
});

const byPerson = async (env, personId, session) => (await badges.all(env, session, "person_id = ?", personId))[0];

const routes = [
  ["GET", /^\/api\/outbox$/, async ({ env, session }) => ({ waiting: await backlog(env.DB, session) })],
  ["GET", /^\/api\/badges$/, ({ env, session, timing }) => timing.step("db_read", () => badges.all(env, session))],
  ["GET", /^\/api\/badges\/by-person\/(?<personId>[^/]+)$/, async ({ env, params, session }) => {
    const b = await byPerson(env, params.personId, session);
    if (!b) throw new HttpError(404, { error: "Badge not found", personId: params.personId });
    return b;
  }],
  ["GET", /^\/api\/badges\/(?<id>[^/]+)$/, (r) => badges.get(r)],
  ["POST", /^\/api\/badges$/, async (r) => {
    const { personId, accessLevel, clearance } = need(r.body, "personId", "accessLevel", "clearance");
    if (await byPerson(r.env, personId, r.session)) throw new HttpError(409, "Person already has a badge");
    const b = {
      id: newId("badge"), personId, badgeNumber: `B${Date.now() % 100000}`,
      accessLevel: oneOf(LEVELS, accessLevel, "accessLevel"), clearance: oneOf(CLEARANCES, clearance, "clearance"),
      active: true,
    };
    return reply(201, await badges.insert(r, b, "BadgeProvisioned"));
  }],
  ["PUT", /^\/api\/badges\/(?<id>[^/]+)\/access-level$/, async (r) =>
    badges.update(r, { ...(await badges.own(r)), accessLevel: oneOf(LEVELS, r.query.get("level"), "level") },
      "AccessLevelChanged")],
  ["PUT", /^\/api\/badges\/(?<id>[^/]+)\/clearance$/, async (r) =>
    badges.update(r, { ...(await badges.own(r)), clearance: oneOf(CLEARANCES, r.query.get("level"), "level") },
      "ClearanceChanged")],
  ["POST", /^\/api\/badges\/(?<id>[^/]+)\/revoke$/, async (r) =>
    badges.update(r, { ...(await badges.own(r)), active: false }, "BadgeRevoked")],
];

const scheduled = sweeper({ badge_holders: "created_at", outbox_events: "created_at" });

export default { fetch: restService(routes, { timingPrefix: "x-security-events" }), scheduled };
