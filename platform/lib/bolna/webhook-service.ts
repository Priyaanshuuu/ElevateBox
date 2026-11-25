import { mapBolnaStatusToCallStatus, type NormalizedBolnaWebhook } from "./webhook.ts";
import {
  buildWebhookDedupeKey,
  extractLeadFacts,
  parseBolnaWebhookPayload,
  sanitizeWebhookHeaders,
  shouldProjectIncomingBolnaEvent,
} from "./webhook.ts";
import type {
  BolnaWebhookStore,
  UpsertBolnaExecutionInput,
  UpsertCallInput,
  UpdateLeadInput,
} from "./webhook-store.ts";

export interface IngestBolnaWebhookInput {
  payload: unknown;
  store: BolnaWebhookStore;
  headers?: Record<string, string | string[] | undefined>;
  sourceIp?: string | null;
  now?: Date;
}

export interface IngestBolnaWebhookResult {
  outcome: "accepted" | "duplicate";
  eventId: string;
  executionId: string;
  executionRef: string;
  projected: boolean;
  callId?: string;
}

function buildExecutionInput(
  normalized: NormalizedBolnaWebhook,
  status: string,
  includeTerminalFields: boolean,
): UpsertBolnaExecutionInput {
  const input: UpsertBolnaExecutionInput = {
    executionId: normalized.executionId,
    agentId: normalized.agentId,
    agentVersionId: normalized.agentVersionId,
    batchId: normalized.batchId,
    status,
    terminationReason: normalized.terminationReason,
    errorMessage: normalized.errorMessage,
    userNumber: normalized.phoneNumber,
    agentNumber: normalized.agentNumber,
    callType: normalized.direction === "unknown" ? null : normalized.direction,
    provider: null,
    providerCallId: null,
    telephonyData: normalized.telephonyData,
    occurredAt: normalized.occurredAt,
    bolnaCreatedAt: normalized.bolnaCreatedAt,
    bolnaUpdatedAt: normalized.bolnaUpdatedAt,
  };

  if (normalized.telephonyData && typeof normalized.telephonyData === "object" && !Array.isArray(normalized.telephonyData)) {
    const telephony = normalized.telephonyData as Record<string, unknown>;
    if (typeof telephony.provider === "string") input.provider = telephony.provider;
    if (typeof telephony.provider_call_id === "string") input.providerCallId = telephony.provider_call_id;
  }

  if (includeTerminalFields) {
    input.recordingUrl = normalized.recordingUrl;
    input.conversationDuration = normalized.conversationDuration;
    input.totalCost = normalized.totalCost;
    input.costBreakdown = normalized.costBreakdown;
    input.transcript = normalized.transcript;
    input.summary = normalized.summary;
    input.extractedData = normalized.extractedData;
    input.nodeExtractedData = normalized.nodeExtractedData;
  }

  return input;
}

function buildLeadUpdate(normalized: NormalizedBolnaWebhook): UpdateLeadInput {
  const facts = extractLeadFacts(normalized);
  const update: UpdateLeadInput = {};

  if (facts.business) update.business = facts.business;
  if (facts.productCount !== null) update.productCount = facts.productCount;
  if (facts.budget !== null) update.budget = facts.budget;
  if (facts.timeline) update.timeline = facts.timeline;
  if (facts.features.length > 0) update.features = facts.features;
  if (facts.intent) update.intent = facts.intent;

  return update;
}

function safeFailureName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export async function ingestBolnaWebhook(
  input: IngestBolnaWebhookInput,
): Promise<IngestBolnaWebhookResult> {
  const normalized = parseBolnaWebhookPayload(input.payload);
  const dedupeKey = buildWebhookDedupeKey(input.payload, normalized);
  const now = input.now ?? new Date();

  const existingEvent = await input.store.findEventByDedupeKey(dedupeKey);
  if (existingEvent) {
    return {
      outcome: "duplicate",
      eventId: existingEvent.id,
      executionId: normalized.executionId,
      executionRef: "",
      projected: false,
    };
  }

  const existingExecution = await input.store.findExecution(normalized.executionId);
  const shouldProject = shouldProjectIncomingBolnaEvent(
    existingExecution?.status ?? null,
    normalized.status,
  );
  const projectedStatus = shouldProject ? normalized.status : (existingExecution?.status ?? normalized.status);

  const execution = await input.store.upsertExecution(
    buildExecutionInput(normalized, projectedStatus, shouldProject && normalized.isTerminal),
  );

  const eventId = await input.store.createEvent({
    dedupeKey,
    executionId: normalized.executionId,
    eventType: normalized.eventType,
    status: normalized.status,
    sourceIp: input.sourceIp ?? null,
    payload: input.payload as never,
    headers: sanitizeWebhookHeaders(input.headers ?? {}),
  });

  if (!eventId) {
    const racedEvent = await input.store.findEventByDedupeKey(dedupeKey);
    return {
      outcome: "duplicate",
      eventId: racedEvent?.id ?? "",
      executionId: normalized.executionId,
      executionRef: execution.id,
      projected: false,
    };
  }

  try {
    let callId: string | undefined;

    if (shouldProject && normalized.phoneNumber) {
      const callStatus = mapBolnaStatusToCallStatus(normalized.status);
      if (callStatus) {
        const lead = await input.store.getOrCreateLead(normalized.phoneNumber);
        const callInput: UpsertCallInput = {
          leadId: lead.id,
          bolnaExecutionRef: execution.id,
          status: callStatus,
        };

        if (normalized.isTerminal) {
          callInput.endedAt = normalized.occurredAt ?? now;
          callInput.transcript = normalized.transcript;
          callInput.summary = normalized.summary;
        }

        if (normalized.status === "in-progress") {
          callInput.startedAt = normalized.occurredAt ?? now;
        }

        const existingCall = await input.store.findCallByExecutionRef(execution.id);
        if (existingCall) {
          await input.store.updateCall(existingCall.id, callInput);
          callId = existingCall.id;
        } else {
          callId = (await input.store.createCall(callInput)).id;
        }

        if (normalized.isTerminal) {
          const leadUpdate = buildLeadUpdate(normalized);
          if (Object.keys(leadUpdate).length > 0) {
            await input.store.updateLead(lead.id, leadUpdate);
          }
        }
      }
    }

    await input.store.markEventProcessed(eventId);

    return {
      outcome: "accepted",
      eventId,
      executionId: normalized.executionId,
      executionRef: execution.id,
      projected: shouldProject,
      ...(callId ? { callId } : {}),
    };
  } catch (error) {
    await input.store.markEventFailed(eventId, safeFailureName(error));
    throw error;
  }
}
