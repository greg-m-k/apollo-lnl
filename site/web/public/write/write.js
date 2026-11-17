import { federation, rest, composedView, until, createPerson, emailFor } from "../lib/api.js";
import { $, crumbs, logger, timeline, fedLanes, busy, say } from "../lib/ui.js";
import { pipeline, fromTiming } from "../lib/pipeline.js";

crumbs();
const fedLog = logger($("#fed-log"));
const evtLog = logger($("#evt-log"));
pipeline($("#pipeline"), {});
$("#name").addEventListener("input", (e) => { $("#email").value = emailFor(e.target.value); });

// The big "read right after the write" result. tone is a colour token: evt, wait or fail.
function verdict(node, text, tone) {
  node.textContent = text;
  node.style.color = `var(--${tone})`;
}

async function federationSide(name, email) {
  const mutation = createPerson(name, email);
  $("#fed-code").textContent = mutation;
  const w = await federation(mutation);
  const id = w.body.data?.createPerson?.id;
  if (!id) return refused($("#fed-read"), fedLog, w.body.errors?.[0]?.message ?? "no id returned");
  showReadBack(w, id, await federation(`{ person(id: "${id}") { id name } }`));
  return { readable: `Federation readable after ${w.total}ms` };  // the owner answered: every read sees it now
}

// The owner turned the write down: nothing was created, so there is nothing to read back.
function refused(node, log, reason) {
  verdict(node, reason, "fail");
  log.log(`write refused: ${reason}`, "err");
  return { refused: reason };
}

function showReadBack(w, id, r) {
  const found = Boolean(r.body.data?.person);
  timeline($("#fed-timeline"), [...fedLanes(w, "Write (router)"),
    { name: "Read it back", start: w.total, end: w.total + (r.router ?? r.total), kind: "fed" }]);
  verdict($("#fed-read"), found ? "found ✓" : "not found", found ? "evt" : "fail");
  const dbWrite = w.subgraphs.hr.details?.db ?? "?";
  fedLog.log(`created ${id} in ${w.total}ms (HR DB write ${dbWrite}ms); read back at once: ${found ? "found" : "missing"}`,
    found ? "ok" : "err");
}

async function eventSide(name, email) {
  const body = { name, email, hireDate: new Date().toISOString().slice(0, 10) };
  $("#evt-code").textContent = `POST /api/persons\n${JSON.stringify(body, null, 2)}`;
  pipeline($("#pipeline"), { write: { status: "wait" } });
  const w = await rest("hr-events/persons", { method: "POST", body });
  if (!w.ok) {
    pipeline($("#pipeline"), { write: { status: "fail" } });
    return refused($("#evt-read"), evtLog, w.data?.error ?? `HTTP ${w.status}`);
  }
  pipeline($("#pipeline"), { write: { status: "done", ms: w.server }, relay: { status: "wait" } });
  evtLog.log(`created ${w.data.id}: API answered in ${w.total}ms (DB + outbox ${w.details?.db ?? "?"}ms)`, "ok");
  await showRace(w.data.id);
  const propagation = await showPropagation(w.data.id, w.server);
  return { readable: propagation == null
    ? "Projection not readable yet"
    : `Projection readable after ${w.total + propagation}ms (write ${w.total}ms + propagation ${propagation}ms)` };
}

// The read that races the event: usually too early.
async function showRace(id) {
  const { ok } = await composedView(id);
  verdict($("#evt-read"), ok ? "found ✓" : "not found yet", ok ? "evt" : "wait");
  evtLog.log(`read straight after the write: ${ok ? "found" : "404, not in the projection yet"}`, ok ? "ok" : "wait");
}

// Wait for the consumer's timing row; it is committed together with the projection row.
async function showPropagation(id, writeMs) {
  const [t, waited] = await until(async () => {
    const r = await rest(`consumer/metrics/timing/${id}`);
    return r.ok && r.data;
  }, 250);
  if (!t) {
    evtLog.log(`no propagation after ${waited}ms`, "err");
    return null;
  }
  pipeline($("#pipeline"), fromTiming(writeMs, t));
  verdict($("#evt-read"), `found after ${t.totalPropagationMs}ms`, "evt");
  evtLog.log(`in the projection ${t.totalPropagationMs}ms after the write (relay ${t.outboxToQueueMs}ms, queue ${t.queueToConsumerMs}ms, consumer ${t.consumerToProjectionMs}ms)`, "ok");
  return t.totalPropagationMs;
}

$("#run").addEventListener("click", busy($("#run"), async () => {
  const name = $("#name").value.trim();
  const email = $("#email").value.trim();
  if (!name || !email) return;
  say($("#status"), "Writing…", "wait");
  for (const node of [$("#fed-read"), $("#evt-read")]) verdict(node, "–", "faint");  // no result from the last run lingers
  const sides = await Promise.all([federationSide(name, email), eventSide(name, email)]);
  const refusal = sides.find((s) => s.refused)?.refused;
  if (refusal) say($("#status"), `${refusal}. Change the name or email and try again.`, "err");
  else say($("#status"), `Done. ${sides.map((s) => s.readable).join(" · ")}. Try again with another name.`, "ok");
}));
