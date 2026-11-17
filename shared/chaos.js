// Lesson switches ride on each request, so every visitor breaks only their own demo.
//   x-lnl-session: the visitor's session id (their own rows, their own outbox)
//   x-lnl-chaos:   {"down": ["security"], "delay": {"hr": 300}}
export const SESSION_HEADER = "x-lnl-session";
export const CHAOS_HEADER = "x-lnl-chaos";
const SERVICES = new Set(["hr", "employment", "security"]);
const MAX_DELAY_MS = 5000;

export function sessionFrom(request) {
  const s = request.headers.get(SESSION_HEADER) || "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : "";
}

// Parsed once where it enters; anything malformed means "no chaos".
export function chaosFrom(request) {
  const none = { down: [], delay: {} };
  let raw;
  try {
    raw = JSON.parse(request.headers.get(CHAOS_HEADER) || "{}");
  } catch {
    return none;
  }
  if (!raw || typeof raw !== "object") return none;
  const down = Array.isArray(raw.down) ? raw.down.filter((s) => SERVICES.has(s)) : [];
  const delay = {};
  for (const [service, ms] of Object.entries(raw.delay ?? {})) {
    if (SERVICES.has(service) && Number.isFinite(ms) && ms > 0) delay[service] = Math.min(ms, MAX_DELAY_MS);
  }
  return { down, delay };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
