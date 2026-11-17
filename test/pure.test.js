import { describe, expect, test } from "vitest";
import { chaosFrom, sessionFrom } from "../shared/chaos.js";
import { human } from "../shared/freshness.js";
import { projectionFor, eventId } from "../shared/projections.js";
import { Timing } from "../shared/timing.js";
import { composed } from "../workers/query-service/src/index.js";

const req = (headers) => new Request("https://x", { headers });

describe("lesson switches on the request", () => {
  test("keeps known services, clamps delay, drops the rest", () => {
    const c = chaosFrom(req({ "x-lnl-chaos": JSON.stringify({ down: ["security", "kafka"], delay: { hr: 99999, x: 5, employment: -3 } }) }));
    expect(c).toEqual({ down: ["security"], delay: { hr: 5000 } });
  });
  test("malformed or missing means no chaos", () => {
    expect(chaosFrom(req({ "x-lnl-chaos": "{nope" }))).toEqual({ down: [], delay: {} });
    expect(chaosFrom(req({}))).toEqual({ down: [], delay: {} });
  });
  test("session ids are short and plain, anything else is no session", () => {
    expect(sessionFrom(req({ "x-lnl-session": "abc_123-x" }))).toBe("abc_123-x");
    expect(sessionFrom(req({ "x-lnl-session": "a b" }))).toBe("");
    expect(sessionFrom(req({ "x-lnl-session": "x".repeat(65) }))).toBe("");
  });
});

test("freshness reads like the apollo-demo query-service", () => {
  expect([human(250), human(1500), human(90000)]).toEqual(["250ms", "1.5s", "1.5m"]);
});

test("timing adds up named steps", async () => {
  let t = 0;
  const timing = new Timing(() => t);
  await timing.step("db_read", async () => { t += 5; });
  await timing.step("db_read", async () => { t += 3; });
  t += 2;
  expect(timing.details()).toEqual({ db_read: 8, total: 10 });
});

describe("events land in their projection", () => {
  const ts = "2026-11-17T00:00:00.000Z";
  test("a badge event", () => {
    const p = projectionFor({ eventType: "ClearanceChanged", badgeId: "badge-1", timestamp: ts,
      data: { personId: "person-1", badgeNumber: "B1", accessLevel: "STANDARD", clearance: "SECRET", active: true } });
    expect(p).toEqual({ topic: "security.badge", kind: "badge", table: "badge_projections", aggregateId: "badge-1",
      columns: { person_id: "person-1", badge_number: "B1", access_level: "STANDARD", clearance: "SECRET", active: 1 } });
  });
  test("a terminated person is inactive, a missing hire date is null", () => {
    const p = projectionFor({ eventType: "PersonTerminated", personId: "person-1", timestamp: ts,
      data: { name: "A", email: "a@x", active: false } });
    expect(p.columns).toEqual({ name: "A", email: "a@x", hire_date: null, active: 0 });
  });
  test("unknown event types are refused", () => {
    expect(() => projectionFor({ eventType: "Nope" })).toThrow(/Unknown event type/);
  });
  test("idempotency key matches the Quarkus consumer", () => {
    expect(eventId("person", "person-1", ts)).toBe(`person-person-1-${ts}`);
  });
});

test("composed view: missing parts are null and inactive, lag is the oldest part", () => {
  const p = { id: "person-1", name: "A", email: "a@x", hire_date: null, active: 1, last_updated: 1000 };
  const e = { id: "emp-1", title: "T", department: "D", salary: 1, active: 1, last_updated: 4000 };
  const v = composed(p, e, null, 5000);
  expect(v).toMatchObject({ personId: "person-1", title: "T", badgeId: null, badgeActive: false, employeeActive: true });
  expect(v.freshness).toMatchObject({ maxLagMs: 4000, dataFreshness: "4.0s", badgeLastUpdated: null });
});
