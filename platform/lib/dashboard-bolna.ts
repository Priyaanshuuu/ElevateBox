import { prisma } from "./prisma";
import {
  buildBolnaOperationsSummary,
  projectExecutionDetail,
  projectExecutionListItem,
  projectToolInvocation,
  projectWebhookEvent,
} from "./bolna/dashboard-projection.ts";

export async function getBolnaExecutions() {
  const executions = await prisma.bolnaExecution.findMany({
    orderBy: { createdAt: "desc" },
    include: { call: { include: { lead: true } } },
  });
  return executions.map((execution) => ({
    ...projectExecutionListItem(execution),
    callId: execution.call?.id ?? null,
    lead: execution.call?.lead
      ? {
          id: execution.call.lead.id,
          name: execution.call.lead.name,
          phoneNumber: execution.call.lead.phoneNumber,
          intent: execution.call.lead.intent,
        }
      : null,
  }));
}

export async function getBolnaExecutionDetail(id: string) {
  const execution = await prisma.bolnaExecution.findFirst({
    where: { OR: [{ id }, { executionId: id }] },
    include: {
      call: { select: { id: true, status: true } },
      events: { orderBy: { receivedAt: "desc" } },
    },
  });
  if (!execution) return null;
  const invocations = await prisma.bolnaToolInvocation.findMany({
    where: { executionId: execution.executionId },
    orderBy: { createdAt: "desc" },
  });
  return {
    detail: projectExecutionDetail({
      execution,
      events: execution.events,
      invocations,
      linkedCallId: execution.call?.id ?? null,
    }),
    events: execution.events.map(projectWebhookEvent),
    invocations: invocations.map(projectToolInvocation),
  };
}

export async function getBolnaEvents() {
  const events = await prisma.bolnaWebhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    include: { execution: { select: { status: true, userNumber: true } } },
  });
  return events.map((event) => ({
    ...projectWebhookEvent(event),
    executionStatus: event.execution.status,
    userNumber: event.execution.userNumber,
  }));
}

export async function getBolnaToolInvocations() {
  const invocations = await prisma.bolnaToolInvocation.findMany({
    orderBy: { createdAt: "desc" },
  });
  return invocations.map(projectToolInvocation);
}

export async function getBolnaOperationsSummary() {
  const [executions, events, invocations] = await Promise.all([
    prisma.bolnaExecution.findMany(),
    prisma.bolnaWebhookEvent.findMany(),
    prisma.bolnaToolInvocation.findMany(),
  ]);
  return buildBolnaOperationsSummary({ executions, events, invocations });
}

export async function getExecutionForCall(executionId: string) {
  const execution = await prisma.bolnaExecution.findUnique({
    where: { executionId },
    include: { events: true },
  });
  if (!execution) return null;
  const invocations = await prisma.bolnaToolInvocation.findMany({
    where: { executionId },
    orderBy: { createdAt: "desc" },
  });
  const detail = projectExecutionDetail({
    execution,
    events: execution.events,
    invocations,
  });
  return {
    executionId: execution.executionId,
    status: detail.status,
    callStatus: detail.callStatus,
    agentVersion: detail.agentVersion,
    provider: detail.provider,
    providerCallId: detail.providerCallId,
    recordingUrl: detail.recordingUrl,
    cost: detail.totalCost,
    durationSeconds: detail.durationSeconds,
    eventCount: detail.eventCount,
    toolInvocationCount: detail.toolInvocationCount,
    terminationReason: detail.terminationReason,
    errorMessage: detail.errorMessage,
  };
}
