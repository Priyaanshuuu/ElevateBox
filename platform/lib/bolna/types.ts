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
