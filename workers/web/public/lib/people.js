// Fill a person <select> from the projection (seed people first, then the visitor's own).
import { rest } from "./api.js";
import { el } from "./ui.js";

export async function fillPeople(select, selected = select.value) {
  const res = await rest("query/persons");
  if (!res.ok) return;
  const seed = (id) => /^person-00\d$/.test(id);
  const people = res.data.sort((a, b) => (seed(b.id) - seed(a.id)) || a.name.localeCompare(b.name));
  select.replaceChildren(...people.map((p) =>
    el("option", { value: p.id, selected: p.id === selected }, `${p.name} (${p.id})${seed(p.id) ? "" : " · yours"}`)));
}
