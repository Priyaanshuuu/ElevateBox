import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBolnaOperationsSummary,
  formatDashboardCost,
  formatDashboardJson,
  projectExecutionDetail,
  projectExecutionListItem,
  projectToolInvocation,
  projectWebhookEvent,
  sanitizeDashboardHeaders,
  type ExecutionProjectionInput,
  type ToolInvocationProjectionInput,
  type WebhookEventProjectionInput,
} from "../lib/bolna/dashboard-projection.ts";

const EXECUTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function execution(overrides: Partial<ExecutionProjectionInput> = {}): ExecutionProjectionInput {
  return {
    id: "execution-row-1",
    executionId: EXECUTION_ID,
    agentId: "agent-1",
    agentVersionId: VERSION_ID,
    batchId: null,
    status: "completed",
    terminationReason: null,
    errorMessage: null,
    userNumber: "+919876543210",
    agentNumber: "+911122233344",
    callType: "outbound",
    provider: "twilio",
    providerCallId: "CA1234567890",
    recordingUrl: "https://recordings.example.test/call.wav",
    conversationDuration: 92.5,
    totalCost: 0.4237,
    costBreakdown: { voiceAiCost: 0.1, bolnaPlatformCost: 0.2, currency: "USD" },
    transcript: "User: hello\nAgent: hi",
    summary: "Qualified prospect.",
    extractedData: { intent: "HOT", budget: 500000 },
    nodeExtractedData: { qualification: { confidence: 0.9 } },
    telephonyData: { provider: "twilio", sipStatus: "200" },
    occurredAt: new Date("2026-11-26T10:00:00.000Z"),
    bolnaCreatedAt: new Date("2026-11-26T09:58:00.000Z"),
    bolnaUpdatedAt: new Date("2026-11-26T10:02:00.000Z"),
    createdAt: new Date("2026-11-26T10:00:00.000Z"),
    updatedAt: new Date("2026-11-26T10:02:00.000Z"),
    ...overrides,
  };
}

function event(overrides: Partial<WebhookEventProjectionInput> = {}): WebhookEventProjectionInput {
  return {
    id: "event-row-1",
    dedupeKey: "dedupe-1",
    executionId: EXECUTION_ID,
    eventType: "execution.completed",
    status: "completed",
    sourceIp: "203.0.113.10",
    payload: { status: "completed" },
    headers: { "x-source-ip": "203.0.113.10", authorization: "Bearer secret" },
    receivedAt: new Date("2026-11-26T10:02:00.000Z"),
    processedAt: new Date("2026-11-26T10:02:01.000Z"),
    failedAt: null,
    errorMessage: null,
    ...overrides,
  };
}

function invocation(overrides: Partial<ToolInvocationProjectionInput> = {}): ToolInvocationProjectionInput {
  return {
    id: "invocation-row-1",
    dedupeKey: "tool-dedupe-1",
    toolName: "schedule_callback",
    executionId: EXECUTION_ID,
    status: "completed",
    result: { status: "scheduled" },
    errorMessage: null,
    createdAt: new Date("2026-11-26T10:01:00.000Z"),
    updatedAt: new Date("2026-11-26T10:01:01.000Z"),
    ...overrides,
  };
}

describe("Step 9 dashboard projection", () => {
  it("maps a terminal raw status to the internal call status and short ids", () => {
    const item = projectExecutionListItem(execution());
    assert.equal(item.status, "completed");
    assert.equal(item.callStatus, "COMPLETED");
    assert.equal(item.terminal, true);
    assert.equal(item.callType, "outbound");
    assert.equal(item.shortExecutionId, EXECUTION_ID.slice(-8));
    assert.equal(item.agentVersion, VERSION_ID.slice(-8));
    assert.equal(item.durationSeconds, 92.5);
    assert.equal(item.totalCost, 0.4237);
  });

  it("does not turn call-disconnected into a terminal or failed call", () => {
    const item = projectExecutionListItem(execution({ status: "call-disconnected" }));
    assert.equal(item.terminal, false);
    assert.equal(item.callStatus, null);
  });

  it("exposes every normalized execution field in the detail projection", () => {
    const detail = projectExecutionDetail({
      execution: execution(),
      events: [event()],
      invocations: [invocation()],
      linkedCallId: "call-row-1",
    });
    assert.equal(detail.agentId, "agent-1");
    assert.equal(detail.providerCallId, "CA1234567890");
    assert.equal(detail.recordingUrl, "https://recordings.example.test/call.wav");
    assert.equal(detail.linkedCallId, "call-row-1");
    assert.equal(detail.eventCount, 1);
    assert.equal(detail.toolInvocationCount, 1);
    assert.match(detail.costBreakdownText, /voiceAiCost/);
    assert.match(detail.extractedDataText, /HOT/);
    assert.match(detail.nodeExtractedDataText, /confidence/);
    assert.match(detail.telephonyDataText, /sipStatus/);
    assert.equal(detail.transcript, "User: hello\nAgent: hi");
    assert.equal(detail.summary, "Qualified prospect.");
  });

  it("uses explicit empty-state copy for missing transcript and summary", () => {
    const detail = projectExecutionDetail({
      execution: execution({ transcript: "", summary: null }),
      events: [],
      invocations: [],
    });
    assert.match(detail.transcript, /No transcript/);
    assert.match(detail.summary, /No summary/);
    assert.equal(detail.eventCount, 0);
    assert.equal(detail.toolInvocationCount, 0);
  });

  it("redacts sensitive headers and preserves safe ones for event inspection", () => {
    const headers = sanitizeDashboardHeaders({
      authorization: "Bearer secret",
      "x-api-key": "key-123",
      cookie: "session=abc",
      "x-webhook-token": "token-123",
      "X-Source-Ip": "203.0.113.10",
      "x-attempt": ["1", "2"],
    });
    assert.deepEqual(headers, { "X-Source-Ip": "203.0.113.10", "x-attempt": "1, 2" });
    const projected = projectWebhookEvent(event());
    assert.deepEqual(projected.headers, { "x-source-ip": "203.0.113.10" });
    assert.equal(projected.hasPayload, true);
    assert.match(projected.payloadText, /completed/);
  });

  it("renders tool results and errors without losing status", () => {
    const ok = projectToolInvocation(invocation());
    assert.equal(ok.toolName, "schedule_callback");
    assert.equal(ok.status, "completed");
    assert.match(ok.resultText, /scheduled/);
    const failed = projectToolInvocation(invocation({ status: "failed", errorMessage: "denied" }));
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorMessage, "denied");
  });

  it("truncates large JSON payloads deterministically", () => {
    const value = { data: "x".repeat(5000) };
    const projected = formatDashboardJson(value, 100);
    assert.equal(projected.length, 101);
    assert.ok(projected.endsWith("…"));
    assert.equal(formatDashboardJson(null), "—");
  });

  it("sums recorded cost and counts failures from normalized rows only", () => {
    const summary = buildBolnaOperationsSummary({
      executions: [
        execution(),
        execution({ id: "execution-row-2", executionId: "other", status: "no-answer", totalCost: 0.1 }),
        execution({ id: "execution-row-3", executionId: "third", status: "call-disconnected", errorMessage: null, totalCost: null }),
      ],
      events: [event(), event({ id: "event-row-2", failedAt: new Date(), errorMessage: "retry" })],
      invocations: [invocation(), invocation({ id: "invocation-row-2", status: "failed" })],
    });
    assert.equal(summary.totalExecutions, 3);
    assert.equal(summary.terminalExecutions, 2);
    assert.equal(summary.failedExecutions, 1);
    assert.equal(summary.totalWebhookEvents, 2);
    assert.equal(summary.failedWebhookEvents, 1);
    assert.equal(summary.totalToolInvocations, 2);
    assert.equal(summary.failedToolInvocations, 1);
    assert.equal(summary.totalCost, 0.5237);
    assert.equal(formatDashboardCost(summary.totalCost), "0.52");
  });

  it("formats missing and non-finite costs as an empty value", () => {
    assert.equal(formatDashboardCost(null), "—");
    assert.equal(formatDashboardCost(Number.NaN), "—");
  });
});
