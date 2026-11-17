// Lesson switches ride on each request, so every visitor breaks only their own demo.
//   x-lnl-session: the visitor's session id (their own rows, their own outbox)
//   x-lnl-chaos:   {"down": ["security"], "delay": {"hr": 300}}
export const SESSION_HEADER = "x-lnl-session";
export const CHAOS_HEADER = "x-lnl-chaos";
const MAX_DELAY_MS = 5000;

export function sessionFrom(request) {
  const s = request.headers.get(SESSION_HEADER) || "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : "";
}

// Parsed once where it enters; anything malformed means "no chaos".
function parse(text) {
  try {
    const value = JSON.parse(text || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

// What the request asks of the service called `name`: be down, or answer late.
export function chaosFor(request, name) {
  const { down, delay } = parse(request.headers.get(CHAOS_HEADER));
  const ms = Number(delay?.[name]);
  return { down: Array.isArray(down) && down.includes(name), delayMs: ms > 0 ? Math.min(ms, MAX_DELAY_MS) : 0 };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
