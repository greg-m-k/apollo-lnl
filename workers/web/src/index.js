// The Lunch & Learn site: static lesson pages plus one same-origin /api that forwards
// to the demo's Workers over service bindings, and sets the per-session Lesson switches
// (broker down, consumer paused) that the event side reads.
import { lessonStub } from "../../../shared/lesson.js";
import { sessionFrom } from "../../../shared/chaos.js";

// /api/<prefix>/rest -> [binding, path prefix on that Worker]
const UPSTREAM = {
  federation: ["ROUTER", "/graphql"],
  "hr-events": ["HR_EVENTS", "/api"],
  "employment-events": ["EMPLOYMENT_EVENTS", "/api"],
  "security-events": ["SECURITY_EVENTS", "/api"],
  query: ["QUERY", "/api"],
  consumer: ["CONSUMER", "/api"],
};

async function lesson(request, env) {
  const session = sessionFrom(request);
  if (!session) return Response.json({ error: "x-lnl-session header is required" }, { status: 400 });
  const stub = lessonStub(env, session);
  return Response.json(request.method === "PUT" ? await stub.set(await request.json()) : await stub.switches());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const [, api, prefix, ...rest] = url.pathname.split("/");
    if (api !== "api") return env.ASSETS.fetch(request);
    if (prefix === "lesson") return lesson(request, env);
    const upstream = UPSTREAM[prefix];
    if (!upstream) return Response.json({ error: "Not found" }, { status: 404 });
    const [binding, base] = upstream;
    const target = new URL(`${base}${rest.length ? `/${rest.join("/")}` : ""}${url.search}`, "https://internal");
    return env[binding].fetch(new Request(target, request));
  },
};
