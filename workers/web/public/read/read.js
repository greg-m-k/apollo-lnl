import { federation, rest, PERSON_QUERY } from "../lib/api.js";
import { $, crumbs, logger, timeline, kv, busy, fedRows, evtRows } from "../lib/ui.js";
import { fillPeople } from "../lib/people.js";

crumbs();
const SUBGRAPHS = ["hr", "employment", "security"];
const fedLog = logger($("#fed-log"));
const evtLog = logger($("#evt-log"));

for (const s of SUBGRAPHS) {
  $(`#d-${s}`).addEventListener("input", (e) => { $(`#o-${s}`).value = `${e.target.value}ms`; });
}
const delays = () => Object.fromEntries(SUBGRAPHS.map((s) => [s, Number($(`#d-${s}`).value)]).filter(([, v]) => v > 0));

function showCode() {
  const id = $("#person").value;
  $("#fed-code").textContent = `POST /graphql\n${PERSON_QUERY(id)}`;
  $("#evt-code").textContent = `GET /api/composed/${id}`;
}

async function askFederation(id) {
  const delay = delays();
  const r = await federation(PERSON_QUERY(id), Object.keys(delay).length ? { delay } : undefined);
  const lanes = [{ name: "Router (whole query)", start: 0, end: r.router ?? r.total, kind: "fed" },
    ...r.fetches.map((f) => ({
      name: `→ ${f.subgraph}${delay[f.subgraph] ? ` (+${delay[f.subgraph]}ms)` : ""}`,
      start: f.start, end: f.end, kind: f.status === 200 ? "fed" : "fail",
    }))];
  timeline($("#fed-timeline"), lanes);
  kv($("#fed-result"), fedRows(r.body.data?.person));
  const parts = SUBGRAPHS.map((s) => `${s} ${r.subgraphs[s].ms ?? "-"}ms`).join(", ");
  fedLog.log(`${r.total}ms in the browser, router ${r.router}ms [${parts}]`, r.body.errors ? "err" : "ok");
  for (const e of r.body.errors ?? []) fedLog.log(`error: ${e.message}`, "err");
  return r.total;
}

async function askProjection(id) {
  const r = await rest(`query/composed/${id}`);
  const db = r.details?.db ?? 0;
  timeline($("#evt-timeline"), [
    { name: "Query service", start: 0, end: r.server ?? r.total, kind: "evt" },
    { name: "→ local projection DB", start: Math.max(0, (r.server ?? 0) - db), end: r.server ?? db, kind: "evt" },
  ]);
  kv($("#evt-result"), evtRows(r.ok ? r.data : null));
  evtLog.log(r.ok
    ? `${r.total}ms in the browser, service ${r.server}ms (DB ${db}ms), data ${r.data.freshness.dataFreshness} old`
    : `${r.status}: ${JSON.stringify(r.data)}`, r.ok ? "ok" : "err");
  return r.total;
}

$("#run").addEventListener("click", busy($("#run"), async () => {
  const id = $("#person").value;
  showCode();
  $("#status").textContent = "Asking both…";
  $("#status").className = "status wait";
  const [fed, evt] = await Promise.all([askFederation(id), askProjection(id)]);
  $("#status").textContent = `Federation ${fed}ms · Projection ${evt}ms`;
  $("#status").className = "status ok";
}));
$("#person").addEventListener("change", showCode);
showCode();
fillPeople($("#person")).then(showCode);
