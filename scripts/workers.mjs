// Every Worker of the demo, web first (the first config is the one wrangler dev serves).
export const WORKERS = [
  "web", "router", "hr-subgraph", "employment-subgraph", "security-subgraph",
  "hr-events", "employment-events", "security-events", "projection-consumer", "query-service",
];
// Worker folder -> D1 database it migrates (query-service shares lnl-projections).
export const DATABASES = {
  "hr-subgraph": "lnl-hr", "employment-subgraph": "lnl-employment", "security-subgraph": "lnl-security",
  "hr-events": "lnl-hr-events", "employment-events": "lnl-employment-events", "security-events": "lnl-security-events",
  "projection-consumer": "lnl-projections",
};
