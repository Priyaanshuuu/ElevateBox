import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  BolnaConfigError,
  buildOutboundCanaryCallRequest,
  canaryTrunkPlanDigest,
  canaryTrunkPlanFromEnv,
  evaluateCanaryCostGate,
  estimateWorstCaseCallCost,
  loadCallCostRatesFromEnv,
  maskedCanaryTrunkPlan,
  validateCanaryTrunkPlan,
} from "../lib/bolna/index.ts";
import type { BolnaLanguageCode } from "../lib/bolna/index.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true, quiet: true });

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new BolnaConfigError(`${name} is required for the Step 6 canary plan.`);
  return value;
}

function numberEnv(name: string, fallback?: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    if (fallback === undefined) throw new BolnaConfigError(`${name} is required.`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new BolnaConfigError(`${name} must be numeric.`);
  return value;
}

function maskPhone(value: string): string {
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

try {
  const plan = canaryTrunkPlanFromEnv(process.env);
  validateCanaryTrunkPlan(plan);

  const language = process.env.BOLNA_CANARY_LANGUAGE?.trim() || "en";
  if (language !== "en" && language !== "hi" && language !== "te") {
    throw new BolnaConfigError("BOLNA_CANARY_LANGUAGE must be en, hi, or te.");
  }
  const callRequest = buildOutboundCanaryCallRequest(plan, {
    agentId: requiredEnv("BOLNA_AGENT_ID"),
    agentVersionId: requiredEnv("BOLNA_CANARY_VERSION_ID"),
    recipientPhone: requiredEnv("BOLNA_CANARY_RECIPIENT_PHONE"),
    fromPhone: requiredEnv("BOLNA_CANARY_FROM_PHONE"),
    language: language as BolnaLanguageCode,
    customerName: process.env.BOLNA_CANARY_CUSTOMER_NAME?.trim() || "Canary caller",
    runId: requiredEnv("BOLNA_CANARY_RUN_ID"),
  });

  const rates = loadCallCostRatesFromEnv(process.env);
  const callCapSeconds = numberEnv("BOLNA_CANARY_CALL_CAP_SECONDS", 300);
  const preferredRaw = process.env.BOLNA_CANARY_PREFERRED_MODELS ?? "1";
  if (preferredRaw !== "0" && preferredRaw !== "1") {
    throw new BolnaConfigError("BOLNA_CANARY_PREFERRED_MODELS must be 0 or 1.");
  }
  const estimate = estimateWorstCaseCallCost({
    rates,
    callCapSeconds,
    usesPreferredModels: preferredRaw === "1",
  });
  const costGate = evaluateCanaryCostGate({
    estimate,
    plannedCalls: numberEnv("BOLNA_CANARY_PLANNED_CALLS", 1),
    maxCallsPerCanary: numberEnv("BOLNA_CANARY_MAX_CALLS", 2),
    maxCostPerCall: numberEnv("BOLNA_CANARY_MAX_COST_PER_CALL"),
    maxCanaryCost: numberEnv("BOLNA_CANARY_MAX_COST"),
    maxConcurrentCalls: numberEnv("BOLNA_CANARY_MAX_CONCURRENT", 1),
  });

  if (costGate.status !== "PASS") {
    throw new BolnaConfigError(`Canary cost gate failed: ${costGate.reasons.join("; ")}`);
  }

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        note: "offline plan only — no trunk, call, or agent mutation was performed",
        planDigest: canaryTrunkPlanDigest(plan),
        plan: maskedCanaryTrunkPlan(plan),
        call: {
          ...callRequest,
          recipient_phone_number: maskPhone(callRequest.recipient_phone_number),
          from_phone_number: maskPhone(callRequest.from_phone_number ?? ""),
        },
        estimate,
        costGate,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: Step 6 canary plan — ${message}`);
  process.exit(1);
}
