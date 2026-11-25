import { createHash } from "node:crypto";
import { BolnaConfigError } from "./errors.ts";
import {
  isE164TrunkPhone,
  isPublicIpv4Cidr,
  isUuid,
  parseTrunkCodecs,
  serializeTrunkCreateRequest,
  validateBolnaTrunkCreateRequest,
  validateBolnaTrunkGatewayRequest,
  type BolnaTrunkCodec,
  type BolnaTrunkCreateRequest,
  type BolnaTrunkGatewayRequest,
  type BolnaTrunkNumberRequest,
  type BolnaTrunkPreset,
  type BolnaTrunkTransport,
} from "./trunk-types.ts";

export const MAX_CANARY_CHANNELS = 4;
export const MAX_CANARY_NUMBERS = 5;

export interface CanaryTrunkNumber {
  e164: string;
  destinationKey: string;
  agentId?: string | null;
}

export interface CanaryTrunkPlan {
  trunkName: string;
  description?: string;
  preset: BolnaTrunkPreset;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  channels: number;
  defaultInboundAgentId: string | null;
  transport: BolnaTrunkTransport;
  outboundLeadingPlusEnabled: boolean;
  codecs: string;
  gateways: BolnaTrunkGatewayRequest[];
  ipAcls: string[];
  numbers: CanaryTrunkNumber[];
  authUsername?: string;
  authPasswordEnv?: string;
}

type JsonCanonical = string | number | boolean | null | JsonCanonical[] | { [key: string]: JsonCanonical };

function canonicalize(value: unknown): JsonCanonical {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const result: Record<string, JsonCanonical> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      result[key] = canonicalize(entry);
    }
    return result;
  }
  return String(value);
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseGatewayList(value: string | undefined): BolnaTrunkGatewayRequest[] {
  return splitList(value).map((entry) => {
    const [host, portRaw, priorityRaw, ...extra] = entry.split(":");
    if (!host || extra.length > 0) {
      throw new BolnaConfigError("BOLNA_TRUNK_GATEWAYS entries must be host[:port[:priority]].");
    }
    const port = portRaw === undefined || portRaw === "" ? 5060 : Number(portRaw);
    const priority = priorityRaw === undefined || priorityRaw === "" ? 0 : Number(priorityRaw);
    return { host, port, priority };
  });
}

export function canaryTrunkPlanDigest(plan: CanaryTrunkPlan): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(plan)))
    .digest("hex");
}

export function validateCanaryTrunkPlan(plan: CanaryTrunkPlan): void {
  if (!plan.trunkName || plan.trunkName.length < 1 || plan.trunkName.length > 100) {
    throw new BolnaConfigError("Canary trunk name must be 1 to 100 characters.");
  }
  if (
    !Number.isInteger(plan.channels) ||
    plan.channels < 1 ||
    plan.channels > MAX_CANARY_CHANNELS
  ) {
    throw new BolnaConfigError(`Canary trunk channels must be 1 to ${MAX_CANARY_CHANNELS}.`);
  }
  if (plan.transport !== "udp" && plan.transport !== "tcp") {
    throw new BolnaConfigError("Canary trunk transport must be udp or tcp.");
  }
  let codecs: BolnaTrunkCodec[];
  try {
    codecs = parseTrunkCodecs(plan.codecs);
  } catch {
    throw new BolnaConfigError("Canary codecs must be a subset of PCMU and PCMA.");
  }
  if (codecs.length === 0) throw new BolnaConfigError("At least one G.711 codec is required.");

  if (plan.gateways.length < 1 || plan.gateways.length > 8) {
    throw new BolnaConfigError("Outbound canary requires 1 to 8 gateways.");
  }
  for (const gateway of plan.gateways) validateBolnaTrunkGatewayRequest(gateway);

  if (plan.ipAcls.length < 1 || plan.ipAcls.length > 32) {
    throw new BolnaConfigError("Inbound canary requires 1 to 32 carrier IP ranges.");
  }
  for (const cidr of plan.ipAcls) {
    if (!isPublicIpv4Cidr(cidr)) {
      throw new BolnaConfigError(`Invalid carrier IP range: ${cidr}.`);
    }
  }

  if (plan.numbers.length < 1 || plan.numbers.length > MAX_CANARY_NUMBERS) {
    throw new BolnaConfigError(`Canary requires 1 to ${MAX_CANARY_NUMBERS} trunk numbers.`);
  }
  const seenE164 = new Set<string>();
  const seenDestinationKeys = new Set<string>();
  for (const number of plan.numbers) {
    if (!isE164TrunkPhone(number.e164)) {
      throw new BolnaConfigError(`Invalid trunk number: ${number.e164}.`);
    }
    if (!/^\d+$/.test(number.destinationKey)) {
      throw new BolnaConfigError("Destination key must contain only digits.");
    }
    if (seenE164.has(number.e164) || seenDestinationKeys.has(number.destinationKey)) {
      throw new BolnaConfigError("Trunk numbers and destination keys must be unique.");
    }
    seenE164.add(number.e164);
    seenDestinationKeys.add(number.destinationKey);
    if (number.agentId !== undefined && number.agentId !== null && !isUuid(number.agentId)) {
      throw new BolnaConfigError("Trunk number agent id must be a UUID or null.");
    }
  }

  if (!plan.defaultInboundAgentId && plan.numbers.every((number) => !number.agentId)) {
    throw new BolnaConfigError(
      "Inbound canary needs a default agent or an agent on every trunk number.",
    );
  }
  if (plan.defaultInboundAgentId && !isUuid(plan.defaultInboundAgentId)) {
    throw new BolnaConfigError("Default inbound agent id must be a UUID when set.");
  }

  if (Boolean(plan.authUsername) !== Boolean(plan.authPasswordEnv)) {
    throw new BolnaConfigError(
      "Set both BOLNA_TRUNK_AUTH_USERNAME and BOLNA_TRUNK_AUTH_PASSWORD_ENV, or neither.",
    );
  }
  if (
    plan.authPasswordEnv !== undefined &&
    !/^[A-Z][A-Z0-9_]*$/.test(plan.authPasswordEnv)
  ) {
    throw new BolnaConfigError("Auth password env name must be an uppercase environment variable name.");
  }
  if (plan.authUsername && /["|{}\\\u0000-\u001f]/.test(plan.authUsername)) {
    throw new BolnaConfigError("Auth username contains a forbidden character.");
  }

  const shapeCheck: BolnaTrunkCreateRequest = {
    name: plan.trunkName,
    description: plan.description,
    preset: plan.preset,
    inboundEnabled: plan.inboundEnabled,
    outboundEnabled: plan.outboundEnabled,
    channels: plan.channels,
    defaultInboundAgentId: plan.defaultInboundAgentId,
    transport: plan.transport,
    outboundLeadingPlusEnabled: plan.outboundLeadingPlusEnabled,
    codecs: plan.codecs,
    gateways: plan.gateways,
    ipAcls: plan.ipAcls,
    ...(plan.authUsername
      ? { authUsername: plan.authUsername, authPassword: "credential-from-env" }
      : {}),
  };
  validateBolnaTrunkCreateRequest(shapeCheck);
}

export function buildCanaryTrunkCreateRequest(
  plan: CanaryTrunkPlan,
  env: Record<string, string | undefined> = {},
): BolnaTrunkCreateRequest {
  validateCanaryTrunkPlan(plan);
  const request: BolnaTrunkCreateRequest = {
    name: plan.trunkName,
    description: plan.description,
    preset: plan.preset,
    inboundEnabled: plan.inboundEnabled,
    outboundEnabled: plan.outboundEnabled,
    channels: plan.channels,
    defaultInboundAgentId: plan.defaultInboundAgentId,
    transport: plan.transport,
    outboundLeadingPlusEnabled: plan.outboundLeadingPlusEnabled,
    codecs: plan.codecs,
    gateways: plan.gateways,
    ipAcls: plan.ipAcls,
  };
  if (plan.authUsername && plan.authPasswordEnv) {
    const password = env[plan.authPasswordEnv]?.trim();
    if (!password) {
      throw new BolnaConfigError(`${plan.authPasswordEnv} is required by the canary trunk plan.`);
    }
    request.authUsername = plan.authUsername;
    request.authPassword = password;
  }
  const validated = validateBolnaTrunkCreateRequest(request);
  serializeTrunkCreateRequest(validated);
  return validated;
}

export function buildCanaryTrunkNumberRequests(plan: CanaryTrunkPlan): BolnaTrunkNumberRequest[] {
  validateCanaryTrunkPlan(plan);
  return plan.numbers.map((number) => ({
    e164: number.e164,
    destinationKey: number.destinationKey,
    ...(number.agentId !== undefined ? { agentId: number.agentId } : {}),
  }));
}

export function canaryTrunkPlanFromEnv(env: Record<string, string | undefined>): CanaryTrunkPlan {
  const numbers = splitList(env.BOLNA_TRUNK_NUMBERS).map((e164) => ({
    e164,
    destinationKey: e164.replace(/^\+/, ""),
    agentId: env.BOLNA_TRUNK_INBOUND_AGENT_ID?.trim() || null,
  }));
  const plan: CanaryTrunkPlan = {
    trunkName: env.BOLNA_TRUNK_NAME?.trim() || "ElevateBox canary SIP trunk",
    description: env.BOLNA_TRUNK_DESCRIPTION?.trim() || undefined,
    preset: (env.BOLNA_TRUNK_PRESET?.trim() || "custom") as BolnaTrunkPreset,
    inboundEnabled: env.BOLNA_TRUNK_INBOUND_ENABLED !== "0",
    outboundEnabled: env.BOLNA_TRUNK_OUTBOUND_ENABLED !== "0",
    channels: Number(env.BOLNA_TRUNK_CHANNELS?.trim() || "2"),
    defaultInboundAgentId: env.BOLNA_TRUNK_DEFAULT_AGENT_ID?.trim() || null,
    transport: (env.BOLNA_TRUNK_TRANSPORT?.trim() || "udp") as BolnaTrunkTransport,
    outboundLeadingPlusEnabled: env.BOLNA_TRUNK_OUTBOUND_LEADING_PLUS === "1",
    codecs: env.BOLNA_TRUNK_CODECS?.trim() || "PCMU,PCMA",
    gateways: parseGatewayList(env.BOLNA_TRUNK_GATEWAYS),
    ipAcls: splitList(env.BOLNA_TRUNK_CARRIER_IPS),
    numbers,
    authUsername: env.BOLNA_TRUNK_AUTH_USERNAME?.trim() || undefined,
    authPasswordEnv: env.BOLNA_TRUNK_AUTH_PASSWORD_ENV?.trim() || undefined,
  };
  validateCanaryTrunkPlan(plan);
  return plan;
}

export function maskedCanaryTrunkPlan(plan: CanaryTrunkPlan): Record<string, unknown> {
  return {
    ...plan,
    numbers: plan.numbers.map((number) => ({
      e164: `${number.e164.slice(0, 3)}****${number.e164.slice(-4)}`,
      destinationKey: `${number.destinationKey.slice(0, 2)}****${number.destinationKey.slice(-3)}`,
      hasAgentId: Boolean(number.agentId),
    })),
    digest: canaryTrunkPlanDigest(plan),
  };
}
