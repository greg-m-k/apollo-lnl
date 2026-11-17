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

// routes: [[method, /regex with named groups/, handler({ params, query, body, env, ctx, session, timing })]]
// timingPrefix: e.g. "x-hr-events" adds x-hr-events-time-ms and x-hr-events-timing-details.
export function restService(routes, { timingPrefix } = {}) {
  return async (request, env, ctx) => {
    const url = new URL(request.url);
    const timing = new Timing();
    const route = routes.find(([m, re]) => m === request.method && re.test(url.pathname));
    let status = 200;
    let payload;
    try {
      if (!route) throw new HttpError(404, { error: "Not found", path: url.pathname });
      const [, re, handler] = route;
      const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined);
      const out = await handler({
        params: url.pathname.match(re).groups ?? {}, query: url.searchParams, body, env, ctx,
        session: sessionFrom(request), timing,
      });
      [status, payload] = Array.isArray(out) ? out : [200, out];
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      [status, payload] = [e.status, e.body];
    }
    const headers = new Headers({ "content-type": typeof payload === "string" ? "text/plain" : "application/json" });
    if (timingPrefix) {
      headers.set(`${timingPrefix}-time-ms`, String(timing.total()));
      headers.set(`${timingPrefix}-timing-details`, JSON.stringify(timing.details()));
    }
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status, headers });
  };
}

export function need(body, ...fields) {
  for (const f of fields) {
    if (body?.[f] == null || body[f] === "") throw new HttpError(400, { error: `${f} is required` });
  }
  return body;
}
