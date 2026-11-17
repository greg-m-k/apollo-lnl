// Drive every lesson in the installed Edge and check what a visitor would see.
// BASE=http://localhost:8800 SHOTS=<dir> node --test test/ui.mjs
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:8800";
const SHOTS = process.env.SHOTS;
let browser, page;
const errors = [];

before(async () => {
  browser = await chromium.launch({ channel: "msedge" });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
});
after(async () => browser?.close());
const shot = (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

test("home lists the six lessons", async () => {
  await page.goto(BASE);
  assert.equal(await page.locator(".card").count(), 6);
  await shot("home");
});

test("read: both sides answer, federation shows HR then two parallel calls", async () => {
  await page.goto(`${BASE}/read/`);
  await page.click("#run");
  await page.waitForFunction(() => /Federation \d+ms/.test(document.querySelector("#status").textContent));
  assert.equal(await page.locator("#fed-timeline .lane").count(), 4);
  assert.match(await page.textContent("#fed-result"), /Senior Software Engineer/);
  assert.match(await page.textContent("#evt-result"), /B10001/);
  await shot("read");
});

test("failure: security off gives a partial federation answer and a full projection", async () => {
  await page.goto(`${BASE}/failure/`);
  await page.click("#sw-security");
  await page.click("#run");
  await page.waitForFunction(() => /Federation:/.test(document.querySelector("#status").textContent));
  assert.match(await page.textContent("#status"), /partial answer · Projection: full answer/);
  assert.match(await page.textContent("#fed-log"), /security/);
  await shot("failure");
});

test("write: federation reads back at once, the projection after propagation", async () => {
  await page.goto(`${BASE}/write/`);
  await page.fill("#name", `Grace ${Date.now() % 100000}`);
  await page.dispatchEvent("#name", "input");
  await page.click("#run");
  await page.waitForFunction(() => /Done/.test(document.querySelector("#status").textContent), null, { timeout: 20000 });
  assert.match(await page.textContent("#fed-read"), /found/);
  assert.match(await page.textContent("#evt-read"), /found after \d+ms/);
  assert.equal(await page.locator(".stage.done").count(), 5);
  await shot("write");
});

test("bus: with the broker down a rename waits, then catches up", async () => {
  await page.goto(`${BASE}/bus/`);
  await page.click("#create");
  await page.waitForFunction(() => document.querySelector("#mine").value !== "");
  await page.waitForFunction(() => /in sync/.test(document.querySelector("#sync").textContent), null, { timeout: 15000 });
  await page.click("#sw-brokerDown");
  await page.waitForFunction(() => document.querySelector("#sw-brokerDown").getAttribute("aria-pressed") === "true");
  await page.click("#write");
  await page.waitForFunction(() => /behind/.test(document.querySelector("#sync").textContent), null, { timeout: 15000 });
  await page.waitForFunction(() => /Outbox: [1-9]/.test(document.querySelector("#backlog").textContent), null, { timeout: 15000 });
  await shot("bus-behind");
  await page.click("#sw-brokerDown");
  await page.waitForFunction(() => /in sync/.test(document.querySelector("#sync").textContent), null, { timeout: 20000 });
  await shot("bus-caught-up");
});

test("tradeoffs: measures both paths", async () => {
  await page.goto(`${BASE}/tradeoffs/`);
  await page.click("#run");
  await page.waitForFunction(() => /Measured/.test(document.querySelector("#status").textContent), null, { timeout: 60000 });
  assert.equal(await page.locator("#numbers tr").count(), 5);
  await shot("tradeoffs");
});

test("port page renders and nothing logged an error", async () => {
  await page.goto(`${BASE}/port/`);
  assert.match(await page.textContent("h1"), /Cloudflare/);
  await shot("port");
  // 404s are expected: reads that race an event, and polling until it lands.
  assert.deepEqual(errors.filter((e) => !/status of 404/.test(e)), []);
});
