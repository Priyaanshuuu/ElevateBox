import { BolnaConfigError, BolnaResponseError } from "./errors.ts";

export type BolnaTelephonyProvider =
  | "twilio"
  | "plivo"
  | "exotel"
  | "vobiz"
  | "trunk"
  | "sip-trunk"
  | "default";

export type BolnaTrunkPreset =
  | "plivo"
  | "telnyx"
  | "twilio"
  | "exotel"
  | "vobiz"
  | "vonage"
  | "custom";

export type BolnaTrunkTransport = "udp" | "tcp";
export type BolnaTrunkCodec = "PCMU" | "PCMA";
export type BolnaTrunkHealth = "ready" | "waiting_for_carrier" | "degraded" | "disabled";
export type BolnaTrunkCallDirection = "inbound" | "outbound";
export type BolnaTrunkCallFilter = "all" | "inbound" | "outbound" | "failed";

export interface BolnaTrunkGatewayRequest {
  host: string;
  port?: number;
  priority?: number;
}

export interface BolnaTrunkCreateRequest {
  name: string;
  description?: string;
  preset?: BolnaTrunkPreset;
  inboundEnabled?: boolean;
  outboundEnabled?: boolean;
  channels?: number;
  defaultInboundAgentId?: string | null;
  authUsername?: string;
  authPassword?: string;
  transport?: BolnaTrunkTransport;
  outboundLeadingPlusEnabled?: boolean;
  codecs?: string;
  gateways?: BolnaTrunkGatewayRequest[];
  ipAcls?: string[];
}

export interface BolnaTrunkGateway {
  id: string;
  trunkId: string;
  host: string;
  resolvedIps: string[] | null;
  port: number;
  priority: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

export interface BolnaTrunkCarrierIp {
  id: string;
  trunkId: string;
  cidr: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

export interface BolnaTrunkNumber {
  id: string;
  trunkId: string;
  e164: string;
  destinationKey: string;
  agentId: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

export interface BolnaTrunk {
  id: string;
  name: string;
  description: string | null;
  preset: BolnaTrunkPreset | null;
  isActive: boolean;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  channels: number;
  defaultInboundAgentId: string | null;
  authUsername: string | null;
  transport: BolnaTrunkTransport;
  codecs: string;
  outboundLeadingPlusEnabled: boolean;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  convertedFromByotTrunkId: string | null;
  organizationId: string | null;
  subAccountId: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
  health: BolnaTrunkHealth;
  activeCalls: number;
  gateways: BolnaTrunkGateway[];
  ipAcls: BolnaTrunkCarrierIp[];
  numbers: BolnaTrunkNumber[];
}

export interface BolnaTrunkListResponse {
  trunks: BolnaTrunk[];
}

export interface BolnaTrunkConnectionDetails {
  sipDomain: string | null;
  ips: string[];
  port: number;
  transports: BolnaTrunkTransport[];
  rtpPorts: string | null;
}

export interface BolnaTrunkCall {
  executionId: string;
  startedAt: string;
  direction: BolnaTrunkCallDirection;
  number: string;
  durationSeconds: number | null;
  outcome: string;
  sipCode: number | null;
  sipCause: string | null;
}

export interface BolnaTrunkCallListResponse {
  calls: BolnaTrunkCall[];
}

export interface BolnaAgentPatchResponse {
  message: string;
  state: "updated";
}

export interface BolnaTrunkNumberRequest {
  e164: string;
  destinationKey: string;
  agentId?: string | null;
}

export interface BolnaCarrierIpRequest {
  cidr: string;
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const PRESETS: readonly BolnaTrunkPreset[] = [
  "plivo",
  "telnyx",
  "twilio",
  "exotel",
  "vobiz",
  "vonage",
  "custom",
];
const HEALTH_VALUES: readonly BolnaTrunkHealth[] = [
  "ready",
  "waiting_for_carrier",
  "degraded",
  "disabled",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, ErrorClass = BolnaResponseError): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ErrorClass(`Bolna trunk response returned an invalid ${field}.`);
  }
  return value;
}

function requireConfigString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BolnaConfigError(`${field} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, field);
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new BolnaResponseError(`Bolna trunk response returned an invalid ${field}.`);
  }
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BolnaResponseError(`Bolna trunk response returned an invalid ${field}.`);
  }
  return value;
}

function nullableInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return requireInteger(value, field);
}

function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new BolnaResponseError(`Bolna trunk response returned an invalid ${field}.`);
  }
  return value as T;
}

function parseNullableStringArray(value: unknown, field: string): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new BolnaResponseError(`Bolna trunk response returned an invalid ${field}.`);
  }
  return [...value] as string[];
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isE164TrunkPhone(value: string): boolean {
  return E164_PATTERN.test(value);
}

function parseIpv4Octets(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

function isPrivateIpv4Octets(octets: readonly number[]): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && b >= 18 && b <= 19) return true;
  return false;
}

export function isPublicIpv4(value: string): boolean {
  const octets = parseIpv4Octets(value);
  return octets !== null && !isPrivateIpv4Octets(octets);
}

export function isPublicIpv4Cidr(value: string): boolean {
  const [address, prefixRaw, ...extra] = value.split("/");
  if (!address || extra.length > 0) return false;
  const octets = parseIpv4Octets(address);
  if (!octets || isPrivateIpv4Octets(octets)) return false;
  if (prefixRaw === undefined) return true;
  if (!/^\d{1,2}$/.test(prefixRaw)) return false;
  const prefix = Number(prefixRaw);
  return prefix >= 16 && prefix <= 32;
}

export function isTrunkGatewayHost(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  if (value === "localhost" || value.endsWith(".local")) return false;
  if (parseIpv4Octets(value)) return isPublicIpv4(value);
  return HOSTNAME_PATTERN.test(value);
}

export function parseTrunkCodecs(value: string): BolnaTrunkCodec[] {
  const parts = value.split(",").map((part) => part.trim().toUpperCase());
  if (parts.length === 0 || parts.length > 2) {
    throw new BolnaResponseError("Bolna trunk response returned invalid codecs.");
  }
  const result: BolnaTrunkCodec[] = [];
  for (const part of parts) {
    if (part !== "PCMU" && part !== "PCMA") {
      throw new BolnaResponseError("Bolna trunk response returned invalid codecs.");
    }
    if (!result.includes(part)) result.push(part);
  }
  return result;
}

export function parseBolnaTrunkGateway(value: unknown): BolnaTrunkGateway {
  if (!isRecord(value)) throw new BolnaResponseError("Bolna trunk gateway is not an object.");
  return {
    id: requireString(value.id, "gateway id"),
    trunkId: requireString(value.trunk_id, "gateway trunk id"),
    host: requireString(value.host, "gateway host"),
    resolvedIps: parseNullableStringArray(value.resolved_ips, "gateway resolved ips"),
    port: requireInteger(value.port, "gateway port"),
    priority: requireInteger(value.priority, "gateway priority"),
    createdAt: requireString(value.created_at, "gateway created_at"),
    updatedAt: requireString(value.updated_at, "gateway updated_at"),
    isDeleted: requireBoolean(value.is_deleted, "gateway is_deleted"),
    deletedAt: nullableString(value.deleted_at, "gateway deleted_at"),
  };
}

export function parseBolnaTrunkCarrierIp(value: unknown): BolnaTrunkCarrierIp {
  if (!isRecord(value)) throw new BolnaResponseError("Bolna carrier IP is not an object.");
  return {
    id: requireString(value.id, "carrier IP id"),
    trunkId: requireString(value.trunk_id, "carrier IP trunk id"),
    cidr: requireString(value.cidr, "carrier IP cidr"),
    createdAt: requireString(value.created_at, "carrier IP created_at"),
    updatedAt: requireString(value.updated_at, "carrier IP updated_at"),
    isDeleted: requireBoolean(value.is_deleted, "carrier IP is_deleted"),
    deletedAt: nullableString(value.deleted_at, "carrier IP deleted_at"),
  };
}

export function parseBolnaTrunkNumber(value: unknown): BolnaTrunkNumber {
  if (!isRecord(value)) throw new BolnaResponseError("Bolna trunk number is not an object.");
  return {
    id: requireString(value.id, "trunk number id"),
    trunkId: requireString(value.trunk_id, "trunk number trunk id"),
    e164: requireString(value.e164, "trunk number e164"),
    destinationKey: requireString(value.destination_key, "trunk number destination_key"),
    agentId: nullableString(value.agent_id, "trunk number agent_id"),
    lastInboundAt: nullableString(value.last_inbound_at, "trunk number last_inbound_at"),
    lastOutboundAt: nullableString(value.last_outbound_at, "trunk number last_outbound_at"),
    createdAt: requireString(value.created_at, "trunk number created_at"),
    updatedAt: requireString(value.updated_at, "trunk number updated_at"),
    isDeleted: requireBoolean(value.is_deleted, "trunk number is_deleted"),
    deletedAt: nullableString(value.deleted_at, "trunk number deleted_at"),
  };
}

export function parseBolnaTrunk(value: unknown): BolnaTrunk {
  if (!isRecord(value)) throw new BolnaResponseError("Bolna trunk is not an object.");
  const presetValue = value.preset;
  if (
    presetValue !== null &&
    presetValue !== undefined &&
    (typeof presetValue !== "string" || !PRESETS.includes(presetValue as BolnaTrunkPreset))
  ) {
    throw new BolnaResponseError("Bolna trunk response returned an invalid preset.");
  }
  const preset = (presetValue ?? null) as BolnaTrunkPreset | null;
  if (!Array.isArray(value.gateways) || !Array.isArray(value.ip_acls) || !Array.isArray(value.numbers)) {
    throw new BolnaResponseError("Bolna trunk response is missing nested resources.");
  }

  return {
    id: requireString(value.id, "trunk id"),
    name: requireString(value.name, "trunk name"),
    description: nullableString(value.description, "trunk description"),
    preset: preset ?? null,
    isActive: requireBoolean(value.is_active, "trunk is_active"),
    inboundEnabled: requireBoolean(value.inbound_enabled, "trunk inbound_enabled"),
    outboundEnabled: requireBoolean(value.outbound_enabled, "trunk outbound_enabled"),
    channels: requireInteger(value.channels, "trunk channels"),
    defaultInboundAgentId: nullableString(value.default_inbound_agent_id, "trunk default agent"),
    authUsername: nullableString(value.auth_username, "trunk auth username"),
    transport: requireEnum(value.transport, "trunk transport", ["udp", "tcp"]),
    codecs: requireString(value.codecs, "trunk codecs"),
    outboundLeadingPlusEnabled: requireBoolean(
      value.outbound_leading_plus_enabled,
      "trunk outbound_leading_plus_enabled",
    ),
    lastInboundAt: nullableString(value.last_inbound_at, "trunk last_inbound_at"),
    lastOutboundAt: nullableString(value.last_outbound_at, "trunk last_outbound_at"),
    convertedFromByotTrunkId: nullableString(
      value.converted_from_byot_trunk_id,
      "trunk converted_from_byot_trunk_id",
    ),
    organizationId: nullableString(value.organization_id, "trunk organization_id"),
    subAccountId: nullableString(value.sub_account_id, "trunk sub_account_id"),
    userId: nullableString(value.user_id, "trunk user_id"),
    createdAt: requireString(value.created_at, "trunk created_at"),
    updatedAt: requireString(value.updated_at, "trunk updated_at"),
    isDeleted: requireBoolean(value.is_deleted, "trunk is_deleted"),
    deletedAt: nullableString(value.deleted_at, "trunk deleted_at"),
    health: requireEnum(value.health, "trunk health", HEALTH_VALUES),
    activeCalls: requireInteger(value.active_calls, "trunk active_calls"),
    gateways: value.gateways.map(parseBolnaTrunkGateway),
    ipAcls: value.ip_acls.map(parseBolnaTrunkCarrierIp),
    numbers: value.numbers.map(parseBolnaTrunkNumber),
  };
}

export function parseBolnaTrunkListResponse(value: unknown): BolnaTrunkListResponse {
  if (!isRecord(value) || !Array.isArray(value.trunks)) {
    throw new BolnaResponseError("Bolna trunk list response is not an object with trunks.");
  }
  return { trunks: value.trunks.map(parseBolnaTrunk) };
}

export function parseBolnaTrunkConnectionDetails(value: unknown): BolnaTrunkConnectionDetails {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna trunk connection details are not an object.");
  }
  if (!Array.isArray(value.ips) || value.ips.some((item) => typeof item !== "string")) {
    throw new BolnaResponseError("Bolna trunk connection details returned invalid ips.");
  }
  if (!Array.isArray(value.transports)) {
    throw new BolnaResponseError("Bolna trunk connection details returned invalid transports.");
  }

  return {
    sipDomain: nullableString(value.sip_domain, "sip domain"),
    ips: [...value.ips] as string[],
    port: requireInteger(value.port, "trunk connection port"),
    transports: value.transports.map((item) =>
      requireEnum(item, "trunk transport", ["udp", "tcp"]),
    ),
    rtpPorts: nullableString(value.rtp_ports, "rtp ports"),
  };
}

export function parseBolnaTrunkCallListResponse(value: unknown): BolnaTrunkCallListResponse {
  if (!isRecord(value) || !Array.isArray(value.calls)) {
    throw new BolnaResponseError("Bolna trunk call list response is not an object with calls.");
  }
  return {
    calls: value.calls.map((item) => {
      if (!isRecord(item)) {
        throw new BolnaResponseError("Bolna trunk call is not an object.");
      }
      return {
        executionId: requireString(item.execution_id, "call execution id"),
        startedAt: requireString(item.started_at, "call started_at"),
        direction: requireEnum(item.direction, "call direction", ["inbound", "outbound"]),
        number: requireString(item.number, "call number"),
        durationSeconds: nullableInteger(item.duration_s, "call duration_s"),
        outcome: requireString(item.outcome, "call outcome"),
        sipCode: nullableInteger(item.sip_code, "call sip_code"),
        sipCause: nullableString(item.sip_cause, "call sip_cause"),
      };
    }),
  };
}

export function parseBolnaAgentPatchResponse(value: unknown): BolnaAgentPatchResponse {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna agent patch response is not an object.");
  }
  const message = requireString(value.message, "agent patch message");
  if (value.state !== "updated") {
    throw new BolnaResponseError("Bolna agent patch response state is not updated.");
  }
  return { message, state: "updated" };
}

function assertKnownFields(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new BolnaConfigError(`Unknown SIP trunk field: ${key}.`);
    }
  }
}

export function validateBolnaTrunkGatewayRequest(value: unknown): BolnaTrunkGatewayRequest {
  if (!isRecord(value)) throw new BolnaConfigError("Gateway must be an object.");
  assertKnownFields(value, ["host", "port", "priority"]);
  const host = requireConfigString(value.host, "Gateway host");
  if (!isTrunkGatewayHost(host)) {
    throw new BolnaConfigError("Gateway host must be a public IPv4 address or DNS name.");
  }
  const port = value.port === undefined ? 5060 : value.port;
  const priority = value.priority === undefined ? 0 : value.priority;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BolnaConfigError("Gateway port must be an integer from 1 to 65535.");
  }
  if (
    typeof priority !== "number" ||
    !Number.isInteger(priority) ||
    priority < 0 ||
    priority > 100
  ) {
    throw new BolnaConfigError("Gateway priority must be an integer from 0 to 100.");
  }
  return { host, port, priority };
}

export function validateBolnaTrunkCreateRequest(value: unknown): BolnaTrunkCreateRequest {
  if (!isRecord(value)) throw new BolnaConfigError("Trunk request must be an object.");
  assertKnownFields(value, [
    "name",
    "description",
    "preset",
    "inbound_enabled",
    "outbound_enabled",
    "channels",
    "default_inbound_agent_id",
    "auth_username",
    "auth_password",
    "transport",
    "outbound_leading_plus_enabled",
    "codecs",
    "gateways",
    "ip_acls",
    "inboundEnabled",
    "outboundEnabled",
    "channels",
    "defaultInboundAgentId",
    "authUsername",
    "authPassword",
    "outboundLeadingPlusEnabled",
    "ipAcls",
  ]);

  const name = requireConfigString(value.name, "Trunk name");
  if (name.length < 1 || name.length > 100) {
    throw new BolnaConfigError("Trunk name must be 1 to 100 characters.");
  }
  const description = value.description;
  if (description !== undefined && (typeof description !== "string" || description.length > 500)) {
    throw new BolnaConfigError("Trunk description must be at most 500 characters.");
  }
  const preset = value.preset ?? "custom";
  if (typeof preset !== "string" || !PRESETS.includes(preset as BolnaTrunkPreset)) {
    throw new BolnaConfigError("Unknown SIP trunk preset.");
  }

  const channels = value.channels ?? 10;
  if (typeof channels !== "number" || !Number.isInteger(channels) || channels < 1 || channels > 1000) {
    throw new BolnaConfigError("Trunk channels must be an integer from 1 to 1000.");
  }
  const transport = value.transport ?? "udp";
  if (transport !== "udp" && transport !== "tcp") {
    throw new BolnaConfigError("Trunk transport must be udp or tcp.");
  }
  const codecs = typeof value.codecs === "string" ? value.codecs : "PCMU,PCMA";
  try {
    parseTrunkCodecs(codecs);
  } catch {
    throw new BolnaConfigError("Trunk codecs must be a subset of PCMU and PCMA.");
  }

  const authUsername = value.auth_username ?? value.authUsername;
  const authPassword = value.auth_password ?? value.authPassword;
  if (Boolean(authUsername) !== Boolean(authPassword)) {
    throw new BolnaConfigError("Trunk auth username and password must be set together.");
  }
  for (const [field, credential] of [
    ["auth username", authUsername],
    ["auth password", authPassword],
  ] as const) {
    if (credential === undefined) continue;
    if (typeof credential !== "string" || credential.length === 0) {
      throw new BolnaConfigError(`${field} must be a non-empty string.`);
    }
    if (/["|{}\\\u0000-\u001f]/.test(credential)) {
      throw new BolnaConfigError(`${field} contains a forbidden character.`);
    }
  }

  const defaultAgent = value.default_inbound_agent_id ?? value.defaultInboundAgentId ?? null;
  if (defaultAgent !== null && (typeof defaultAgent !== "string" || !isUuid(defaultAgent))) {
    throw new BolnaConfigError("Default inbound agent id must be a UUID or null.");
  }

  const rawGateways = value.gateways ?? [];
  if (!Array.isArray(rawGateways) || rawGateways.length > 8) {
    throw new BolnaConfigError("A trunk supports at most 8 gateways.");
  }
  const gateways = rawGateways.map(validateBolnaTrunkGatewayRequest);

  const rawIpAcls = value.ip_acls ?? value.ipAcls ?? [];
  if (!Array.isArray(rawIpAcls) || rawIpAcls.length > 32) {
    throw new BolnaConfigError("A trunk supports at most 32 carrier IPs.");
  }
  const ipAcls: string[] = [];
  for (const entry of rawIpAcls) {
    if (typeof entry !== "string" || !isPublicIpv4Cidr(entry)) {
      throw new BolnaConfigError("Carrier IPs must be public IPv4 addresses or /16-or-narrower CIDRs.");
    }
    ipAcls.push(entry);
  }

  const request: BolnaTrunkCreateRequest = {
    name,
    description: description as string | undefined,
    preset: preset as BolnaTrunkPreset,
    inboundEnabled: (value.inbound_enabled ?? value.inboundEnabled ?? true) as boolean,
    outboundEnabled: (value.outbound_enabled ?? value.outboundEnabled ?? true) as boolean,
    channels,
    defaultInboundAgentId: defaultAgent,
    transport,
    outboundLeadingPlusEnabled: (value.outbound_leading_plus_enabled ??
      value.outboundLeadingPlusEnabled ??
      false) as boolean,
    codecs,
    gateways,
    ipAcls,
  };
  if (authUsername !== undefined && typeof authUsername === "string") {
    request.authUsername = authUsername;
  }
  if (authPassword !== undefined && typeof authPassword === "string") {
    request.authPassword = authPassword;
  }
  if (typeof request.inboundEnabled !== "boolean" || typeof request.outboundEnabled !== "boolean") {
    throw new BolnaConfigError("Trunk inbound/outbound enabled flags must be booleans.");
  }
  if (typeof request.outboundLeadingPlusEnabled !== "boolean") {
    throw new BolnaConfigError("Trunk outbound leading plus flag must be a boolean.");
  }
  return request;
}

export function serializeTrunkCreateRequest(request: BolnaTrunkCreateRequest): Record<string, unknown> {
  const validated = validateBolnaTrunkCreateRequest(request);
  const body: Record<string, unknown> = {
    name: validated.name,
    preset: validated.preset,
    inbound_enabled: validated.inboundEnabled,
    outbound_enabled: validated.outboundEnabled,
    channels: validated.channels,
    transport: validated.transport,
    outbound_leading_plus_enabled: validated.outboundLeadingPlusEnabled,
    codecs: validated.codecs,
    gateways: validated.gateways,
    ip_acls: validated.ipAcls,
  };
  if (validated.description !== undefined) body.description = validated.description;
  if (validated.defaultInboundAgentId !== undefined) {
    body.default_inbound_agent_id = validated.defaultInboundAgentId;
  }
  if (validated.authUsername !== undefined) body.auth_username = validated.authUsername;
  if (validated.authPassword !== undefined) body.auth_password = validated.authPassword;
  return body;
}

export function validateTrunkNumberRequest(value: unknown): BolnaTrunkNumberRequest {
  if (!isRecord(value)) throw new BolnaConfigError("Trunk number request must be an object.");
  assertKnownFields(value, ["e164", "destination_key", "destinationKey", "agent_id", "agentId"]);
  const e164 = requireConfigString(value.e164, "Trunk number e164");
  if (!isE164TrunkPhone(e164)) {
    throw new BolnaConfigError("Trunk number must be E.164 with a leading plus.");
  }
  const destinationKey =
    typeof value.destination_key === "string"
      ? value.destination_key
      : typeof value.destinationKey === "string"
        ? value.destinationKey
        : undefined;
  if (!destinationKey || !/^\d+$/.test(destinationKey)) {
    throw new BolnaConfigError("Destination key must contain only digits.");
  }
  const agentId = value.agent_id ?? value.agentId ?? null;
  if (agentId !== null && (typeof agentId !== "string" || !isUuid(agentId))) {
    throw new BolnaConfigError("Trunk number agent id must be a UUID or null.");
  }
  return { e164, destinationKey, agentId };
}

export function serializeTrunkNumberRequest(request: BolnaTrunkNumberRequest): Record<string, unknown> {
  const validated = validateTrunkNumberRequest(request);
  return {
    e164: validated.e164,
    destination_key: validated.destinationKey,
    ...(validated.agentId !== undefined ? { agent_id: validated.agentId } : {}),
  };
}

export function validateCarrierIpRequest(value: unknown): BolnaCarrierIpRequest {
  if (!isRecord(value)) throw new BolnaConfigError("Carrier IP request must be an object.");
  assertKnownFields(value, ["cidr"]);
  const cidr = requireConfigString(value.cidr, "Carrier IP cidr");
  if (!isPublicIpv4Cidr(cidr)) {
    throw new BolnaConfigError("Carrier IP must be a public IPv4 address or /16-or-narrower CIDR.");
  }
  return { cidr };
}

export function validateAgentTelephonyProvider(value: string): BolnaTelephonyProvider {
  if (
    value !== "twilio" &&
    value !== "plivo" &&
    value !== "exotel" &&
    value !== "vobiz" &&
    value !== "trunk" &&
    value !== "sip-trunk" &&
    value !== "default"
  ) {
    throw new BolnaConfigError("Unsupported Bolna telephony provider.");
  }
  return value;
}

export function buildAgentTelephonyPatchRequest(
  provider: BolnaTelephonyProvider,
): Record<string, unknown> {
  return { agent_config: { telephony_provider: validateAgentTelephonyProvider(provider) } };
}
