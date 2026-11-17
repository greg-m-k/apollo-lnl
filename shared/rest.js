// Tiny REST routing for the event-side services, mirroring the JAX-RS resources.
import { sessionFrom } from "./chaos.js";
import { Timing } from "./timing.js";

export class HttpError extends Error {
  constructor(status, body) {
    super(typeof body === "string" ? body : JSON.stringify(body));
    this.status = status;
    this.body = body;
  }
}

// "/api/persons/:id" -> a regex with one named group per :param
const pattern = (path) => new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);

// routes: [[method, "/path/:param", handler({ params, query, body, env, ctx, session, timing }), status = 200]]
// A handler returns the response body: an object for JSON, a string for plain text.
// Returns a Worker fetch handler; every response carries the request's timing headers.
export function restService(routes) {
  const table = routes.map(([method, path, handler, status = 200]) => ({ method, re: pattern(path), handler, status }));
  return async (request, env, ctx) => {
    const timing = new Timing();
    const [status, payload] = await answer(table, request, env, ctx, timing);
    const text = typeof payload === "string";
    return timing.stamp(new Response(text ? payload : JSON.stringify(payload), {
      status, headers: { "content-type": text ? "text/plain" : "application/json" },
    }));
  };
}

// [status, body] for one request. An error that carries a status is the answer, not a crash.
async function answer(table, request, env, ctx, timing) {
  const url = new URL(request.url);
  const route = table.find((r) => r.method === request.method && r.re.test(url.pathname));
  if (!route) return [404, { error: "Not found", path: url.pathname }];
  try {
    const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined);
    return [route.status, await route.handler({
      params: url.pathname.match(route.re).groups ?? {}, query: url.searchParams, body, env, ctx,
      session: sessionFrom(request), timing,
    })];
  } catch (e) {
    if (!e.status) throw e;
    return [e.status, e.body ?? { error: e.message }];
  }
}

export function need(body, ...fields) {
  for (const f of fields) {
    if (body?.[f] == null || body[f] === "") throw new HttpError(400, { error: `${f} is required` });
  }
  return body;
}
