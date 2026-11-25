import { isTerminalBolnaStatus, mapBolnaStatusToCallStatus } from "./webhook.ts";

export interface ExecutionProjectionInput {
  id: string;
  executionId: string;
  agentId: string | null;
  agentVersionId: string | null;
  batchId: string | null;
  status: string;
  terminationReason: string | null;
  errorMessage: string | null;
  userNumber: string | null;
  agentNumber: string | null;
  callType: string | null;
  provider: string | null;
  providerCallId: string | null;
  recordingUrl: string | null;
  conversationDuration: number | null;
  totalCost: number | null;
  costBreakdown: unknown;
  transcript: string | null;
  summary: string | null;
  extractedData: unknown;
  nodeExtractedData: unknown;
  telephonyData: unknown;
  occurredAt: Date | string | null;
  bolnaCreatedAt: Date | string | null;
  bolnaUpdatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface WebhookEventProjectionInput {
  id: string;
  dedupeKey: string;
  executionId: string;
  eventType: string | null;
  status: string | null;
  sourceIp: string | null;
  payload: unknown;
  headers: unknown;
  receivedAt: Date | string;
  processedAt: Date | string | null;
  failedAt: Date | string | null;
  errorMessage: string | null;
}

export interface ToolInvocationProjectionInput {
  id: string;
  dedupeKey: string;
  toolName: string;
  executionId: string | null;
  status: string;
  result: unknown;
  errorMessage: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ExecutionListItem {
  id: string;
  executionId: string;
  shortExecutionId: string;
  status: string;
  callStatus: string | null;
  terminal: boolean;
  callType: string;
  userNumber: string;
  agentVersion: string;
  durationSeconds: number | null;
  totalCost: number | null;
  occurredAt: Date | string;
}

export interface ExecutionDetail extends ExecutionListItem {
  agentId: string;
  batchId: string;
  terminationReason: string;
  errorMessage: string;
  agentNumber: string;
  provider: string;
  providerCallId: string;
  recordingUrl: string;
  costBreakdownText: string;
  extractedDataText: string;
  nodeExtractedDataText: string;
  telephonyDataText: string;
  transcript: string;
  summary: string;
  bolnaCreatedAt: string;
  bolnaUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  linkedCallId: string | null;
  eventCount: number;
  toolInvocationCount: number;
}

export interface WebhookEventItem {
  id: string;
  shortId: string;
  executionId: string;
  eventType: string;
  status: string;
  sourceIp: string;
  receivedAt: Date | string;
  processedAt: Date | string | null;
  failedAt: Date | string | null;
  errorMessage: string;
  hasPayload: boolean;
  payloadText: string;
  headers: Record<string, string>;
}

export interface ToolInvocationItem {
  id: string;
  shortId: string;
  dedupeKey: string;
  toolName: string;
  executionId: string;
  status: string;
  resultText: string;
  errorMessage: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface BolnaOperationsSummary {
  totalExecutions: number;
  terminalExecutions: number;
  failedExecutions: number;
  totalWebhookEvents: number;
  failedWebhookEvents: number;
  totalToolInvocations: number;
  failedToolInvocations: number;
  totalCost: number;
}

function text(value: string | null | undefined, fallback = "—"): string {
  return value && value.length > 0 ? value : fallback;
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(-8) : value;
}

function money(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

export function formatDashboardJson(value: unknown, maxLength = 2000): string {
  if (value === null || value === undefined) return "—";
  const rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (typeof rendered !== "string" || rendered.length === 0) return "—";
  return rendered.length > maxLength ? `${rendered.slice(0, maxLength)}…` : rendered;
}

export function formatDashboardCost(value: number | null): string {
  return money(value);
}

export function sanitizeDashboardHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (/authorization|cookie|api[-_]?key|token|secret/i.test(key)) continue;
    if (typeof value === "string") result[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      result[key] = (value as string[]).join(", ");
    }
  }
  return result;
}

export function projectExecutionListItem(record: ExecutionProjectionInput): ExecutionListItem {
  return {
    id: record.id,
    executionId: record.executionId,
    shortExecutionId: shortId(record.executionId),
    status: record.status,
    callStatus: mapBolnaStatusToCallStatus(record.status),
    terminal: isTerminalBolnaStatus(record.status),
    callType: text(record.callType, "unknown"),
    userNumber: text(record.userNumber),
    agentVersion: record.agentVersionId ? shortId(record.agentVersionId) : "—",
    durationSeconds: record.conversationDuration,
    totalCost: record.totalCost,
    occurredAt: record.occurredAt ?? record.createdAt,
  };
}

export function projectExecutionDetail(input: {
  execution: ExecutionProjectionInput;
  events: readonly WebhookEventProjectionInput[];
  invocations: readonly ToolInvocationProjectionInput[];
  linkedCallId?: string | null;
}): ExecutionDetail {
  const { execution, events, invocations, linkedCallId } = input;
  return {
    ...projectExecutionListItem(execution),
    agentId: text(execution.agentId),
    batchId: text(execution.batchId),
    terminationReason: text(execution.terminationReason),
    errorMessage: text(execution.errorMessage),
    agentNumber: text(execution.agentNumber),
    provider: text(execution.provider),
    providerCallId: text(execution.providerCallId),
    recordingUrl: text(execution.recordingUrl),
    costBreakdownText: formatDashboardJson(execution.costBreakdown),
    extractedDataText: formatDashboardJson(execution.extractedData),
    nodeExtractedDataText: formatDashboardJson(execution.nodeExtractedData),
    telephonyDataText: formatDashboardJson(execution.telephonyData),
    transcript: text(execution.transcript, "No transcript is available for this execution."),
    summary: text(execution.summary, "No summary is available for this execution."),
    bolnaCreatedAt: String(execution.bolnaCreatedAt ?? "—"),
    bolnaUpdatedAt: String(execution.bolnaUpdatedAt ?? "—"),
    createdAt: String(execution.createdAt),
    updatedAt: String(execution.updatedAt),
    linkedCallId: linkedCallId ?? null,
    eventCount: events.length,
    toolInvocationCount: invocations.length,
  };
}

export function projectWebhookEvent(event: WebhookEventProjectionInput): WebhookEventItem {
  return {
    id: event.id,
    shortId: shortId(event.id),
    executionId: event.executionId,
    eventType: text(event.eventType),
    status: text(event.status),
    sourceIp: text(event.sourceIp),
    receivedAt: event.receivedAt,
    processedAt: event.processedAt,
    failedAt: event.failedAt,
    errorMessage: text(event.errorMessage),
    hasPayload: event.payload !== null && event.payload !== undefined,
    payloadText: formatDashboardJson(event.payload, 1200),
    headers: sanitizeDashboardHeaders(event.headers),
  };
}

export function projectToolInvocation(invocation: ToolInvocationProjectionInput): ToolInvocationItem {
  return {
    id: invocation.id,
    shortId: shortId(invocation.id),
    dedupeKey: shortId(invocation.dedupeKey),
    toolName: invocation.toolName,
    executionId: text(invocation.executionId),
    status: invocation.status,
    resultText: formatDashboardJson(invocation.result, 1200),
    errorMessage: text(invocation.errorMessage),
    createdAt: invocation.createdAt,
    updatedAt: invocation.updatedAt,
  };
}

export function buildBolnaOperationsSummary(input: {
  executions: readonly ExecutionProjectionInput[];
  events: readonly WebhookEventProjectionInput[];
  invocations: readonly ToolInvocationProjectionInput[];
}): BolnaOperationsSummary {
  const totalCost = input.executions.reduce((sum, execution) => {
    const value = execution.totalCost;
    return sum + (value !== null && Number.isFinite(value) ? value : 0);
  }, 0);
  return {
    totalExecutions: input.executions.length,
    terminalExecutions: input.executions.filter((execution) =>
      isTerminalBolnaStatus(execution.status),
    ).length,
    failedExecutions: input.executions.filter(
      (execution) =>
        Boolean(execution.errorMessage) ||
        mapBolnaStatusToCallStatus(execution.status) === "FAILED",
    ).length,
    totalWebhookEvents: input.events.length,
    failedWebhookEvents: input.events.filter(
      (event) => Boolean(event.failedAt) || Boolean(event.errorMessage),
    ).length,
    totalToolInvocations: input.invocations.length,
    failedToolInvocations: input.invocations.filter(
      (invocation) =>
        invocation.status === "failed" || Boolean(invocation.errorMessage),
    ).length,
    totalCost: Math.round(totalCost * 10_000) / 10_000,
  };
}
