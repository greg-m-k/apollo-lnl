// Security events service (apollo-demo security-events-service), topic security.badge.
import { need, HttpError } from "../../../shared/rest.js";
import { OutboxRelay } from "../../../shared/outbox.js";
import { eventService } from "../../../shared/event-service.js";
import { badge, newBadgeNumber } from "../../../shared/entities.js";
import { newId } from "../../../shared/rows.js";

export { OutboxRelay };

const LEVELS = ["VISITOR", "STANDARD", "RESTRICTED", "ALL_ACCESS"];
const CLEARANCES = ["NONE", "CONFIDENTIAL", "SECRET", "TOP_SECRET"];
const oneOf = (allowed, v, field) => {
  if (!allowed.includes(v)) throw new HttpError(400, { error: `${field} must be one of ${allowed.join(", ")}` });
  return v;
};

export default eventService({
  entity: badge, path: "badges", topic: "security.badge", idKey: "badgeId", label: "Badge",
  onePerPerson: "Person already has a badge",
  routes: (badges) => [
    ["POST", "/api/badges", (r) => {
      const { personId, accessLevel, clearance } = need(r.body, "personId", "accessLevel", "clearance");
      return badges.insert(r, {
        id: newId("badge"), personId, badgeNumber: newBadgeNumber(),
        accessLevel: oneOf(LEVELS, accessLevel, "accessLevel"), clearance: oneOf(CLEARANCES, clearance, "clearance"),
        active: true,
      }, "BadgeProvisioned");
    }, 201],
    ["PUT", "/api/badges/:id/access-level", (r) =>
      badges.change(r, "AccessLevelChanged", { accessLevel: oneOf(LEVELS, r.query.get("level"), "level") })],
    ["PUT", "/api/badges/:id/clearance", (r) =>
      badges.change(r, "ClearanceChanged", { clearance: oneOf(CLEARANCES, r.query.get("level"), "level") })],
    ["POST", "/api/badges/:id/revoke", (r) => badges.change(r, "BadgeRevoked", { active: false })],
  ],
});
