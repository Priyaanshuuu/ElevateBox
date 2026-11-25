import { timingSafeEqual } from "node:crypto";
import { BolnaConfigError } from "./errors.ts";

const DEFAULT_MAX_BODY_BYTES = 262_144;
const MIN_URL_TOKEN_LENGTH = 32;

export const DEFAULT_BOLNA_WEBHOOK_SOURCE_IPS = [
  "13.203.39.153",
  "13.126.9.249",
  "13.202.133.53",
] as const;

export interface BolnaWebhookConfig {
  urlToken: string | null;
  allowUnauthenticated: boolean;
  allowedSourceIps: string[];
  maxBodyBytes: number;
  verifyExecution: boolean;
}

function parseIpList(rawValue: string | undefined): string[] {
  return (rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function loadWebhookConfig(
  env: Record<string, string | undefined> = process.env,
): BolnaWebhookConfig {
  const allowUnauthenticated = env.BOLNA_WEBHOOK_ALLOW_UNAUTHENTICATED === "1";
  const urlToken = env.BOLNA_WEBHOOK_URL_TOKEN?.trim() || null;

  if (urlToken && urlToken.length < MIN_URL_TOKEN_LENGTH) {
    throw new BolnaConfigError(
      `BOLNA_WEBHOOK_URL_TOKEN must be at least ${MIN_URL_TOKEN_LENGTH} characters.`,
    );
  }
  if (!urlToken && !allowUnauthenticated) {
    throw new BolnaConfigError(
      "BOLNA_WEBHOOK_URL_TOKEN is required. Set BOLNA_WEBHOOK_ALLOW_UNAUTHENTICATED=1 only for local development.",
    );
  }

  const rawMax = env.BOLNA_WEBHOOK_MAX_BODY_BYTES;
  const maxBodyBytes = rawMax === undefined ? DEFAULT_MAX_BODY_BYTES : Number(rawMax);
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024 || maxBodyBytes > 2_000_000) {
    throw new BolnaConfigError(
      "BOLNA_WEBHOOK_MAX_BODY_BYTES must be an integer between 1024 and 2000000.",
    );
  }

  const configuredIps = parseIpList(env.BOLNA_WEBHOOK_IP_ALLOWLIST);
  const allowedSourceIps =
    configuredIps.length > 0
      ? configuredIps
      : allowUnauthenticated
        ? []
        : [...DEFAULT_BOLNA_WEBHOOK_SOURCE_IPS];

  const rawVerify = env.BOLNA_WEBHOOK_VERIFY_EXECUTION;
  const verifyExecution =
    rawVerify === undefined ? !allowUnauthenticated : rawVerify === "1";

  return {
    urlToken,
    allowUnauthenticated,
    allowedSourceIps,
    maxBodyBytes,
    verifyExecution,
  };
}

export function isWebhookUrlTokenValid(
  tokenFromPath: string | undefined,
  config: BolnaWebhookConfig,
): boolean {
  if (!config.urlToken) return config.allowUnauthenticated;
  if (!tokenFromPath) return false;

  const providedBytes = Buffer.from(tokenFromPath);
  const expectedBytes = Buffer.from(config.urlToken);
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

function firstHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (Array.isArray(value)) {
      const first = value[0]?.trim();
      if (first) return first;
    }
  }
  return null;
}

export function extractClientIp(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const forwarded = firstHeaderValue(headers, ["x-forwarded-for"]);
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  return firstHeaderValue(headers, ["cf-connecting-ip", "x-real-ip"]);
}

export function isAllowedWebhookSource(
  clientIp: string | null,
  config: BolnaWebhookConfig,
): boolean {
  if (config.allowedSourceIps.length === 0) return config.allowUnauthenticated;
  return clientIp !== null && config.allowedSourceIps.includes(clientIp);
}
