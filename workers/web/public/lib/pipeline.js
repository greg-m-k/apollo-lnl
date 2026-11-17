// The event write path as stages; each stage shows its measured ms once known.
import { el } from "./ui.js";

export const STAGES = [
  ["write", "DB + outbox"],
  ["relay", "Outbox relay"],
  ["queue", "Queue"],
  ["consumer", "Consumer"],
  ["projection", "Projection"],
];

// state: { stage: { status: "done"|"wait"|"fail", ms? } }
export function pipeline(container, state) {
  container.replaceChildren(...STAGES.flatMap(([key, label], i) => [
    i ? el("span", { class: "arrow" }, "→") : null,
    el("div", { class: `stage ${state[key]?.status ?? ""}` }, label,
      el("b", {}, state[key]?.ms != null ? `${state[key].ms}ms` : state[key]?.status === "wait" ? "waiting" : "·")),
  ].filter(Boolean)));
}

// Server breakdown from /api/consumer/metrics/timing/{id} as pipeline state.
export function fromTiming(writeMs, t) {
  return {
    write: { status: "done", ms: writeMs },
    relay: { status: "done", ms: t.outboxToQueueMs },
    queue: { status: "done", ms: t.queueToConsumerMs },
    consumer: { status: "done", ms: t.consumerToProjectionMs },
    projection: { status: "done" },
  };
}
