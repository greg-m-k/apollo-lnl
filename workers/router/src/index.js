// Federation router: the Cloudflare counterpart of the apollo-demo Apollo Router.
// Hive Gateway plans each query over the same committed supergraph and calls the
// subgraph Workers through service bindings instead of the cluster network.
// Like timing.rhai, it copies each subgraph's timing onto the response, as
// x-<subgraph>-time-ms and x-<subgraph>-timing-details. It also adds x-lnl-fetches:
// every subgraph call with its start and end, for the lesson timelines.
import { createGatewayRuntime } from "@graphql-hive/gateway-runtime";
import http from "@graphql-mesh/transport-http";
import supergraph from "../../../shared/schema/supergraph.graphql";
import { CHAOS_HEADER, SESSION_HEADER } from "../../../shared/chaos.js";

// join__graph url host in the supergraph -> [service binding, subgraph name]
const SUBGRAPHS = {
  "hr-subgraph": ["HR", "hr"],
  "employment-subgraph": ["EMPLOYMENT", "employment"],
  "security-subgraph": ["SECURITY", "security"],
};
const TIMING_HEADERS = ["time-ms", "timing-details"];  // each subgraph answers with x-time-ms, x-timing-details

const traces = new WeakMap(); // incoming Request -> { t0, fetches: [], headers: {} }

function subgraphFetch(env) {
  return {
    onFetch({ url, setFetchFn, context }) {
      const [binding, name] = SUBGRAPHS[new URL(url).hostname] ?? [];
      if (!binding) return;
      setFetchFn((u, init) => env[binding].fetch(u, init));
      const trace = traces.get(context?.request);
      if (!trace) return;
      const start = Math.round(performance.now() - trace.t0);
      return ({ response }) => {
        trace.fetches.push({ subgraph: name, start, end: Math.round(performance.now() - trace.t0), status: response.status });
        for (const h of TIMING_HEADERS) {
          const value = response.headers.get(`x-${h}`);
          if (value) trace.headers[`x-${name}-${h}`] = value;
        }
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
    const trace = { t0: performance.now(), fetches: [], headers: {} };
    traces.set(request, trace);
    const response = await runtime.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(trace.headers)) headers.set(k, v);
    headers.set("x-lnl-fetches", JSON.stringify(trace.fetches));
    headers.set("x-router-time-ms", String(Math.round(performance.now() - trace.t0)));
    return new Response(response.body, { status: response.status, headers });
  },
};
