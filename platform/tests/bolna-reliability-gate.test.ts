import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MemoryWebhookStore,
  RELIABILITY_GATE_CHECKS,
  ReliabilityStoreError,
  runReliabilityGate,
} from "../lib/bolna/index.ts";
import { ingestBolnaWebhook } from "../lib/bolna/webhook-service.ts";

const PAYLOAD = {
  id: "step10-test-execution",
  status: "completed",
  conversation_duration: 120,
  total_cost: 2.5,
  transcript: "User: hello\nAgent: hi",
  summary: "Interested buyer.",
  user_number: "+919876543210",
  created_at: "2026-11-26T10:00:00Z",
  updated_at: "2026-11-26T10:02:00Z",
};

describe("Step 10 — offline reliability, cost, and load gate evals", () => {
  it("eval: the default gate passes all thirteen named checks", async () => {
    const report = await runReliabilityGate();
    assert.equal(report.status, "PASS");
    assert.deepEqual(
      report.checks.map((item) => item.name),
      [...RELIABILITY_GATE_CHECKS],
    );
    assert.ok(report.checks.every((item) => item.status === "PASS"));
    assert.equal(report.reasons.length, 0);
    assert.equal(report.networkRequests, 0);
    assert.equal(report.liveChecksRequired.length, 3);
  });

  it("eval: gate digest is deterministic and changes with load settings", async () => {
    const first = await runReliabilityGate();
    const second = await runReliabilityGate();
    const changed = await runReliabilityGate({ webhookBurst: 8, toolBurst: 4 });
    assert.equal(first.digest, second.digest);
    assert.notEqual(first.digest, changed.digest);
    assert.equal(changed.metrics.webhookBurst, 8);
    assert.equal(changed.metrics.toolBurst, 4);
  });

  it("eval: invalid burst limits fail closed before any scenario runs", async () => {
    const report = await runReliabilityGate({ webhookBurst: 1 });
    assert.equal(report.status, "FAIL");
    assert.equal(report.checks.length, 1);
    assert.equal(report.checks[0]?.name, "input_validation");
    assert.match(report.checks[0]?.detail ?? "", /webhookBurst/);
  });

  it("eval: the gate passes with every network call poisoned", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network is disabled for Step 10");
    }) as unknown as typeof fetch;
    try {
      const report = await runReliabilityGate();
      assert.equal(report.status, "PASS");
      assert.equal(report.networkRequests, 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("eval: replay and key-order checks keep exactly one event and call", async () => {
    const report = await runReliabilityGate();
    const replay = report.checks.find((item) => item.name === "webhook_replay");
    const keyOrder = report.checks.find((item) => item.name === "key_order_dedupe");
    assert.equal(replay?.status, "PASS");
    assert.match(replay?.detail ?? "", /one accepted delivery/);
    assert.equal(keyOrder?.status, "PASS");
    assert.equal(report.metrics.webhookAccepted, 2);
    assert.equal(report.metrics.webhookDuplicates, 32);
  });

  it("eval: out-of-order and terminal refresh checks protect finalized fields", async () => {
    const report = await runReliabilityGate();
    const outOfOrder = report.checks.find((item) => item.name === "out_of_order");
    const refresh = report.checks.find((item) => item.name === "terminal_refresh");
    assert.equal(outOfOrder?.status, "PASS");
    assert.match(outOfOrder?.detail ?? "", /did not downgrade/);
    assert.equal(refresh?.status, "PASS");
    assert.match(refresh?.detail ?? "", /refreshed cost/);
  });

  it("eval: non-terminal and missing-phone events never create business records", async () => {
    const report = await runReliabilityGate();
    const nonTerminal = report.checks.find((item) => item.name === "non_terminal_guard");
    const missingPhone = report.checks.find((item) => item.name === "missing_phone");
    assert.equal(nonTerminal?.status, "PASS");
    assert.equal(missingPhone?.status, "PASS");
  });

  it("eval: a processed-event failure is marked and recovered by duplicate replay", async () => {
    const report = await runReliabilityGate();
    const recovery = report.checks.find((item) => item.name === "store_failure_recovery");
    assert.equal(recovery?.status, "PASS");
    assert.equal(report.metrics.failedEvents, 1);
  });

  it("eval: concurrent webhook load produces exactly one call", async () => {
    const report = await runReliabilityGate({ webhookBurst: 48 });
    const load = report.checks.find((item) => item.name === "concurrent_webhook_load");
    assert.equal(load?.status, "PASS");
    assert.match(load?.detail ?? "", /48 concurrent deliveries/);
    assert.equal(report.metrics.webhookAccepted, 2);
    assert.equal(report.metrics.webhookDuplicates, 48);
    assert.equal(report.metrics.calls, 2);
  });

  it("eval: concurrent tool load executes once and pending claims return 202", async () => {
    const report = await runReliabilityGate({ toolBurst: 24 });
    const load = report.checks.find((item) => item.name === "concurrent_tool_load");
    const pending = report.checks.find((item) => item.name === "tool_pending_claim");
    assert.equal(load?.status, "PASS");
    assert.equal(pending?.status, "PASS");
    assert.equal(report.metrics.toolExecutions, 1);
    assert.equal(report.metrics.toolDuplicates, 23);
    assert.equal(report.metrics.toolPending, 1);
  });

  it("eval: cost gate passes with fixture rates and budget breaches fail closed", async () => {
    const report = await runReliabilityGate();
    const cost = report.checks.find((item) => item.name === "cost_gate");
    const budget = report.checks.find((item) => item.name === "budget_failure");
    assert.equal(cost?.status, "PASS");
    assert.equal(budget?.status, "PASS");
    assert.equal(report.metrics.currency, "USD");
    assert.ok(report.metrics.worstCaseCostPerCall > 0);
    assert.equal(report.metrics.projectedCanaryCost, report.metrics.worstCaseCostPerCall);
  });

  it("eval: the exported memory store records failures without duplicating side effects", async () => {
    const store = new MemoryWebhookStore({ failProcessedEvents: true });
    await assert.rejects(ingestBolnaWebhook({ payload: PAYLOAD, store }), ReliabilityStoreError);
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.errorMessage, new ReliabilityStoreError("").name);
    store.failProcessedEvents = false;
    const retry = await ingestBolnaWebhook({ payload: PAYLOAD, store });
    assert.equal(retry.outcome, "duplicate");
    assert.equal(store.calls.length, 1);
    assert.equal(store.snapshot().failedEvents, 1);
  });
});
