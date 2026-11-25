import { BolnaConfigError } from "./errors.ts";

export interface BolnaConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export const BOLNA_DEFAULT_BASE_URL = "https://api.bolna.ai";
export const BOLNA_DEFAULT_TIMEOUT_MS = 15_000;

function parseBaseUrl(rawValue: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new BolnaConfigError("BOLNA_API_BASE_URL must be a valid absolute URL.");
  }

  if (parsed.username || parsed.password) {
    throw new BolnaConfigError("BOLNA_API_BASE_URL must not contain credentials.");
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (parsed.protocol !== "https:" && !localHosts.has(parsed.hostname)) {
    throw new BolnaConfigError("BOLNA_API_BASE_URL must use HTTPS outside local development.");
  }

  return parsed.toString().replace(/\/+$/, "");
}

function parseTimeoutMs(rawValue: string): number {
  const timeoutMs = Number(rawValue);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new BolnaConfigError("BOLNA_REQUEST_TIMEOUT_MS must be an integer between 100 and 120000.");
  }
  return timeoutMs;
}

export function loadBolnaConfig(
  env: Record<string, string | undefined> = process.env,
): BolnaConfig {
  const apiKey = env.BOLNA_API_KEY?.trim();
  if (!apiKey) {
    throw new BolnaConfigError("BOLNA_API_KEY is required.");
  }

  const baseUrl = parseBaseUrl(
    (env.BOLNA_API_BASE_URL ?? BOLNA_DEFAULT_BASE_URL).trim(),
  );
  const timeoutMs = parseTimeoutMs(
    env.BOLNA_REQUEST_TIMEOUT_MS ?? String(BOLNA_DEFAULT_TIMEOUT_MS),
  );

  return { apiKey, baseUrl, timeoutMs };
}
