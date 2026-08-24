import { CallbackStatus } from "../../generated/prisma/client";
import { prisma } from "../prisma";

export async function createScheduledCallback(input: {
  leadId: string;
  callId?: string;
  scheduledAt: Date;
  notes?: string;
}) {
  if (input.scheduledAt.getTime() <= Date.now()) {
    throw new Error("Callback time must be in the future.");
  }

  return prisma.callback.create({
    data: {
      leadId: input.leadId,
      ...(input.callId !== undefined ? { callId: input.callId } : {}),
      scheduledAt: input.scheduledAt,
      status: CallbackStatus.SCHEDULED,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}

export async function getDueScheduledCallbacks(limit = 10) {
  return prisma.callback.findMany({
    where: {
      status: CallbackStatus.SCHEDULED,
      scheduledAt: { lte: new Date() },
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    include: { lead: true },
  });
}

export async function markCallbackCompleted(callbackId: string) {
  return prisma.callback.update({
    where: { id: callbackId },
    data: { status: CallbackStatus.COMPLETED },
  });
}

export async function markCallbackFailed(callbackId: string, notes: string) {
  return prisma.callback.update({
    where: { id: callbackId },
    data: { status: CallbackStatus.FAILED, notes },
  });
}
