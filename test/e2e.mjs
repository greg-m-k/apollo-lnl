// End-to-end checks against a running demo: BASE=http://localhost:8800 node --test test/e2e.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://localhost:8800";
const session = () => `e2e-${crypto.randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(s, query, chaos) {
  const res = await fetch(`${BASE}/api/federation`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lnl-session": s, ...(chaos && { "x-lnl-chaos": JSON.stringify(chaos) }) },
    body: JSON.stringify({ query }),
  });
  return { body: await res.json(), headers: res.headers };
}
const api = (s, path, init = {}) => fetch(`${BASE}/api/${path}`, {
  ...init, headers: { "content-type": "application/json", "x-lnl-session": s, ...init.headers },
});
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(100); }
  return false;
}

const PERSON = `{ person(id: "person-001") { name employee { title } badge { badgeNumber } } }`;

test("federation composes one person from three subgraphs, HR first", async () => {
  const { body, headers } = await gql(session(), PERSON);
  assert.deepEqual(body.data.person, { name: "Alice Johnson", employee: { title: "Senior Software Engineer" }, badge: { badgeNumber: "B10001" } });
  const fetches = JSON.parse(headers.get("x-lnl-fetches"));
  assert.deepEqual(fetches.map((f) => f.subgraph)[0], "hr");
  assert.equal(fetches.length, 3);
});

test("federation with a subgraph down answers partially with an error", async () => {
  const { body } = await gql(session(), PERSON, { down: ["security"] });
  assert.equal(body.data.person.badge, null);
  assert.equal(body.data.person.employee.title, "Senior Software Engineer");
  assert.equal(body.errors[0].extensions.serviceName, "security");
});

test("federation latency follows the slowest subgraph", async () => {
  const { headers } = await gql(session(), PERSON, { delay: { employment: 600 } });
  assert.ok(Number(headers.get("x-router-time-ms")) >= 600);
});

test("a federation write is readable at once; another session cannot see it", async () => {
  const s = session();
  const { body } = await gql(s, `mutation { createPerson(name: "Fed Fay", email: "fay@company.com") { id } }`);
  const id = body.data.createPerson.id;
  assert.equal((await gql(s, `{ person(id: "${id}") { name } }`)).body.data.person.name, "Fed Fay");
  assert.equal((await gql(session(), `{ person(id: "${id}") { name } }`)).body.data.person, null);
});

test("seed data is read-only on both sides", async () => {
  const { body } = await gql(session(), `mutation { terminatePerson(id: "person-001") { id } }`);
  assert.match(body.errors[0].message, /read-only/);
  assert.equal((await api(session(), "hr-events/persons/person-001/terminate", { method: "POST" })).status, 403);
});

test("an event-side write reaches the projection shortly after", async () => {
  const s = session();
  const res = await api(s, "hr-events/persons", { method: "POST", body: JSON.stringify({ name: "Ev Ed", email: "ed@company.com" }) });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  assert.ok(await until(async () => (await api(s, `query/composed/${id}`)).status === 200));
  const timing = await (await api(s, `consumer/metrics/timing/${id}`)).json();
  assert.equal(timing.eventType, "PersonCreated");
});

test("with the broker down the event waits in the outbox, then catches up", async () => {
  const s = session();
  await api(s, "lesson", { method: "PUT", body: JSON.stringify({ brokerDown: true }) });
  const { id } = await (await api(s, "hr-events/persons", { method: "POST", body: JSON.stringify({ name: "Held Hal", email: "hal@company.com" }) })).json();
  await sleep(2500);
  assert.equal((await (await api(s, "hr-events/outbox")).json()).waiting, 1);
  assert.equal((await api(s, `query/composed/${id}`)).status, 404);
  await api(s, "lesson", { method: "PUT", body: JSON.stringify({ brokerDown: false }) });
  assert.ok(await until(async () => (await api(s, `query/composed/${id}`)).status === 200));
});

test("an employee and a badge join the composed view", async () => {
  const s = session();
  const { id } = await (await api(s, "hr-events/persons", { method: "POST", body: JSON.stringify({ name: "Jo Jay", email: "jo@company.com" }) })).json();
  await api(s, "employment-events/employees", { method: "POST", body: JSON.stringify({ personId: id, title: "Pilot", department: "Ops", salary: 100 }) });
  await api(s, "security-events/badges", { method: "POST", body: JSON.stringify({ personId: id, accessLevel: "STANDARD", clearance: "NONE" }) });
  assert.ok(await until(async () => {
    const v = await (await api(s, `query/composed/${id}`)).json();
    return v.title === "Pilot" && v.accessLevel === "STANDARD";
  }));
  assert.equal((await api(s, "employment-events/employees", { method: "POST", body: JSON.stringify({ personId: id, title: "x", department: "y", salary: 1 }) })).status, 409);
});

test("list endpoints answer with arrays", async () => {
  for (const path of ["query/persons", "query/employees", "query/badges", "hr-events/persons",
    "employment-events/employees", "security-events/badges"]) {
    const res = await api(session(), path);
    assert.equal(res.status, 200, path);
    assert.ok(Array.isArray(await res.json()), path);
  }
});
