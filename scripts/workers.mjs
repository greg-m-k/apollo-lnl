// Every Worker of the demo, in deploy order: whatever a Worker binds to is deployed before it.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

export const WORKERS = [
  "site/lesson",
  "patterns/federation/hr-subgraph",
  "patterns/federation/employment-subgraph",
  "patterns/federation/security-subgraph",
  "patterns/federation/router",
  "patterns/event-projections/hr-events",
  "patterns/event-projections/employment-events",
  "patterns/event-projections/security-events",
  "patterns/event-projections/projection-consumer",
  "patterns/event-projections/query-service",
  "site/web",
];

export const config = (worker) => `${worker}/wrangler.jsonc`;
export const run = (command) => execSync(command, { stdio: "inherit", env: { ...process.env, CI: "1" } });

// Apply the D1 migrations of every Worker that has a migrations folder, to its DB binding.
// where: "--remote", or "--local --persist-to <dir>".
export function migrate(where) {
  for (const worker of WORKERS.filter((w) => existsSync(`${w}/migrations`))) {
    run(`npx wrangler d1 migrations apply DB ${where} -c ${config(worker)}`);
  }
}
