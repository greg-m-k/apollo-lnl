// Calls to the demo, each tagged with this visitor's session (kept in the browser).
const KEY = "lnl-session";

export function session() {
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

// One federated GraphQL call through the router. chaos: { down: [...], delay: {...} }.
export async function federation(query, chaos) {
  const t0 = performance.now();
  const res = await fetch("/api/federation", {
    method: "POST", headers: headers(chaos ? { "x-lnl-chaos": JSON.stringify(chaos) } : {}),
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  const h = res.headers;
  return {
    body, total: Math.round(performance.now() - t0), router: ms(h, "x-router-time-ms"),
    fetches: json(h, "x-lnl-fetches") ?? [],
    subgraphs: Object.fromEntries(["hr", "employment", "security"].map((s) =>
      [s, { ms: ms(h, `x-${s}-time-ms`), details: json(h, `x-${s}-timing-details`) }])),
  };
}

// One REST call to an event-side service. Returns status, body and server timing.
export async function rest(path, { method = "GET", body } = {}) {
  const t0 = performance.now();
  const res = await fetch(`/api/${path}`, { method, headers: headers(), body: body && JSON.stringify(body) });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  const h = res.headers;
  const service = path.split("/")[0];
  return {
    status: res.status, ok: res.ok, data, total: Math.round(performance.now() - t0),
    server: ms(h, `x-${service === "query" ? "query" : service}-time-ms`),
    details: json(h, `x-${service}-timing-details`),
  };
}

export const lesson = {
  get: () => rest("lesson"),
  set: (changes) => rest("lesson", { method: "PUT", body: changes }),
};

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

export const sleep = (t) => new Promise((r) => setTimeout(r, t));

// Poll fn until it returns truthy or the time runs out; returns [value, elapsedMs].
export async function until(fn, { every = 100, max = 15000 } = {}) {
  const t0 = performance.now();
  while (performance.now() - t0 < max) {
    const v = await fn();
    if (v) return [v, Math.round(performance.now() - t0)];
    await sleep(every);
  }
  return [null, Math.round(performance.now() - t0)];
}

export const emailFor = (name) => `${name.toLowerCase().trim().replace(/\s+/g, ".")}@company.com`;
