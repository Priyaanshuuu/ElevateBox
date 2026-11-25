import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  BolnaConfigError,
  buildOutboundCanaryCallRequest,
  canaryTrunkPlanDigest,
  canaryTrunkPlanFromEnv,
  createBolnaClient,
  estimateWorstCaseCallCost,
  evaluateCanaryCostGate,
  evaluateCanaryReadiness,
  loadCallCostRatesFromEnv,
  runCanaryExecution,
  runOfflineTranscriptGate,
} from "../lib/bolna/index.ts";
import type { BolnaLanguageCode } from "../lib/bolna/index.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true, quiet: true });

function maskPhone(value: string): string {
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new BolnaConfigError(`${name} is required for the live canary gate.`);
  return value;
}

function numeric(name: string, fallback?: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    if (fallback === undefined) throw new BolnaConfigError(`${name} is required.`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new BolnaConfigError(`${name} must be numeric.`);
  return value;
}

if (process.env.BOLNA_RUN_CANARY !== "1") {
  console.log(
    "SKIP: set BOLNA_RUN_CANARY=1, BOLNA_EVAL_GATE=PASS, explicit authorization, and a reviewed plan digest before a live canary.",
  );
  process.exit(0);
}

const dryRun = process.env.BOLNA_CANARY_DRY_RUN !== "0";
const runId = process.env.BOLNA_CANARY_RUN_ID?.trim() ?? "";

// Fail before any live read if the cheap authorization gates are missing.
if (
  process.env.BOLNA_EVAL_GATE !== "PASS" ||
  process.env.BOLNA_CANARY_AUTHORIZE !== "1" ||
  runId.length === 0 ||
  process.env.BOLNA_CANARY_AUTHORIZED_RUN_ID?.trim() !== runId
) {
  console.error(
    "FAIL: explicit live canary authorization is missing. Require BOLNA_EVAL_GATE=PASS, BOLNA_CANARY_AUTHORIZE=1, and a matching BOLNA_CANARY_AUTHORIZED_RUN_ID.",
  );
  process.exit(1);
}

try {
  const planDigestEnv = required("BOLNA_CANARY_EXPECTED_PLAN_DIGEST");
  const trunkId = required("BOLNA_TRUNK_ID");
  const fromPhone = required("BOLNA_CANARY_FROM_PHONE");
  const language = process.env.BOLNA_CANARY_LANGUAGE?.trim() || "en";
  if (language !== "en" && language !== "hi" && language !== "te") {
    throw new BolnaConfigError("BOLNA_CANARY_LANGUAGE must be en, hi, or te.");
  }

  const offline = await runOfflineTranscriptGate();
  const plan = canaryTrunkPlanFromEnv(process.env);
  const planDigest = canaryTrunkPlanDigest(plan);
  if (planDigest !== planDigestEnv) {
    throw new BolnaConfigError(
      "Reviewed plan digest does not match the current trunk plan. Re-review before authorizing.",
    );
  }

  const callRequest = buildOutboundCanaryCallRequest(plan, {
    agentId: required("BOLNA_AGENT_ID"),
    agentVersionId: required("BOLNA_CANARY_VERSION_ID"),
    recipientPhone: required("BOLNA_CANARY_RECIPIENT_PHONE"),
    fromPhone,
    language: language as BolnaLanguageCode,
    customerName: process.env.BOLNA_CANARY_CUSTOMER_NAME?.trim() || "Canary caller",
    runId,
  });

  const rates = loadCallCostRatesFromEnv(process.env);
  const estimate = estimateWorstCaseCallCost({
    rates,
    callCapSeconds: numeric("BOLNA_CANARY_CALL_CAP_SECONDS", 300),
    usesPreferredModels: process.env.BOLNA_CANARY_PREFERRED_MODELS !== "0",
  });
  const costGate = evaluateCanaryCostGate({
    estimate,
    plannedCalls: numeric("BOLNA_CANARY_PLANNED_CALLS", 1),
    maxCallsPerCanary: numeric("BOLNA_CANARY_MAX_CALLS", 2),
    maxCostPerCall: numeric("BOLNA_CANARY_MAX_COST_PER_CALL"),
    maxCanaryCost: numeric("BOLNA_CANARY_MAX_COST"),
    maxConcurrentCalls: numeric("BOLNA_CANARY_MAX_CONCURRENT", 1),
  });

  const client = createBolnaClient();
  const [connectionDetails, trunk] = await Promise.all([
    client.getTrunkConnectionDetails(),
    client.getTrunk(trunkId),
  ]);
  if (process.env.BOLNA_CANARY_INSPECT_FAILURES === "1") {
    await client.listTrunkCalls(trunkId, { direction: "failed", limit: 10 });
  }
  const readiness = evaluateCanaryReadiness({
    plan,
    trunk,
    connectionDetails,
    costGate,
    expectedFromPhone: fromPhone,
    expectedPlanDigest: planDigest,
  });

  const result = await runCanaryExecution(
    {
      env: { ...process.env, BOLNA_CANARY_DRY_RUN: dryRun ? "1" : "0" },
      plan,
      offlineGate: offline.result,
      costGate,
      readiness,
      callRequest,
    },
    { placeCall: (request) => client.makeCall(request) },
  );

  console.log(
    JSON.stringify(
      {
        result: result.status,
        reason: result.reason,
        gate: {
          status: result.gate.status,
          reasons: result.gate.reasons,
          digest: result.gate.digest,
          checks: result.gate.checks,
        },
        executionId: result.executionId ?? null,
        dryRun,
        planDigest,
        offlineGateDigest: offline.result.digest,
        costGate: costGate.status,
        readiness: readiness.status,
        call: {
          ...callRequest,
          recipient_phone_number: maskPhone(callRequest.recipient_phone_number),
          from_phone_number: maskPhone(callRequest.from_phone_number ?? ""),
        },
        note:
          result.status === "PLACED"
            ? "one gated canary call was placed; monitor the execution webhook"
            : "no live call was placed",
      },
      null,
      2,
    ),
  );
  if (result.status === "FAIL") process.exit(1);
} catch (error) {
  console.error(
    `FAIL: live canary gate — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
