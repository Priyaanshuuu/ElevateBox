import { createHash } from "node:crypto";
import { canaryTrunkPlanDigest, type CanaryTrunkPlan } from "./trunk-config.ts";
import { isE164TrunkPhone, isUuid } from "./trunk-types.ts";
import type { BolnaCallRequest, BolnaCallResponse } from "./agent-types.ts";
import type { CostGateResult } from "./call-cost.ts";
import type { CanaryReadinessResult } from "./canary-plan.ts";
import type { PreCallGateResult } from "./precall-gate.ts";

export interface CanaryExecutionCheck {
  name: string;
  status: "PASS" | "FAIL";
  detail?: string;
}

export interface CanaryExecutionInput {
  env: Record<string, string | undefined>;
  plan: CanaryTrunkPlan;
  offlineGate: PreCallGateResult;
  costGate: CostGateResult;
  readiness: CanaryReadinessResult;
  callRequest: BolnaCallRequest;
}

export interface CanaryExecutionGateResult {
  status: "PASS" | "FAIL";
  checks: CanaryExecutionCheck[];
  reasons: string[];
  digest: string;
}

export interface CanaryExecutionResult {
  status: "SKIP" | "FAIL" | "DRY_RUN" | "PLACED";
  reason: string;
  gate: CanaryExecutionGateResult;
  executionId?: string;
}

export interface CanaryExecutionDependencies {
  placeCall(request: BolnaCallRequest): Promise<BolnaCallResponse>;
}

function check(name: string, ok: boolean, detail?: string): CanaryExecutionCheck {
  return { name, status: ok ? "PASS" : "FAIL", ...(detail ? { detail } : {}) };
}

export function evaluateCanaryExecutionGate(
  input: CanaryExecutionInput,
): CanaryExecutionGateResult {
  const env = input.env;
  const runId = env.BOLNA_CANARY_RUN_ID?.trim() ?? "";
  const agentVersionId = input.callRequest.agent_version_id ?? "";
  const fromPhoneNumber = input.callRequest.from_phone_number ?? "";
  const checks: CanaryExecutionCheck[] = [
    check("live_opt_in", env.BOLNA_RUN_CANARY === "1", env.BOLNA_RUN_CANARY ?? "unset"),
    check("eval_gate", env.BOLNA_EVAL_GATE === "PASS", env.BOLNA_EVAL_GATE ?? "unset"),
    check(
      "explicit_authorization",
      env.BOLNA_CANARY_AUTHORIZE === "1" &&
        runId.length > 0 &&
        env.BOLNA_CANARY_AUTHORIZED_RUN_ID?.trim() === runId,
      `authorize=${env.BOLNA_CANARY_AUTHORIZE ?? "unset"}, run=${runId || "unset"}`,
    ),
    check("offline_gate", input.offlineGate.status === "PASS", input.offlineGate.status),
    check(
      "plan_digest_reviewed",
      Boolean(env.BOLNA_CANARY_EXPECTED_PLAN_DIGEST?.trim()) &&
        env.BOLNA_CANARY_EXPECTED_PLAN_DIGEST?.trim() === canaryTrunkPlanDigest(input.plan),
      env.BOLNA_CANARY_EXPECTED_PLAN_DIGEST?.trim() || "unset",
    ),
    check("live_readiness", input.readiness.status === "PASS", input.readiness.status),
    check(
      "cost_gate",
      input.costGate.status === "PASS" &&
        input.costGate.projectedCanaryCost > 0,
      `${input.costGate.status}, projected=${input.costGate.projectedCanaryCost}`,
    ),
    check(
      "single_call",
      Number(env.BOLNA_CANARY_PLANNED_CALLS) === 1 &&
        Number(env.BOLNA_CANARY_MAX_CONCURRENT) === 1,
      `planned=${env.BOLNA_CANARY_PLANNED_CALLS ?? "unset"}, concurrent=${env.BOLNA_CANARY_MAX_CONCURRENT ?? "unset"}`,
    ),
    check(
      "call_pinning",
      isUuid(agentVersionId) &&
        isE164TrunkPhone(fromPhoneNumber) &&
        input.plan.numbers.some((number) => number.e164 === fromPhoneNumber) &&
        input.callRequest.user_data?.canary === true &&
        input.callRequest.retry_config === undefined &&
        input.callRequest.bypass_call_guardrails === undefined,
      `version=${agentVersionId || "unset"}, from=${fromPhoneNumber || "unset"}`,
    ),
  ];

  const reasons = checks
    .filter((item) => item.status === "FAIL")
    .map((item) => `${item.name}: ${item.detail ?? "failed"}`);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        checks: checks.map((item) => [item.name, item.status]),
        call: {
          agentId: input.callRequest.agent_id,
          agentVersionId: input.callRequest.agent_version_id,
          recipient: input.callRequest.recipient_phone_number,
          from: input.callRequest.from_phone_number,
        },
        planDigest: canaryTrunkPlanDigest(input.plan),
      }),
    )
    .digest("hex");

  return {
    status: reasons.length > 0 ? "FAIL" : "PASS",
    checks,
    reasons,
    digest,
  };
}

export async function runCanaryExecution(
  input: CanaryExecutionInput,
  dependencies: CanaryExecutionDependencies,
): Promise<CanaryExecutionResult> {
  const gate = evaluateCanaryExecutionGate(input);
  if (gate.status === "FAIL") {
    return {
      status: "FAIL",
      reason: `canary execution gate failed: ${gate.reasons.join("; ")}`,
      gate,
    };
  }
  if (input.env.BOLNA_CANARY_DRY_RUN === "1") {
    return {
      status: "DRY_RUN",
      reason: "all gates passed; dry run did not place a call",
      gate,
    };
  }

  const response = await dependencies.placeCall(input.callRequest);
  return {
    status: "PLACED",
    reason: "one gated canary call was placed",
    gate,
    executionId: response.execution_id,
  };
}
