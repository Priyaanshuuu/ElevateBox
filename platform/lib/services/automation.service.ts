import {
  AutomationStatus,
  AutomationType,
} from "../../generated/prisma/client";
import { prisma } from "../prisma";

export async function getActiveInterestedLeadWhatsAppEvent(
  leadId: string,
  callId?: string,
) {
  return prisma.automationEvent.findFirst({
    where: {
      leadId,
      ...(callId !== undefined ? { callId } : {}),
      type: AutomationType.INTERESTED_LEAD_WHATSAPP,
      status: {
        in: [AutomationStatus.PENDING, AutomationStatus.TRIGGERED, AutomationStatus.COMPLETED],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function createPendingInterestedLeadWhatsAppEvent(
  leadId: string,
  callId: string | undefined,
  payload: unknown,
) {
  return prisma.automationEvent.create({
    data: {
      leadId,
      ...(callId !== undefined ? { callId } : {}),
      type: AutomationType.INTERESTED_LEAD_WHATSAPP,
      status: AutomationStatus.PENDING,
      payload: payload as never,
    },
  });
}

export async function markAutomationEventTriggered(eventId: string) {
  return prisma.automationEvent.update({
    where: { id: eventId },
    data: {
      status: AutomationStatus.TRIGGERED,
      triggeredAt: new Date(),
    },
  });
}

export async function markAutomationEventCompleted(eventId: string, payload?: unknown) {
  return prisma.automationEvent.update({
    where: { id: eventId },
    data: {
      status: AutomationStatus.COMPLETED,
      completedAt: new Date(),
      ...(payload !== undefined ? { payload: payload as never } : {}),
    },
  });
}

export async function markAutomationEventFailed(
  eventId: string,
  errorMessage: string,
  payload?: unknown,
) {
  return prisma.automationEvent.update({
    where: { id: eventId },
    data: {
      status: AutomationStatus.FAILED,
      errorMessage,
      ...(payload !== undefined ? { payload: payload as never } : {}),
    },
  });
}
