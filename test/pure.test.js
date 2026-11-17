import { describe, expect, test } from "vitest";
import { chaosFor, sessionFrom, CHAOS_HEADER, SESSION_HEADER } from "../shared/chaos.js";
import { badge, person } from "../shared/entities.js";
import { human } from "../shared/freshness.js";
import { PROJECTIONS, eventId } from "../shared/projections.js";
import { given } from "../shared/rows.js";
import { Timing } from "../shared/timing.js";
import { composed } from "../workers/query-service/src/index.js";

const req = (headers) => new Request("https://x", { headers });
const chaos = (value) => req({ [CHAOS_HEADER]: typeof value === "string" ? value : JSON.stringify(value) });

describe("lesson switches on the request", () => {
  test("a service is down only if the request names it", () => {
    const r = chaos({ down: ["security"] });
    expect(chaosFor(r, "security").down).toBe(true);
    expect(chaosFor(r, "hr").down).toBe(false);
  });
  test("delay is per service, capped at 5 s, and nonsense is no delay", () => {
    const r = chaos({ delay: { hr: 99999, employment: -3, security: "soon" } });
    expect(chaosFor(r, "hr").delayMs).toBe(5000);
    expect(chaosFor(r, "employment").delayMs).toBe(0);
    expect(chaosFor(r, "security").delayMs).toBe(0);
  });
  test("malformed or missing means no chaos", () => {
    for (const r of [chaos("{nope"), chaos("null"), chaos({ down: "security" }), req({})]) {
      expect(chaosFor(r, "security")).toEqual({ down: false, delayMs: 0 });
    }
  });
  test("session ids are short and plain, anything else is no session", () => {
    expect(sessionFrom(req({ [SESSION_HEADER]: "abc_123-x" }))).toBe("abc_123-x");
    expect(sessionFrom(req({ [SESSION_HEADER]: "a b" }))).toBe("");
    expect(sessionFrom(req({ [SESSION_HEADER]: "x".repeat(65) }))).toBe("");
  });
});

test("freshness reads like the apollo-demo query-service", () => {
  expect([human(250), human(1500), human(90000)]).toEqual(["250ms", "1.5s", "1.5m"]);
});

describe("timing", () => {
  const timed = async () => {
    let t = 0;
    const timing = new Timing(() => t);
    await timing.step("db_read", async () => { t += 5; });
    await timing.step("db_read", async () => { t += 3; });
    t += 2;
    return timing;
  };
  test("adds up named steps", async () => {
    expect((await timed()).details()).toEqual({ db_read: 8, total: 10 });
  });
  test("stamps a response with its headers, keeping status and body", async () => {
    const res = (await timed()).stamp(new Response("hi", { status: 201 }));
    expect([res.status, await res.text(), res.headers.get("x-time-ms")]).toEqual([201, "hi", "10"]);
    expect(JSON.parse(res.headers.get("x-timing-details"))).toEqual({ db_read: 8, total: 10 });
  });
});

describe("entities", () => {
  test("a row becomes the API object, and the object becomes column values", () => {
    const json = badge.toJson({
      id: "badge-1", session: "s", person_id: "person-1", badge_number: "B1", access_level: "STANDARD", clearance: "SECRET", active: 1,
    });
    expect(json).toEqual({
      id: "badge-1", personId: "person-1", badgeNumber: "B1", accessLevel: "STANDARD", clearance: "SECRET", active: true,
    });
    expect(badge.columns(json)).toEqual({
      person_id: "person-1", badge_number: "B1", access_level: "STANDARD", clearance: "SECRET", active: 1,
    });
  });
  test("a terminated person is inactive, a missing hire date is null", () => {
    expect(person.columns({ name: "A", email: "a@x", active: false })).toEqual({ name: "A", email: "a@x", hire_date: null, active: 0 });
  });
  test("no row, no object", () => {
    expect(person.toJson(null)).toBeNull();
  });
});

describe("projections", () => {
  test("each topic's projection stores its entity's columns", () => {
    expect(Object.keys(PROJECTIONS)).toEqual(["hr.person", "employment.employee", "security.badge"]);
    expect(PROJECTIONS["security.badge"]).toEqual({ kind: "badge", table: "badge_projections", columns: badge.columns });
  });
  test("idempotency key matches the Quarkus consumer", () => {
    const ts = "2026-11-17T00:00:00.000Z";
    expect(eventId("person", "person-1", ts)).toBe(`person-person-1-${ts}`);
  });
});

test("a partial update keeps only the fields that were given", () => {
  expect(given({ a: 1, b: null, c: undefined, d: "", e: 0 })).toEqual({ a: 1, d: "", e: 0 });
});

test("composed view: missing parts are null and inactive, lag is the oldest part", () => {
  const p = { id: "person-1", name: "A", email: "a@x", hire_date: null, active: 1, last_updated: 1000 };
  const e = { id: "emp-1", title: "T", department: "D", salary: 1, active: 1, last_updated: 4000 };
  const v = composed(p, e, null, 5000);
  expect(v).toMatchObject({ personId: "person-1", title: "T", badgeId: null, badgeActive: false, employeeActive: true });
  expect(v.freshness).toMatchObject({ maxLagMs: 4000, dataFreshness: "4.0s", badgeLastUpdated: null });
  expect(Object.keys(v)).toEqual(["personId", "name", "email", "hireDate", "personActive", "employeeId", "title", "department",
    "salary", "employeeActive", "badgeId", "badgeNumber", "accessLevel", "clearance", "badgeActive", "freshness"]);
});
