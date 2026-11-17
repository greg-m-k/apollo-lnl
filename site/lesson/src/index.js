// Home of the per-session Lesson switches that must outlive one request (the event side
// is asynchronous): "broker down" holds a session's outbox, "consumer paused" leaves its
// events on the topic. One Durable Object per session; a switch turns itself off after
// MAX_ON_MS so a forgotten one never strands a visitor's events. Its own Worker, so the
// services that read the switches and the site that sets them can deploy in order.
import { DurableObject } from "cloudflare:workers";

const MAX_ON_MS = 3 * 60 * 1000;
const SWITCHES = ["brokerDown", "consumerPaused"];

export class Lesson extends DurableObject {
  // Each switch is on while it was last turned on less than MAX_ON_MS ago.
  async switches() {
    const since = (await this.ctx.storage.get("since")) ?? {};
    const now = Date.now();
    return Object.fromEntries(SWITCHES.map((k) => [k, now - (since[k] ?? 0) < MAX_ON_MS]));
  }

  async set(changes) {
    const since = (await this.ctx.storage.get("since")) ?? {};
    for (const k of SWITCHES) {
      if (typeof changes[k] === "boolean") since[k] = changes[k] ? Date.now() : 0;
    }
    await this.ctx.storage.put("since", since);
    return this.switches();
  }
}

export default { fetch: () => new Response("Not found", { status: 404 }) };
