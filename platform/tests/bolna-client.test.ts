import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createBolnaClient } from "../lib/bolna/client.ts";
import { loadBolnaConfig } from "../lib/bolna/config.ts";
import {
  BolnaConfigError,
  BolnaHttpError,
  BolnaNetworkError,
  BolnaResponseError,
  BolnaTimeoutError,
} from "../lib/bolna/errors.ts";
import type { BolnaConfig } from "../lib/bolna/config.ts";

const API_KEY = "bolna-test-key-123";

interface SeenRequest {
  url?: string;
  authorization?: string;
  accept?: string;
}

let server: Server | undefined;
let seen: SeenRequest[];

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const current = createServer(handler);
  server = current;

  await new Promise<void>((resolve, reject) => {
    current.once("error", reject);
    current.listen(0, "127.0.0.1", () => resolve());
  });

  const address = current.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function testConfig(baseUrl: string, overrides: Partial<BolnaConfig> = {}): BolnaConfig {
  return { apiKey: API_KEY, baseUrl, timeoutMs: 2000, ...overrides };
}

function captureConsole() {
  const lines: string[] = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const capture = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };

  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;

  return {
    lines,
    restore() {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

beforeEach(() => {
  seen = [];
});

afterEach(async () => {
  if (!server) return;
  const current = server;
  server = undefined;
  current.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("Step 1 — Bolna foundation evals", () => {
  describe("configuration validation", () => {
    it("eval: rejects a missing BOLNA_API_KEY", () => {
      assert.throws(
        () => loadBolnaConfig({}),
        (error: unknown) => {
          assert.ok(error instanceof BolnaConfigError);
          assert.match(error.message, /BOLNA_API_KEY/);
          assert.ok(!error.message.includes(API_KEY));
          return true;
        },
      );
    });

    it("eval: rejects non-HTTPS and credential-bearing base URLs", () => {
      assert.throws(
        () =>
          loadBolnaConfig({
            BOLNA_API_KEY: API_KEY,
            BOLNA_API_BASE_URL: "http://api.bolna.ai",
          }),
        BolnaConfigError,
      );

      assert.throws(
        () =>
          loadBolnaConfig({
            BOLNA_API_KEY: API_KEY,
            BOLNA_API_BASE_URL: "https://user:pass@api.bolna.ai",
          }),
        BolnaConfigError,
      );
    });

    it("eval: accepts a local fixture base URL for offline tests", () => {
      const config = loadBolnaConfig({
        BOLNA_API_KEY: API_KEY,
        BOLNA_API_BASE_URL: "http://127.0.0.1:4010",
      });
      assert.equal(config.baseUrl, "http://127.0.0.1:4010");
      assert.equal(config.timeoutMs, 15_000);
    });
  });

  describe("GET /user/me contract", () => {
    it("eval: sends bearer auth and normalizes the account fixture", async () => {
      const baseUrl = await startServer((request, response) => {
        seen.push({
          url: request.url,
          authorization: request.headers.authorization,
          accept: request.headers.accept,
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "usr_123",
            name: "Bruce Wayne",
            email: "bruce@example.com",
            wallet: 42.42,
            concurrency: { max: 10, current: 1 },
            ignoredExtraField: true,
          }),
        );
      });

      const client = createBolnaClient({ config: testConfig(baseUrl) });
      const user = await client.getUser();

      assert.deepEqual(user, {
        id: "usr_123",
        name: "Bruce Wayne",
        email: "bruce@example.com",
        wallet: 42.42,
        concurrency: { max: 10, current: 1 },
      });
      assert.equal(seen[0]?.url, "/user/me");
      assert.equal(seen[0]?.authorization, `Bearer ${API_KEY}`);
      assert.equal(seen[0]?.accept, "application/json");
    });

    it("eval: rejects malformed account payloads with a typed error", async () => {
      const baseUrl = await startServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "usr_123", wallet: "42" }));
      });

      const client = createBolnaClient({ config: testConfig(baseUrl) });
      await assert.rejects(client.getUser(), BolnaResponseError);
    });
  });

  describe("typed errors and secret safety", () => {
    it("eval: redacts the API key in HTTP error messages and logs nothing", async () => {
      const baseUrl = await startServer((_request, response) => {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ message: `invalid api key ${API_KEY}`, secret: API_KEY }),
        );
      });

      const client = createBolnaClient({ config: testConfig(baseUrl) });
      const captured = captureConsole();

      try {
        await assert.rejects(
          client.getUser(),
          (error: unknown) => {
            assert.ok(error instanceof BolnaHttpError);
            assert.equal(error.status, 401);
            assert.equal(error.retryable, false);
            assert.ok(!error.message.includes(API_KEY));
            assert.match(error.message, /\[REDACTED\]/);
            return true;
          },
        );
      } finally {
        captured.restore();
      }

      assert.ok(captured.lines.every((line) => !line.includes(API_KEY)));
    });

    it("eval: marks server errors as retryable", async () => {
      const baseUrl = await startServer((_request, response) => {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "temporary failure" }));
      });

      const client = createBolnaClient({ config: testConfig(baseUrl) });
      await assert.rejects(
        client.getUser(),
        (error: unknown) => {
          assert.ok(error instanceof BolnaHttpError);
          assert.equal(error.status, 500);
          assert.equal(error.retryable, true);
          return true;
        },
      );
    });

    it("eval: reports non-JSON responses as BolnaResponseError", async () => {
      const baseUrl = await startServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("not-json");
      });

      const client = createBolnaClient({ config: testConfig(baseUrl) });
      await assert.rejects(client.getUser(), BolnaResponseError);
    });

    it("eval: reports transport failures as BolnaNetworkError", async () => {
      const client = createBolnaClient({
        config: testConfig("https://api.bolna.ai"),
        fetchImpl: async () => {
          throw new Error("socket closed");
        },
      });

      await assert.rejects(client.getUser(), BolnaNetworkError);
    });

    it("eval: reports timeouts as BolnaTimeoutError", async () => {
      const baseUrl = await startServer((_request, response) => {
        setTimeout(() => {
          if (!response.destroyed) {
            response.writeHead(200, { "content-type": "application/json" });
            response.end("{}");
          }
        }, 300);
      });

      const client = createBolnaClient({ config: testConfig(baseUrl, { timeoutMs: 100 }) });
      await assert.rejects(client.getUser(), BolnaTimeoutError);
    });
  });
});
