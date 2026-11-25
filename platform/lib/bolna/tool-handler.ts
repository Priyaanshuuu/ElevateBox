import { createHash } from "node:crypto";
import { BolnaToolError } from "./errors.ts";
import { isBolnaToolName } from "./tool-config.ts";
import { isBolnaToolSourceAllowed, isBolnaToolTokenValid } from "./tool-auth.ts";
import type { BolnaToolAuthConfig } from "./tool-auth.ts";
import { resolveCallbackTime } from "../services/callback-time.ts";
import { createScheduledCallback } from "../services/callback.service.ts";
import {
  buildHotLeadWhatsAppMessage,
  loadWhatsAppConfig,
  sendWhatsAppMessage,
} from "../services/whatsapp.service.ts";
import {
  createPendingInterestedLeadWhatsAppEvent,
  getActiveInterestedLeadWhatsAppEvent,
  markAutomationEventCompleted,
  markAutomationEventFailed,
  markAutomationEventTriggered,
} from "../services/automation.service.ts";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type ToolResult = Record<string, JsonValue>;

export interface ScheduleCallbackArgs {
  leadId: string;
  callId: string | null;
  timezone: string;
  requestText: string | null;
  scheduledAt: string | null;
  notes: string | null;
}

export interface HotLeadWhatsAppArgs {
  leadId: string;
  callId: string | null;
  toPhoneNumber: string;
  contextText: string;
  resumeTextOrUrl: string;
  myPhoneNumber: string;
}

export interface ToolInvocationContext {
  executionId: string | null;
  agentId: string | null;
  toolCallId: string | null;
  now: Date;
}

export interface ToolHandlers {
  scheduleCallback(
    args: ScheduleCallbackArgs,
    context: ToolInvocationContext,
  ): Promise<ToolResult>;
  triggerHotLeadWhatsApp(
    args: HotLeadWhatsAppArgs,
    context: ToolInvocationContext,
  ): Promise<ToolResult>;
}

export interface ToolInvocationRecord {
  dedupeKey: string;
  toolName: string;
  status: "pending" | "completed" | "failed";
  result: ToolResult | null;
  errorMessage: string | null;
}

export interface BolnaToolStore {
  claim(input: {
    dedupeKey: string;
    toolName: string;
    executionId: string | null;
  }): Promise<{ claimed: boolean; existing: ToolInvocationRecord | null }>;
  complete(dedupeKey: string, result: ToolResult): Promise<void>;
  fail(dedupeKey: string, errorMessage: string): Promise<void>;
}

export interface HandleBolnaToolRequestInput {
  toolName: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  config: BolnaToolAuthConfig;
  store: BolnaToolStore;
  handlers: ToolHandlers;
  now?: Date;
}

export interface HandleBolnaToolRequestResult {
  status: number;
  body: ToolResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string, maxLength = 2048): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new BolnaToolError(`Invalid ${field}.`);
  }
  return value.trim();
}

function requiredString(value: unknown, field: string, maxLength = 2048): string {
  const result = optionalString(value, field, maxLength);
  if (!result) throw new BolnaToolError(`Missing ${field}.`);
  return result;
}

function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

function requiredPhone(value: unknown, field: string): string {
  const phone = requiredString(value, field, 32);
  if (!isE164(phone)) {
    throw new BolnaToolError(`${field} must be in E.164 format.`);
  }
  return phone;
}

export function parseScheduleCallbackArgs(value: unknown): ScheduleCallbackArgs {
  if (!isRecord(value)) throw new BolnaToolError("Tool arguments must be an object.");
  const timezone = requiredString(value.timezone, "timezone", 100);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new BolnaToolError("timezone must be a valid IANA timezone.");
  }
  const requestText = optionalString(value.request_text, "request_text", 1000);
  const scheduledAt = optionalString(value.scheduled_at, "scheduled_at", 64);
  if (!requestText && !scheduledAt) {
    throw new BolnaToolError("Provide request_text or scheduled_at.");
  }
  return {
    leadId: requiredString(value.lead_id, "lead_id", 100),
    callId: optionalString(value.call_id, "call_id", 100),
    timezone,
    requestText,
    scheduledAt,
    notes: optionalString(value.notes, "notes", 1000),
  };
}

export function parseHotLeadWhatsAppArgs(value: unknown): HotLeadWhatsAppArgs {
  if (!isRecord(value)) throw new BolnaToolError("Tool arguments must be an object.");
  return {
    leadId: requiredString(value.lead_id, "lead_id", 100),
    callId: optionalString(value.call_id, "call_id", 100),
    toPhoneNumber: requiredPhone(value.to_phone_number, "to_phone_number"),
    contextText: requiredString(value.context_text, "context_text", 2000),
    resumeTextOrUrl: requiredString(value.resume_text_or_url, "resume_text_or_url", 2048),
    myPhoneNumber: requiredPhone(value.my_phone_number, "my_phone_number"),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildToolDedupeKey(toolName: string, payload: unknown): string {
  return createHash("sha256")
    .update(toolName)
    .update("\0")
    .update(stableStringify(payload))
    .digest("hex");
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export async function handleBolnaToolRequest(
  input: HandleBolnaToolRequestInput,
): Promise<HandleBolnaToolRequestResult> {
  const now = input.now ?? new Date();

  if (!isBolnaToolName(input.toolName)) {
    return { status: 404, body: { ok: false, error: "unknown_tool" } };
  }
  if (!isBolnaToolTokenValid(headerValue(input.headers, "authorization"), input.config)) {
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }
  if (!isBolnaToolSourceAllowed(input.headers, input.config)) {
    return { status: 403, body: { ok: false, error: "forbidden_source" } };
  }
  if (Buffer.byteLength(input.rawBody, "utf8") > input.config.maxBodyBytes) {
    return { status: 413, body: { ok: false, error: "payload_too_large" } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "invalid_json" } };
  }
  if (!isRecord(payload)) {
    return { status: 400, body: { ok: false, error: "invalid_payload" } };
  }

  const context: ToolInvocationContext = {
    executionId: optionalString(payload.execution_id, "execution_id", 100),
    agentId: optionalString(payload.agent_id, "agent_id", 100),
    toolCallId: optionalString(payload.tool_call_id, "tool_call_id", 100),
    now,
  };

  let args: ScheduleCallbackArgs | HotLeadWhatsAppArgs;
  try {
    args =
      input.toolName === "schedule_callback"
        ? parseScheduleCallbackArgs(payload)
        : parseHotLeadWhatsAppArgs(payload);
  } catch (error) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "invalid_arguments",
        message: error instanceof Error ? error.message : "Invalid arguments.",
      },
    };
  }

  const dedupeKey = buildToolDedupeKey(input.toolName, {
    execution_id: context.executionId,
    args,
  });
  let claim;
  try {
    claim = await input.store.claim({
      dedupeKey,
      toolName: input.toolName,
      executionId: context.executionId,
    });
  } catch {
    return { status: 503, body: { ok: false, error: "store_unavailable" } };
  }

  if (!claim.claimed && claim.existing?.status === "completed") {
    return {
      status: 200,
      body: { ok: true, tool: input.toolName, duplicate: true, result: claim.existing.result },
    };
  }
  if (!claim.claimed && claim.existing?.status === "pending") {
    return { status: 202, body: { ok: true, tool: input.toolName, duplicate: true, pending: true } };
  }

  try {
    const result =
      input.toolName === "schedule_callback"
        ? await input.handlers.scheduleCallback(args as ScheduleCallbackArgs, context)
        : await input.handlers.triggerHotLeadWhatsApp(args as HotLeadWhatsAppArgs, context);
    await input.store.complete(dedupeKey, result);
    return { status: 200, body: { ok: true, tool: input.toolName, duplicate: false, result } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.store.fail(dedupeKey, message.slice(0, 500));
    return { status: 502, body: { ok: false, error: "tool_failed" } };
  }
}

export function createMemoryToolStore(): BolnaToolStore {
  const records = new Map<string, ToolInvocationRecord>();
  return {
    async claim({ dedupeKey, toolName }) {
      const existing = records.get(dedupeKey);
      if (existing && existing.status !== "failed") {
        return { claimed: false, existing };
      }
      const record: ToolInvocationRecord = {
        dedupeKey,
        toolName,
        status: "pending",
        result: null,
        errorMessage: null,
      };
      records.set(dedupeKey, record);
      return { claimed: true, existing: null };
    },
    async complete(dedupeKey, result) {
      const record = records.get(dedupeKey);
      if (record) {
        record.status = "completed";
        record.result = result;
      }
    },
    async fail(dedupeKey, errorMessage) {
      const record = records.get(dedupeKey);
      if (record) {
        record.status = "failed";
        record.errorMessage = errorMessage;
      }
    },
  };
}

export function createProductionToolHandlers(
  env: Record<string, string | undefined> = process.env,
): ToolHandlers {
  const defaultHourRaw = Number.parseInt(env.CALLBACK_DEFAULT_HOUR ?? "10", 10);
  const defaultHour =
    Number.isInteger(defaultHourRaw) && defaultHourRaw >= 0 && defaultHourRaw <= 23
      ? defaultHourRaw
      : 10;

  return {
    async scheduleCallback(args, context) {
      const resolved = resolveCallbackTime({
        timezone: args.timezone,
        ...(args.requestText ? { requestText: args.requestText } : {}),
        ...(args.scheduledAt ? { scheduledAt: args.scheduledAt } : {}),
        defaultHour,
        now: context.now,
      });
      if (resolved.status === "needs-clarification") {
        const clarification: ToolResult = {
          status: "needs-clarification",
          reason: resolved.reason,
        };
        return clarification;
      }

      const callback = await createScheduledCallback({
        leadId: args.leadId,
        ...(args.callId ? { callId: args.callId } : {}),
        scheduledAt: resolved.scheduledAt,
        ...(args.notes ? { notes: args.notes } : {}),
      });
      const scheduled: ToolResult = {
        status: "scheduled",
        callbackId: callback.id,
        scheduledAt: callback.scheduledAt.toISOString(),
      };
      return scheduled;
    },

    async triggerHotLeadWhatsApp(args) {
      const existing = await getActiveInterestedLeadWhatsAppEvent(args.leadId, args.callId ?? undefined);
      if (existing) {
        const skipped: ToolResult = { status: "skipped-duplicate" };
        return skipped;
      }

      const config = loadWhatsAppConfig(env);
      if (!config) {
        throw new BolnaToolError("WhatsApp provider is disabled.");
      }

      const pending = await createPendingInterestedLeadWhatsAppEvent(
        args.leadId,
        args.callId ?? undefined,
        {
          toPhoneNumber: args.toPhoneNumber,
          contextText: args.contextText,
        },
      );

      try {
        await markAutomationEventTriggered(pending.id);
        const result = await sendWhatsAppMessage(
          config,
          args.toPhoneNumber,
          buildHotLeadWhatsAppMessage({
            leadId: args.leadId,
            callerPhoneNumber: args.myPhoneNumber,
            contextText: args.contextText,
            resumeTextOrUrl: args.resumeTextOrUrl,
          }),
        );
        await markAutomationEventCompleted(pending.id, {
          toPhoneNumber: args.toPhoneNumber,
          providerMessageId: result.providerMessageId ?? null,
        });
        const triggered: ToolResult = { status: "triggered", eventId: pending.id };
        return triggered;
      } catch (error) {
        await markAutomationEventFailed(
          pending.id,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
  };
}
