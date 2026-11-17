// OPTION A · GraphQL Federation · Router
//
// The one endpoint clients call. A port of the Apollo Router in infra/router/federation of
// the apollo-demo. Hive Gateway reads the same composed supergraph (../supergraph.graphql),
// plans each query, and calls the three subgraphs. On Cloudflare the subgraphs are Workers,
// reached through service bindings instead of the cluster network.
import { createGatewayRuntime } from "@graphql-hive/gateway-runtime";
import http from "@graphql-mesh/transport-http";
import supergraph from "../supergraph.graphql";

// The supergraph names each subgraph by URL host. Here: which Worker that host is, and its name.
const SUBGRAPHS = {
  "hr-subgraph": { binding: "HR", name: "hr" },
  "employment-subgraph": { binding: "EMPLOYMENT", name: "employment" },
  "security-subgraph": { binding: "SECURITY", name: "security" },
};

function gateway(env) {
  return createGatewayRuntime({
    supergraph,
    graphqlEndpoint: "/graphql",
    landingPage: false,
    maskedErrors: false,
    transports: { http },  // bundled: a Worker cannot load transports on demand
    // The visitor's session and lesson switches travel on to every subgraph.
    propagateHeaders: {
      fromClientToSubgraphs: ({ request }) => ({
        "x-lnl-session": request.headers.get("x-lnl-session") ?? "",
        "x-lnl-chaos": request.headers.get("x-lnl-chaos") ?? "",
      }),
    },
    plugins: () => [{
      // Every call the query plan makes to a subgraph goes through here.
      onFetch({ url, setFetchFn, context }) {
        const subgraph = SUBGRAPHS[new URL(url).hostname];
        if (!subgraph) return;
        setFetchFn((target, init) => env[subgraph.binding].fetch(target, init));
        return recordCall(subgraph.name, context?.request);
      },
    }],
  });
}

let runtime;
export default {
  async fetch(request, env, executionContext) {
    runtime ??= gateway(env);
    const trace = { started: performance.now(), calls: [], timings: {} };
    traces.set(request, trace);
    const response = await runtime.fetch(request, env, executionContext);

    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(trace.timings)) headers.set(name, value);
    headers.set("x-lnl-fetches", JSON.stringify(trace.calls));
    headers.set("x-router-time-ms", String(Math.round(performance.now() - trace.started)));
    return new Response(response.body, { status: response.status, headers });
  },
};

// ---------------------------------------------------------------------------------------
// Lunch & Learn plumbing. Not part of the federation pattern: it records when each subgraph
// call started and ended, for the timelines on the lesson pages. Like timing.rhai in the
// apollo-demo, it also copies each subgraph's own timing onto the response, as
// x-<subgraph>-time-ms and x-<subgraph>-timing-details.
// ---------------------------------------------------------------------------------------
const traces = new WeakMap();  // incoming Request -> { started, calls, timings }

// Called when a subgraph call starts; returns what to do when its response arrives.
function recordCall(name, request) {
  const trace = traces.get(request);
  if (!trace) return;
  const start = Math.round(performance.now() - trace.started);
  return ({ response }) => {
    trace.calls.push({ subgraph: name, start, end: Math.round(performance.now() - trace.started), status: response.status });
    for (const header of ["time-ms", "timing-details"]) {
      const value = response.headers.get(`x-${header}`);
      if (value) trace.timings[`x-${name}-${header}`] = value;
    }
  };
}
