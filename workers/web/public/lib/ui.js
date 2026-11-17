// Small DOM helpers shared by the lesson pages.
export const LESSONS = [
  ["/read/", "One question, three services"],
  ["/failure/", "When a service goes down"],
  ["/write/", "Write, then read"],
  ["/bus/", "When the bus stops"],
  ["/tradeoffs/", "So which one?"],
  ["/port/", "How this runs on Cloudflare"],
];

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
  const nav = el("nav", { class: "crumbs", "aria-label": "Lessons" }, el("a", { href: "/" }, "Home"),
    ...LESSONS.map(([href, title]) => el("a", { href, "aria-current": href === here ? "page" : null }, title)));
  document.querySelector("main").prepend(nav);
  const i = LESSONS.findIndex(([href]) => href === here);
  const next = LESSONS[i + 1];
  if (next) document.querySelector("main").append(el("p", { class: "next" }, "Next: ", el("a", { href: next[0] }, `${next[1]} →`)));
  document.querySelector("main").append(el("footer", {},
    "People you create are yours alone and are cleared 20 minutes after you make them. Lesson switches you turn on switch themselves off after 3 minutes."));
}

// A console pane: log(text, kind?) with kind "ok" | "err" | "wait".
export function logger(pre) {
  pre.textContent = "Nothing logged yet";
  let empty = true;
  return {
    log(text, kind) {
      if (empty) { pre.textContent = ""; empty = false; }
      const line = el("div", { class: kind ?? null }, `${new Date().toLocaleTimeString()}  ${text}`);
      pre.append(line);
      pre.scrollTop = pre.scrollHeight;
    },
    clear() { pre.textContent = "Nothing logged yet"; empty = true; },
  };
}

// lanes: [{ name, start, end, kind: "fed"|"evt"|"fail"|"wait", label? }]; scale fits the slowest.
export function timeline(container, lanes, minScale = 200) {
  const max = Math.max(minScale, ...lanes.map((l) => l.end));
  const scale = Math.ceil(max / 100) * 100;
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

export function kv(table, rows) {
  table.replaceChildren(...rows.map(([k, v]) =>
    el("tr", {}, el("th", {}, k), el("td", { class: v == null ? "null" : null }, v == null ? "null" : String(v)))));
}

export const $ = (sel) => document.querySelector(sel);

export function busy(button, fn) {
  return async (...args) => {
    button.disabled = true;
    try { return await fn(...args); } finally { button.disabled = false; }
  };
}

// The federated person as rows for a kv table.
export function fedRows(p) {
  if (!p) return [["person", null]];
  return [["name", p.name], ["email", p.email], ["employee.title", p.employee?.title ?? null],
    ["employee.department", p.employee?.department ?? null], ["badge.badgeNumber", p.badge?.badgeNumber ?? null],
    ["badge.accessLevel", p.badge?.accessLevel ?? null]];
}

// The composed projection view as rows for a kv table.
export function evtRows(v) {
  if (!v || !v.personId) return [["person", null]];
  return [["name", v.name], ["email", v.email], ["title", v.title], ["department", v.department],
    ["badgeNumber", v.badgeNumber], ["accessLevel", v.accessLevel], ["data freshness", v.freshness?.dataFreshness]];
}
