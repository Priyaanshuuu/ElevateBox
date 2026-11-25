import { CallStatus, LeadIntent } from "../../generated/prisma/client.ts";
import { prisma } from "../prisma.ts";
import type {
  BolnaWebhookStore,
  CreateBolnaEventInput,
  InternalCallStatus,
  InternalLeadIntent,
  UpsertBolnaExecutionInput,
  UpsertCallInput,
  UpdateLeadInput,
} from "./webhook-store.ts";

function toCallStatus(status: InternalCallStatus): CallStatus {
  switch (status) {
    case "INITIATED":
      return CallStatus.INITIATED;
    case "RINGING":
      return CallStatus.RINGING;
    case "IN_PROGRESS":
      return CallStatus.IN_PROGRESS;
    case "COMPLETED":
      return CallStatus.COMPLETED;
    case "FAILED":
      return CallStatus.FAILED;
  }
}

function toLeadIntent(intent: InternalLeadIntent): LeadIntent {
  switch (intent) {
    case "HOT":
      return LeadIntent.HOT;
    case "WARM":
      return LeadIntent.WARM;
    case "COLD":
      return LeadIntent.COLD;
    case "UNKNOWN":
      return LeadIntent.UNKNOWN;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function jsonOrUndefined(value: unknown): never | undefined {
  return value === undefined || value === null ? undefined : (value as never);
}

function buildExecutionData(input: UpsertBolnaExecutionInput) {
  return {
    executionId: input.executionId,
    agentId: input.agentId,
    agentVersionId: input.agentVersionId,
    batchId: input.batchId,
    status: input.status,
    terminationReason: input.terminationReason,
    errorMessage: input.errorMessage,
    userNumber: input.userNumber,
    agentNumber: input.agentNumber,
    callType: input.callType,
    provider: input.provider,
    providerCallId: input.providerCallId,
    telephonyData: jsonOrUndefined(input.telephonyData),
    occurredAt: input.occurredAt,
    bolnaCreatedAt: input.bolnaCreatedAt,
    bolnaUpdatedAt: input.bolnaUpdatedAt,
    recordingUrl: input.recordingUrl,
    conversationDuration: input.conversationDuration,
    totalCost: input.totalCost,
    costBreakdown: jsonOrUndefined(input.costBreakdown),
    transcript: input.transcript,
    summary: input.summary,
    extractedData: jsonOrUndefined(input.extractedData),
    nodeExtractedData: jsonOrUndefined(input.nodeExtractedData),
  };
}

function buildCallData(input: Partial<UpsertCallInput>) {
  return {
    ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
    ...(input.bolnaExecutionRef !== undefined
      ? { bolnaExecutionId: input.bolnaExecutionRef }
      : {}),
    ...(input.status !== undefined ? { status: toCallStatus(input.status) } : {}),
    ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
    ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : {}),
    ...(input.transcript !== undefined ? { transcript: input.transcript } : {}),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
  };
}

export function createPrismaWebhookStore(): BolnaWebhookStore {
  return {
    async findEventByDedupeKey(dedupeKey) {
      return prisma.bolnaWebhookEvent.findUnique({
        where: { dedupeKey },
        select: { id: true },
      });
    },

    async findExecution(executionId) {
      return prisma.bolnaExecution.findUnique({
        where: { executionId },
        select: { id: true, status: true },
      });
    },

    async upsertExecution(input) {
      const data = buildExecutionData(input);
      const execution = await prisma.bolnaExecution.upsert({
        where: { executionId: input.executionId },
        create: data,
        update: data,
        select: { id: true },
      });
      return execution;
    },

    async createEvent(input: CreateBolnaEventInput) {
      try {
        const event = await prisma.bolnaWebhookEvent.create({
          data: {
            dedupeKey: input.dedupeKey,
            executionId: input.executionId,
            eventType: input.eventType,
            status: input.status,
            sourceIp: input.sourceIp,
            payload: input.payload as never,
            headers: input.headers as never,
          },
          select: { id: true },
        });
        return event.id;
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async findCallByExecutionRef(executionRef) {
      return prisma.call.findUnique({
        where: { bolnaExecutionId: executionRef },
        select: { id: true },
      });
    },

    async createCall(input) {
      const call = await prisma.call.create({
        data: buildCallData(input) as never,
        select: { id: true },
      });
      return call;
    },

    async updateCall(callId, input) {
      const data = buildCallData(input);
      if (Object.keys(data).length === 0) return;
      await prisma.call.update({
        where: { id: callId },
        data,
      });
    },

    async getOrCreateLead(phoneNumber) {
      return prisma.lead.upsert({
        where: { phoneNumber },
        create: { phoneNumber },
        update: {},
        select: { id: true },
      });
    },

    async updateLead(leadId, input: UpdateLeadInput) {
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          ...(input.business !== undefined ? { business: input.business } : {}),
          ...(input.productCount !== undefined ? { productCount: input.productCount } : {}),
          ...(input.budget !== undefined ? { budget: input.budget } : {}),
          ...(input.timeline !== undefined ? { timeline: input.timeline } : {}),
          ...(input.features !== undefined ? { features: input.features } : {}),
          ...(input.intent !== undefined ? { intent: toLeadIntent(input.intent) } : {}),
        },
      });
    },

    async markEventProcessed(eventId) {
      await prisma.bolnaWebhookEvent.update({
        where: { id: eventId },
        data: { processedAt: new Date(), failedAt: null, errorMessage: null },
      });
    },

    async markEventFailed(eventId, message) {
      await prisma.bolnaWebhookEvent.update({
        where: { id: eventId },
        data: { failedAt: new Date(), errorMessage: message.slice(0, 500) },
      });
    },
  };
}
