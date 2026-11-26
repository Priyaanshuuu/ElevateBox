import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { CANARY_PREFLIGHT_ENV_KEYS, runCanaryPreflight } from "../lib/bolna/canary-preflight.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true, quiet: true });

try {
  // Only allowlisted, non-secret canary inputs reach the packet. DATABASE_URL,
  // API keys, carrier passwords, and tool tokens are never read into output.
  const env = Object.fromEntries(
    CANARY_PREFLIGHT_ENV_KEYS.map((name) => [name, process.env[name]]),
  );
  const report = await runCanaryPreflight({ env });
  const blocked = report.status === "BLOCKED";

  console.log(
    JSON.stringify(
      {
        result: report.status,
        note: blocked
          ? "offline live-canary preflight is blocked — no live call was placed"
          : "offline live-canary preflight is ready for review — no live call was placed",
        digest: report.digest,
        checks: report.checks,
        reasons: report.reasons,
        missingInputs: report.missingInputs,
        planDigest: report.planDigest,
        maskedPlan: report.maskedPlan,
        maskedCall: report.maskedCall,
        cost: report.cost,
        offlineDigests: report.offlineDigests,
        liveChecksRequired: report.liveChecksRequired,
        networkRequests: 0,
        liveCallPlaced: false,
      },
      null,
      2,
    ),
  );
  if (blocked) process.exit(1);
} catch (error) {
  console.error(
    `FAIL: offline live-canary preflight — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
