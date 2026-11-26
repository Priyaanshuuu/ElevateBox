import { runRollbackDrill } from "../lib/bolna/rollback-drill.ts";

try {
  const report = await runRollbackDrill();
  const failed = report.status === "FAIL";
  console.log(
    JSON.stringify(
      {
        result: report.status,
        note: failed
          ? "offline Step 11 rollback drill failed — no rollback was executed and no live call is authorized"
          : "offline Step 11 rollback drill passed — this is a documentation/readiness drill only",
        gateDigest: report.digest,
        checks: report.checks,
        reasons: report.reasons,
        metrics: report.metrics,
        rollbackExecuted: report.rollbackExecuted,
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
    `FAIL: Step 11 offline rollback drill — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
