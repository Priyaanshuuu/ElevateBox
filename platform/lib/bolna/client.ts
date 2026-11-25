import { loadBolnaConfig, type BolnaConfig } from "./config.ts";
import {
  BolnaHttpError,
  BolnaNetworkError,
  BolnaResponseError,
  BolnaTimeoutError,
  redactSecrets,
} from "./errors.ts";
import { parseBolnaUser, type BolnaUser } from "./types.ts";

export interface BolnaClientOptions {
  config?: BolnaConfig;
  fetchImpl?: typeof fetch;
}

export interface BolnaClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  request<T>(path: string, init?: RequestInit): Promise<T>;
  getUser(): Promise<BolnaUser>;
}

function buildUrl(baseUrl: string, path: string): URL {
  return new URL(path.replace(/^\/+/, ""), `${baseUrl}/`);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

async function readErrorSnippet(response: Response, apiKey: string): Promise<string> {
  try {
    const text = await response.text();
    return redactSecrets(text, [apiKey]).replace(/\s+/g, " ").trim().slice(0, 2000);
  } catch {
    return "";
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new BolnaResponseError("Bolna returned a non-JSON response.", { cause });
  }
}

export function createBolnaClient(options: BolnaClientOptions = {}): BolnaClient {
  const config = options.config ?? loadBolnaConfig();
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = buildUrl(config.baseUrl, path);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${config.apiKey}`);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (cause) {
      if (isTimeoutError(cause)) {
        throw new BolnaTimeoutError(`Bolna request timed out after ${config.timeoutMs}ms.`, {
          cause,
        });
      }
      throw new BolnaNetworkError("Bolna request failed before a response was received.", {
        cause,
      });
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response, config.apiKey);
      const retryable = response.status === 429 || response.status >= 500;
      throw new BolnaHttpError(
        `Bolna request failed with status ${response.status}${snippet ? `: ${snippet}` : ""}.`,
        { status: response.status, retryable },
      );
    }

    return await parseJsonResponse<T>(response);
  }

  return {
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    request,
    async getUser() {
      return parseBolnaUser(await request<unknown>("/user/me"));
    },
  };
}
