// The Lunch & Learn site. Serves the lesson pages (./public) and one same-origin /api that
// passes each call on to Option A's router or one of Option B's services over a service
// binding. It also sets the visitor's lesson switches (../lesson).

// /api/<prefix>/rest -> the Worker bound as `binding`, at `path` + /rest
const UPSTREAM = {
  federation: { binding: "ROUTER", path: "/graphql" },           // Option A
  "hr-events": { binding: "HR_EVENTS", path: "/api" },            // Option B, write side
  "employment-events": { binding: "EMPLOYMENT_EVENTS", path: "/api" },
  "security-events": { binding: "SECURITY_EVENTS", path: "/api" },
  query: { binding: "QUERY", path: "/api" },                      // Option B, read side
  consumer: { binding: "CONSUMER", path: "/api" },
};

// GET reads the visitor's switches; PUT { brokerDown, consumerPaused } changes them.
async function lessonSwitches(request, env) {
  const session = request.headers.get("x-lnl-session") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(session)) return Response.json({ error: "x-lnl-session header is required" }, { status: 400 });
  const lesson = env.LESSON.get(env.LESSON.idFromName(session));
  return Response.json(request.method === "PUT" ? await lesson.set(await request.json()) : await lesson.switches());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const [, api, prefix, ...rest] = url.pathname.split("/");
    if (api !== "api") return env.ASSETS.fetch(request);
    if (prefix === "lesson") return lessonSwitches(request, env);
    const upstream = UPSTREAM[prefix];
    if (!upstream) return Response.json({ error: "Not found" }, { status: 404 });
    const target = new URL(`${upstream.path}${rest.length ? `/${rest.join("/")}` : ""}${url.search}`, "https://internal");
    return env[upstream.binding].fetch(new Request(target, request));
  },
};
