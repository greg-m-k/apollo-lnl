// Deploy the demo: remote D1 migrations, then every Worker in binding order.
import { WORKERS, config, migrate, run } from "./workers.mjs";

migrate("--remote");
for (const worker of WORKERS) run(`npx wrangler deploy -c ${config(worker)}`);
