import { createHash } from "node:crypto";
import {
  estimateWorstCaseCallCost,
  evaluateCanaryCostGate,
  loadCallCostRatesFromEnv,
} from "./call-cost.ts";
import { buildOutboundCanaryCallRequest } from "./canary-plan.ts";
import {
  canaryTrunkPlanDigest,
  canaryTrunkPlanFromEnv,
  maskedCanaryTrunkPlan,
  type CanaryTrunkPlan,
} from "./trunk-config.ts";
import { runReliabilityGate } from "./reliability-gate.ts";
import { runRollbackDrill } from "./rollback-drill.ts";
import { runOfflineTranscriptGate } from "./transcript-gate-runner.ts";

export const CANARY_PREFLIGHT_ENV_KEYS = [
  "BOLNA_RUN_CANARY",
  "BOLNA_EVAL_GATE",
  "BOLNA_CANARY_AUTHORIZE",
  "BOLNA_CANARY_RUN_ID",
  "BOLNA_CANARY_AUTHORIZED_RUN_ID",
  "BOLNA_CANARY_EXPECTED_PLAN_DIGEST",
  "BOLNA_CANARY_DRY_RUN",
  "BOLNA_CANARY_INSPECT_FAILURES",
  "BOLNA_TRUNK_ID",
  "BOLNA_TRUNK_NAME",
  "BOLNA_TRUNK_DESCRIPTION",
  "BOLNA_TRUNK_PRESET",
  "BOLNA_TRUNK_INBOUND_ENABLED",
  "BOLNA_TRUNK_OUTBOUND_ENABLED",
  "BOLNA_TRUNK_CHANNELS",
  "BOLNA_TRUNK_DEFAULT_AGENT_ID",
  "BOLNA_TRUNK_TRANSPORT",
  "BOLNA_TRUNK_OUTBOUND_LEADING_PLUS",
  "BOLNA_TRUNK_CODECS",
  "BOLNA_TRUNK_GATEWAYS",
  "BOLNA_TRUNK_CARRIER_IPS",
  "BOLNA_TRUNK_NUMBERS",
  "BOLNA_TRUNK_INBOUND_AGENT_ID",
  "BOLNA_TRUNK_AUTH_USERNAME",
  "BOLNA_TRUNK_AUTH_PASSWORD_ENV",
  "BOLNA_AGENT_ID",
  "BOLNA_CANARY_VERSION_ID",
  "BOLNA_CANARY_RECIPIENT_PHONE",
  "BOLNA_CANARY_FROM_PHONE",
  "BOLNA_CANARY_LANGUAGE",
  "BOLNA_CANARY_CUSTOMER_NAME",
  "BOLNA_CANARY_CALL_CAP_SECONDS",
  "BOLNA_CANARY_PLANNED_CALLS",
  "BOLNA_CANARY_MAX_CALLS",
  "BOLNA_CANARY_MAX_CONCURRENT",
  "BOLNA_CANARY_PREFERRED_MODELS",
  "BOLNA_CANARY_CURRENCY",
  "BOLNA_VOICE_AI_PER_MINUTE",
  "BOLNA_PLATFORM_FEE_PER_MINUTE",
  "BOLNA_CARRIER_PER_MINUTE",
  "BOLNA_CARRIER_CONNECTION_FEE",
  "BOLNA_CARRIER_MINIMUM_MINUTES",
  "BOLNA_CARRIER_BILLING_INCREMENT_SECONDS",
  "BOLNA_CANARY_MAX_COST_PER_CALL",
  "BOLNA_CANARY_MAX_COST",
] as const;

const REQUIRED_PREFLIGHT_INPUTS = [
  "BOLNA_RUN_CANARY",
  "BOLNA_EVAL_GATE",
  "BOLNA_CANARY_AUTHORIZE",
  "BOLNA_CANARY_RUN_ID",
  "BOLNA_CANARY_AUTHORIZED_RUN_ID",
  "BOLNA_CANARY_EXPECTED_PLAN_DIGEST",
  "BOLNA_TRUNK_ID",
  "BOLNA_TRUNK_GATEWAYS",
  "BOLNA_TRUNK_CARRIER_IPS",
  "BOLNA_TRUNK_NUMBERS",
  "BOLNA_AGENT_ID",
  "BOLNA_CANARY_VERSION_ID",
  "BOLNA_CANARY_RECIPIENT_PHONE",
  "BOLNA_CANARY_FROM_PHONE",
  "BOLNA_VOICE_AI_PER_MINUTE",
  "BOLNA_PLATFORM_FEE_PER_MINUTE",
  "BOLNA_CARRIER_PER_MINUTE",
  "BOLNA_CARRIER_CONNECTION_FEE",
  "BOLNA_CANARY_MAX_COST_PER_CALL",
  "BOLNA_CANARY_MAX_COST",
] as const;

const LIVE_CHECKS_REQUIRED = [
  "Run Step 6 read-only trunk readiness immediately before any call.",
  "Review the plan digest and masked call packet in this preflight.",
  "Give explicit live authorization with a matching run id; keep dry-run until then.",
] as const;

export interface CanaryPreflightCheck {
  name: string;
  status: "PASS" | "FAIL";
  detail: string;
}

export interface CanaryPreflightCost {
  currency: string;
  worstCaseCostPerCall: number;
  projectedCanaryCost: number;
}

export interface CanaryPreflightResult {
  status: "READY_FOR_REVIEW" | "BLOCKED";
  checks: CanaryPreflightCheck[];
  reasons: string[];
  missingInputs: string[];
  digest: string;
  planDigest: string | null;
  maskedPlan: Record<string, unknown> | null;
  maskedCall: Record<string, unknown> | null;
  cost: CanaryPreflightCost | null;
  offlineDigests: {
    transcript: string;
    reliability: string;
    rollback: string;
  };
  networkRequests: 0;
  liveCallPlaced: false;
  liveChecksRequired: string[];
}

export interface CanaryPreflightInput {
  env: Record<string, string | undefined>;
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function maskPhone(value: string): string {
  if (value.length < 7) return "***";
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

async function check(
  name: string,
  fn: () => string | Promise<string>,
): Promise<CanaryPreflightCheck> {
  try {
    return { name, status: "PASS", detail: await fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, status: "FAIL", detail: message };
  }
}

function numeric(env: Record<string, string | undefined>, name: string, fallback?: number): number {
  const raw = env[name]?.trim();
  if (!raw) {
    if (fallback === undefined) throw new Error(`${name} is required.`);
    return fallback;
  }
  const value = Number(raw);
  expect(Number.isFinite(value), `${name} must be numeric.`);
  return value;
}

/**
 * Offline live-canary review packet. It reads only the supplied env object,
 * re-runs offline gates, and never contacts Bolna or places a call.
 */
export async function runCanaryPreflight(
  input: CanaryPreflightInput,
): Promise<CanaryPreflightResult> {
  const env = input.env;
  const checks: CanaryPreflightCheck[] = [];
  let plan: CanaryTrunkPlan | null = null;
  let maskedPlan: Record<string, unknown> | null = null;
  let maskedCall: Record<string, unknown> | null = null;
  let cost: CanaryPreflightCost | null = null;

  const [transcript, reliability, rollback] = await Promise.all([
    runOfflineTranscriptGate(),
    runReliabilityGate(),
    runRollbackDrill(),
  ]);

  checks.push(
    await check("offline_transcript_gate", () => {
      expect(transcript.result.status === "PASS", "Step 7 transcript gate is not PASS.");
      return `PASS ${transcript.result.digest}`;
    }),
    await check("offline_reliability_gate", () => {
      expect(reliability.status === "PASS", "Step 10 reliability gate is not PASS.");
      return `PASS ${reliability.digest}`;
    }),
    await check("offline_rollback_drill", () => {
      expect(rollback.status === "PASS", "Step 11 rollback drill is not PASS.");
      return `PASS ${rollback.digest}`;
    }),
  );

  checks.push(
    await check("plan_complete", () => {
      plan = canaryTrunkPlanFromEnv(env);
      maskedPlan = maskedCanaryTrunkPlan(plan);
      return `plan digest ${canaryTrunkPlanDigest(plan)}`;
    }),
  );

  checks.push(
    await check("cost_inputs", () => {
      const rates = loadCallCostRatesFromEnv(env);
      const estimate = estimateWorstCaseCallCost({
        rates,
        callCapSeconds: numeric(env, "BOLNA_CANARY_CALL_CAP_SECONDS", 300),
        usesPreferredModels: env.BOLNA_CANARY_PREFERRED_MODELS !== "0",
      });
      const gate = evaluateCanaryCostGate({
        estimate,
        plannedCalls: numeric(env, "BOLNA_CANARY_PLANNED_CALLS", 1),
        maxCallsPerCanary: numeric(env, "BOLNA_CANARY_MAX_CALLS", 2),
        maxCostPerCall: numeric(env, "BOLNA_CANARY_MAX_COST_PER_CALL"),
        maxCanaryCost: numeric(env, "BOLNA_CANARY_MAX_COST"),
        maxConcurrentCalls: numeric(env, "BOLNA_CANARY_MAX_CONCURRENT", 1),
      });
      expect(gate.status === "PASS", gate.reasons.join("; "));
      cost = {
        currency: estimate.currency,
        worstCaseCostPerCall: estimate.totalCost,
        projectedCanaryCost: gate.projectedCanaryCost,
      };
      return `${estimate.currency} projected ${gate.projectedCanaryCost}`;
    }),
  );

  checks.push(
    await check("call_pinning", () => {
      expect(plan !== null, "A valid trunk plan is required before call pinning.");
      const language = env.BOLNA_CANARY_LANGUAGE?.trim() || "en";
      const request = buildOutboundCanaryCallRequest(plan as CanaryTrunkPlan, {
        agentId: env.BOLNA_AGENT_ID?.trim() ?? "",
        agentVersionId: env.BOLNA_CANARY_VERSION_ID?.trim() ?? "",
        recipientPhone: env.BOLNA_CANARY_RECIPIENT_PHONE?.trim() ?? "",
        fromPhone: env.BOLNA_CANARY_FROM_PHONE?.trim() ?? "",
        language: language as "en" | "hi" | "te",
        customerName: env.BOLNA_CANARY_CUSTOMER_NAME?.trim() || "Canary caller",
        runId: env.BOLNA_CANARY_RUN_ID?.trim() ?? "",
      });
      maskedCall = {
        ...request,
        recipient_phone_number: maskPhone(request.recipient_phone_number),
        from_phone_number: maskPhone(request.from_phone_number ?? ""),
      };
      return `pinned version ${request.agent_version_id}, from ${maskPhone(request.from_phone_number ?? "")}`;
    }),
  );

  checks.push(
    await check("authorization_fields", () => {
      expect(plan !== null, "A valid trunk plan is required before digest review.");
      const runId = env.BOLNA_CANARY_RUN_ID?.trim() ?? "";
      expect(env.BOLNA_RUN_CANARY === "1", "BOLNA_RUN_CANARY must be 1 for review.");
      expect(env.BOLNA_EVAL_GATE === "PASS", "BOLNA_EVAL_GATE must be PASS.");
      expect(env.BOLNA_CANARY_AUTHORIZE === "1", "BOLNA_CANARY_AUTHORIZE must be 1.");
      expect(runId.length > 0, "BOLNA_CANARY_RUN_ID is required.");
      expect(
        env.BOLNA_CANARY_AUTHORIZED_RUN_ID?.trim() === runId,
        "Authorized run id must match the canary run id.",
      );
      expect(
        env.BOLNA_CANARY_EXPECTED_PLAN_DIGEST?.trim() === canaryTrunkPlanDigest(plan as CanaryTrunkPlan),
        "Reviewed plan digest does not match the current plan.",
      );
      return `authorized run ${runId} matches reviewed digest`;
    }),
  );

  checks.push(
    await check("dry_run_default", () => {
      expect(
        env.BOLNA_CANARY_DRY_RUN !== "0",
        "Offline preflight must keep BOLNA_CANARY_DRY_RUN enabled.",
      );
      return "dry-run remains enabled; preflight cannot place a call";
    }),
  );

  const reasons = checks
    .filter((item) => item.status === "FAIL")
    .map((item) => `${item.name}: ${item.detail}`);
  const missingInputs = REQUIRED_PREFLIGHT_INPUTS.filter((name) => !env[name]?.trim());
  const offlineDigests = {
    transcript: transcript.result.digest,
    reliability: reliability.digest,
    rollback: rollback.digest,
  };
  const digest = createHash("sha256")
    .update(
      canonical({
        checks: checks.map((item) => [item.name, item.status]),
        planDigest: plan ? canaryTrunkPlanDigest(plan) : null,
        cost,
        offlineDigests,
        networkRequests: 0,
        liveCallPlaced: false,
      }),
    )
    .digest("hex");

  return {
    status: reasons.length === 0 ? "READY_FOR_REVIEW" : "BLOCKED",
    checks,
    reasons,
    missingInputs: [...missingInputs],
    digest,
    planDigest: plan ? canaryTrunkPlanDigest(plan) : null,
    maskedPlan,
    maskedCall,
    cost,
    offlineDigests,
    networkRequests: 0,
    liveCallPlaced: false,
    liveChecksRequired: [...LIVE_CHECKS_REQUIRED],
  };
}
