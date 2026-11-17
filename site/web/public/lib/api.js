// Calls to the demo, each tagged with this visitor's session (kept in the browser).
const KEY = "lnl-session";
const POLL_MAX_MS = 15000;
export const SUBGRAPHS = ["hr", "employment", "security"];

function session() {
  let s = null;
  try { s = localStorage.getItem(KEY); } catch {}
  if (!s) {
    s = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    try { localStorage.setItem(KEY, s); } catch {}
  }
  return s;
}

const headers = (extra = {}) => ({ "content-type": "application/json", "x-lnl-session": session(), ...extra });
const ms = (h, name) => (h.get(name) == null ? null : Number(h.get(name)));
const json = (h, name) => { try { return JSON.parse(h.get(name) ?? "null"); } catch { return null; } };

// One federated GraphQL call through the router. chaos: { down: [subgraph], delay: { subgraph: ms } }.
export async function federation(query, chaos = {}) {
  const t0 = performance.now();
  const res = await fetch("/api/federation", {
    method: "POST", headers: headers({ "x-lnl-chaos": JSON.stringify(chaos) }), body: JSON.stringify({ query }),
  });
  const body = await res.json();
  const h = res.headers;
  return {
    body, total: Math.round(performance.now() - t0), router: ms(h, "x-router-time-ms"),
    routerRequest: ms(h, "x-router-request"),  // 1: this copy of the router had just started
    fetches: json(h, "x-lnl-fetches") ?? [],
    subgraphs: Object.fromEntries(SUBGRAPHS.map((s) =>
      [s, { ms: ms(h, `x-${s}-time-ms`), details: json(h, `x-${s}-timing-details`) }])),
  };
}

// One REST call to an event-side service: status, body and the service's own timing.
export async function rest(path, { method = "GET", body } = {}) {
  const t0 = performance.now();
  const res = await fetch(`/api/${path}`, { method, headers: headers(), body: body && JSON.stringify(body) });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return {
    status: res.status, ok: res.ok, data, total: Math.round(performance.now() - t0),
    server: ms(res.headers, "x-time-ms"), details: json(res.headers, "x-timing-details"),
    request: ms(res.headers, "x-request"),  // 1: this copy of the service had just started
  };
}

export const lesson = {
  get: () => rest("lesson"),
  set: (changes) => rest("lesson", { method: "PUT", body: changes }),
};

// The projection's view of one person: 404 until their first event has been applied.
export const composedView = (id) => rest(`query/composed/${id}`);

export const PERSON_QUERY = (id) => `{
  person(id: "${id}") {
    id
    name
    email
    active
    employee { title department salary }
    badge { badgeNumber accessLevel clearance }
  }
}`;

export const createPerson = (name, email) =>
  `mutation { createPerson(name: ${JSON.stringify(name)}, email: ${JSON.stringify(email)}) { id name } }`;

export const sleep = (t) => new Promise((r) => setTimeout(r, t));

// Poll fn every `every` ms until it returns truthy or 15 s pass; resolves to [value, elapsedMs].
export async function until(fn, every = 100) {
  const t0 = performance.now();
  while (performance.now() - t0 < POLL_MAX_MS) {
    const v = await fn();
    if (v) return [v, Math.round(performance.now() - t0)];
    await sleep(every);
  }
  return [null, Math.round(performance.now() - t0)];
}

export const emailFor = (name) => `${name.toLowerCase().trim().replace(/\s+/g, ".")}@company.com`;
