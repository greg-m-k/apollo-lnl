// Small DOM helpers shared by the lesson pages.
const LESSONS = [
  ["/start/", "Start here"],
  ["/read/", "One question, three services"],
  ["/failure/", "When a service goes down"],
  ["/write/", "Write, then read"],
  ["/bus/", "When the bus stops"],
  ["/tradeoffs/", "So which one?"],
  ["/port/", "How this runs on Cloudflare"],
];
const MIN_SCALE_MS = 200;

export const $ = (sel) => document.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

export function crumbs() {
  const here = location.pathname.endsWith("/") ? location.pathname : `${location.pathname}/`;
  const nav = el("nav", { class: "crumbs", "aria-label": "Lessons" }, el("a", { href: "/" }, "← Home"),
    ...LESSONS.map(([href, title]) => el("a", { href, "aria-current": href === here ? "page" : null }, title)));
  document.querySelector("main").prepend(nav);
  // On a phone the chips scroll sideways: bring the current lesson into view.
  const current = nav.querySelector('[aria-current="page"]');
  if (current) nav.scrollLeft = current.offsetLeft - nav.offsetLeft - 18;
  const next = LESSONS[LESSONS.findIndex(([href]) => href === here) + 1];
  if (next) document.querySelector("main").append(el("p", { class: "next" }, "Next: ", el("a", { href: next[0] }, `${next[1]} →`)));
  document.querySelector("main").append(el("footer", {}, "Made by ", el("a", { href: "https://greg.kitchen" }, "Greg Kitchen"), "."));
}

// A console pane: log(text, kind?) with kind "ok" | "err" | "wait".
export function logger(pre) {
  pre.textContent = "Nothing logged yet";
  let empty = true;
  return {
    log(text, kind) {
      if (empty) { pre.textContent = ""; empty = false; }
      pre.append(el("div", { class: kind }, `${new Date().toLocaleTimeString()}  ${text}`));
      pre.scrollTop = pre.scrollHeight;
    },
    clear() { pre.textContent = "Nothing logged yet"; empty = true; },
  };
}

// A status line: kind "ok" | "err" | "wait", or none.
export function say(node, text, kind = "") {
  node.textContent = text;
  node.className = `status ${kind}`.trim();
}

// On/off pill buttons: pressed(button) reads one; press(button, on) sets it and marks it with ✕.
export const pressed = (button) => button.getAttribute("aria-pressed") === "true";
export function press(button, on) {
  button.dataset.label ??= button.textContent;
  button.setAttribute("aria-pressed", String(on));
  button.textContent = `${button.dataset.label}${on ? " ✕" : ""}`;
}

// lanes: [{ name, start, end, kind: "fed"|"evt"|"fail", label? }]; the scale fits the slowest.
export function timeline(container, lanes) {
  const scale = Math.ceil(Math.max(MIN_SCALE_MS, ...lanes.map((l) => l.end)) / 100) * 100;
  container.replaceChildren(
    ...lanes.map((l) => el("div", { class: "lane" },
      el("div", { class: "name", title: l.name }, l.name),
      el("div", { class: "track" }, el("div", {
        class: `seg ${l.kind}`, style: `left:${(l.start / scale) * 100}%;width:${((l.end - l.start) / scale) * 100}%`,
        title: `${l.name}: ${l.start}–${l.end} ms`,
      })),
      el("div", { class: "ms" }, l.label ?? `${l.end - l.start}ms`))),
    el("div", { class: "axis" }, el("span"), el("div", { class: "ticks" },
      ...[0, 0.25, 0.5, 0.75, 1].map((f) => el("span", {}, `${Math.round(scale * f)}ms`))), el("span")),
  );
}

// Timeline lanes for one federated call: the router's whole span, then each subgraph call.
// note(subgraph): text to add after a subgraph's name.
export function fedLanes(r, routerName = "Router", note = () => "") {
  const failed = (f) => f.status !== 200;
  return [
    { name: routerName, start: 0, end: r.router ?? r.total, kind: r.body.errors ? "fail" : "fed" },
    ...r.fetches.map((f) => ({
      name: `→ ${f.subgraph}${note(f.subgraph)}`, start: f.start, end: f.end,
      kind: failed(f) ? "fail" : "fed", label: failed(f) ? String(f.status) : undefined,
    })),
  ];
}

// rows: [[label, value]]; a missing value is shown as a red "null".
export function kv(table, rows) {
  table.replaceChildren(...rows.map(([k, v]) =>
    el("tr", {}, el("th", {}, k), el("td", { class: v == null ? "null" : null }, v == null ? "null" : String(v)))));
}

// A click handler that disables its button while it runs.
export function busy(button, fn) {
  return async (...args) => {
    button.disabled = true;
    try { return await fn(...args); } finally { button.disabled = false; }
  };
}

// The federated person as rows for a kv table.
export function fedRows(p) {
  if (!p) return [["person", null]];
  return [["name", p.name], ["email", p.email], ["employee.title", p.employee?.title],
    ["employee.department", p.employee?.department], ["badge.badgeNumber", p.badge?.badgeNumber],
    ["badge.accessLevel", p.badge?.accessLevel]];
}

// The composed projection view as rows for a kv table.
export function evtRows(v) {
  if (!v?.personId) return [["person", null]];
  return [["name", v.name], ["email", v.email], ["title", v.title], ["department", v.department],
    ["badgeNumber", v.badgeNumber], ["accessLevel", v.accessLevel], ["data freshness", v.freshness?.dataFreshness]];
}
