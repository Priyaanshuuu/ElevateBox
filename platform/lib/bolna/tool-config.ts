import { createHash } from "node:crypto";
import { BolnaConfigError } from "./errors.ts";

export const TOOL_AUTH_MIN_TOKEN_LENGTH = 32;
export const BOLNA_TOOL_SCHEMA_VERSION = "step5-v1";

export type BolnaToolName = "schedule_callback" | "trigger_hot_lead_whatsapp";

export interface BolnaCustomFunctionParam {
  method: "POST";
  url: string;
  api_token: string;
  headers: Record<string, string>;
  param: string;
}

export interface BolnaApiToolsConfig {
  tools: string;
  tools_params: Record<string, BolnaCustomFunctionParam>;
}

interface ToolDefinition {
  name: BolnaToolName;
  description: string;
  pre_call_message: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  key: "custom_task";
}

const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "schedule_callback",
    description:
      "Use when the caller asks for a callback, a call back later, a follow-up call, or a convenient time to speak again. Collect the lead id, timezone, and either a natural language time or an ISO scheduled_at value. Do not call this tool for vague phrases like 'call me sometime' without asking for a day or time.",
    pre_call_message: "Let me note that down for you.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "ElevateBox lead id for this customer" },
        call_id: { type: "string", description: "Optional ElevateBox call id for this call" },
        timezone: {
          type: "string",
          description: "IANA timezone for the requested callback, for example Asia/Kolkata",
        },
        request_text: {
          type: "string",
          description: "Natural language callback time spoken by the caller",
        },
        scheduled_at: {
          type: "string",
          description: "Optional ISO-8601 future timestamp with timezone offset",
        },
        notes: { type: "string", description: "Optional short callback note" },
      },
      required: ["lead_id", "timezone"],
    },
    key: "custom_task",
  },
  {
    name: "trigger_hot_lead_whatsapp",
    description:
      "Use only after the caller clearly says they are interested in a discovery call or next step and the lead is qualified as hot. Sends one alert to the sales team. Never call this tool for cold, warm, or unknown intent.",
    pre_call_message: "Great, let me share that with our team.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "ElevateBox lead id for this customer" },
        call_id: { type: "string", description: "Optional ElevateBox call id for this call" },
        to_phone_number: {
          type: "string",
          description: "Sales team WhatsApp number in E.164 format",
        },
        context_text: {
          type: "string",
          description: "Short summary of why the lead is hot",
        },
        resume_text_or_url: {
          type: "string",
          description: "Discovery call link or short resume text for the sales team",
        },
        my_phone_number: {
          type: "string",
          description: "Caller phone number in E.164 format",
        },
      },
      required: [
        "lead_id",
        "to_phone_number",
        "context_text",
        "resume_text_or_url",
        "my_phone_number",
      ],
    },
    key: "custom_task",
  },
];

export function listBolnaToolNames(): BolnaToolName[] {
  return TOOL_DEFINITIONS.map((tool) => tool.name);
}

export function isBolnaToolName(value: string): value is BolnaToolName {
  return TOOL_DEFINITIONS.some((tool) => tool.name === value);
}

function validateToolBaseUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BolnaConfigError("Bolna tool base URL must be an absolute URL.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new BolnaConfigError(
      "Bolna tool base URL must not contain credentials, query string, or fragment.",
    );
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new BolnaConfigError("Bolna tool base URL must use HTTPS outside local development.");
  }
  return parsed;
}

export function validateBolnaToolUrl(rawUrl: string): void {
  const parsed = new URL(validateToolBaseUrl(rawUrl).toString());
  if (!parsed.pathname.startsWith("/api/bolna/tools/")) {
    throw new BolnaConfigError("Bolna tool URL must point to /api/bolna/tools/{tool}.");
  }
}

export function buildBolnaToolUrl(baseUrl: string, toolName: BolnaToolName): string {
  if (!isBolnaToolName(toolName)) {
    throw new BolnaConfigError(`Unknown Bolna tool: ${toolName}.`);
  }
  const parsed = validateToolBaseUrl(baseUrl);
  const path = `${parsed.pathname.replace(/\/$/, "")}/api/bolna/tools/${toolName}`;
  return `${parsed.origin}${path}`;
}

function validateToolToken(token: string): void {
  if (token.length < TOOL_AUTH_MIN_TOKEN_LENGTH || /\s/.test(token)) {
    throw new BolnaConfigError(
      `Bolna tool token must be at least ${TOOL_AUTH_MIN_TOKEN_LENGTH} characters with no whitespace.`,
    );
  }
}

function buildParamMap(definition: ToolDefinition): string {
  const param: Record<string, string> = {};
  for (const name of Object.keys(definition.parameters.properties)) {
    param[name] = `%(${name})s`;
  }
  return JSON.stringify(param);
}

export function buildElevateBoxToolConfig(options: {
  baseUrl: string;
  token: string;
}): BolnaApiToolsConfig {
  validateToolToken(options.token);
  const tools = TOOL_DEFINITIONS.map((definition) => ({ ...definition }));
  const toolsParams: Record<string, BolnaCustomFunctionParam> = {};

  for (const definition of tools) {
    toolsParams[definition.name] = {
      method: "POST",
      url: buildBolnaToolUrl(options.baseUrl, definition.name),
      api_token: `Bearer ${options.token}`,
      headers: { "Content-Type": "application/json" },
      param: buildParamMap(definition),
    };
  }

  return {
    tools: JSON.stringify(tools),
    tools_params: toolsParams,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function toolConfigDigest(config: BolnaApiToolsConfig): string {
  return createHash("sha256").update(stableStringify(config)).digest("hex");
}

export function validateBolnaToolConfig(config: BolnaApiToolsConfig): void {
  let definitions: Array<{ name?: unknown }>;
  try {
    const parsed: unknown = JSON.parse(config.tools);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    definitions = parsed as Array<{ name?: unknown }>;
  } catch {
    throw new BolnaConfigError("Bolna api_tools.tools must be a JSON array string.");
  }
  if (definitions.length === 0) {
    throw new BolnaConfigError("Bolna api_tools.tools must not be empty.");
  }

  for (const definition of definitions) {
    const name = definition.name;
    if (typeof name !== "string" || !name) {
      throw new BolnaConfigError("Every Bolna tool definition needs a name.");
    }
    const params = config.tools_params[name];
    if (!params) {
      throw new BolnaConfigError(`Bolna tool ${name} is missing tools_params.`);
    }
    if (params.method !== "POST") {
      throw new BolnaConfigError(`Bolna tool ${name} must use POST.`);
    }
    validateBolnaToolUrl(params.url);
    if (!params.api_token.startsWith("Bearer ")) {
      throw new BolnaConfigError(`Bolna tool ${name} api_token must be a Bearer token.`);
    }
    const bearer = params.api_token.slice("Bearer ".length);
    if (bearer.length < TOOL_AUTH_MIN_TOKEN_LENGTH || /\s/.test(bearer)) {
      throw new BolnaConfigError(`Bolna tool ${name} token is too short or contains whitespace.`);
    }
    let paramMap: unknown;
    try {
      paramMap = JSON.parse(params.param);
    } catch {
      throw new BolnaConfigError(`Bolna tool ${name} param must be a JSON string.`);
    }
    if (typeof paramMap !== "object" || paramMap === null || Array.isArray(paramMap)) {
      throw new BolnaConfigError(`Bolna tool ${name} param must be a JSON object string.`);
    }
  }
}
