import { federation, rest, until, PERSON_QUERY, emailFor } from "../lib/api.js";
import { $, crumbs, kv, busy } from "../lib/ui.js";

crumbs();
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function measure() {
  const fedReads = [];
  const evtReads = [];
  for (let i = 0; i < 10; i++) {
    $("#status").textContent = `Read ${i + 1} of 10…`;
    fedReads.push((await federation(PERSON_QUERY("person-001"))).total);
    evtReads.push((await rest("query/composed/person-001")).total);
  }
  const fedWrites = [];
  const evtWrites = [];
  const propagation = [];
  for (let i = 0; i < 3; i++) {
    $("#status").textContent = `Write ${i + 1} of 3…`;
    const name = `Measure ${crypto.randomUUID().slice(0, 6)}`;
    const f = await federation(`mutation { createPerson(name: "${name}", email: "${emailFor(name)}") { id } }`);
    fedWrites.push(f.total);
    const e = await rest("hr-events/persons", { method: "POST", body: { name, email: emailFor(name) } });
    evtWrites.push(e.total);
    const [, waited] = await until(async () => (await rest(`query/composed/${e.data.id}`)).ok);
    propagation.push(e.total + waited);
  }
  kv($("#numbers"), [
    ["Read, federation (median of 10)", `${median(fedReads)}ms`],
    ["Read, projection (median of 10)", `${median(evtReads)}ms`],
    ["Write, federation: readable when the call returns", `${median(fedWrites)}ms`],
    ["Write, event-driven: call returns", `${median(evtWrites)}ms`],
    ["Write, event-driven: readable in the projection (seen by polling)", `${median(propagation)}ms`],
  ]);
}

$("#run").addEventListener("click", busy($("#run"), async () => {
  await measure();
  $("#status").textContent = "Measured in your browser, through the same Workers the lessons use.";
}));
