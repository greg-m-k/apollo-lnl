// Local run of the whole demo: apply D1 migrations, then one wrangler dev for all Workers.
import { execSync, spawn } from "node:child_process";
import { WORKERS, DATABASES } from "./workers.mjs";

const STATE = ".wrangler/state";
const port = process.env.PORT ?? "8800";
for (const [worker, db] of Object.entries(DATABASES)) {
  execSync(`npx wrangler d1 migrations apply ${db} --local --persist-to ${STATE} -c workers/${worker}/wrangler.jsonc`,
    { stdio: "inherit", env: { ...process.env, CI: "1" } });
}
const args = ["wrangler", "dev", "--port", port, "--persist-to", STATE, "--test-scheduled",
  ...WORKERS.flatMap((w) => ["-c", `workers/${w}/wrangler.jsonc`])];
spawn("npx", args, { stdio: "inherit", shell: true });
