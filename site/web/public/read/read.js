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

async function askFederation(id) {
  const delay = delays();
  const r = await federation(PERSON_QUERY(id), { delay });
  timeline($("#fed-timeline"), fedLanes(r, "Router (whole query)", (s) => (delay[s] ? ` (+${delay[s]}ms)` : "")));
  kv($("#fed-result"), fedRows(r.body.data?.person));
  const parts = SUBGRAPHS.map((s) => `${s} ${r.subgraphs[s].ms ?? "-"}ms`).join(", ");
  fedLog.log(`${r.total}ms in the browser, router ${r.router}ms [${parts}]${fresh("router", r.routerRequest, "it read the supergraph and planned the query")}`,
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
  return r.total;
}

$("#run").addEventListener("click", busy($("#run"), async () => {
  const id = $("#person").value;
  showCode();
  say($("#status"), "Asking both…", "wait");
  const [fed, evt] = await Promise.all([askFederation(id), askProjection(id)]);
  say($("#status"), `Federation ${fed}ms · Projection ${evt}ms`, "ok");
}));
$("#person").addEventListener("change", showCode);
showCode();
fillPeople($("#person")).then(showCode);
