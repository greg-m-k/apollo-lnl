import { rest, lesson, emailFor } from "../lib/api.js";
import { $, el, crumbs, logger, kv, busy } from "../lib/ui.js";

crumbs();
const log = logger($("#log"));
const SWITCHES = ["brokerDown", "consumerPaused"];
const LABEL = { brokerDown: "Broker down", consumerPaused: "Consumer paused" };
const NAMES = ["Ada Lovelace", "Katherine Johnson", "Margaret Hamilton", "Radia Perlman", "Barbara Liskov", "Frances Allen"];

function showSwitches(s) {
  for (const k of SWITCHES) {
    const b = $(`#sw-${k}`);
    b.setAttribute("aria-pressed", String(Boolean(s[k])));
    b.textContent = `${LABEL[k]}${s[k] ? " ✕" : ""}`;
  }
}

for (const k of SWITCHES) {
  $(`#sw-${k}`).addEventListener("click", async () => {
    const on = $(`#sw-${k}`).getAttribute("aria-pressed") !== "true";
    const r = await lesson.set({ [k]: on });
    if (r.ok) showSwitches(r.data);
    log.log(`${LABEL[k]}: ${on ? "on" : "off"}`, on ? "wait" : "ok");
  });
}

async function fillMine(selected) {
  const r = await rest("hr-events/persons");
  const mine = (r.ok ? r.data : []).filter((p) => !/^person-00\d$/.test(p.id));
  $("#mine").replaceChildren(...(mine.length
    ? mine.map((p) => el("option", { value: p.id, selected: p.id === selected }, `${p.name} (${p.id})`))
    : [el("option", { value: "" }, "none yet")]));
}

$("#create").addEventListener("click", busy($("#create"), async () => {
  const name = `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${Math.floor(Math.random() * 90 + 10)}`;
  const p = await rest("hr-events/persons", { method: "POST", body: { name, email: emailFor(name) } });
  if (!p.ok) return log.log(`create failed: ${JSON.stringify(p.data)}`, "err");
  const e = await rest("employment-events/employees", {
    method: "POST", body: { personId: p.data.id, title: "Engineer", department: "Engineering", salary: 120000 },
  });
  $("#create-status").textContent = `${p.data.name} created${e.ok ? " with a job" : ""}.`;
  log.log(`created ${p.data.id} (${p.data.name})${e.ok ? `, employee ${e.data.id}` : ""}`, "ok");
  await fillMine(p.data.id);
}));

$("#write").addEventListener("click", busy($("#write"), async () => {
  const id = $("#mine").value;
  if (!id) return log.log("Create a person first.", "err");
  const name = `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${Math.floor(Math.random() * 90 + 10)}`;
  const p = await rest(`hr-events/persons/${id}?name=${encodeURIComponent(name)}`, { method: "PUT" });
  const emp = await rest(`employment-events/employees/by-person/${id}`);
  const t = emp.ok
    ? await rest(`employment-events/employees/${emp.data.id}/promote?title=${encodeURIComponent($("#title").value)}`, { method: "PUT" })
    : null;
  log.log(`wrote: name "${name}" (${p.status}, ${p.total}ms)${t ? `, title "${$("#title").value}" (${t.status}, ${t.total}ms)` : ""}`,
    p.ok ? "ok" : "err");
}));

// Every second: owners vs projection, and how much is waiting where.
async function watch() {
  const id = $("#mine").value;
  const s = await lesson.get();
  if (s.ok) showSwitches(s.data);
  const [hrOut, empOut] = await Promise.all([rest("hr-events/outbox"), rest("employment-events/outbox")]);
  const waiting = (hrOut.data?.waiting ?? 0) + (empOut.data?.waiting ?? 0);
  if (!id) {
    $("#backlog").textContent = `Outbox: ${waiting} event(s) waiting.`;
    return;
  }
  const [src, emp, proj] = await Promise.all([
    rest(`hr-events/persons/${id}`), rest(`employment-events/employees/by-person/${id}`), rest(`query/composed/${id}`),
  ]);
  const source = { name: src.data?.name, title: emp.ok ? emp.data.title : null };
  const view = proj.ok ? { name: proj.data.name, title: proj.data.title } : { name: null, title: null };
  kv($("#source"), [["name", source.name], ["title", source.title]]);
  kv($("#projection"), [["name", view.name], ["title", view.title],
    ["data freshness", proj.ok ? proj.data.freshness.dataFreshness : null]]);
  const inSync = source.name === view.name && source.title === view.title;
  $("#sync").textContent = inSync ? "in sync ✓" : "behind…";
  $("#sync").className = `status ${inSync ? "ok" : "wait"}`;
  $("#backlog").textContent = `Outbox: ${waiting} event(s) waiting to be published.` +
    (s.data?.consumerPaused ? " Consumer paused: published events are waiting on the queue." : "");
}

async function loop() {
  try { await watch(); } catch (e) { log.log(String(e), "err"); }
  setTimeout(loop, 1000);
}
fillMine().then(loop);
