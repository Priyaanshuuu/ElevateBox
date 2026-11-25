import { BolnaConfigError } from "./errors.ts";
import { BOLNA_CALLBACK_MAX_BODY_BYTES } from "./callback-types.ts";

export interface LeadQualificationCallbackInput {
  event: "lead.qualified" | "callback.requested" | "whatsapp.alert";
  phone: string;
  leadId?: string;
  executionId?: string;
  intent?: "HOT" | "WARM" | "COLD" | "UNKNOWN";
  summary?: string;
  fields?: Record<string, string | number | boolean | null>;
}

export function isE164Phone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export function buildLeadQualificationCallbackBody(
  input: LeadQualificationCallbackInput,
): string {
  if (!isE164Phone(input.phone)) {
    throw new BolnaConfigError("Callback correlation phone must be in E.164 format.");
  }
  if (!input.leadId && !input.executionId) {
    throw new BolnaConfigError("Callback must include leadId or executionId.");
  }

  const body = {
    event: input.event,
    lead: {
      phone: input.phone,
      ...(input.leadId ? { id: input.leadId } : {}),
    },
    ...(input.executionId ? { execution_id: input.executionId } : {}),
    ...(input.intent ? { qualification: { intent: input.intent } } : {}),
    ...(input.summary ? { summary: input.summary.slice(0, 2000) } : {}),
    ...(input.fields ? { fields: input.fields } : {}),
  };
  const serialized = JSON.stringify(body);
  validateCallbackBody(serialized);
  return serialized;
}

export function validateCallbackBody(body: string): void {
  if (Buffer.byteLength(body, "utf8") > BOLNA_CALLBACK_MAX_BODY_BYTES) {
    throw new BolnaConfigError("Bolna callback body exceeds 262144 bytes.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new BolnaConfigError("Bolna callback body must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BolnaConfigError("Bolna callback body must be an object.");
  }
  const lead = (parsed as { lead?: unknown }).lead;
  if (typeof lead !== "object" || lead === null || Array.isArray(lead)) {
    throw new BolnaConfigError("Bolna callback body must include lead.phone for correlation.");
  }
  const phone = (lead as { phone?: unknown }).phone;
  if (typeof phone !== "string" || !isE164Phone(phone)) {
    throw new BolnaConfigError("Bolna callback lead.phone must be in E.164 format.");
  }
}
