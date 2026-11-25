import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BolnaConfigError,
  buildOutboundCanaryCallRequest,
  canaryTrunkPlanDigest,
  canaryTrunkPlanFromEnv,
  evaluateCanaryExecutionGate,
  runCanaryExecution,
} from "../lib/bolna/index.ts";
import type {
  BolnaCallRequest,
  CanaryExecutionInput,
  CanaryTrunkPlan,
} from "../lib/bolna/index.ts";

const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FROM = "+918035739222";
const RECIPIENT = "+919876543210";
const RUN_ID = "canary-run-1";

function fixturePlan(): CanaryTrunkPlan {
  return {
    trunkName: "ElevateBox canary SIP trunk",
    description: undefined,
    preset: "custom",
    inboundEnabled: true,
    outboundEnabled: true,
    channels: 2,
    defaultInboundAgentId: AGENT_ID,
    transport: "udp",
    outboundLeadingPlusEnabled: false,
    codecs: "PCMU,PCMA",
    gateways: [{ host: "198.51.100.10", port: 5060, priority: 0 }],
    ipAcls: ["198.51.100.0/24"],
    numbers: [{ e164: FROM, destinationKey: "918035739222", agentId: AGENT_ID }],
    authUsername: undefined,
    authPasswordEnv: undefined,
  };
}

function fixtureEnv(): Record<string, string | undefined> {
  return {
    BOLNA_RUN_CANARY: "1",
    BOLNA_EVAL_GATE: "PASS",
    BOLNA_CANARY_AUTHORIZE: "1",
    BOLNA_CANARY_RUN_ID: RUN_ID,
    BOLNA_CANARY_AUTHORIZED_RUN_ID: RUN_ID,
    BOLNA_CANARY_EXPECTED_PLAN_DIGEST: canaryTrunkPlanDigest(fixturePlan()),
    BOLNA_CANARY_PLANNED_CALLS: "1",
    BOLNA_CANARY_MAX_CONCURRENT: "1",
    BOLNA_CANARY_DRY_RUN: "1",
    BOLNA_TRUNK_DEFAULT_AGENT_ID: AGENT_ID,
    BOLNA_TRUNK_INBOUND_AGENT_ID: AGENT_ID,
    BOLNA_TRUNK_GATEWAYS: "198.51.100.10:5060:0",
    BOLNA_TRUNK_CARRIER_IPS: "198.51.100.0/24",
    BOLNA_TRUNK_NUMBERS: FROM,
  };
}

function fixtureCallRequest(plan: CanaryTrunkPlan = fixturePlan()): BolnaCallRequest {
  return buildOutboundCanaryCallRequest(plan, {
    agentId: AGENT_ID,
    agentVersionId: VERSION_ID,
    recipientPhone: RECIPIENT,
    fromPhone: FROM,
    language: "en",
    customerName: "Canary caller",
    runId: RUN_ID,
  });
}

function fixtureInput(overrides: Partial<CanaryExecutionInput> = {}): CanaryExecutionInput {
  const plan = fixturePlan();
  return {
    env: fixtureEnv(),
    plan,
    offlineGate: {
      status: "PASS",
      checks: [],
      reasons: [],
      digest: "a".repeat(64),
      liveChecksRequired: [
        "Step 6 canary readiness against the real carrier trunk",
        "Step 6 cost gate with real Bolna and carrier rates",
        "explicit live canary authorization with a reviewed plan digest",
      ],
    },
    costGate: { status: "PASS", reasons: [], projectedCanaryCost: 0.42 },
    readiness: { status: "PASS", checks: [], reasons: [] },
    callRequest: fixtureCallRequest(plan),
    ...overrides,
  };
}

describe("Step 8 — gated live canary execution harness evals", () => {
  describe("execution gate", () => {
    it("eval: passes only with opt-in, eval gate, matching authorization, reviewed digest, and a pinned single call", () => {
      const result = evaluateCanaryExecutionGate(fixtureInput());
      assert.equal(result.status, "PASS", JSON.stringify(result.reasons));
      assert.equal(result.reasons.length, 0);
      assert.equal(result.checks.length, 9);
      assert.ok(result.checks.every((item) => item.status === "PASS"));
      assert.match(result.digest, /^[0-9a-f]{64}$/);
    });

    it("eval: missing opt-in, eval gate, or explicit authorization fails closed", () => {
      const cases: Record<string, string | undefined>[] = [
        { BOLNA_RUN_CANARY: "0" },
        { BOLNA_EVAL_GATE: "FAIL" },
        { BOLNA_CANARY_AUTHORIZE: "0" },
        { BOLNA_CANARY_AUTHORIZED_RUN_ID: "different-run" },
        { BOLNA_CANARY_RUN_ID: "" },
      ];
      for (const change of cases) {
        const result = evaluateCanaryExecutionGate(
          fixtureInput({ env: { ...fixtureEnv(), ...change } }),
        );
        assert.equal(result.status, "FAIL", JSON.stringify(change));
        assert.ok(
          result.reasons.some((reason) =>
            reason.startsWith(
              change.BOLNA_EVAL_GATE
                ? "eval_gate:"
                : change.BOLNA_RUN_CANARY
                  ? "live_opt_in:"
                  : "explicit_authorization:",
            ),
          ),
          JSON.stringify(result.reasons),
        );
      }
    });

    it("eval: a stale or altered plan digest blocks the canary", () => {
      const stale = evaluateCanaryExecutionGate(
        fixtureInput({
          env: { ...fixtureEnv(), BOLNA_CANARY_EXPECTED_PLAN_DIGEST: "b".repeat(64) },
        }),
      );
      assert.equal(stale.status, "FAIL");
      assert.ok(stale.reasons.some((reason) => reason.startsWith("plan_digest_reviewed:")));

      const alteredPlan = { ...fixturePlan(), channels: 3 };
      const altered = evaluateCanaryExecutionGate(
        fixtureInput({
          plan: alteredPlan,
          callRequest: fixtureCallRequest(alteredPlan),
        }),
      );
      assert.equal(altered.status, "FAIL");
    });

    it("eval: failed offline, readiness, or cost gates block the canary", () => {
      for (const overrides of [
        {
          offlineGate: {
            ...fixtureInput().offlineGate,
            status: "FAIL" as const,
          },
        },
        { readiness: { ...fixtureInput().readiness, status: "FAIL" as const } },
        { costGate: { ...fixtureInput().costGate, status: "FAIL" as const } },
        { costGate: { ...fixtureInput().costGate, projectedCanaryCost: 0 } },
      ]) {
        const result = evaluateCanaryExecutionGate(fixtureInput(overrides));
        assert.equal(result.status, "FAIL", JSON.stringify(overrides));
      }
    });

    it("eval: more than one planned call or concurrent call fails closed", () => {
      assert.equal(
        evaluateCanaryExecutionGate(
          fixtureInput({ env: { ...fixtureEnv(), BOLNA_CANARY_PLANNED_CALLS: "2" } }),
        ).status,
        "FAIL",
      );
      assert.equal(
        evaluateCanaryExecutionGate(
          fixtureInput({ env: { ...fixtureEnv(), BOLNA_CANARY_MAX_CONCURRENT: "2" } }),
        ).status,
        "FAIL",
      );
      assert.equal(
        evaluateCanaryExecutionGate(
          fixtureInput({ env: { ...fixtureEnv(), BOLNA_CANARY_PLANNED_CALLS: undefined } }),
        ).status,
        "FAIL",
      );
    });

    it("eval: unpinned, foreign-caller-id, retrying, or guardrail-bypassing calls fail closed", () => {
      const request = fixtureCallRequest();
      const variants: BolnaCallRequest[] = [
        { ...request, agent_version_id: undefined },
        { ...request, agent_version_id: "not-a-uuid" },
        { ...request, from_phone_number: "+911111111111" },
        { ...request, user_data: { ...request.user_data, canary: false } },
        { ...request, retry_config: { max_retries: 2 } },
        { ...request, bypass_call_guardrails: true },
      ];
      for (const callRequest of variants) {
        const result = evaluateCanaryExecutionGate(fixtureInput({ callRequest }));
        assert.equal(result.status, "FAIL", JSON.stringify(callRequest));
        assert.ok(result.reasons.some((reason) => reason.startsWith("call_pinning:")));
      }
    });

    it("eval: gate digest is deterministic and reflects plan and call changes", () => {
      const first = evaluateCanaryExecutionGate(fixtureInput());
      const repeated = evaluateCanaryExecutionGate(fixtureInput());
      const changedCall = evaluateCanaryExecutionGate(
        fixtureInput({
          callRequest: { ...fixtureCallRequest(), agent_version_id: VERSION_ID.replace(/^b/, "c") },
        }),
      );
      assert.equal(first.digest, repeated.digest);
      assert.notEqual(first.digest, changedCall.digest);
    });
  });

  describe("runner", () => {
    it("eval: dry run passes all gates but calls no provider", async () => {
      let placed = 0;
      const result = await runCanaryExecution(fixtureInput(), {
        async placeCall() {
          placed += 1;
          throw new Error("dry run must not reach the provider");
        },
      });
      assert.equal(result.status, "DRY_RUN");
      assert.equal(result.gate.status, "PASS");
      assert.equal(placed, 0);
      assert.equal(result.executionId, undefined);
    });

    it("eval: explicit live mode places exactly one pinned call and returns the execution id", async () => {
      let placed = 0;
      const input = fixtureInput({
        env: { ...fixtureEnv(), BOLNA_CANARY_DRY_RUN: "0" },
      });
      const result = await runCanaryExecution(input, {
        async placeCall(request) {
          placed += 1;
          assert.deepEqual(request, input.callRequest);
          return { message: "queued", status: "queued", execution_id: "exec-step8" };
        },
      });
      assert.equal(result.status, "PLACED");
      assert.equal(placed, 1);
      assert.equal(result.executionId, "exec-step8");
    });

    it("eval: a failed gate never invokes placeCall", async () => {
      let placed = 0;
      const result = await runCanaryExecution(
        fixtureInput({ env: { ...fixtureEnv(), BOLNA_EVAL_GATE: "FAIL" } }),
        {
          async placeCall() {
            placed += 1;
            throw new Error("failed gate must not reach the provider");
          },
        },
      );
      assert.equal(result.status, "FAIL");
      assert.equal(placed, 0);
      assert.equal(result.executionId, undefined);
    });
  });

  describe("environment plan binding", () => {
    it("eval: canary plan built from env matches the reviewed plan digest", () => {
      const envPlan = canaryTrunkPlanFromEnv(fixtureEnv());
      assert.equal(canaryTrunkPlanDigest(envPlan), canaryTrunkPlanDigest(fixturePlan()));
      assert.equal(envPlan.numbers[0]?.e164, FROM);
      assert.equal(envPlan.gateways[0]?.host, "198.51.100.10");
    });

    it("eval: unsafe carrier inputs in env fail before a plan digest can be reviewed", () => {
      assert.throws(
        () =>
          canaryTrunkPlanFromEnv({
            ...fixtureEnv(),
            BOLNA_TRUNK_CARRIER_IPS: "10.0.0.0/8",
          }),
        BolnaConfigError,
      );
      assert.throws(
        () =>
          canaryTrunkPlanFromEnv({
            ...fixtureEnv(),
            BOLNA_TRUNK_NUMBERS: "9876543210",
          }),
        BolnaConfigError,
      );
    });
  });
});
