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
  page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} at ${m.location().url}`));
});
after(async () => browser?.close());
const shot = (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

test("home lists the start page and the six lessons", async () => {
  await page.goto(BASE);
  assert.equal(await page.locator("#topic-0 ~ .cards .card").count(), 7);
  // The useEffect topic is its own repository and Worker, served below /effects/.
  assert.equal(await page.locator('#topic-1 ~ .cards a.card[href^="/effects/"]').count(), 7);
  assert.equal(await page.locator('.topic a[href="https://github.com/greg-m-k/useeffect-lnl"]').count(), 1);
  assert.match(await page.textContent("header"), /Nothing here is mocked/);
  assert.match(await page.textContent("header strong"), /format/);
  assert.equal(await page.locator('header a[href="https://lnl.sam-peterson.com"]').count(), 1, "credits where the format comes from");
  assert.ok(await page.locator("header p").count() >= 3, "the introduction is several short paragraphs");
  // The source belongs to the topic it teaches, not to the page's opening summary.
  const repo = 'a[href="https://github.com/greg-m-k/apollo-lnl"]';
  assert.equal(await page.locator(`header ${repo}, footer ${repo}`).count(), 0);
  assert.equal(await page.locator(`.topic ${repo}`).count(), 1);
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

test("write: the same name twice is refused by both owners, and the page says so", async () => {
  await page.goto(`${BASE}/write/`);
  await page.fill("#name", `Twice ${Date.now() % 100000}`);
  await page.dispatchEvent("#name", "input");
  await page.click("#run");
  await page.waitForFunction(() => /Done/.test(document.querySelector("#status").textContent), null, { timeout: 20000 });
  await page.click("#run");
  await page.waitForFunction(() => /already/.test(document.querySelector("#status").textContent), null, { timeout: 20000 });
  for (const id of ["#fed-read", "#evt-read", "#fed-log", "#evt-log"])
    assert.match(await page.textContent(id), /already has a person with this email/, id);
  assert.doesNotMatch(await page.textContent("#evt-log"), /<html|D1_ERROR/i);
  assert.doesNotMatch(await page.textContent("#fed-log"), /D1_ERROR/);
});

test("read: the first run's extra time is explained, and the console says when a service had just started", async () => {
  await page.goto(`${BASE}/read/`);
  assert.match(await page.textContent("#first-run"), /first run/i);
  await page.click("#run");
  await page.waitForFunction(() => /Federation \d+ms/.test(document.querySelector("#status").textContent));
  // Every answer says how many requests that copy of the router and the query service had served.
  assert.match(await page.textContent("#fed-log"), /router request #\d+/);
  assert.match(await page.textContent("#evt-log"), /query service request #\d+/);
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

  // Once everything has caught up the page rests: no more API requests until something changes.
  await page.waitForTimeout(1500);
  let asked = 0;
  const count = (request) => { if (request.url().includes("/api/")) asked += 1; };
  page.on("request", count);
  await page.waitForTimeout(2500);
  page.off("request", count);
  assert.equal(asked, 0);
});

test("tradeoffs: measures both paths", async () => {
  await page.goto(`${BASE}/tradeoffs/`);
  await page.click("#run");
  await page.waitForFunction(() => /Measured/.test(document.querySelector("#status").textContent), null, { timeout: 60000 });
  assert.equal(await page.locator("#numbers tr").count(), 5);
  await shot("tradeoffs");
});

test("blue and green belong to the two patterns: only their own panels carry them", async () => {
  for (const path of ["start/", "read/", "failure/", "write/", "bus/", "tradeoffs/", "port/"]) {
    await page.goto(`${BASE}/${path}`);
    for (const h of await page.locator(".panel.fed > h2").allTextContents()) assert.match(h, /^Federated services/, path);
    for (const h of await page.locator(".panel.evt > h2").allTextContents()) assert.match(h, /^Event-driven projections/, path);
  }
});

test("footers credit the author; notes about your data sit on the pages that make it", async () => {
  for (const path of ["", "start/", "read/", "failure/", "write/", "bus/", "tradeoffs/", "port/"]) {
    await page.goto(`${BASE}/${path}`);
    await page.waitForSelector("footer");
    assert.match(await page.textContent("footer"), /^Made by Greg Kitchen.$/, path || "home");
    const text = await page.textContent("main");
    assert.equal(/deleted 20 minutes after/.test(text), ["write/", "bus/"].includes(path), `20-minute note on ${path || "home"}`);
    // Plain statements: no "Neither ...", no "X, not Y" contrasts, no slogans.
    assert.doesNotMatch(text, /Neither|, not (a|an|the) |is the lesson|bargain/, path || "home");
  }
});

test("the two patterns keep their colours in the text that names them", async () => {
  const colour = (sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).color);
  for (const path of ["", "read/", "failure/", "write/", "bus/", "tradeoffs/"]) {
    await page.goto(`${BASE}/${path}`);
    assert.equal(await colour(".fed-name"), "rgb(37, 99, 235)", path || "home");
    assert.equal(await colour(".evt-name"), "rgb(22, 163, 74)", path || "home");
  }
  await page.goto(`${BASE}/start/`);
  assert.equal(await colour(".panel.fed > h2"), "rgb(37, 99, 235)");
  assert.equal(await colour(".panel.evt > h2"), "rgb(22, 163, 74)");
});

test("the page ends shortly after the footer: no empty space to scroll into", async () => {
  for (const path of ["", "start/", "read/", "bus/", "port/"]) {
    await page.goto(`${BASE}/${path}`);
    const gap = await page.evaluate(() => {
      const text = document.createRange();
      text.selectNodeContents(document.querySelector("footer"));
      return document.documentElement.scrollHeight - (text.getBoundingClientRect().bottom + scrollY);
    });
    assert.ok(gap <= 40, `${path || "home"}: ${Math.round(gap)}px below the footer text`);
  }
});

test("start here: headings stand out from body text in light and dark", async () => {
  for (const scheme of ["light", "dark"]) {
    const p = await browser.newPage({ colorScheme: scheme });
    await p.goto(`${BASE}/start/`);
    const [h2, body, strong] = await p.evaluate(() => ["main > h2", "main > p:not(.lead)", "main > p strong"]
      .map((s) => getComputedStyle(document.querySelector(s)).color));
    assert.notEqual(body, h2, `${scheme}: body text is as bright as headings`);
    assert.equal(strong, h2, `${scheme}: defined terms keep heading brightness`);
    await p.close();
  }
});

test("paragraphs have visible space between them on every page", async () => {
  for (const path of ["", "start/", "read/", "failure/", "write/", "bus/", "tradeoffs/", "port/"]) {
    await page.goto(`${BASE}/${path}`);
    const gaps = await page.evaluate(() => [...document.querySelectorAll("main p + p")]
      .filter((p) => p.offsetParent && p.previousElementSibling.offsetParent)
      .map((p) => Math.round(p.getBoundingClientRect().top - p.previousElementSibling.getBoundingClientRect().bottom)));
    for (const gap of gaps) assert.ok(gap >= 12, `${path || "home"}: ${gap}px between paragraphs`);
  }
});

test("start here: further reading links Martin Fowler on bounded contexts, DDD and event-driven systems", async () => {
  await page.goto(`${BASE}/start/`);
  const links = await page.locator("#further-reading a").evaluateAll((as) => as.map((a) => a.href));
  for (const path of ["bliki/BoundedContext.html", "bliki/DomainDrivenDesign.html", "articles/201701-event-driven.html", "bliki/CQRS.html"])
    assert.ok(links.includes(`https://martinfowler.com/${path}`), path);
});

test("inline code reads as a chip with its own background, and topic emoji are ones every system can draw", async () => {
  await page.goto(`${BASE}/start/`);
  const bg = await page.locator("p code").first().evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.notEqual(bg, "rgba(0, 0, 0, 0)");
  await page.goto(BASE);
  assert.doesNotMatch(await page.textContent("main"), /🪝/);
});

test("every page fits a phone screen without sideways scrolling", async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const path of ["", "start/", "read/", "failure/", "write/", "bus/", "tradeoffs/", "port/"]) {
    await page.goto(`${BASE}/${path}`);
    await page.waitForLoadState("networkidle");  // measure the finished page, not one mid-script
    const [over, wide] = await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth,
      [...document.querySelectorAll("body *")].filter((e) => !e.closest(".crumbs, pre") && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3)
        .map((e) => `${e.tagName.toLowerCase()}.${e.className} in ${e.parentElement.className || e.parentElement.tagName}`)]);
    assert.equal(over, 0, `${path || "home"}: ${wide.join(", ")}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("port page renders and nothing logged an error", async () => {
  await page.goto(`${BASE}/port/`);
  assert.match(await page.textContent("h1"), /Cloudflare/);
  assert.equal(await page.locator('.lead a[href="https://github.com/greg-m-k/apollo-federation-vs-kafka-projections-demo"]').count(), 1);
  assert.match(await page.textContent(".lead"), /docker compose up --build/);
  await shot("port");
  // A 404 from the API is an answer, not an error: a read that races an event, or a poll until it lands.
  assert.deepEqual(errors.filter((e) => !/status of 40[49].* at .*\/api\//.test(e)), []);
});
