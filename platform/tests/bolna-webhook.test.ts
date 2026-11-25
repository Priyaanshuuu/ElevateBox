import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BolnaConfigError } from "../lib/bolna/errors.ts";
import {
  buildWebhookDedupeKey,
  DEFAULT_BOLNA_WEBHOOK_SOURCE_IPS,
  isAllowedWebhookSource,
  isTerminalBolnaStatus,
  isWebhookUrlTokenValid,
  loadWebhookConfig,
  mapBolnaStatusToCallStatus,
  parseBolnaWebhookPayload,
  sanitizeWebhookHeaders,
} from "../lib/bolna/index.ts";
import { ingestBolnaWebhook } from "../lib/bolna/webhook-service.ts";
import type {
  BolnaWebhookStore,
  CreateBolnaEventInput,
  UpsertBolnaExecutionInput,
  UpsertCallInput,
  UpdateLeadInput,
} from "../lib/bolna/webhook-store.ts";

interface StoredEvent {
  id: string;
  input: CreateBolnaEventInput;
  processedAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
}

interface StoredExecution extends UpsertBolnaExecutionInput {
  id: string;
}

interface StoredCall extends UpsertCallInput {
  id: string;
}

interface StoredLead {
  id: string;
  phoneNumber: string;
  data: UpdateLeadInput;
}

class MemoryWebhookStore implements BolnaWebhookStore {
  events: StoredEvent[] = [];
  executions: StoredExecution[] = [];
  calls: StoredCall[] = [];
  leads: StoredLead[] = [];
  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  async findEventByDedupeKey(dedupeKey: string) {
    const event = this.events.find((item) => item.input.dedupeKey === dedupeKey);
    return event ? { id: event.id } : null;
  }

  async findExecution(executionId: string) {
    const execution = this.executions.find((item) => item.executionId === executionId);
    return execution ? { id: execution.id, status: execution.status } : null;
  }

  async upsertExecution(input: UpsertBolnaExecutionInput) {
    const existing = this.executions.find((item) => item.executionId === input.executionId);
    if (existing) {
      Object.assign(existing, input);
      return { id: existing.id };
    }
    const execution: StoredExecution = { ...input, id: this.nextId("execution") };
    this.executions.push(execution);
    return { id: execution.id };
  }

  async createEvent(input: CreateBolnaEventInput) {
    if (this.events.some((item) => item.input.dedupeKey === input.dedupeKey)) {
      return null;
    }
    const id = this.nextId("event");
    this.events.push({ id, input });
    return id;
  }

  async findCallByExecutionRef(executionRef: string) {
    const call = this.calls.find((item) => item.bolnaExecutionRef === executionRef);
    return call ? { id: call.id } : null;
  }

  async createCall(input: UpsertCallInput) {
    const call: StoredCall = { ...input, id: this.nextId("call") };
    this.calls.push(call);
    return { id: call.id };
  }

  async updateCall(callId: string, input: Partial<UpsertCallInput>) {
    const call = this.calls.find((item) => item.id === callId);
    if (call) Object.assign(call, input);
  }

  async getOrCreateLead(phoneNumber: string) {
    const existing = this.leads.find((item) => item.phoneNumber === phoneNumber);
    if (existing) return { id: existing.id };
    const lead: StoredLead = {
      id: this.nextId("lead"),
      phoneNumber,
      data: {},
    };
    this.leads.push(lead);
    return { id: lead.id };
  }

  async updateLead(leadId: string, input: UpdateLeadInput) {
    const lead = this.leads.find((item) => item.id === leadId);
    if (lead) Object.assign(lead.data, input);
  }

  async markEventProcessed(eventId: string) {
    const event = this.events.find((item) => item.id === eventId);
    if (event) event.processedAt = new Date("2026-11-25T12:00:00Z");
  }

  async markEventFailed(eventId: string, message: string) {
    const event = this.events.find((item) => item.id === eventId);
    if (event) {
      event.failedAt = new Date("2026-11-25T12:00:00Z");
      event.errorMessage = message;
    }
  }
}

function completedPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "exec-1",
    agent_id: "agent-1",
    agent_version_id: "version-1",
    status: "completed",
    termination_reason: "user_hung_up",
    conversation_duration: 42,
    total_cost: 3.23,
    transcript: "assistant: Hi\nuser: We need a store",
    summary: "Customer is interested in an ecommerce store.",
    user_number: "+919876543210",
    agent_number: "+918035739222",
    telephony_data: {
      duration: 42,
      to_number: "+919876543210",
      from_number: "+918035739222",
      recording_url: "https://api.bolna.ai/recordings/call/exec-1",
      call_type: "outbound",
      provider: "plivo",
      provider_call_id: "ca-1",
    },
    cost_breakdown: { platform: 2, network: 1.23 },
    extracted_data: {
      General: { "Lead Intent": { subjective: "HOT" } },
      business: "Acme Store",
      product_count: 120,
      budget: "$50,000",
      timeline: "4 weeks",
      features: ["catalog", "checkout"],
    },
    created_at: "2026-11-25T10:00:00Z",
    updated_at: "2026-11-25T10:01:00Z",
    ...overrides,
  };
}

describe("Step 2 — Bolna webhook evals", () => {
  it("eval: normalizes a completed execution and projects finalized fields", async () => {
    const store = new MemoryWebhookStore();
    const result = await ingestBolnaWebhook({
      payload: completedPayload(),
      store,
      headers: { "x-bolna-event-id": "event-1", authorization: "Bearer secret" },
      sourceIp: "13.203.39.153",
      now: new Date("2026-11-25T12:00:00Z"),
    });

    assert.equal(result.outcome, "accepted");
    assert.equal(result.projected, true);
    assert.equal(store.executions.length, 1);
    assert.equal(store.executions[0]?.status, "completed");
    assert.equal(store.executions[0]?.totalCost, 3.23);
    assert.equal(store.executions[0]?.recordingUrl, "https://api.bolna.ai/recordings/call/exec-1");
    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0]?.status, "COMPLETED");
    assert.equal(store.leads[0]?.data.intent, "HOT");
    assert.equal(store.leads[0]?.data.business, "Acme Store");
    assert.equal(store.leads[0]?.data.productCount, 120);
    assert.equal(store.leads[0]?.data.budget, 50000);
    assert.deepEqual(store.leads[0]?.data.features, ["catalog", "checkout"]);
    assert.ok(store.events[0]?.processedAt);
  });

  it("eval: duplicate replay does not duplicate side effects", async () => {
    const store = new MemoryWebhookStore();
    const payload = completedPayload();

    const first = await ingestBolnaWebhook({ payload, store });
    const second = await ingestBolnaWebhook({ payload, store });

    assert.equal(first.outcome, "accepted");
    assert.equal(second.outcome, "duplicate");
    assert.equal(store.events.length, 1);
    assert.equal(store.executions.length, 1);
    assert.equal(store.calls.length, 1);
    assert.equal(store.leads.length, 1);
  });

  it("eval: dedupe key ignores object key order", () => {
    const first = {
      id: "exec-1",
      status: "completed",
      total_cost: 3.23,
      nested: { a: 1, b: 2 },
    };
    const reordered = {
      nested: { b: 2, a: 1 },
      total_cost: 3.23,
      status: "completed",
      id: "exec-1",
    };

    const firstKey = buildWebhookDedupeKey(first, parseBolnaWebhookPayload(first));
    const secondKey = buildWebhookDedupeKey(reordered, parseBolnaWebhookPayload(reordered));
    assert.equal(firstKey, secondKey);
  });

  it("eval: call-disconnected never finalizes cost, transcript, recording, or call status", async () => {
    const store = new MemoryWebhookStore();
    const payload = completedPayload({
      status: "call-disconnected",
      termination_reason: null,
    });

    await ingestBolnaWebhook({ payload, store });

    assert.equal(isTerminalBolnaStatus("call-disconnected"), false);
    assert.equal(mapBolnaStatusToCallStatus("call-disconnected"), null);
    assert.equal(store.calls.length, 0);
    assert.equal(store.executions[0]?.totalCost, undefined);
    assert.equal(store.executions[0]?.transcript, undefined);
    assert.equal(store.executions[0]?.recordingUrl, undefined);
    assert.equal(store.leads.length, 0);
  });

  it("eval: a late non-terminal event cannot downgrade a terminal projection", async () => {
    const store = new MemoryWebhookStore();

    await ingestBolnaWebhook({ payload: completedPayload(), store });
    const late = await ingestBolnaWebhook({
      payload: completedPayload({ status: "in-progress", total_cost: 0 }),
      store,
    });

    assert.equal(late.outcome, "accepted");
    assert.equal(late.projected, false);
    assert.equal(store.executions[0]?.status, "completed");
    assert.equal(store.calls[0]?.status, "COMPLETED");
    assert.equal(store.calls.length, 1);
  });

  it("eval: a repeated terminal status refreshes finalized fields without duplicate side effects", async () => {
    const store = new MemoryWebhookStore();

    await ingestBolnaWebhook({ payload: completedPayload(), store });
    const refresh = await ingestBolnaWebhook({
      payload: completedPayload({ total_cost: 8.5, transcript: "assistant: Updated" }),
      store,
    });

    assert.equal(refresh.outcome, "accepted");
    assert.equal(refresh.projected, true);
    assert.equal(store.executions.length, 1);
    assert.equal(store.executions[0]?.status, "completed");
    assert.equal(store.executions[0]?.totalCost, 8.5);
    assert.equal(store.events.length, 2);
    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0]?.transcript, "assistant: Updated");
  });

  it("eval: missing phone number stores the event without creating lead or call", async () => {
    const store = new MemoryWebhookStore();
    const payload = completedPayload();
    delete (payload as Record<string, unknown>).user_number;
    delete (payload as Record<string, unknown>).telephony_data;

    const result = await ingestBolnaWebhook({ payload, store });

    assert.equal(result.outcome, "accepted");
    assert.equal(store.events.length, 1);
    assert.equal(store.executions.length, 1);
    assert.equal(store.calls.length, 0);
    assert.equal(store.leads.length, 0);
  });

  it("eval: terminal failure statuses map to FAILED and completed maps to COMPLETED", () => {
    const failures = [
      "no-answer",
      "busy",
      "failed",
      "canceled",
      "cancelled",
      "stopped",
      "error",
      "balance-low",
      "aborted",
    ];

    for (const status of failures) {
      assert.equal(isTerminalBolnaStatus(status), true, status);
      assert.equal(mapBolnaStatusToCallStatus(status), "FAILED", status);
    }

    assert.equal(isTerminalBolnaStatus("completed"), true);
    assert.equal(mapBolnaStatusToCallStatus("completed"), "COMPLETED");
    assert.equal(isTerminalBolnaStatus("queued"), false);
    assert.equal(mapBolnaStatusToCallStatus("queued"), "INITIATED");
  });

  it("eval: workflow execution webhook shape is accepted", () => {
    const normalized = parseBolnaWebhookPayload({
      event: "execution.terminal",
      schema_version: 1,
      execution_id: "exec:8f14e45f:CUST-9931",
      status: "completed",
      outcome: "success",
      occurred_at: "2026-11-25T11:02:41Z",
      trail: [],
    });

    assert.equal(normalized.executionId, "exec:8f14e45f:CUST-9931");
    assert.equal(normalized.eventType, "execution.terminal");
    assert.equal(normalized.isTerminal, true);
    assert.equal(normalized.occurredAt?.toISOString(), "2026-11-25T11:02:41.000Z");
  });

  it("eval: webhook URL token verification rejects missing and wrong tokens", () => {
    const token = "a".repeat(64);
    const config = loadWebhookConfig({
      BOLNA_WEBHOOK_URL_TOKEN: token,
      BOLNA_WEBHOOK_VERIFY_EXECUTION: "0",
    });
    assert.equal(isWebhookUrlTokenValid(token, config), true);
    assert.equal(isWebhookUrlTokenValid("b".repeat(64), config), false);
    assert.equal(isWebhookUrlTokenValid(undefined, config), false);
    assert.throws(
      () => loadWebhookConfig({ BOLNA_WEBHOOK_URL_TOKEN: "short" }),
      BolnaConfigError,
    );
  });

  it("eval: webhook config requires a URL token outside explicit local mode", () => {
    assert.throws(() => loadWebhookConfig({}), BolnaConfigError);
    const local = loadWebhookConfig({ BOLNA_WEBHOOK_ALLOW_UNAUTHENTICATED: "1" });
    assert.equal(local.allowUnauthenticated, true);
    assert.equal(local.verifyExecution, false);
    assert.deepEqual(local.allowedSourceIps, []);
    assert.equal(isWebhookUrlTokenValid("anything", local), true);
  });

  it("eval: production config defaults to Bolna source IPs and execution verification", () => {
    const config = loadWebhookConfig({ BOLNA_WEBHOOK_URL_TOKEN: "a".repeat(64) });
    assert.deepEqual(config.allowedSourceIps, [...DEFAULT_BOLNA_WEBHOOK_SOURCE_IPS]);
    assert.equal(config.verifyExecution, true);
    assert.equal(isAllowedWebhookSource("13.203.39.153", config), true);
    assert.equal(
      isAllowedWebhookSource("10.0.0.1", config),
      false,
    );
  });

  it("eval: sanitized headers drop authorization, cookies, and API keys", () => {
    const sanitized = sanitizeWebhookHeaders({
      authorization: "Bearer should-not-store",
      cookie: "session=secret",
      "x-api-key": "secret",
      "x-webhook-secret": "secret",
      "x-bolna-event-id": "event-1",
      "content-type": "application/json",
    });

    assert.deepEqual(sanitized, {
      "x-bolna-event-id": "event-1",
      "content-type": "application/json",
    });
  });

  it("eval: custom source IP allowlist rejects unknown IPs", () => {
    const config = loadWebhookConfig({
      BOLNA_WEBHOOK_URL_TOKEN: "a".repeat(64),
      BOLNA_WEBHOOK_IP_ALLOWLIST: "13.203.39.153, 13.126.9.249",
      BOLNA_WEBHOOK_VERIFY_EXECUTION: "0",
    });

    assert.equal(isAllowedWebhookSource("13.203.39.153", config), true);
    assert.equal(isAllowedWebhookSource("13.202.133.53", config), false);
    assert.equal(isAllowedWebhookSource("10.0.0.1", config), false);
    assert.equal(isAllowedWebhookSource(null, config), false);
  });
});
