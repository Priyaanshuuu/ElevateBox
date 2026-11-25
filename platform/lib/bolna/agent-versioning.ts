import { BolnaConfigError } from "./errors.ts";
import type { AgentVersionPlan } from "./agent-config.ts";
import type { BolnaLanguageCode } from "./agent-types.ts";
import type { BolnaClient } from "./client.ts";

export interface CandidateVersionResult {
  kind: "created-agent" | "saved-version";
  agentId: string;
  versionId: string;
}

export interface ElevateBoxCallInput {
  agentId: string;
  versionId: string;
  recipientPhoneNumber: string;
  fromPhoneNumber?: string;
  language?: BolnaLanguageCode;
  userData?: Record<string, string | number | boolean | null>;
  scheduledFor?: Date;
  now?: Date;
}

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const MIN_SCHEDULE_LEAD_MS = 2 * 60 * 1000;
const SCHEDULE_ROUNDING_MS = 10 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatBolnaScheduledAt(scheduledFor: Date, now: Date = new Date()): string {
  if (!(scheduledFor instanceof Date) || Number.isNaN(scheduledFor.getTime())) {
    throw new BolnaConfigError("scheduled_at must be a valid Date.");
  }

  if (scheduledFor.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) {
    throw new BolnaConfigError("Bolna requires scheduled calls to be at least 2 minutes in the future.");
  }

  const roundedMs =
    Math.ceil(scheduledFor.getTime() / SCHEDULE_ROUNDING_MS) * SCHEDULE_ROUNDING_MS;
  const rounded = new Date(roundedMs);

  return [
    rounded.getUTCFullYear(),
    pad(rounded.getUTCMonth() + 1),
    pad(rounded.getUTCDate()),
  ].join("-") +
    `T${pad(rounded.getUTCHours())}:${pad(rounded.getUTCMinutes())}:00+00:00`;
}

export function buildElevateBoxCallRequest(input: ElevateBoxCallInput) {
  if (!E164_PATTERN.test(input.recipientPhoneNumber)) {
    throw new BolnaConfigError("recipientPhoneNumber must be E.164 formatted.");
  }
  if (input.fromPhoneNumber && !E164_PATTERN.test(input.fromPhoneNumber)) {
    throw new BolnaConfigError("fromPhoneNumber must be E.164 formatted.");
  }
  if (!input.versionId.trim()) {
    throw new BolnaConfigError("Every evaluated call must pin an agent version.");
  }

  const userData = { ...(input.userData ?? {}) };
  const userLanguage = userData.agent_language;
  if (userLanguage !== undefined && userLanguage !== input.language) {
    throw new BolnaConfigError(
      "user_data.agent_language and agent_data.language must match.",
    );
  }
  if (input.language) {
    userData.agent_language = input.language;
  }

  return {
    agent_id: input.agentId,
    agent_version_id: input.versionId,
    recipient_phone_number: input.recipientPhoneNumber,
    ...(input.fromPhoneNumber ? { from_phone_number: input.fromPhoneNumber } : {}),
    ...(input.scheduledFor
      ? { scheduled_at: formatBolnaScheduledAt(input.scheduledFor, input.now) }
      : {}),
    ...(Object.keys(userData).length > 0 ? { user_data: userData } : {}),
    agent_data: input.language ? { language: input.language } : {},
  };
}

export async function registerCandidateAgentVersion(
  client: BolnaClient,
  plan: AgentVersionPlan,
  options: { agentId?: string } = {},
): Promise<CandidateVersionResult> {
  if (options.agentId) {
    const response = await client.saveAgentVersion(options.agentId, plan.versionRequest);
    return {
      kind: "saved-version",
      agentId: response.agent_id,
      versionId: response.version_id,
    };
  }

  const response = await client.createAgent(plan.createRequest);
  return {
    kind: "created-agent",
    agentId: response.agent_id,
    versionId: response.version_id,
  };
}

export async function promoteAgentVersion(
  client: BolnaClient,
  agentId: string,
  versionId: string,
): Promise<string> {
  const response = await client.setCurrentAgentVersion(agentId, versionId);
  return response.current_version_id;
}
