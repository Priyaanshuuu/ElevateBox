import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { BolnaError, createBolnaClient } from "../lib/bolna/index.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true, quiet: true });

const runLive = process.env.BOLNA_RUN_LIVE_SMOKE === "1";

if (!runLive) {
  console.log("SKIP: set BOLNA_RUN_LIVE_SMOKE=1 to run the live Bolna /user/me check.");
  process.exit(0);
}

try {
  const client = createBolnaClient();
  const user = await client.getUser();
  console.log("PASS: Bolna /user/me");
  console.log(
    JSON.stringify(
      {
        accountId: user.id,
        wallet: user.wallet,
        concurrency: user.concurrency,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof BolnaError ? error.message : "Unknown Bolna smoke failure.";
  console.error(`FAIL: Bolna /user/me — ${message}`);
  process.exit(1);
}
