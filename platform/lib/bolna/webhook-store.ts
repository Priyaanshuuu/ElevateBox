import type { JsonValue } from "./webhook.ts";

export type InternalCallStatus =
  | "INITIATED"
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";

export type InternalLeadIntent = "HOT" | "WARM" | "COLD" | "UNKNOWN";

export interface CreateBolnaEventInput {
  dedupeKey: string;
  executionId: string;
  eventType: string | null;
  status: string;
  sourceIp: string | null;
  payload: JsonValue;
  headers: Record<string, string>;
}

export interface UpsertBolnaExecutionInput {
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
  recordingUrl?: string | null;
  conversationDuration?: number | null;
  totalCost?: number | null;
  costBreakdown?: JsonValue | null;
  transcript?: string | null;
  summary?: string | null;
  extractedData?: JsonValue | null;
  nodeExtractedData?: JsonValue | null;
  telephonyData?: JsonValue | null;
  occurredAt?: Date | null;
  bolnaCreatedAt?: Date | null;
  bolnaUpdatedAt?: Date | null;
}

export interface UpsertCallInput {
  leadId: string;
  bolnaExecutionRef: string;
  status: InternalCallStatus;
  startedAt?: Date | null;
  endedAt?: Date | null;
  transcript?: string | null;
  summary?: string | null;
}

export interface UpdateLeadInput {
  business?: string | null;
  productCount?: number | null;
  budget?: number | null;
  timeline?: string | null;
  features?: string[];
  intent?: InternalLeadIntent;
}

export interface BolnaWebhookStore {
  findEventByDedupeKey(dedupeKey: string): Promise<{ id: string } | null>;
  findExecution(executionId: string): Promise<{ id: string; status: string } | null>;
  upsertExecution(input: UpsertBolnaExecutionInput): Promise<{ id: string }>;
  createEvent(input: CreateBolnaEventInput): Promise<string | null>;
  findCallByExecutionRef(executionRef: string): Promise<{ id: string } | null>;
  createCall(input: UpsertCallInput): Promise<{ id: string }>;
  updateCall(callId: string, input: Partial<UpsertCallInput>): Promise<void>;
  getOrCreateLead(phoneNumber: string): Promise<{ id: string }>;
  updateLead(leadId: string, input: UpdateLeadInput): Promise<void>;
  markEventProcessed(eventId: string): Promise<void>;
  markEventFailed(eventId: string, message: string): Promise<void>;
}
