import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { runReliabilityGate } from "../lib/bolna/reliability-gate.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

try {
  const report = await runReliabilityGate();
  const failed = report.status === "FAIL";
  console.log(
    JSON.stringify(
      {
        result: report.status,
        note: failed
          ? "offline Step 10 reliability gate failed — no live call is authorized"
          : "offline Step 10 reliability gate passed — live checks are still required before any call",
        gateDigest: report.digest,
        checks: report.checks,
        reasons: report.reasons,
        metrics: report.metrics,
        liveChecksRequired: report.liveChecksRequired,
        networkRequests: 0,
      },
      null,
      2,
    ),
  );
  if (failed) process.exit(1);
} catch (error) {
  console.error(
    `FAIL: Step 10 offline reliability gate — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
