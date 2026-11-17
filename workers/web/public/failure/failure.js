import { federation, rest, PERSON_QUERY } from "../lib/api.js";
import { $, crumbs, logger, timeline, kv, busy, fedRows, evtRows } from "../lib/ui.js";
import { fillPeople } from "../lib/people.js";

crumbs();
const SUBGRAPHS = ["hr", "employment", "security"];
const fedLog = logger($("#fed-log"));
const evtLog = logger($("#evt-log"));

for (const s of SUBGRAPHS) {
  const b = $(`#sw-${s}`);
  b.addEventListener("click", () => {
    b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
    b.textContent = `${b.textContent.replace(/ ✕$/, "")}${b.getAttribute("aria-pressed") === "true" ? " ✕" : ""}`;
  });
}
const down = () => SUBGRAPHS.filter((s) => $(`#sw-${s}`).getAttribute("aria-pressed") === "true");

$("#run").addEventListener("click", busy($("#run"), async () => {
  const id = $("#person").value;
  const off = down();
  $("#status").textContent = off.length ? `Asking with ${off.join(", ")} down…` : "Asking…";
  $("#status").className = "status wait";
  const [f, e] = await Promise.all([federation(PERSON_QUERY(id), { down: off }), rest(`query/composed/${id}`)]);

  timeline($("#fed-timeline"), [{ name: "Router", start: 0, end: f.router ?? f.total, kind: f.body.errors ? "fail" : "fed" },
    ...f.fetches.map((x) => ({ name: `→ ${x.subgraph}`, start: x.start, end: x.end, kind: x.status === 200 ? "fed" : "fail",
      label: x.status === 200 ? undefined : String(x.status) }))]);
  kv($("#fed-result"), fedRows(f.body.data?.person));
  fedLog.clear();
  if (!f.body.errors) fedLog.log("No errors: every subgraph answered.", "ok");
  for (const err of f.body.errors ?? []) {
    fedLog.log(`${err.extensions?.serviceName ?? "router"}: ${err.message} (path ${(err.path ?? []).join(".")})`, "err");
  }

  timeline($("#evt-timeline"), [{ name: "Query service", start: 0, end: e.server ?? e.total, kind: "evt" }]);
  kv($("#evt-result"), evtRows(e.ok ? e.data : null));
  evtLog.log(e.ok ? `${e.total}ms, answered from data ${e.data.freshness.dataFreshness} old` : `${e.status}`, e.ok ? "ok" : "err");

  const partial = f.body.data?.person && f.body.errors;
  const none = !f.body.data?.person;
  $("#status").textContent = `Federation: ${none ? "no answer" : partial ? "partial answer" : "full answer"} · Projection: ${e.ok ? "full answer" : "no answer"}`;
  $("#status").className = `status ${none || partial ? "err" : "ok"}`;
}));
fillPeople($("#person"));
