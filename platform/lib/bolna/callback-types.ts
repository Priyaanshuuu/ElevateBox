import { createHmac, timingSafeEqual } from "node:crypto";
import { BolnaConfigError, BolnaResponseError } from "./errors.ts";

export interface BolnaWorkflowCallbackEndpoint {
  url: string;
  slug: string;
  signingSecret: string;
  createdAt: string | null;
  rateLimitPerMinute: number | null;
}

export interface BolnaWorkflowCallbackDelivery {
  status: "accepted";
  match: "matched" | "none";
}

export const BOLNA_CALLBACK_SIGNATURE_HEADER = "x-bolna-signature";
export const BOLNA_CALLBACK_MAX_BODY_BYTES = 262_144;

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

export function parseBolnaWorkflowCallbackEndpoint(
  value: unknown,
): BolnaWorkflowCallbackEndpoint {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna workflow callback endpoint was not an object.");
  }

  const url = requiredString(value.url, "url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BolnaResponseError("Bolna workflow callback url was not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new BolnaResponseError("Bolna workflow callback url must use HTTPS.");
  }

  const signingSecret = requiredString(value.signing_secret, "signing_secret");
  if (!/^[0-9a-fA-F]{64}$/.test(signingSecret)) {
    throw new BolnaResponseError("Bolna workflow callback signing secret must be 64 hex characters.");
  }

  const rateLimit = value.rate_limit_per_min;
  if (rateLimit !== undefined && rateLimit !== null) {
    if (!Number.isInteger(rateLimit) || (rateLimit as number) < 1) {
      throw new BolnaResponseError("Bolna workflow callback rate limit was invalid.");
    }
  }

  return {
    url,
    slug: requiredString(value.slug, "slug"),
    signingSecret,
    createdAt: optionalString(value.created_at, "created_at"),
    rateLimitPerMinute: rateLimit === undefined || rateLimit === null ? null : (rateLimit as number),
  };
}

export function parseBolnaWorkflowCallbackDelivery(
  value: unknown,
): BolnaWorkflowCallbackDelivery {
  if (!isRecord(value)) {
    throw new BolnaResponseError("Bolna workflow callback delivery was not an object.");
  }
  if (value.status !== "accepted") {
    throw new BolnaResponseError("Bolna workflow callback delivery was not accepted.");
  }
  if (value.match !== "matched" && value.match !== "none") {
    throw new BolnaResponseError("Bolna workflow callback delivery returned an invalid match.");
  }
  return { status: "accepted", match: value.match };
}

export function validateCallbackSigningSecret(secret: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new BolnaConfigError(
      "Bolna workflow callback signing secret must be a 64-character hex string.",
    );
  }
}

export function signBolnaCallbackBody(body: string | Uint8Array, signingSecret: string): string {
  validateCallbackSigningSecret(signingSecret);
  const digest = createHmac("sha256", signingSecret)
    .update(typeof body === "string" ? Buffer.from(body, "utf8") : body)
    .digest("hex");
  return `sha256=${digest}`;
}

export function isBolnaCallbackSignatureValid(
  body: string | Uint8Array,
  signature: string | undefined,
  signingSecret: string,
): boolean {
  if (!signature) return false;
  const expected = signBolnaCallbackBody(body, signingSecret);
  const providedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}
