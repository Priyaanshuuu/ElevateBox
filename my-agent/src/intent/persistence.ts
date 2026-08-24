import type { LeadIntent } from "../../../platform/generated/prisma/enums.ts";

type LeadRecord = { id: string; phoneNumber: string };

type LeadServiceModule = {
  getOrCreateLead: (phoneNumber: string) => Promise<LeadRecord>;
  updateLeadIntent: (leadId: string, intent: LeadIntent) => Promise<unknown>;
};

let cachedService: LeadServiceModule | null = null;

async function getLeadService(): Promise<LeadServiceModule> {
  if (cachedService) {
    return cachedService;
  }

  const mod = (await import("../../../platform/lib/services/lead.service.ts")) as LeadServiceModule;
  cachedService = mod;
  return mod;
}

export async function getOrCreateLeadForIdentity(identity: string): Promise<LeadRecord | null> {
  const normalized = normalizePhone(identity);
  if (!normalized) {
    return null;
  }

  const leadService = await getLeadService();
  return leadService.getOrCreateLead(normalized);
}

export async function persistLeadIntent(leadId: string, intent: LeadIntent): Promise<void> {
  const leadService = await getLeadService();
  await leadService.updateLeadIntent(leadId, intent);
}

function normalizePhone(identity: string): string | null {
  const value = identity.trim();
  if (!value) {
    return null;
  }

  // Keep '+' and digits for PSTN-like identities; fallback to raw identity.
  const compact = value.replace(/\s+/g, "");
  const candidate = compact.replace(/[^\d+]/g, "");
  return candidate || compact;
}
