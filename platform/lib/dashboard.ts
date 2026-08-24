import { prisma } from "./prisma";

export async function getOverviewData() {
  const [totalLeads, hotLeads, warmLeads, coldLeads, totalCalls, scheduledCallbacks] =
    await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { intent: "HOT" } }),
      prisma.lead.count({ where: { intent: "WARM" } }),
      prisma.lead.count({ where: { intent: "COLD" } }),
      prisma.call.count(),
      prisma.callback.count({ where: { status: "SCHEDULED" } }),
    ]);

  return { totalLeads, hotLeads, warmLeads, coldLeads, totalCalls, scheduledCallbacks };
}

export async function getLeads() {
  return prisma.lead.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function getCalls() {
  return prisma.call.findMany({
    orderBy: { createdAt: "desc" },
    include: { lead: true },
  });
}

export async function getCallDetails(id: string) {
  return prisma.call.findUnique({
    where: { id },
    include: {
      lead: true,
      callbacks: { orderBy: { scheduledAt: "asc" } },
      automationEvents: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function getCallbacks() {
  return prisma.callback.findMany({
    orderBy: { scheduledAt: "asc" },
    include: { lead: true, call: true },
  });
}

export async function getAutomationEvents() {
  return prisma.automationEvent.findMany({
    orderBy: { createdAt: "desc" },
    include: { lead: true, call: true },
  });
}
