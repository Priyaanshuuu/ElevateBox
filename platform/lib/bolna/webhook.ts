import { createHash } from "node:crypto";
import { BolnaWebhookError } from "./errors.ts";
import type { InternalCallStatus, InternalLeadIntent } from "./webhook-store.ts";

export const BOLNA_CALL_STATUS = {
  INITIATED: "INITIATED",
  RINGING: "RINGING",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export const BOLNA_LEAD_INTENT = {
  HOT: "HOT",
  WARM: "WARM",
  COLD: "COLD",
  UNKNOWN: "UNKNOWN",
} as const;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface NormalizedBolnaWebhook {
  executionId: string;
  eventType: string | null;
  status: string;
  agentId: string | null;
  agentNumber: string | null;
  agentVersionId: string | null;
  batchId: string | null;
  terminationReason: string | null;
  errorMessage: string | null;
  phoneNumber: string | null;
  direction: "inbound" | "outbound" | "unknown";
  recordingUrl: string | null;
  conversationDuration: number | null;
  totalCost: number | null;
  transcript: string | null;
  summary: string | null;
  extractedData: JsonValue | null;
  nodeExtractedData: JsonValue | null;
  telephonyData: JsonValue | null;
  costBreakdown: JsonValue | null;
  occurredAt: Date | null;
  bolnaCreatedAt: Date | null;
  bolnaUpdatedAt: Date | null;
  isTerminal: boolean;
}

export interface LeadFacts {
  business: string | null;
  productCount: number | null;
  budget: number | null;
  timeline: string | null;
  features: string[];
  intent: InternalLeadIntent | null;
}

const TERMINAL_SUCCESS = new Set(["completed"]);
const TERMINAL_FAILURE = new Set([
  "no-answer",
  "busy",
  "failed",
  "canceled",
  "cancelled",
  "stopped",
  "error",
  "balance-low",
  "aborted",
]);
const KNOWN_STATUSES = new Set([
  "scheduled",
  "queued",
  "rescheduled",
  "initiated",
  "ringing",
  "in-progress",
  "call-disconnected",
  ...TERMINAL_SUCCESS,
  ...TERMINAL_FAILURE,
]);

const SAFE_HEADER_NAMES = new Set([
  "content-type",
  "user-agent",
  "x-bolna-event-id",
  "x-bolna-delivery-id",
  "x-bolna-execution-id",
  "idempotency-key",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function readDate(record: Record<string, unknown> | null, key: string): Date | null {
  const value = readString(record, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readJson(value: unknown): JsonValue | null {
  return value === undefined ? null : (value as JsonValue);
}

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\s()-]/g, "");
  return normalized.length >= 7 ? normalized : null;
}

function resolvePhoneNumber(
  root: Record<string, unknown>,
  telephony: Record<string, unknown> | null,
  direction: NormalizedBolnaWebhook["direction"],
): string | null {
  const to = readString(telephony, "to_number");
  const from = readString(telephony, "from_number");
  const userNumber = readString(root, "user_number");

  if (direction === "outbound") return normalizePhone(to ?? userNumber ?? from);
  if (direction === "inbound") return normalizePhone(from ?? userNumber ?? to);
  return normalizePhone(userNumber ?? to ?? from);
}

function resolveDirection(
  root: Record<string, unknown>,
  telephony: Record<string, unknown> | null,
): NormalizedBolnaWebhook["direction"] {
  const value = (readString(telephony, "call_type") ?? readString(root, "call_type") ?? "").toLowerCase();
  if (value === "inbound") return "inbound";
  if (value === "outbound") return "outbound";
  return "unknown";
}

function flattenJson(value: unknown, prefix = "", output: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined) return output;

  if (Array.isArray(value)) {
    if (prefix) {
      output[prefix] = value.map((item) => String(item)).join(", ");
    }
    return output;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      flattenJson(child, nextPrefix, output);
    }
    return output;
  }

  if (prefix) {
    output[prefix] = String(value);
  }
  return output;
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findFlattenedValue(
  flat: Record<string, string>,
  aliases: readonly string[],
): string | null {
  for (const [key, value] of Object.entries(flat)) {
    const keyNormalized = normalizedKey(key);
    if (aliases.some((alias) => keyNormalized.includes(alias))) return value;
  }
  return null;
}

function parseLeadIntent(value: string | null): InternalLeadIntent | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper.includes("HOT")) return BOLNA_LEAD_INTENT.HOT;
  if (upper.includes("WARM")) return BOLNA_LEAD_INTENT.WARM;
  if (upper.includes("COLD")) return BOLNA_LEAD_INTENT.COLD;
  if (upper.includes("UNKNOWN")) return BOLNA_LEAD_INTENT.UNKNOWN;
  return null;
}

function parseCommaList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseBolnaWebhookPayload(payload: unknown): NormalizedBolnaWebhook {
  const root = asRecord(payload);
  if (!root) {
    throw new BolnaWebhookError("Bolna webhook payload must be an object.");
  }

  const executionId = readString(root, "execution_id") ?? readString(root, "id");
  if (!executionId) {
    throw new BolnaWebhookError("Bolna webhook payload is missing execution_id.");
  }

  const telephony = asRecord(root.telephony_data);
  const status = (readString(root, "status") ?? "unknown").toLowerCase();
  const direction = resolveDirection(root, telephony);

  return {
    executionId,
    eventType: readString(root, "event"),
    status,
    agentId: readString(root, "agent_id"),
    agentNumber: readString(root, "agent_number"),
    agentVersionId: readString(root, "agent_version_id"),
    batchId: readString(root, "batch_id"),
    terminationReason: readString(root, "termination_reason"),
    errorMessage: readString(root, "error_message"),
    phoneNumber: resolvePhoneNumber(root, telephony, direction),
    direction,
    recordingUrl: readString(telephony, "recording_url") ?? readString(root, "recording_url"),
    conversationDuration:
      readNumber(root, "conversation_duration") ?? readNumber(telephony, "duration"),
    totalCost: readNumber(root, "total_cost"),
    transcript: readString(root, "transcript"),
    summary: sanitizeCallSummary(root.summary),
    extractedData: readJson(root.extracted_data),
    nodeExtractedData: readJson(root.node_extracted_data),
    telephonyData: readJson(root.telephony_data),
    costBreakdown: readJson(root.cost_breakdown),
    occurredAt:
      readDate(root, "occurred_at") ?? readDate(root, "updated_at") ?? readDate(root, "created_at"),
    bolnaCreatedAt: readDate(root, "created_at"),
    bolnaUpdatedAt: readDate(root, "updated_at"),
    isTerminal: isTerminalBolnaStatus(status),
  };
}

export function isTerminalBolnaStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return TERMINAL_SUCCESS.has(normalized) || TERMINAL_FAILURE.has(normalized);
}

export function isKnownBolnaStatus(status: string): boolean {
  return KNOWN_STATUSES.has(status.toLowerCase());
}

export function mapBolnaStatusToCallStatus(status: string): InternalCallStatus | null {
  const normalized = status.toLowerCase();

  if (TERMINAL_SUCCESS.has(normalized)) return BOLNA_CALL_STATUS.COMPLETED;
  if (TERMINAL_FAILURE.has(normalized)) return BOLNA_CALL_STATUS.FAILED;
  if (normalized === "in-progress") return BOLNA_CALL_STATUS.IN_PROGRESS;
  if (normalized === "ringing") return BOLNA_CALL_STATUS.RINGING;
  if (normalized === "scheduled" || normalized === "queued" || normalized === "rescheduled" || normalized === "initiated") {
    return BOLNA_CALL_STATUS.INITIATED;
  }

  // call-disconnected is intentionally not a terminal call state.
  return null;
}

export function shouldProjectIncomingBolnaEvent(
  existingStatus: string | null,
  incomingStatus: string,
): boolean {
  if (!existingStatus) return true;
  if (!isTerminalBolnaStatus(existingStatus)) return true;

  // Only a repeated terminal status may refresh finalized fields. A different
  // late status must never downgrade an already-final call.
  const existing = existingStatus.toLowerCase();
  const incoming = incomingStatus.toLowerCase();
  return existing === incoming && isTerminalBolnaStatus(incoming);
}

export const MIN_EXTRACTION_CONFIDENCE = 0.5;
const NO_USER_TURN_SUMMARY_MARKER = "Summary not generated as there was no user turn";

export function sanitizeCallSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === NO_USER_TURN_SUMMARY_MARKER) return null;
  return trimmed;
}

interface NestedExtractionResult {
  category: string;
  name: string;
  value: Record<string, unknown>;
}

function looksLikeExtractionResult(value: Record<string, unknown>): boolean {
  return [
    "subjective",
    "objective",
    "confidence",
    "status",
    "status_reason",
  ].some((key) => key in value);
}

function collectNestedExtractionResults(
  sources: readonly unknown[],
): NestedExtractionResult[] {
  const output: NestedExtractionResult[] = [];
  for (const source of sources) {
    const root = asRecord(source);
    if (!root) continue;

    for (const [category, categoryValue] of Object.entries(root)) {
      const categoryRecord = asRecord(categoryValue);
      if (!categoryRecord) continue;

      for (const [name, resultValue] of Object.entries(categoryRecord)) {
        const result = asRecord(resultValue);
        if (result && looksLikeExtractionResult(result)) {
          output.push({ category, name, value: result });
        }
      }
    }
  }
  return output;
}

function resultText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "null") return null;
    return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => resultText(item))
      .filter((item): item is string => Boolean(item))
      .join(", ");
    return joined || null;
  }
  return null;
}

function isUsableExtractionResult(result: Record<string, unknown>): boolean {
  const status =
    typeof result.status === "string" ? result.status.trim().toLowerCase() : "completed";
  if (status !== "completed") return false;

  const confidence = result.confidence;
  if (
    typeof confidence === "number" &&
    Number.isFinite(confidence) &&
    confidence < MIN_EXTRACTION_CONFIDENCE
  ) {
    return false;
  }

  return true;
}

interface NestedValueLookup {
  matched: boolean;
  value: string | null;
}

function findNestedValue(
  results: readonly NestedExtractionResult[],
  aliases: readonly string[],
): NestedValueLookup {
  const normalizedAliases = aliases.map(normalizedKey);
  let matched = false;

  for (const item of results) {
    const nameKey = normalizedKey(item.name);
    const pathKey = `${normalizedKey(item.category)}${nameKey}`;
    const matches = normalizedAliases.some(
      (alias) => nameKey.includes(alias) || pathKey.includes(alias),
    );
    if (!matches) continue;

    matched = true;
    if (!isUsableExtractionResult(item.value)) continue;

    const value = resultText(item.value.objective) ?? resultText(item.value.subjective);
    if (value) return { matched: true, value };
  }

  return { matched, value: null };
}

export function extractLeadFactsFromData(...sources: readonly unknown[]): LeadFacts {
  const flat: Record<string, string> = {};
  for (const source of sources) {
    flattenJson(source, "", flat);
  }

  const nested = collectNestedExtractionResults(sources);
  const findValue = (aliases: readonly string[]): string | null => {
    const found = findNestedValue(nested, aliases);
    if (found.matched) return found.value;

    // No structured result for this field means the payload may still be a
    // legacy flat extraction. Never fall back through a low-confidence or
    // skipped structured result: that would silently project rejected data.
    return findFlattenedValue(flat, aliases);
  };

  const featureValue = findValue(["features", "requestedfeatures", "websiterequirements"]);

  return {
    business: findValue(["business", "companyname", "businessname"]),
    productCount: readNumber(
      { value: findValue(["productcount", "numberofproducts"]) },
      "value",
    ),
    budget: readNumber({ value: findValue(["budget"]) }, "value"),
    timeline: findValue(["timeline"]),
    features: parseCommaList(featureValue),
    intent: parseLeadIntent(
      findValue(["leadintent", "intent", "qualificationleadintent"]),
    ),
  };
}

export function extractLeadFacts(normalized: NormalizedBolnaWebhook): LeadFacts {
  return extractLeadFactsFromData(normalized.extractedData, normalized.nodeExtractedData);
}

function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function buildWebhookDedupeKey(payload: unknown, normalized: NormalizedBolnaWebhook): string {
  const digest = createHash("sha256").update(stableStringify(payload)).digest("hex");
  return `${normalized.executionId}:${digest}`;
}

export function sanitizeWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (!SAFE_HEADER_NAMES.has(key) || value === undefined) continue;
    output[key] = Array.isArray(value) ? value[0] ?? "" : value;
  }
  return output;
}
