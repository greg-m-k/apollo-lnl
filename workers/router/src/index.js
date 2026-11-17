// Federation router: the Cloudflare counterpart of the apollo-demo Apollo Router.
// Hive Gateway plans each query over the same committed supergraph and calls the
// subgraph Workers through service bindings instead of the cluster network.
// Like timing.rhai, it copies each subgraph's timing headers onto the response, and it
// adds x-lnl-fetches: every subgraph call with its start and end, for the lesson timelines.
import { createGatewayRuntime } from "@graphql-hive/gateway-runtime";
import http from "@graphql-mesh/transport-http";
import supergraph from "../../../shared/schema/supergraph.graphql";
import { CHAOS_HEADER, SESSION_HEADER } from "../../../shared/chaos.js";

// join__graph url host -> [service binding, subgraph name]
const SUBGRAPHS = {
  "hr-subgraph": ["HR", "hr"],
  "employment-subgraph": ["EMPLOYMENT", "employment"],
  "security-subgraph": ["SECURITY", "security"],
};
const EXPOSED = ["x-hr-time-ms", "x-employment-time-ms", "x-security-time-ms",
  "x-hr-timing-details", "x-employment-timing-details", "x-security-timing-details", "x-lnl-fetches", "x-router-time-ms"];

const traces = new WeakMap(); // incoming Request -> { t0, fetches: [], headers: {} }

function subgraphFetch(env) {
  return {
    onFetch({ url, setFetchFn, context }) {
      const [binding, name] = SUBGRAPHS[new URL(url).hostname] ?? [];
      if (!binding) return;
      setFetchFn((u, init) => env[binding].fetch(u, init));
      const trace = traces.get(context?.request);
      const start = performance.now();
      return ({ response }) => {
        if (!trace) return;
        trace.fetches.push({
          subgraph: name, start: Math.round(start - trace.t0), end: Math.round(performance.now() - trace.t0),
          status: response.status,
        });
        const ms = response.headers.get(`x-${name}-time-ms`);
        if (ms) trace.headers[`x-${name}-time-ms`] = ms;
        const details = response.headers.get("x-timing-details");
        if (details) trace.headers[`x-${name}-timing-details`] = details;
      };
    },
  };
}

function gateway(env) {
  return createGatewayRuntime({
    supergraph,
    graphqlEndpoint: "/graphql",
    landingPage: false,
    maskedErrors: false,
    propagateHeaders: {
      fromClientToSubgraphs: ({ request }) => ({
        [SESSION_HEADER]: request.headers.get(SESSION_HEADER) ?? "",
        [CHAOS_HEADER]: request.headers.get(CHAOS_HEADER) ?? "",
      }),
    },
    transports: { http },  // bundled: Workers cannot load transports dynamically
    plugins: () => [subgraphFetch(env)],
  });
}

let runtime;
export default {
  async fetch(request, env, ctx) {
    runtime ??= gateway(env);
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "UP" });
    if (url.pathname === "/") url.pathname = "/graphql";
    const incoming = new Request(url, request);
    const trace = { t0: performance.now(), fetches: [], headers: {} };
    traces.set(incoming, trace);
    const response = await runtime.fetch(incoming, env, ctx);
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(trace.headers)) headers.set(k, v);
    headers.set("x-lnl-fetches", JSON.stringify(trace.fetches));
    headers.set("x-router-time-ms", String(Math.round(performance.now() - trace.t0)));
    headers.set("access-control-expose-headers", EXPOSED.join(", "));
    return new Response(response.body, { status: response.status, headers });
  },
};
