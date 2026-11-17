import { federation, composedView, PERSON_QUERY, SUBGRAPHS } from "../lib/api.js";
import { $, crumbs, logger, timeline, fedLanes, kv, busy, say, press, pressed, fedRows, evtRows } from "../lib/ui.js";
import { fillPeople } from "../lib/people.js";

crumbs();
const fedLog = logger($("#fed-log"));
const evtLog = logger($("#evt-log"));
const switchOf = (subgraph) => $(`#sw-${subgraph}`);
for (const s of SUBGRAPHS) switchOf(s).addEventListener("click", () => press(switchOf(s), !pressed(switchOf(s))));

// How much of the person federation returned: "full", "partial" (parts null, with errors) or "no".
function answered({ data, errors }) {
  if (!data?.person) return "no";
  return errors ? "partial" : "full";
}

function showFederation(f) {
  timeline($("#fed-timeline"), fedLanes(f));
  kv($("#fed-result"), fedRows(f.body.data?.person));
  fedLog.clear();
  if (!f.body.errors) fedLog.log("No errors: every subgraph answered.", "ok");
  for (const err of f.body.errors ?? []) {
    fedLog.log(`${err.extensions?.serviceName ?? "router"}: ${err.message} (path ${(err.path ?? []).join(".")})`, "err");
  }
}

function showProjection(e) {
  timeline($("#evt-timeline"), [{ name: "Query service", start: 0, end: e.server ?? e.total, kind: "evt" }]);
  kv($("#evt-result"), evtRows(e.ok ? e.data : null));
  evtLog.log(e.ok ? `${e.total}ms, answered from data ${e.data.freshness.dataFreshness} old` : `${e.status}`, e.ok ? "ok" : "err");
}

$("#run").addEventListener("click", busy($("#run"), async () => {
  const id = $("#person").value;
  const down = SUBGRAPHS.filter((s) => pressed(switchOf(s)));
  say($("#status"), down.length ? `Asking with ${down.join(", ")} down…` : "Asking…", "wait");
  const [f, e] = await Promise.all([federation(PERSON_QUERY(id), { down }), composedView(id)]);
  showFederation(f);
  showProjection(e);
  const fed = answered(f.body);
  say($("#status"), `Federation: ${fed} answer · Projection: ${e.ok ? "full" : "no"} answer`, fed === "full" ? "ok" : "err");
}));
fillPeople($("#person"));
