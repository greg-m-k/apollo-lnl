// Local run of the whole demo: apply D1 migrations, then one wrangler dev for all Workers.
import { spawn } from "node:child_process";
import { WORKERS, config, migrate } from "./workers.mjs";

const STATE = ".wrangler/state";
migrate(`--local --persist-to ${STATE}`);
// wrangler dev serves the first config's Worker: web, the last one deployed.
const configs = [...WORKERS].reverse().flatMap((w) => ["-c", config(w)]);
spawn("npx", ["wrangler", "dev", "--port", process.env.PORT ?? "8800", "--persist-to", STATE, "--test-scheduled", ...configs],
  { stdio: "inherit", shell: true });
