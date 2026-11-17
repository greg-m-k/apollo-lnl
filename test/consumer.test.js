// The projection consumer against a real SQLite schema: what a queue batch does to the read models.
import { readFileSync } from "node:fs";
import { beforeEach, expect, test } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import consumer from "../workers/projection-consumer/src/index.js";

const SCHEMA = readFileSync(new URL("../workers/projection-consumer/migrations/0001_projections.sql", import.meta.url), "utf8");
const T0 = "2026-11-17T00:00:00.000Z";
const T1 = "2026-11-17T00:00:05.000Z";

let env;
let paused;
beforeEach(() => {
  paused = new Set();
  env = {
    DB: fakeD1(SCHEMA),
    LESSON: { idFromName: (s) => s, get: (s) => ({ switches: async () => ({ consumerPaused: paused.has(s) }) }) },
  };
});

function message(body) {
  const m = {
    body: { session: "s1", publishedAt: Date.parse(body.timestamp) + 50, ...body }, attempts: 1, acked: false, retried: null,
    ack() { m.acked = true; },
    retry(options) { m.retried = options; },
  };
  return m;
}
const personEvent = (id, name, timestamp = T0, more = {}) => message({
  eventType: "PersonCreated", topic: "hr.person", aggregateId: id, personId: id, timestamp,
  data: { id, name, email: `${id}@company.com`, hireDate: null, active: true }, ...more,
});
const deliver = (...messages) => consumer.queue({ messages }, env);
const first = (sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const person = (id) => first("SELECT * FROM person_projections WHERE id = ?", id);
const timings = async (id) => (await first("SELECT COUNT(*) AS n FROM propagation_timing WHERE entity_id = ?", id)).n;

test("an event becomes a projection row with its timing, and is acknowledged", async () => {
  const m = personEvent("person-x", "Xena");
  await deliver(m);
  expect(await person("person-x")).toMatchObject({ name: "Xena", session: "s1", active: 1, hire_date: null, event_version: 1 });
  expect(await timings("person-x")).toBe(1);
  expect(m.acked).toBe(true);
});

test("the same event delivered again, or twice in one batch, is applied once", async () => {
  await deliver(personEvent("person-x", "Xena"), personEvent("person-x", "Xena"));
  await deliver(personEvent("person-x", "Xena"));
  expect((await person("person-x")).event_version).toBe(1);
  expect(await timings("person-x")).toBe(1);
});

test("a later event overwrites the row and raises its version", async () => {
  await deliver(personEvent("person-x", "Xena"));
  await deliver(personEvent("person-x", "Xena Prime", T1));
  expect(await person("person-x")).toMatchObject({ name: "Xena Prime", event_version: 2 });
  expect(await timings("person-x")).toBe(2);
});

test("an employee event lands in the employee projection", async () => {
  await deliver(message({
    eventType: "EmployeeAssigned", topic: "employment.employee", aggregateId: "emp-x", employeeId: "emp-x", timestamp: T0,
    data: { id: "emp-x", personId: "person-x", title: "Pilot", department: "Ops", salary: 100, active: true },
  }));
  expect(await first("SELECT * FROM employee_projections WHERE id = 'emp-x'"))
    .toMatchObject({ person_id: "person-x", title: "Pilot", department: "Ops", salary: 100, active: 1 });
});

test("a paused session's events go back on the queue while other sessions' are applied", async () => {
  paused.add("s1");
  const held = personEvent("person-x", "Xena");
  const live = personEvent("person-y", "Yara", T0, { session: "s2" });
  await deliver(held, live);
  expect(held).toMatchObject({ acked: false, retried: { delaySeconds: 2 } });
  expect(await person("person-x")).toBeNull();
  expect(live.acked).toBe(true);
  expect((await person("person-y")).name).toBe("Yara");
});
