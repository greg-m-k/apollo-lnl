// The REST helper every event-side service is built on, called the way a client would.
import { expect, test } from "vitest";
import { restService, HttpError, need } from "../shared/rest.js";
import { Refused } from "../shared/rows.js";
import { SESSION_HEADER } from "../shared/chaos.js";

const service = restService([
  ["GET", "/api/things", () => [1, 2]],
  ["GET", "/api/things/:id", ({ params, session, query }) => ({ id: params.id, session, q: query.get("q") })],
  ["POST", "/api/things", ({ body }) => need(body, "name"), 201],
  ["GET", "/api/text", () => "plain"],
  ["GET", "/api/conflict", () => { throw new HttpError(409, "Already there"); }],
  ["GET", "/api/refused", () => { throw new Refused(403, "seed data"); }],
  ["GET", "/api/crash", () => { throw new Error("bug"); }],
]);

const call = (method, path, body) => service(new Request(`https://x${path}`, {
  method, headers: { [SESSION_HEADER]: "s1" }, body: body && JSON.stringify(body),
}), {}, {});
const answer = async (method, path, body) => {
  const res = await call(method, path, body);
  return [res.status, res.headers.get("content-type").startsWith("application/json") ? await res.json() : await res.text()];
};

test("a handler's value is the JSON body, arrays included", async () => {
  expect(await answer("GET", "/api/things")).toEqual([200, [1, 2]]);
});

test("path params, the query and the session reach the handler", async () => {
  expect(await answer("GET", "/api/things/42?q=x")).toEqual([200, { id: "42", session: "s1", q: "x" }]);
});

test("a route can answer with its own success status", async () => {
  expect(await answer("POST", "/api/things", { name: "n" })).toEqual([201, { name: "n" }]);
});

test("a missing field is a 400 that names it", async () => {
  expect(await answer("POST", "/api/things", {})).toEqual([400, { error: "name is required" }]);
});

test("a string is answered as plain text", async () => {
  expect(await answer("GET", "/api/text")).toEqual([200, "plain"]);
  expect(await answer("GET", "/api/conflict")).toEqual([409, "Already there"]);
});

test("a refusal by the row rules becomes its status and message", async () => {
  expect(await answer("GET", "/api/refused")).toEqual([403, { error: "seed data" }]);
});

test("unknown paths and wrong methods are 404", async () => {
  expect((await answer("GET", "/api/nope"))[0]).toBe(404);
  expect((await answer("DELETE", "/api/things"))[0]).toBe(404);
  expect((await answer("GET", "/api/things/1/extra"))[0]).toBe(404);
});

test("every answer carries the request's timing", async () => {
  const res = await call("GET", "/api/things");
  expect(Number(res.headers.get("x-time-ms"))).toBeGreaterThanOrEqual(0);
  expect(JSON.parse(res.headers.get("x-timing-details"))).toHaveProperty("total");
});

test("a bug in a handler is not disguised as an answer", async () => {
  await expect(call("GET", "/api/crash")).rejects.toThrow("bug");
});
