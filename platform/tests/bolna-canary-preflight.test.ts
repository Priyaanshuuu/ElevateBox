import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canaryTrunkPlanDigest,
  runCanaryPreflight,
} from "../lib/bolna/index.ts";

const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FROM = "+918035739222";
const RECIPIENT = "+919876543210";
const RUN_ID = "canary-run-1";

function fixturePlan(gateway = "198.51.100.10") {
  return {
    trunkName: "ElevateBox canary SIP trunk",
    description: undefined,
    preset: "custom" as const,
    inboundEnabled: true,
    outboundEnabled: true,
    channels: 2,
    defaultInboundAgentId: AGENT_ID,
    transport: "udp" as const,
    outboundLeadingPlusEnabled: false,
    codecs: "PCMU,PCMA",
    gateways: [{ host: gateway, port: 5060, priority: 0 }],
    ipAcls: ["198.51.100.0/24"],
    numbers: [{ e164: FROM, destinationKey: "918035739222", agentId: AGENT_ID }],
    authUsername: undefined,
    authPasswordEnv: undefined,
  };
}

function fixtureEnv(gateway = "198.51.100.10"): Record<string, string | undefined> {
  return {
    BOLNA_RUN_CANARY: "1",
    BOLNA_EVAL_GATE: "PASS",
    BOLNA_CANARY_AUTHORIZE: "1",
    BOLNA_CANARY_RUN_ID: RUN_ID,
    BOLNA_CANARY_AUTHORIZED_RUN_ID: RUN_ID,
    BOLNA_CANARY_EXPECTED_PLAN_DIGEST: canaryTrunkPlanDigest(fixturePlan(gateway)),
    BOLNA_CANARY_DRY_RUN: "1",
    BOLNA_TRUNK_ID: "trunk-fixture",
    BOLNA_TRUNK_DEFAULT_AGENT_ID: AGENT_ID,
    BOLNA_TRUNK_INBOUND_AGENT_ID: AGENT_ID,
    BOLNA_TRUNK_GATEWAYS: `${gateway}:5060:0`,
    BOLNA_TRUNK_CARRIER_IPS: "198.51.100.0/24",
    BOLNA_TRUNK_NUMBERS: FROM,
    BOLNA_AGENT_ID: AGENT_ID,
    BOLNA_CANARY_VERSION_ID: VERSION_ID,
    BOLNA_CANARY_RECIPIENT_PHONE: RECIPIENT,
    BOLNA_CANARY_FROM_PHONE: FROM,
    BOLNA_CANARY_LANGUAGE: "en",
    BOLNA_CANARY_CALL_CAP_SECONDS: "300",
    BOLNA_CANARY_PLANNED_CALLS: "1",
    BOLNA_CANARY_MAX_CALLS: "2",
    BOLNA_CANARY_MAX_CONCURRENT: "1",
    BOLNA_CANARY_PREFERRED_MODELS: "1",
    BOLNA_CANARY_CURRENCY: "USD",
    BOLNA_VOICE_AI_PER_MINUTE: "0.1",
    BOLNA_PLATFORM_FEE_PER_MINUTE: "0.05",
    BOLNA_CARRIER_PER_MINUTE: "0.02",
    BOLNA_CARRIER_CONNECTION_FEE: "0.01",
    BOLNA_CARRIER_MINIMUM_MINUTES: "0",
    BOLNA_CARRIER_BILLING_INCREMENT_SECONDS: "60",
    BOLNA_CANARY_MAX_COST_PER_CALL: "1",
    BOLNA_CANARY_MAX_COST: "1",
  };
}

describe("Step 12 — offline live-canary preflight evals", () => {
  it("eval: a complete non-secret packet is ready for review without a call", async () => {
    const report = await runCanaryPreflight({ env: fixtureEnv() });
    assert.equal(report.status, "READY_FOR_REVIEW", report.reasons.join(" | "));
    assert.equal(report.checks.length, 8);
    assert.ok(report.checks.every((item) => item.status === "PASS"));
    assert.equal(report.reasons.length, 0);
    assert.equal(report.missingInputs.length, 0);
    assert.equal(report.planDigest, canaryTrunkPlanDigest(fixturePlan()));
    assert.equal(report.cost?.currency, "USD");
    assert.ok(report.cost && report.cost.projectedCanaryCost > 0);
    assert.equal(report.networkRequests, 0);
    assert.equal(report.liveCallPlaced, false);
  });

  it("eval: missing explicit authorization blocks the packet", async () => {
    const report = await runCanaryPreflight({
      env: { ...fixtureEnv(), BOLNA_CANARY_AUTHORIZE: "0" },
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.reasons.some((reason) => reason.startsWith("authorization_fields:")));
    assert.equal(report.liveCallPlaced, false);
  });

  it("eval: dry-run cannot be disabled inside the offline preflight", async () => {
    const report = await runCanaryPreflight({
      env: { ...fixtureEnv(), BOLNA_CANARY_DRY_RUN: "0" },
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.reasons.some((reason) => reason.startsWith("dry_run_default:")));
  });

  it("eval: the packet passes with poisoned network and never prints secrets", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network is disabled for Step 12 preflight");
    }) as unknown as typeof fetch;
    try {
      const report = await runCanaryPreflight({
        env: {
          ...fixtureEnv(),
          DATABASE_URL: "super-secret-database-url",
          BOLNA_API_KEY: "super-secret-api-key",
          BOLNA_TRUNK_AUTH_PASSWORD: "super-secret-carrier-password",
          BOLNA_TOOL_TOKEN: "super-secret-tool-token",
        },
      });
      assert.equal(report.status, "READY_FOR_REVIEW", report.reasons.join(" | "));
      const serialized = JSON.stringify(report);
      assert.ok(!serialized.includes("super-secret-database-url"));
      assert.ok(!serialized.includes("super-secret-api-key"));
      assert.ok(!serialized.includes("super-secret-carrier-password"));
      assert.ok(!serialized.includes("super-secret-tool-token"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("eval: digest is deterministic and changes with the reviewed plan", async () => {
    const first = await runCanaryPreflight({ env: fixtureEnv() });
    const second = await runCanaryPreflight({ env: fixtureEnv() });
    const changed = await runCanaryPreflight({ env: fixtureEnv("198.51.100.11") });
    assert.equal(first.digest, second.digest);
    assert.notEqual(first.digest, changed.digest);
  });

  it("eval: full phone numbers are masked in the review packet", async () => {
    const report = await runCanaryPreflight({ env: fixtureEnv() });
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes(RECIPIENT));
    assert.ok(!serialized.includes(FROM));
    assert.ok(serialized.includes("****"));
  });

  it("eval: empty inputs report the missing non-secret values and stay blocked", async () => {
    const report = await runCanaryPreflight({ env: {} });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.reasons.length >= 4);
    assert.ok(report.missingInputs.includes("BOLNA_TRUNK_GATEWAYS"));
    assert.ok(report.missingInputs.includes("BOLNA_CANARY_VERSION_ID"));
    assert.ok(report.missingInputs.includes("BOLNA_CANARY_MAX_COST"));
    assert.equal(report.maskedCall, null);
    assert.equal(report.liveCallPlaced, false);
  });
});
