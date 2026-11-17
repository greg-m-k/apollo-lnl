import { rest, lesson, composedView, emailFor } from "../lib/api.js";
import { $, crumbs, logger, kv, busy, say, press, pressed } from "../lib/ui.js";
import { fillPeople, randomName } from "../lib/people.js";

crumbs();
const log = logger($("#log"));
const SWITCHES = { brokerDown: "Broker down", consumerPaused: "Consumer paused" };
const fillMine = (selected) => fillPeople($("#mine"), { path: "hr-events/persons", mine: true, selected });
let employeeId = null;  // the selected person's employee record, learned by each look

const showSwitches = (on) => Object.keys(SWITCHES).forEach((key) => press($(`#sw-${key}`), on[key]));
for (const [key, label] of Object.entries(SWITCHES)) {
  $(`#sw-${key}`).addEventListener("click", async () => {
    const on = !pressed($(`#sw-${key}`));
    const r = await lesson.set({ [key]: on });
    if (r.ok) showSwitches(r.data);
    log.log(`${label}: ${on ? "on" : "off"}`, on ? "wait" : "ok");
    wake();
  });
}

$("#create").addEventListener("click", busy($("#create"), async () => {
  const name = randomName();
  const p = await rest("hr-events/persons", { method: "POST", body: { name, email: emailFor(name) } });
  if (!p.ok) return log.log(`create failed: ${JSON.stringify(p.data)}`, "err");
  const e = await rest("employment-events/employees", {
    method: "POST", body: { personId: p.data.id, title: "Engineer", department: "Engineering", salary: 120000 },
  });
  $("#create-status").textContent = `${p.data.name} created${e.ok ? " with a job" : ""}.`;
  log.log(`created ${p.data.id} (${p.data.name})${e.ok ? `, employee ${e.data.id}` : ""}`, "ok");
  await fillMine(p.data.id);
  wake();
}));

$("#write").addEventListener("click", busy($("#write"), async () => {
  const id = $("#mine").value;
  if (!id) return log.log("Create a person first.", "err");
  const name = randomName();
  const title = $("#title").value;
  const [p, t] = await Promise.all([
    rest(`hr-events/persons/${id}?name=${encodeURIComponent(name)}`, { method: "PUT" }),
    employeeId && rest(`employment-events/employees/${employeeId}/promote?title=${encodeURIComponent(title)}`, { method: "PUT" }),
  ]);
  log.log(`wrote: name "${name}" (${p.status}, ${p.total}ms)${t ? `, title "${title}" (${t.status}, ${t.total}ms)` : ""}`,
    p.ok ? "ok" : "err");
  wake();
}));

// A field of an API answer's body, or null when the answer has none (a 404, say).
const field = (answer, key) => answer.data?.[key] ?? null;

// Show the owners' data against the projection's; true when they agree.
function compare(source, seen, freshness) {
  kv($("#source"), [["name", source.name], ["title", source.title]]);
  kv($("#projection"), [["name", seen.name], ["title", seen.title], ["data freshness", freshness]]);
  const inSync = source.name === seen.name && source.title === seen.title;
  say($("#sync"), inSync ? "in sync ✓" : "behind…", inSync ? "ok" : "wait");
  return inSync;
}

// The selected person at their owners and in the projection; true when the two agree.
async function personInSync(id) {
  const [person, employee, view] = await Promise.all([
    rest(`hr-events/persons/${id}`), rest(`employment-events/employees/by-person/${id}`), composedView(id),
  ]);
  employeeId = field(employee, "id");
  return compare(
    { name: field(person, "name"), title: field(employee, "title") },
    { name: field(view, "name"), title: field(view, "title") },
    field(view, "freshness")?.dataFreshness,
  );
}

// The switches and the outboxes; true when no switch is on and nothing waits to be published.
async function busQuiet() {
  const [switches, hr, employment] = await Promise.all([
    lesson.get(), rest("hr-events/outbox"), rest("employment-events/outbox"),
  ]);
  const on = switches.ok ? switches.data : {};
  showSwitches(on);
  const waiting = field(hr, "waiting") + field(employment, "waiting");
  $("#backlog").textContent = `Outbox: ${waiting} event(s) waiting to be published.${
    on.consumerPaused ? " Consumer paused: published events are waiting on the queue." : ""}`;
  return waiting === 0 && !on.brokerDown && !on.consumerPaused;
}

// One look at both sides, all requests at once. True once nothing is left to wait for.
async function look() {
  const id = $("#mine").value;
  const [quiet, inSync] = await Promise.all([busQuiet(), id ? personInSync(id) : true]);
  return quiet && inSync;
}

// Look once a second while anything is on its way; rest once settled or while the tab is hidden.
let timer = null;
let woken = false;
function wake() {
  woken = true;
  timer ??= setTimeout(tick, 0);
}
async function tick() {
  woken = false;
  const settled = document.hidden || await look().catch((e) => { log.log(String(e), "err"); return false; });
  timer = settled && !woken ? null : setTimeout(tick, woken ? 0 : 1000);
}
$("#mine").addEventListener("change", wake);
document.addEventListener("visibilitychange", wake);
fillMine().then(wake);
