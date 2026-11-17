import { federation, rest, until, emailFor } from "../lib/api.js";
import { $, crumbs, logger, timeline, busy } from "../lib/ui.js";
import { pipeline, fromTiming } from "../lib/pipeline.js";

crumbs();
const fedLog = logger($("#fed-log"));
const evtLog = logger($("#evt-log"));
pipeline($("#pipeline"), {});
$("#name").addEventListener("input", (e) => { $("#email").value = emailFor(e.target.value); });
const gqlString = (s) => JSON.stringify(s);

async function federationSide(name, email) {
  const mutation = `mutation { createPerson(name: ${gqlString(name)}, email: ${gqlString(email)}) { id name } }`;
  $("#fed-code").textContent = mutation;
  const w = await federation(mutation);
  const id = w.body.data?.createPerson?.id;
  if (!id) {
    fedLog.log(`write failed: ${w.body.errors?.[0]?.message}`, "err");
    return;
  }
  const r = await federation(`{ person(id: "${id}") { id name } }`);
  timeline($("#fed-timeline"), [
    { name: "Write (router)", start: 0, end: w.router, kind: "fed" },
    ...w.fetches.map((f) => ({ name: `→ ${f.subgraph}`, start: f.start, end: f.end, kind: "fed" })),
    { name: "Read it back", start: w.total, end: w.total + (r.router ?? r.total), kind: "fed" },
  ]);
  const found = Boolean(r.body.data?.person);
  $("#fed-read").textContent = found ? "found ✓" : "not found";
  $("#fed-read").style.color = found ? "var(--evt)" : "var(--fail)";
  fedLog.log(`created ${id} in ${w.total}ms (HR DB write ${w.subgraphs.hr.details?.db_write ?? "?"}ms); read back at once: ${found ? "found" : "missing"}`, found ? "ok" : "err");
}

async function eventSide(name, email) {
  const body = { name, email, hireDate: new Date().toISOString().slice(0, 10) };
  $("#evt-code").textContent = `POST /api/persons\n${JSON.stringify(body, null, 2)}`;
  pipeline($("#pipeline"), { write: { status: "wait" } });
  const w = await rest("hr-events/persons", { method: "POST", body });
  if (!w.ok) {
    pipeline($("#pipeline"), { write: { status: "fail" } });
    evtLog.log(`write failed: ${w.status} ${JSON.stringify(w.data)}`, "err");
    return;
  }
  const id = w.data.id;
  pipeline($("#pipeline"), { write: { status: "done", ms: w.server }, relay: { status: "wait" } });
  evtLog.log(`created ${id}: API answered in ${w.total}ms (DB + outbox ${w.details?.db_write_and_outbox ?? "?"}ms)`, "ok");

  const immediate = await rest(`query/composed/${id}`);
  $("#evt-read").textContent = immediate.ok ? "found ✓" : "not found yet";
  $("#evt-read").style.color = immediate.ok ? "var(--evt)" : "var(--wait)";
  evtLog.log(`read straight after the write: ${immediate.status === 200 ? "found" : "404, not in the projection yet"}`,
    immediate.ok ? "ok" : "wait");

  const [, waited] = await until(async () => (await rest(`query/composed/${id}`)).ok);
  const t = await rest(`consumer/metrics/timing/${id}`);
  if (!t.ok) {
    evtLog.log(`no propagation after ${waited}ms`, "err");
    return;
  }
  pipeline($("#pipeline"), fromTiming(w.server, t.data));
  $("#evt-read").textContent = `found after ${t.data.totalPropagationMs}ms`;
  $("#evt-read").style.color = "var(--evt)";
  evtLog.log(`in the projection ${t.data.totalPropagationMs}ms after the write (relay ${t.data.outboxToQueueMs}ms, queue ${t.data.queueToConsumerMs}ms, consumer ${t.data.consumerToProjectionMs}ms)`, "ok");
}

$("#run").addEventListener("click", busy($("#run"), async () => {
  const name = $("#name").value.trim();
  const email = $("#email").value.trim();
  if (!name || !email) return;
  $("#status").textContent = "Writing…";
  $("#status").className = "status wait";
  await Promise.all([federationSide(name, email), eventSide(name, email)]);
  $("#status").textContent = "Done. Try again with another name.";
  $("#status").className = "status ok";
}));
