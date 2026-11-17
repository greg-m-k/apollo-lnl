// Deploy the demo: remote D1 migrations, then every Worker in binding order.
import { execSync } from "node:child_process";
import { DATABASES, DEPLOY_ORDER } from "./workers.mjs";

const run = (cmd) => execSync(cmd, { stdio: "inherit", env: { ...process.env, CI: "1" } });
for (const [worker, db] of Object.entries(DATABASES)) {
  run(`npx wrangler d1 migrations apply ${db} --remote -c workers/${worker}/wrangler.jsonc`);
}
for (const worker of DEPLOY_ORDER) run(`npx wrangler deploy -c workers/${worker}/wrangler.jsonc`);
