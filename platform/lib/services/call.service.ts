import { CallStatus } from "../../generated/prisma/client";
import { prisma } from "../prisma";

export async function createCall(leadId: string) {
  return prisma.call.create({
    data: {
      leadId,
      status: CallStatus.INITIATED,
    },
  });
}

export async function updateCallStatus(
  callId: string,
  status: CallStatus,
) {
  return prisma.call.update({
    where: {
      id: callId,
    },
    data: {
      status,
    },
  });
}

export async function startCall(callId: string) {
  return prisma.call.update({
    where: {
      id: callId,
    },
    data: {
      status: CallStatus.IN_PROGRESS,
      startedAt: new Date(),
    },
  });
}

export async function completeCall(
  callId: string,
  transcript?: string,
  summary?: string,
) {
  return prisma.call.update({
    where: {
      id: callId,
    },
    data: {
      status: CallStatus.COMPLETED,
      endedAt: new Date(),
      ...(transcript !== undefined ? { transcript } : {}),
      ...(summary !== undefined ? { summary } : {}),
    },
  });
}

export async function getCall(callId: string) {
  return prisma.call.findUnique({
    where: {
      id: callId,
    },
    include: {
      lead: true,
      callbacks: true,
      automationEvents: true,
    },
  });
}