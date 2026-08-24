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
