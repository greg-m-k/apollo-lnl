// Every Worker of the demo, in deploy order: whatever a Worker binds to is deployed before it.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

export const WORKERS = [
  "site/lesson",
  "option-a-federation/hr-subgraph",
  "option-a-federation/employment-subgraph",
  "option-a-federation/security-subgraph",
  "option-a-federation/router",
  "option-b-events/hr-events",
  "option-b-events/employment-events",
  "option-b-events/security-events",
  "option-b-events/projection-consumer",
  "option-b-events/query-service",
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
