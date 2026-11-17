// End-to-end checks against a running demo: BASE=http://localhost:8800 node --test test/e2e.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAOS_HEADER, SESSION_HEADER } from "../shared/chaos.js";
import { newId } from "../shared/rows.js";
import { sleep, until } from "../workers/web/public/lib/api.js";

const BASE = process.env.BASE ?? "http://localhost:8800";
const session = () => newId("e2e");
const eventually = async (fn) => (await until(fn))[0];

async function gql(s, query, chaos = {}) {
  const res = await fetch(`${BASE}/api/federation`, {
    method: "POST",
    headers: { "content-type": "application/json", [SESSION_HEADER]: s, [CHAOS_HEADER]: JSON.stringify(chaos) },
    body: JSON.stringify({ query }),
  });
  return { body: await res.json(), headers: res.headers };
}
const api = (s, path, init = {}) => fetch(`${BASE}/api/${path}`, {
  ...init, headers: { "content-type": "application/json", [SESSION_HEADER]: s, ...init.headers },
});
const post = (s, path, body) => api(s, path, { method: "POST", body: JSON.stringify(body) });
const put = (s, path, body) => api(s, path, { method: "PUT", body: body && JSON.stringify(body) });
const json = async (response) => (await response).json();
const composed = (s, id) => api(s, `query/composed/${id}`);

const PERSON = `{ person(id: "person-001") { name employee { title } badge { badgeNumber } } }`;

test("federation composes one person from three subgraphs, HR first", async () => {
  const { body, headers } = await gql(session(), PERSON);
  assert.deepEqual(body.data.person, { name: "Alice Johnson", employee: { title: "Senior Software Engineer" }, badge: { badgeNumber: "B10001" } });
  const fetches = JSON.parse(headers.get("x-lnl-fetches"));
  assert.equal(fetches[0].subgraph, "hr");
  assert.equal(fetches.length, 3);
  for (const s of ["hr", "employment", "security"]) {
    assert.ok(Number(headers.get(`x-${s}-time-ms`)) >= 0, `${s} time`);
    assert.ok("total" in JSON.parse(headers.get(`x-${s}-timing-details`)), `${s} details`);
  }
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

test("federation mutations change only what was given, and report the person as changed", async () => {
  const s = session();
  const { body } = await gql(s, `mutation { createPerson(name: "Old Name", email: "old@company.com") { id } }`);
  const id = body.data.createPerson.id;
  const updated = await gql(s, `mutation { updatePerson(id: "${id}", name: "New Name") { name email active } }`);
  assert.deepEqual(updated.body.data.updatePerson, { name: "New Name", email: "old@company.com", active: true });
  const ended = await gql(s, `mutation { terminatePerson(id: "${id}") { name active } }`);
  assert.deepEqual(ended.body.data.terminatePerson, { name: "New Name", active: false });
  assert.equal((await gql(s, `mutation { updatePerson(id: "person-nope", name: "x") { id } }`)).body.data.updatePerson, null);
});

test("a federated person gains a job and a badge, once each", async () => {
  const s = session();
  const id = (await gql(s, `mutation { createPerson(name: "Job Jo", email: "jo@company.com") { id } }`)).body.data.createPerson.id;
  const assign = `mutation { assignEmployee(personId: "${id}", title: "Pilot", department: "Ops", salary: 100) { id title } }`;
  const emp = (await gql(s, assign)).body.data.assignEmployee;
  assert.equal(emp.title, "Pilot");
  assert.equal((await gql(s, assign)).body.data.assignEmployee, null);
  await gql(s, `mutation { promoteEmployee(id: "${emp.id}", newTitle: "Captain") { id } }`);
  await gql(s, `mutation { provisionBadge(personId: "${id}", accessLevel: STANDARD, clearance: NONE) { id } }`);
  const person = (await gql(s, `{ person(id: "${id}") { employee { title department salary } badge { accessLevel } } }`)).body.data.person;
  assert.deepEqual(person, { employee: { title: "Captain", department: "Ops", salary: 100 }, badge: { accessLevel: "STANDARD" } });
});

test("seed data is read-only on both sides", async () => {
  const { body } = await gql(session(), `mutation { terminatePerson(id: "person-001") { id } }`);
  assert.match(body.errors[0].message, /read-only/);
  const refused = await post(session(), "hr-events/persons/person-001/terminate");
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error, /read-only/);
});

test("an event-side write reaches the projection shortly after", async () => {
  const s = session();
  const res = await post(s, "hr-events/persons", { name: "Ev Ed", email: "ed@company.com" });
  assert.equal(res.status, 201);
  assert.ok(Number(res.headers.get("x-time-ms")) >= 0);
  const { id } = await res.json();
  assert.ok(await eventually(async () => (await composed(s, id)).status === 200));
  const timing = await json(api(s, `consumer/metrics/timing/${id}`));
  assert.equal(timing.eventType, "PersonCreated");
});

test("with the broker down the event waits in the outbox, then catches up", async () => {
  const s = session();
  await put(s, "lesson", { brokerDown: true });
  const { id } = await json(post(s, "hr-events/persons", { name: "Held Hal", email: "hal@company.com" }));
  await sleep(2500);
  assert.equal((await json(api(s, "hr-events/outbox"))).waiting, 1);
  assert.equal((await composed(s, id)).status, 404);
  await put(s, "lesson", { brokerDown: false });
  assert.ok(await eventually(async () => (await composed(s, id)).status === 200));
  assert.equal((await json(api(s, "hr-events/outbox"))).waiting, 0);
});

test("one visitor's stopped broker does not hold up another visitor's events", async () => {
  const [stuck, free] = [session(), session()];
  await put(stuck, "lesson", { brokerDown: true });
  await post(stuck, "hr-events/persons", { name: "Stuck Sam", email: "sam@company.com" });
  const { id } = await json(post(free, "hr-events/persons", { name: "Free Fran", email: "fran@company.com" }));
  assert.ok(await eventually(async () => (await composed(free, id)).status === 200));
  await put(stuck, "lesson", { brokerDown: false });
});

test("with the consumer paused the event waits on the queue, then catches up", async () => {
  const s = session();
  await put(s, "lesson", { consumerPaused: true });
  const { id } = await json(post(s, "hr-events/persons", { name: "Paused Pat", email: "pat@company.com" }));
  await sleep(2500);
  assert.equal((await json(api(s, "hr-events/outbox"))).waiting, 0);
  assert.equal((await composed(s, id)).status, 404);
  await put(s, "lesson", { consumerPaused: false });
  assert.ok(await eventually(async () => (await composed(s, id)).status === 200));
});

test("an employee and a badge join the composed view, and changes follow", async () => {
  const s = session();
  const { id } = await json(post(s, "hr-events/persons", { name: "Jo Jay", email: "jo@company.com" }));
  const employee = await json(post(s, "employment-events/employees", { personId: id, title: "Pilot", department: "Ops", salary: 100 }));
  const badge = await json(post(s, "security-events/badges", { personId: id, accessLevel: "STANDARD", clearance: "NONE" }));
  const view = async () => json(composed(s, id));
  assert.ok(await eventually(async () => (await view()).title === "Pilot" && (await view()).accessLevel === "STANDARD"));
  assert.equal((await post(s, "employment-events/employees", { personId: id, title: "x", department: "y", salary: 1 })).status, 409);
  assert.equal((await api(s, `employment-events/employees/by-person/${id}`)).status, 200);

  await put(s, `hr-events/persons/${id}?name=Jo%20Renamed`);
  await put(s, `employment-events/employees/${employee.id}/promote?title=Captain`);
  await put(s, `security-events/badges/${badge.id}/clearance?level=SECRET`);
  assert.equal((await put(s, `security-events/badges/${badge.id}/clearance?level=NOPE`)).status, 400);
  assert.ok(await eventually(async () => {
    const v = await view();
    return v.name === "Jo Renamed" && v.title === "Captain" && v.salary === 100 && v.clearance === "SECRET";
  }));
});

test("list endpoints answer with arrays", async () => {
  for (const path of ["query/persons", "query/employees", "query/badges", "hr-events/persons",
    "employment-events/employees", "security-events/badges"]) {
    const res = await api(session(), path);
    assert.equal(res.status, 200, path);
    assert.ok(Array.isArray(await res.json()), path);
  }
});

test("unknown people are 404 on the event side", async () => {
  const s = session();
  assert.equal((await api(s, "hr-events/persons/person-nope")).status, 404);
  assert.equal((await put(s, "hr-events/persons/person-nope?name=x")).status, 404);
  assert.equal((await composed(s, "person-nope")).status, 404);
});
