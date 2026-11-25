import { BolnaResponseError } from "./errors.ts";

export type BolnaLanguageCode = "en" | "hi" | "te";
export type BolnaPipelineStage = "transcriber" | "llm" | "synthesizer";
export type BolnaTaskType = "conversation" | "extraction" | "summarization";

export interface BolnaLlmConfig {
  provider: string;
  model: string;
  temperature: number;
  max_tokens: number;
  verbosity?: "low" | "medium" | "high";
  reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  compact_threshold?: number | null;
  request_json?: boolean;
  [key: string]: unknown;
}

export interface BolnaLlmAgentConfig {
  agent_type: "simple_llm_agent" | "knowledgebase_agent";
  agent_flow_type: "streaming";
  llm_config: BolnaLlmConfig;
  [key: string]: unknown;
}

export interface BolnaTranscriberConfig {
  provider: string;
  model: string;
  language: string;
  stream?: boolean;
  encoding?: "linear16" | "mulaw";
  sampling_rate?: number;
  endpointing?: number;
  keywords?: string | null;
  context?: string | null;
  vad_threshold?: number;
  vad_prefix_padding_ms?: number;
  language_hints?: string[] | null;
  [key: string]: unknown;
}

export interface BolnaSynthesizerConfig {
  provider: string;
  provider_config: Record<string, unknown>;
  stream?: boolean;
  caching?: boolean;
  buffer_size?: number;
  audio_format?: "wav";
  [key: string]: unknown;
}

export interface BolnaInputOutputConfig {
  provider: string;
  format: string;
  [key: string]: unknown;
}

export interface BolnaMultilingualLanguageEntry {
  transcriber?: Partial<BolnaTranscriberConfig> & { language: string };
  synthesizer: BolnaSynthesizerConfig;
  system_prompt?: string;
  handoff_message?: string;
  agent_name?: string;
  welcome_message?: string;
  [key: string]: unknown;
}

export interface BolnaMultilingualConfig {
  enabled: boolean;
  active_language: string;
  language_switch_trigger: "requested_or_auto_detected" | "caller_requested";
  languages: Record<string, BolnaMultilingualLanguageEntry>;
  [key: string]: unknown;
}

export interface BolnaConversationTaskConfig {
  hangup_after_silence?: number;
  hangup_after_LLMCall?: boolean;
  incremental_delay?: number;
  number_of_words_for_interruption?: number;
  backchanneling?: boolean;
  backchanneling_message_gap?: number;
  backchanneling_start_delay?: number;
  call_terminate?: number;
  welcome_message_delay?: number;
  noise_cancellation_level?: number | null;
  call_hangup_message?: string | Record<string, string> | null;
  interruptible_hangup_message?: boolean;
  check_if_user_online?: boolean;
  trigger_user_online_message_after?: number;
  voicemail?: boolean;
  voicemail_detection_duration?: number;
  voicemail_check_interval?: number;
  voicemail_min_transcript_length?: number;
  [key: string]: unknown;
}

export interface BolnaTaskConfig {
  task_type: BolnaTaskType;
  toolchain: {
    execution: "sequential" | "parallel";
    pipelines: BolnaPipelineStage[][];
  };
  tools_config: {
    llm_agent: BolnaLlmAgentConfig;
    synthesizer: BolnaSynthesizerConfig;
    transcriber: BolnaTranscriberConfig;
    input: BolnaInputOutputConfig;
    output: BolnaInputOutputConfig;
    api_tools?: unknown;
    s2s?: unknown;
    multilingual_config?: BolnaMultilingualConfig | null;
  };
  task_config?: BolnaConversationTaskConfig;
}

export interface BolnaAgentConfig {
  agent_name: string;
  agent_welcome_message?: string;
  webhook_url?: string;
  call_summary_enabled?: boolean;
  tasks: BolnaTaskConfig[];
  [key: string]: unknown;
}

export interface BolnaAgentPrompt {
  system_prompt: string;
  [key: string]: unknown;
}

export interface BolnaAgentRequestV2 {
  agent_config: BolnaAgentConfig;
  agent_prompts: Record<string, BolnaAgentPrompt>;
}

export interface BolnaAgentVersionRequestV2 extends BolnaAgentRequestV2 {
  version_name: string;
  tags?: string[];
}

export interface BolnaAgentCreateResponse {
  agent_id: string;
  state: "created";
  version_id: string;
}

export interface BolnaAgentVersionSaveResponse {
  agent_id: string;
  version_id: string;
  version_name?: string;
  state: "saved" | "updated";
}

export interface BolnaAgentVersionSummary {
  id: string;
  version_name: string;
  tags: string[];
  version_status: "saved" | "published";
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export interface BolnaAgentVersionListResponse {
  versions: BolnaAgentVersionSummary[];
  current_version_id: string | null;
  total: number;
  page_number: number;
  page_size: number;
  has_more: boolean;
}

export interface BolnaAgentVersionSetCurrentResponse {
  message: string;
  current_version_id: string;
}

export interface BolnaCallRequest {
  agent_id: string;
  agent_version_id?: string;
  recipient_phone_number: string;
  from_phone_number?: string;
  scheduled_at?: string;
  user_data?: Record<string, string | number | boolean | null>;
  agent_data?: { language?: string; voice_id?: never };
  retry_config?: Record<string, unknown>;
  bypass_call_guardrails?: boolean;
}

export interface BolnaCallResponse {
  message: string;
  status: "queued";
  execution_id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BolnaResponseError(`Bolna response returned an invalid ${field}.`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new BolnaResponseError(`Bolna response returned an invalid ${field}.`);
  }
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BolnaResponseError(`Bolna response returned an invalid ${field}.`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new BolnaResponseError(`Bolna response returned an invalid ${field}.`);
  }
  return value as string[];
}

export function parseBolnaAgentCreateResponse(value: unknown): BolnaAgentCreateResponse {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna agent create did not return an object.");
  }
  if (value.state !== "created") {
    throw new BolnaResponseError("Bolna agent create returned an unexpected state.");
  }

  return {
    agent_id: requireString(value.agent_id, "agent_id"),
    state: "created",
    version_id: requireString(value.version_id, "version_id"),
  };
}

export function parseBolnaAgentVersionSaveResponse(
  value: unknown,
): BolnaAgentVersionSaveResponse {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna version save did not return an object.");
  }
  if (value.state !== "saved" && value.state !== "updated") {
    throw new BolnaResponseError("Bolna version save returned an unexpected state.");
  }

  return {
    agent_id: requireString(value.agent_id, "agent_id"),
    version_id: requireString(value.version_id, "version_id"),
    ...(value.version_name === undefined
      ? {}
      : { version_name: requireString(value.version_name, "version_name") }),
    state: value.state,
  };
}

export function parseBolnaAgentVersionListResponse(
  value: unknown,
): BolnaAgentVersionListResponse {
  if (!isRecord(value) || !Array.isArray(value.versions)) {
    throw new BolnaResponseError("Bolna version list did not return a versions array.");
  }

  const versions = value.versions.map((rawVersion): BolnaAgentVersionSummary => {
    if (!isRecord(rawVersion)) {
      throw new BolnaResponseError("Bolna version list contained an invalid version.");
    }
    if (rawVersion.version_status !== "saved" && rawVersion.version_status !== "published") {
      throw new BolnaResponseError("Bolna version list contained an invalid version_status.");
    }

    return {
      id: requireString(rawVersion.id, "version id"),
      version_name: requireString(rawVersion.version_name, "version_name"),
      tags: optionalStringArray(rawVersion.tags, "version tags"),
      version_status: rawVersion.version_status,
      is_current: requireBoolean(rawVersion.is_current, "is_current"),
      created_at: requireString(rawVersion.created_at, "created_at"),
      updated_at: requireString(rawVersion.updated_at, "updated_at"),
    };
  });

  const currentVersionId =
    value.current_version_id === null
      ? null
      : requireString(value.current_version_id, "current_version_id");

  return {
    versions,
    current_version_id: currentVersionId,
    total: requireInteger(value.total, "total"),
    page_number: requireInteger(value.page_number, "page_number"),
    page_size: requireInteger(value.page_size, "page_size"),
    has_more: requireBoolean(value.has_more, "has_more"),
  };
}

export function parseBolnaAgentVersionSetCurrentResponse(
  value: unknown,
): BolnaAgentVersionSetCurrentResponse {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna set-current did not return an object.");
  }

  return {
    message: requireString(value.message, "message"),
    current_version_id: requireString(value.current_version_id, "current_version_id"),
  };
}

export function parseBolnaCallResponse(value: unknown): BolnaCallResponse {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna call create did not return an object.");
  }
  if (value.status !== "queued") {
    throw new BolnaResponseError("Bolna call create returned an unexpected status.");
  }

  return {
    message: requireString(value.message, "message"),
    status: "queued",
    execution_id: requireString(value.execution_id, "execution_id"),
  };
}
