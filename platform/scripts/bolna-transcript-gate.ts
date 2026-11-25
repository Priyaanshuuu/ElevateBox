import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { runOfflineTranscriptGate } from "../lib/bolna/transcript-gate-runner.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

try {
  const report = await runOfflineTranscriptGate();
  const failed = report.result.status === "FAIL";
  console.log(
    JSON.stringify(
      {
        result: report.result.status,
        note: failed
          ? "offline Step 7 gate failed — no live call is authorized"
          : "offline Step 7 gate passed — live checks are still required before any call",
        fixtureDigest: report.fixtureDigest,
        gateDigest: report.result.digest,
        transcripts: report.transcriptResults.map((item) => ({
          id: item.id,
          status: item.status,
          digest: item.digest,
          reasons: item.reasons,
        })),
        checks: report.result.checks,
        liveChecksRequired: report.result.liveChecksRequired,
        networkRequests: 0,
      },
      null,
      2,
    ),
  );
  if (failed) process.exit(1);
} catch (error) {
  console.error(
    `FAIL: Step 7 offline transcript gate — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
