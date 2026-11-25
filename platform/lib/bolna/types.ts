import { BolnaResponseError } from "./errors.ts";

export interface BolnaConcurrency {
  max: number;
  current: number;
}

export interface BolnaUser {
  id: string;
  name?: string | null;
  email?: string | null;
  wallet: number;
  concurrency: BolnaConcurrency;
}

export interface BolnaExecutionSnapshot {
  executionId: string;
  status: string;
  agentId: string | null;
  agentVersionId: string | null;
  batchId: string | null;
  conversationDuration: number | null;
  totalCost: number | null;
  transcript: string | null;
  summary: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BolnaResponseError(`Bolna /user/me returned an invalid ${field}.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new BolnaResponseError(`Bolna /user/me returned an invalid ${field}.`);
}

export function parseBolnaUser(value: unknown): BolnaUser {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna /user/me did not return an object.");
  }

  if (typeof value.id !== "string") {
    throw new BolnaResponseError("Bolna /user/me returned an invalid id.");
  }

  if (!isRecord(value.concurrency)) {
    throw new BolnaResponseError("Bolna /user/me returned an invalid concurrency object.");
  }

  return {
    id: value.id,
    ...(value.name !== undefined ? { name: optionalString(value.name, "name") } : {}),
    ...(value.email !== undefined ? { email: optionalString(value.email, "email") } : {}),
    wallet: finiteNumber(value.wallet, "wallet"),
    concurrency: {
      max: finiteNumber(value.concurrency.max, "concurrency.max"),
      current: finiteNumber(value.concurrency.current, "concurrency.current"),
    },
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BolnaResponseError(`Bolna execution returned an invalid ${field}.`);
  }
  return value.trim();
}

function optionalExecutionString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BolnaResponseError(`Bolna execution returned an invalid ${field}.`);
  }
  return value.trim() || null;
}

function optionalExecutionNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BolnaResponseError(`Bolna execution returned an invalid ${field}.`);
  }
  return value;
}

export function parseBolnaExecutionSnapshot(value: unknown): BolnaExecutionSnapshot {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna execution did not return an object.");
  }

  return {
    executionId: requiredString(value.id, "id"),
    status: requiredString(value.status, "status").toLowerCase(),
    agentId: optionalExecutionString(value.agent_id, "agent_id"),
    agentVersionId: optionalExecutionString(value.agent_version_id, "agent_version_id"),
    batchId: optionalExecutionString(value.batch_id, "batch_id"),
    conversationDuration: optionalExecutionNumber(value.conversation_duration, "conversation_duration"),
    totalCost: optionalExecutionNumber(value.total_cost, "total_cost"),
    transcript: optionalExecutionString(value.transcript, "transcript"),
    summary: optionalExecutionString(value.summary, "summary"),
  };
}
