import { timingSafeEqual } from "node:crypto";
import { extractClientIp, DEFAULT_BOLNA_WEBHOOK_SOURCE_IPS } from "./webhook-config.ts";
import { BolnaConfigError } from "./errors.ts";
import { TOOL_AUTH_MIN_TOKEN_LENGTH } from "./tool-config.ts";

const DEFAULT_MAX_TOOL_BODY_BYTES = 65_536;

export interface BolnaToolAuthConfig {
  token: string | null;
  allowUnauthenticated: boolean;
  allowedSourceIps: string[];
  maxBodyBytes: number;
}

function parseIpList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadBolnaToolAuthConfig(
  env: Record<string, string | undefined> = process.env,
): BolnaToolAuthConfig {
  const allowUnauthenticated = env.BOLNA_TOOL_ALLOW_UNAUTHENTICATED === "1";
  const token = env.BOLNA_TOOL_TOKEN?.trim() || null;

  if (token && token.length < TOOL_AUTH_MIN_TOKEN_LENGTH) {
    throw new BolnaConfigError(
      `BOLNA_TOOL_TOKEN must be at least ${TOOL_AUTH_MIN_TOKEN_LENGTH} characters.`,
    );
  }
  if (!token && !allowUnauthenticated) {
    throw new BolnaConfigError(
      "BOLNA_TOOL_TOKEN is required. Set BOLNA_TOOL_ALLOW_UNAUTHENTICATED=1 only for local development.",
    );
  }

  const configuredIps = parseIpList(env.BOLNA_TOOL_IP_ALLOWLIST);
  const allowedSourceIps =
    configuredIps.length > 0
      ? configuredIps
      : allowUnauthenticated
        ? []
        : [...DEFAULT_BOLNA_WEBHOOK_SOURCE_IPS];

  const rawMax = env.BOLNA_TOOL_MAX_BODY_BYTES;
  const maxBodyBytes = rawMax === undefined ? DEFAULT_MAX_TOOL_BODY_BYTES : Number(rawMax);
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024 || maxBodyBytes > 262_144) {
    throw new BolnaConfigError(
      "BOLNA_TOOL_MAX_BODY_BYTES must be an integer between 1024 and 262144.",
    );
  }

  return { token, allowUnauthenticated, allowedSourceIps, maxBodyBytes };
}

export function isBolnaToolTokenValid(
  authorization: string | undefined,
  config: BolnaToolAuthConfig,
): boolean {
  if (!config.token) return config.allowUnauthenticated;
  if (!authorization) return false;

  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  const provided = Buffer.from(authorization.slice(prefix.length));
  const expected = Buffer.from(config.token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function isBolnaToolSourceAllowed(
  headers: Record<string, string | string[] | undefined>,
  config: BolnaToolAuthConfig,
): boolean {
  if (config.allowedSourceIps.length === 0) return config.allowUnauthenticated;
  const ip = extractClientIp(headers);
  return ip !== null && config.allowedSourceIps.includes(ip);
}
