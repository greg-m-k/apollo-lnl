import { federation, composedView, PERSON_QUERY, SUBGRAPHS } from "../lib/api.js";
import { $, crumbs, logger, timeline, fedLanes, kv, busy, say, fedRows, evtRows } from "../lib/ui.js";
import { fillPeople } from "../lib/people.js";

crumbs();
const fedLog = logger($("#fed-log"));
const evtLog = logger($("#evt-log"));

for (const s of SUBGRAPHS) {
  $(`#d-${s}`).addEventListener("input", (e) => { $(`#o-${s}`).value = `${e.target.value}ms`; });
}
// { subgraph: extra ms } from the sliders
const delays = () => Object.fromEntries(SUBGRAPHS.map((s) => [s, Number($(`#d-${s}`).value)]));

function showCode() {
  const id = $("#person").value;
  $("#fed-code").textContent = `POST /graphql\n${PERSON_QUERY(id)}`;
  $("#evt-code").textContent = `GET /api/composed/${id}`;
}

// "router request #1 (just started)": the first request a fresh copy of a Worker serves is the slow one.
const fresh = (who, n, firstWork) => (n == null ? "" : ` · ${who} request #${n}${n === 1 ? ` (just started: ${firstWork})` : ""}`);

// Where federation's time went: the trip to the router and back, the router's own work (parsing,
// planning, merging), and the time it spent waiting for subgraph calls (first call's start to last call's end).
function split(r) {
  const waiting = r.fetches.length ? Math.max(...r.fetches.map((f) => f.end)) - Math.min(...r.fetches.map((f) => f.start)) : 0;
  return `network and site ${r.total - r.router}ms + router ${r.router}ms (router's own work ${r.router - waiting}ms, waiting on subgraphs ${waiting}ms)`;
}
// Each subgraph's time, with the part its database took. The database time is inside the subgraph time.
const subgraphParts = (r) => SUBGRAPHS.map((s) => {
  const db = r.subgraphs[s].details?.db;
  return `${s} ${r.subgraphs[s].ms ?? "-"}ms${db == null ? "" : ` (DB ${db}ms)`}`;
}).join(", ");

async function askFederation(id) {
  const delay = delays();
  const r = await federation(PERSON_QUERY(id), { delay });
  timeline($("#fed-timeline"), fedLanes(r, "Router (whole query)", (s) => (delay[s] ? ` (+${delay[s]}ms)` : "")));
  kv($("#fed-result"), fedRows(r.body.data?.person));
  fedLog.log(`${r.total}ms in the browser = ${split(r)} [${subgraphParts(r)}]${fresh("router", r.routerRequest, "it read the supergraph and planned the query")}`,
    r.body.errors ? "err" : "ok");
  for (const e of r.body.errors ?? []) fedLog.log(`error: ${e.message}`, "err");
  return r.total;
}

async function askProjection(id) {
  const r = await composedView(id);
  const db = r.details?.db ?? 0;
  const service = r.server ?? r.total;
  timeline($("#evt-timeline"), [
    { name: "Query service", start: 0, end: service, kind: "evt" },
    { name: "→ local projection DB", start: Math.max(0, service - db), end: service, kind: "evt" },
  ]);
  kv($("#evt-result"), evtRows(r.ok ? r.data : null));
  evtLog.log(r.ok
    ? `${r.total}ms in the browser, service ${r.server}ms (DB ${db}ms), data ${r.data.freshness.dataFreshness} old${fresh("query service", r.request, "its database connection opened")}`
    : `${r.status}: ${JSON.stringify(r.data)}`, r.ok ? "ok" : "err");
  return { ms: r.total, age: r.ok ? r.data.freshness.dataFreshness : null };
}

$("#run").addEventListener("click", busy($("#run"), async () => {
  const id = $("#person").value;
  showCode();
  say($("#status"), "Asking both…", "wait");
  const [fed, evt] = await Promise.all([askFederation(id), askProjection(id)]);
  // Speed next to what it costs: federation's answer is live, the projection's is as old as its oldest part.
  say($("#status"), `Federation ${fed}ms, live · Projection ${evt.ms}ms${evt.age ? `, data ${evt.age} old` : ", no answer"}`, "ok");
}));
$("#person").addEventListener("change", showCode);
showCode();
fillPeople($("#person")).then(showCode);
