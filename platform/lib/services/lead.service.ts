import { LeadIntent } from "../../generated/prisma/client";
import { prisma } from "../prisma";

export type UpdateLeadData = {
  name?: string;
  business?: string;
  productCount?: number;
  budget?: number;
  timeline?: string;
  features?: string[];
  intent?: LeadIntent;
};

export async function getLeadByPhone(phoneNumber: string) {
  return prisma.lead.findUnique({
    where: {
      phoneNumber,
    },
  });
}

export async function createLead(phoneNumber: string) {
  return prisma.lead.create({
    data: {
      phoneNumber,
    },
  });
}

export async function getOrCreateLead(phoneNumber: string) {
  const existingLead = await getLeadByPhone(phoneNumber);

  if (existingLead) {
    return existingLead;
  }

  return createLead(phoneNumber);
}

export async function updateLead(
  leadId: string,
  data: UpdateLeadData,
) {
  return prisma.lead.update({
    where: {
      id: leadId,
    },
    data,
  });
}

export async function updateLeadIntent(
  leadId: string,
  intent: LeadIntent,
) {
  return prisma.lead.update({
    where: {
      id: leadId,
    },
    data: {
      intent,
    },
  });
}