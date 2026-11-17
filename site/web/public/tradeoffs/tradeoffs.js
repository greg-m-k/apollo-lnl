import { federation, rest, composedView, until, PERSON_QUERY, createPerson, emailFor } from "../lib/api.js";
import { $, crumbs, kv, busy, say } from "../lib/ui.js";

crumbs();
const READS = 10;
const WRITES = 3;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function measureReads() {
  const fed = [];
  const evt = [];
  for (let i = 0; i < READS; i++) {
    say($("#status"), `Read ${i + 1} of ${READS}…`, "wait");
    fed.push((await federation(PERSON_QUERY("person-001"))).total);
    evt.push((await composedView("person-001")).total);
  }
  return { fed, evt };
}

// Each write is timed until the call returns; the event side also until a poll finds it in the projection.
async function measureWrites() {
  const fed = [];
  const evt = [];
  const readable = [];
  for (let i = 0; i < WRITES; i++) {
    say($("#status"), `Write ${i + 1} of ${WRITES}…`, "wait");
    const name = `Measure ${crypto.randomUUID().slice(0, 6)}`;
    fed.push((await federation(createPerson(name, emailFor(name)))).total);
    const e = await rest("hr-events/persons", { method: "POST", body: { name, email: emailFor(name) } });
    evt.push(e.total);
    const [, waited] = await until(async () => (await composedView(e.data.id)).ok);
    readable.push(e.total + waited);
  }
  return { fed, evt, readable };
}

$("#run").addEventListener("click", busy($("#run"), async () => {
  const reads = await measureReads();
  const writes = await measureWrites();
  kv($("#numbers"), [
    [`Read, federation (median of ${READS})`, `${median(reads.fed)}ms`],
    [`Read, projection (median of ${READS})`, `${median(reads.evt)}ms`],
    ["Write, federation: readable when the call returns", `${median(writes.fed)}ms`],
    ["Write, event-driven: call returns", `${median(writes.evt)}ms`],
    ["Write, event-driven: readable in the projection (seen by polling)", `${median(writes.readable)}ms`],
  ]);
  say($("#status"), "Measured in your browser, through the same Workers the lessons use.", "ok");
}));
