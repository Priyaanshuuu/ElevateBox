import { BolnaResponseError } from "./errors.ts";

export type BolnaExtractionModel =
  | "gpt-4.1-mini"
  | "gpt-4.1-nano"
  | "gpt-4o-mini"
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "gpt-5.4-mini"
  | "gpt-5.6-luna"
  | "gpt-6-luna"
  | "azure/gpt-4.1-mini"
  | "azure/gpt-4.1-nano"
  | "azure/gpt-4o-mini"
  | "azure/gpt-5-mini"
  | "azure/gpt-5.4-mini"
  | "azure/gpt-5.4-nano"
  | "azure/gpt-5.6-luna"
  | "gemini-3.5-flash"
  | "gemini-3.5-flash-lite";

export type BolnaSubjectiveType =
  | "text"
  | "timestamp"
  | "numeric"
  | "boolean"
  | "email"
  | "regex";

export interface BolnaObjectiveOption {
  value: string;
  condition: string;
  sub_options?: BolnaObjectiveOption[];
}

export interface BolnaSubjectiveTypeConfig {
  pattern: string;
  description?: string;
}

export interface BolnaExtractionCategoryCreate {
  name: string;
  model: BolnaExtractionModel;
  managed_by?: "bolna" | "user";
  min_duration_s?: number | null;
  skip_voicemail?: boolean;
  parent_disposition_id?: string | null;
  match_mode?: "in" | "not_in" | null;
  match_values?: string[] | null;
}

export interface BolnaDispositionSummary {
  id: string;
  name: string;
  question: string | null;
  category: string | null;
  categoryId: string | null;
}

export interface BolnaExtractionCategory {
  id: string;
  name: string;
  model: string;
  agentId: string | null;
  managedBy: string | null;
  minDurationS: number | null;
  skipVoicemail: boolean;
  parentDispositionId: string | null;
  matchMode: "in" | "not_in" | null;
  matchValues: string[] | null;
  dispositions: BolnaDispositionSummary[];
}

export interface BolnaExtractionCategoryListResponse {
  categories: BolnaExtractionCategory[];
}

export interface BolnaDispositionItem {
  name: string;
  question: string;
  category?: string;
  category_id?: string;
  model?: BolnaExtractionModel;
  is_subjective?: boolean;
  is_objective?: boolean;
  subjective_type?: BolnaSubjectiveType;
  subjective_type_config?: BolnaSubjectiveTypeConfig | null;
  objective_options?: BolnaObjectiveOption[] | null;
}

export interface BolnaDispositionCreateRequest extends BolnaDispositionItem {
  agent_id: string;
}

export interface BolnaDispositionCreateResponse {
  message: string | null;
  id: string;
  categoryId: string | null;
}

export interface BolnaBulkDispositionsRequest {
  agent_id: string;
  dispositions: BolnaDispositionItem[];
}

export interface BolnaBulkDispositionsResponse {
  message: string | null;
  ids: string[];
}

export interface BolnaDispositionTestRequest {
  transcript: string;
  call_date?: string;
}

export interface BolnaExtractionResult {
  subjective: string | null;
  objective: string | null;
  confidence: number | null;
  confidenceLabel: string | null;
  status: string;
  statusReason: string | null;
}

export interface BolnaDispositionTestResponse {
  extractedData: Record<string, Record<string, BolnaExtractionResult>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BolnaResponseError(`Bolna extraction response returned an invalid ${field}.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BolnaResponseError(`Bolna extraction response returned an invalid ${field}.`);
  }
  return value.trim() || null;
}

function optionalRawString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BolnaResponseError(`Bolna extraction response returned an invalid ${field}.`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BolnaResponseError(`Bolna extraction response returned an invalid ${field}.`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") {
    throw new BolnaResponseError(`Bolna extraction response returned an invalid ${field}.`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new BolnaResponseError(`Bolna extraction response returned an invalid ${field}.`);
  }
  return value as string[];
}

function optionalMatchMode(value: unknown, field: string): "in" | "not_in" | null {
  if (value === undefined || value === null) return null;
  if (value !== "in" && value !== "not_in") {
    throw new BolnaResponseError(`Bolna extraction response returned an invalid ${field}.`);
  }
  return value;
}

function parseBolnaDispositionSummary(value: unknown, field: string): BolnaDispositionSummary {
  if (!isRecord(value)) {
    throw new BolnaResponseError(`Bolna disposition ${field} was not an object.`);
  }
  return {
    id: requiredString(value.id, `${field}.id`),
    name: requiredString(value.name, `${field}.name`),
    question: optionalString(value.question, `${field}.question`),
    category: optionalString(value.category, `${field}.category`),
    categoryId: optionalString(value.category_id, `${field}.category_id`),
  };
}

function parseOptionalDispositions(value: unknown, field: string): BolnaDispositionSummary[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BolnaResponseError(`Bolna ${field} was not an array.`);
  }
  return value.map((item, index) => parseBolnaDispositionSummary(item, `${field}[${index}]`));
}

export function parseBolnaExtractionCategory(value: unknown): BolnaExtractionCategory {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna extraction category was not an object.");
  }

  return {
    id: requiredString(value.id, "category.id"),
    name: requiredString(value.name, "category.name"),
    model: requiredString(value.model, "category.model"),
    agentId: optionalString(value.agent_id, "category.agent_id"),
    managedBy: optionalString(value.managed_by, "category.managed_by"),
    minDurationS: optionalNumber(value.min_duration_s, "category.min_duration_s"),
    skipVoicemail: optionalBoolean(value.skip_voicemail, "category.skip_voicemail"),
    parentDispositionId: optionalString(value.parent_disposition_id, "category.parent_disposition_id"),
    matchMode: optionalMatchMode(value.match_mode, "category.match_mode"),
    matchValues: optionalStringArray(value.match_values, "category.match_values"),
    dispositions: parseOptionalDispositions(value.dispositions, "category.dispositions"),
  };
}

export function parseBolnaExtractionCategoryListResponse(
  value: unknown,
): BolnaExtractionCategoryListResponse {
  if (!isRecord(value) || !Array.isArray(value.categories)) {
    throw new BolnaResponseError("Bolna category list did not contain a categories array.");
  }
  return {
    categories: value.categories.map(parseBolnaExtractionCategory),
  };
}

export function parseBolnaDispositionCreateResponse(
  value: unknown,
): BolnaDispositionCreateResponse {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna disposition create response was not an object.");
  }
  return {
    message: optionalString(value.message, "disposition.message"),
    id: requiredString(value.id, "disposition.id"),
    categoryId: optionalString(value.category_id, "disposition.category_id"),
  };
}

export function parseBolnaBulkDispositionsResponse(
  value: unknown,
): BolnaBulkDispositionsResponse {
  if (!isRecord(value) || !Array.isArray(value.ids)) {
    throw new BolnaResponseError("Bolna bulk disposition response did not contain an ids array.");
  }
  if (value.ids.some((id) => typeof id !== "string")) {
    throw new BolnaResponseError("Bolna bulk disposition response contained an invalid id.");
  }
  return {
    message: optionalString(value.message, "disposition.message"),
    ids: value.ids as string[],
  };
}

export function parseBolnaExtractionResult(value: unknown, field: string): BolnaExtractionResult {
  if (!isRecord(value)) {
    throw new BolnaResponseError(`Bolna extraction result ${field} was not an object.`);
  }

  const rawStatus = value.status === undefined ? "completed" : value.status;
  if (typeof rawStatus !== "string" || !rawStatus.trim()) {
    throw new BolnaResponseError(`Bolna extraction result ${field} has an invalid status.`);
  }

  return {
    subjective: optionalRawString(value.subjective, `${field}.subjective`),
    objective: optionalRawString(value.objective, `${field}.objective`),
    confidence: optionalNumber(value.confidence, `${field}.confidence`),
    confidenceLabel: optionalString(value.confidence_label, `${field}.confidence_label`),
    status: rawStatus.trim().toLowerCase(),
    statusReason: optionalString(value.status_reason, `${field}.status_reason`),
  };
}

export function parseBolnaDispositionTestResponse(
  value: unknown,
): BolnaDispositionTestResponse {
  if (!isRecord(value) || !isRecord(value.extracted_data)) {
    throw new BolnaResponseError("Bolna disposition test response did not contain extracted_data.");
  }

  const extractedData: Record<string, Record<string, BolnaExtractionResult>> = {};
  for (const [category, categoryValue] of Object.entries(value.extracted_data)) {
    if (!isRecord(categoryValue)) {
      throw new BolnaResponseError(`Bolna extraction category ${category} was not an object.`);
    }
    const results: Record<string, BolnaExtractionResult> = {};
    for (const [name, resultValue] of Object.entries(categoryValue)) {
      results[name] = parseBolnaExtractionResult(resultValue, `${category}.${name}`);
    }
    extractedData[category] = results;
  }

  return { extractedData };
}
