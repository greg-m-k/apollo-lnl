// People on the lesson pages: seed people are shared, the rest are the visitor's own.
import { rest } from "./api.js";
import { el } from "./ui.js";

export const isSeed = (id) => /^person-00\d$/.test(id);

const NAMES = ["Ada Lovelace", "Katherine Johnson", "Margaret Hamilton", "Radia Perlman", "Barbara Liskov", "Frances Allen"];

// A name that differs each time, so a rename is visible.
export const randomName = () =>
  `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${Math.floor(Math.random() * 90 + 10)}`;

// Fill a person <select> from a list endpoint: seed people first, then by name.
// mine: only the visitor's own people; an empty list then shows "none yet".
export async function fillPeople(select, { path = "query/persons", mine = false, selected = select.value } = {}) {
  const res = await rest(path);
  if (!res.ok) return;
  const people = res.data.filter((p) => !(mine && isSeed(p.id)))
    .sort((a, b) => (isSeed(b.id) - isSeed(a.id)) || a.name.localeCompare(b.name));
  const tag = (p) => (mine || isSeed(p.id) ? "" : " · yours");
  select.replaceChildren(...(people.length
    ? people.map((p) => el("option", { value: p.id, selected: p.id === selected }, `${p.name} (${p.id})${tag(p)}`))
    : [el("option", { value: "" }, "none yet")]));
}
