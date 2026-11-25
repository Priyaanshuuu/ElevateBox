import { BolnaResponseError } from "./errors.ts";

export type BolnaKnowledgeStatus = "processing" | "processed" | "error";
export type BolnaKnowledgeLanguageSupport = "multilingual" | null;

export interface BolnaKnowledgeBase {
  ragId: string;
  vectorId: string | null;
  fileName: string;
  sourceType: "pdf" | "url" | null;
  status: BolnaKnowledgeStatus;
  languageSupport: BolnaKnowledgeLanguageSupport;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BolnaKnowledgeBaseListResponse {
  knowledgeBases: BolnaKnowledgeBase[];
}

export interface BolnaKnowledgeBaseDeleteResponse {
  acknowledged: boolean;
  message: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BolnaResponseError(`Bolna response returned an invalid ${field}.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BolnaResponseError(`Bolna response returned an invalid ${field}.`);
  }
  return value;
}

function optionalStatus(value: unknown, field: string): BolnaKnowledgeStatus {
  if (value === "processing" || value === "processed" || value === "error") return value;
  throw new BolnaResponseError(`Bolna response returned an invalid ${field}.`);
}

function optionalLanguageSupport(
  value: unknown,
  field: string,
): BolnaKnowledgeLanguageSupport {
  if (value === undefined || value === null) return null;
  if (value === "multilingual") return value;
  throw new BolnaResponseError(`Bolna response returned an invalid ${field}.`);
}

export function parseBolnaKnowledgeBase(value: unknown): BolnaKnowledgeBase {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna knowledge base was not an object.");
  }

  const sourceType = value.source_type;
  if (sourceType !== undefined && sourceType !== null && sourceType !== "pdf" && sourceType !== "url") {
    throw new BolnaResponseError("Bolna response returned an invalid source_type.");
  }

  return {
    ragId: requiredString(value.rag_id, "rag_id"),
    vectorId: optionalString(value.vector_id, "vector_id"),
    fileName: requiredString(value.file_name, "file_name"),
    sourceType: sourceType ?? null,
    status: optionalStatus(value.status, "status"),
    languageSupport: optionalLanguageSupport(value.language_support, "language_support"),
    createdAt: optionalString(value.created_at, "created_at"),
    updatedAt: optionalString(value.updated_at, "updated_at"),
  };
}

export function parseBolnaKnowledgeBaseListResponse(
  value: unknown,
): BolnaKnowledgeBaseListResponse {
  if (!isRecord(value) || !Array.isArray(value.knowledge_bases)) {
    // Tolerate a bare array from older deployments, but keep one typed shape.
    if (Array.isArray(value)) {
      return { knowledgeBases: value.map((item) => parseBolnaKnowledgeBase(item)) };
    }
    if (!isRecord(value) || !Array.isArray(value.knowledgebases)) {
      throw new BolnaResponseError("Bolna knowledge base list was not an array.");
    }
    return { knowledgeBases: value.knowledgebases.map((item) => parseBolnaKnowledgeBase(item)) };
  }
  return { knowledgeBases: value.knowledge_bases.map((item) => parseBolnaKnowledgeBase(item)) };
}

export function parseBolnaKnowledgeBaseDeleteResponse(
  value: unknown,
): BolnaKnowledgeBaseDeleteResponse {
  if (value === undefined || value === null) {
    return { acknowledged: true, message: null };
  }
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna knowledge base delete did not return an object.");
  }
  const message = optionalString(value.message, "message");
  return { acknowledged: message === null || /delet/i.test(message), message };
}
