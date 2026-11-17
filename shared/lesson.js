// Lesson switches that must outlive one request (the event side is asynchronous):
// "broker down" holds a session's outbox, "consumer paused" leaves its events on the
// topic. One Durable Object per session keeps them; they switch themselves off after
// MAX_ON_MS so a forgotten switch never strands a visitor's events.
import { DurableObject } from "cloudflare:workers";

export const MAX_ON_MS = 3 * 60 * 1000;
const OFF = { brokerDown: false, consumerPaused: false };

export class Lesson extends DurableObject {
  async switches() {
    const s = (await this.ctx.storage.get("switches")) ?? { ...OFF, since: {} };
    const now = Date.now();
    const out = {};
    for (const k of Object.keys(OFF)) out[k] = Boolean(s[k] && now - (s.since?.[k] ?? 0) < MAX_ON_MS);
    return out;
  }

  async set(changes) {
    const s = (await this.ctx.storage.get("switches")) ?? { ...OFF, since: {} };
    for (const k of Object.keys(OFF)) {
      if (typeof changes[k] === "boolean") {
        s[k] = changes[k];
        s.since = { ...s.since, [k]: Date.now() };
      }
    }
    await this.ctx.storage.put("switches", s);
    return this.switches();
  }
}

export async function lessonSwitches(env, session) {
  if (!session || !env.LESSON) return { ...OFF };
  return env.LESSON.get(env.LESSON.idFromName(session)).switches();
}
