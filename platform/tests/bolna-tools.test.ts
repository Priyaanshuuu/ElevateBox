import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  BOLNA_CALLBACK_SIGNATURE_HEADER,
  BolnaConfigError,
  BolnaResponseError,
  BolnaToolError,
  buildAgentVersionPlan,
  buildElevateBoxAgentRequest,
  buildElevateBoxToolConfig,
  buildLeadQualificationCallbackBody,
  createBolnaClient,
  createElevateBoxAgentSpec,
  createMemoryToolStore,
  handleBolnaToolRequest,
  isBolnaCallbackSignatureValid,
  isBolnaToolSourceAllowed,
  isBolnaToolTokenValid,
  isE164Phone,
  loadBolnaToolAuthConfig,
  parseBolnaWorkflowCallbackEndpoint,
  parseHotLeadWhatsAppArgs,
  signBolnaCallbackBody,
  validateBolnaToolConfig,
  validateCallbackBody,
  validateCallbackSigningSecret,
  validateElevateBoxAgentSpec,
  type BolnaApiToolsConfig,
  type BolnaClient,
  type BolnaConfig,
  type ElevateBoxAgentSpec,
  type ToolHandlers,
} from "../lib/bolna/index.ts";
import type { BolnaLlmAgentConfig } from "../lib/bolna/agent-types.ts";
import { resolveCallbackTime } from "../lib/services/callback-time.ts";
import {
  buildHotLeadWhatsAppMessage,
  normalizeWhatsAppAddress,
  sendWhatsAppMessage,
} from "../lib/services/whatsapp.service.ts";

const API_KEY = "bolna-step5-tools-test-key";
const TOOL_TOKEN = "step5-fixture-token-0123456789abcdef";
const SIGNING_SECRET = "a".repeat(64);
const KNOWLEDGE_ID = "11111111-1111-4111-8111-111111111111";
const PHONE = "+919876543210";

interface SeenRequest {
  method: string;
  url: string;
  body: string;
  authorization: string | undefined;
  signature: string | undefined;
}

interface TestServer {
  baseUrl: string;
  requests: SeenRequest[];
}

let server: Server | undefined;

async function startServer(
  handler: (request: SeenRequest) => { status: number; body: unknown },
): Promise<TestServer> {
  const requests: SeenRequest[] = [];
  const current = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));

    const seen: SeenRequest = {
      method: request.method ?? "",
      url: request.url ?? "",
      body: Buffer.concat(chunks).toString("utf8"),
      authorization: request.headers.authorization,
      signature: request.headers[BOLNA_CALLBACK_SIGNATURE_HEADER] as string | undefined,
    };
    requests.push(seen);

    const result = handler(seen);
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  server = current;
  await new Promise<void>((resolve, reject) => {
    current.once("error", reject);
    current.listen(0, "127.0.0.1", () => resolve());
  });
  const address = current.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests };
}

function testClient(baseUrl: string): BolnaClient {
  const config: BolnaConfig = { apiKey: API_KEY, baseUrl, timeoutMs: 2000 };
  return createBolnaClient({ config });
}

function fixtureSpec(overrides: Partial<ElevateBoxAgentSpec> = {}): ElevateBoxAgentSpec {
  const base = createElevateBoxAgentSpec({
    webhookUrl: "http://127.0.0.1:7777/api/bolna/webhook/step5-test-token-0123456789",
    versionName: "step5-fixture",
    voices: {
      en: {
        provider: "elevenlabs",
        model: "eleven_turbo_v2_5",
        voice: "Angelica",
        voiceId: "fixture-en-voice",
        language: "en",
      },
      hi: {
        provider: "sarvam",
        model: "bulbul:v3",
        voice: "Priya",
        voiceId: "fixture-hi-voice",
        language: "hi",
      },
      te: {
        provider: "sarvam",
        model: "bulbul:v3",
        voice: "Anushka",
        voiceId: "fixture-te-voice",
        language: "te",
      },
    },
  });
  return { ...base, ...overrides };
}

afterEach(async () => {
  if (!server) return;
  const current = server;
  server = undefined;
  current.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("Step 5 — signed tools and workflow callback evals", () => {
  describe("agent attachment and tool schema", () => {
    it("eval: knowledge ids and api_tools attach to a deterministic agent version", () => {
      const apiTools = buildElevateBoxToolConfig({
        baseUrl: "https://app.example.com",
        token: TOOL_TOKEN,
      });
      const spec = fixtureSpec({ knowledgeBaseIds: [KNOWLEDGE_ID], apiTools });
      const request = buildElevateBoxAgentRequest(spec);
      const llmAgent = request.agent_config.tasks[0]?.tools_config.llm_agent as
        | (BolnaLlmAgentConfig & {
            vector_store: { provider: string; provider_config: { vector_ids: string[] } };
          })
        | undefined;

      assert.ok(llmAgent);
      assert.equal(llmAgent.agent_type, "knowledgebase_agent");
      assert.equal(llmAgent.vector_store.provider, "lancedb");
      assert.deepEqual(llmAgent.vector_store.provider_config.vector_ids, [KNOWLEDGE_ID]);
      assert.deepEqual(request.agent_config.tasks[0]?.tools_config.api_tools, apiTools);
      assert.doesNotThrow(() => validateElevateBoxAgentSpec(spec));

      const first = buildAgentVersionPlan(spec).digest;
      const repeated = buildAgentVersionPlan(fixtureSpec({ knowledgeBaseIds: [KNOWLEDGE_ID], apiTools })).digest;
      const changed = buildAgentVersionPlan(
        fixtureSpec({
          knowledgeBaseIds: ["22222222-2222-4222-8222-222222222222"],
          apiTools,
        }),
      ).digest;
      assert.equal(first, repeated);
      assert.notEqual(first, changed);
    });

    it("eval: invalid knowledge ids and tampered tool config fail closed", () => {
      assert.throws(
        () => validateElevateBoxAgentSpec(fixtureSpec({ knowledgeBaseIds: ["not-a-uuid"] })),
        BolnaConfigError,
      );
      assert.throws(
        () => validateElevateBoxAgentSpec(fixtureSpec({ knowledgeBaseIds: [KNOWLEDGE_ID, KNOWLEDGE_ID] })),
        BolnaConfigError,
      );

      const tools = buildElevateBoxToolConfig({
        baseUrl: "https://app.example.com",
        token: TOOL_TOKEN,
      });
      assert.doesNotThrow(() => validateBolnaToolConfig(tools));

      const tampered: BolnaApiToolsConfig = structuredClone(tools);
      tampered.tools_params.schedule_callback.method = "GET" as "POST";
      assert.throws(() => validateBolnaToolConfig(tampered), BolnaConfigError);

      assert.throws(
        () => buildElevateBoxToolConfig({ baseUrl: "http://app.example.com", token: TOOL_TOKEN }),
        BolnaConfigError,
      );
      assert.throws(
        () => buildElevateBoxToolConfig({ baseUrl: "https://app.example.com", token: "too-short" }),
        BolnaConfigError,
      );
    });

    it("eval: custom function definitions use OpenAI-style schemas and %() specifiers", () => {
      const config = buildElevateBoxToolConfig({
        baseUrl: "https://app.example.com",
        token: TOOL_TOKEN,
      });
      const definitions = JSON.parse(config.tools) as Array<Record<string, unknown>>;
      assert.equal(definitions.length, 2);
      assert.ok(
        definitions.every(
          (tool) =>
            tool.key === "custom_task" &&
            typeof tool.description === "string" &&
            typeof tool.parameters === "object",
        ),
      );

      const params = config.tools_params.schedule_callback;
      assert.equal(params.method, "POST");
      assert.equal(
        params.url,
        "https://app.example.com/api/bolna/tools/schedule_callback",
      );
      assert.equal(params.api_token, `Bearer ${TOOL_TOKEN}`);
      assert.equal((JSON.parse(params.param) as Record<string, string>).lead_id, "%(lead_id)s");
    });
  });

  describe("tool endpoint security and dedupe", () => {
    const authConfig = () =>
      loadBolnaToolAuthConfig({
        BOLNA_TOOL_TOKEN: TOOL_TOKEN,
        BOLNA_TOOL_IP_ALLOWLIST: "127.0.0.1",
      });

    it("eval: tool auth requires a strong token and an allowed source IP", () => {
      const config = authConfig();
      assert.equal(isBolnaToolTokenValid(`Bearer ${TOOL_TOKEN}`, config), true);
      assert.equal(isBolnaToolTokenValid("Bearer wrong-token", config), false);
      assert.equal(isBolnaToolTokenValid(undefined, config), false);
      assert.equal(
        isBolnaToolSourceAllowed({ "x-forwarded-for": "127.0.0.1" }, config),
        true,
      );
      assert.equal(
        isBolnaToolSourceAllowed({ "x-forwarded-for": "10.0.0.1" }, config),
        false,
      );
      assert.throws(() => loadBolnaToolAuthConfig({}), BolnaConfigError);
    });

    it("eval: a duplicate tool invocation is not executed twice", async () => {
      const calls: string[] = [];
      const handlers: ToolHandlers = {
        async scheduleCallback(args) {
          calls.push(args.leadId);
          return { status: "scheduled", callbackId: "cb-1", scheduledAt: "2026-11-27T10:30:00.000Z" };
        },
        async triggerHotLeadWhatsApp() {
          calls.push("whatsapp");
          return { status: "triggered", eventId: "event-1" };
        },
      };
      const store = createMemoryToolStore();
      const headers = {
        authorization: `Bearer ${TOOL_TOKEN}`,
        "x-forwarded-for": "127.0.0.1",
      };
      const rawBody = JSON.stringify({
        execution_id: "exec-1",
        lead_id: "lead-1",
        timezone: "Asia/Kolkata",
        request_text: "tomorrow 4 pm",
      });

      const first = await handleBolnaToolRequest({
        toolName: "schedule_callback",
        headers,
        rawBody,
        config: authConfig(),
        store,
        handlers,
        now: new Date("2026-11-26T05:00:00Z"),
      });
      const duplicate = await handleBolnaToolRequest({
        toolName: "schedule_callback",
        headers,
        rawBody: JSON.stringify({
          request_text: "tomorrow 4 pm",
          timezone: "Asia/Kolkata",
          lead_id: "lead-1",
          execution_id: "exec-1",
        }),
        config: authConfig(),
        store,
        handlers,
        now: new Date("2026-11-26T05:00:00Z"),
      });

      assert.equal(first.status, 200);
      assert.equal(first.body.duplicate, false);
      const firstResult = first.body.result as Record<string, unknown> | null;
      assert.equal(firstResult?.status, "scheduled");
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body.duplicate, true);
      assert.equal(calls.length, 1);
    });

    it("eval: auth, source, size, JSON, and argument failures fail closed", async () => {
      const handlers: ToolHandlers = {
        async scheduleCallback() {
          return { status: "scheduled", callbackId: "cb-1", scheduledAt: "2026-11-27T10:30:00.000Z" };
        },
        async triggerHotLeadWhatsApp() {
          return { status: "triggered", eventId: "event-1" };
        },
      };
      const base = {
        toolName: "schedule_callback",
        config: authConfig(),
        store: createMemoryToolStore(),
        handlers,
      };

      const unauthorized = await handleBolnaToolRequest({
        ...base,
        headers: { "x-forwarded-for": "127.0.0.1" },
        rawBody: "{}",
      });
      const wrongIp = await handleBolnaToolRequest({
        ...base,
        headers: {
          authorization: `Bearer ${TOOL_TOKEN}`,
          "x-forwarded-for": "10.0.0.1",
        },
        rawBody: "{}",
      });
      const oversized = await handleBolnaToolRequest({
        ...base,
        headers: {
          authorization: `Bearer ${TOOL_TOKEN}`,
          "x-forwarded-for": "127.0.0.1",
        },
        rawBody: `"${"x".repeat(70_000)}"`,
      });
      const invalidJson = await handleBolnaToolRequest({
        ...base,
        headers: {
          authorization: `Bearer ${TOOL_TOKEN}`,
          "x-forwarded-for": "127.0.0.1",
        },
        rawBody: "{",
      });
      const invalidArgs = await handleBolnaToolRequest({
        ...base,
        headers: {
          authorization: `Bearer ${TOOL_TOKEN}`,
          "x-forwarded-for": "127.0.0.1",
        },
        rawBody: JSON.stringify({
          lead_id: "lead-1",
          timezone: "Not/AZone",
          request_text: "tomorrow 4 pm",
        }),
      });
      const unknownTool = await handleBolnaToolRequest({
        ...base,
        toolName: "not_a_tool",
        headers: {
          authorization: `Bearer ${TOOL_TOKEN}`,
          "x-forwarded-for": "127.0.0.1",
        },
        rawBody: "{}",
      });

      assert.equal(unauthorized.status, 401);
      assert.equal(wrongIp.status, 403);
      assert.equal(oversized.status, 413);
      assert.equal(invalidJson.status, 400);
      assert.equal(invalidJson.body.error, "invalid_json");
      assert.equal(invalidArgs.status, 400);
      assert.equal(invalidArgs.body.error, "invalid_arguments");
      assert.equal(unknownTool.status, 404);
    });

    it("eval: WhatsApp tool arguments and callback phone numbers must be E.164", () => {
      const valid = {
        lead_id: "lead-1",
        to_phone_number: PHONE,
        context_text: "Interested in a discovery call",
        resume_text_or_url: "https://example.com/resume",
        my_phone_number: "+919999999999",
      };
      assert.equal(parseHotLeadWhatsAppArgs(valid).toPhoneNumber, PHONE);
      assert.throws(
        () => parseHotLeadWhatsAppArgs({ ...valid, to_phone_number: "9876543210" }),
        BolnaToolError,
      );
      assert.equal(isE164Phone(PHONE), true);
      assert.equal(isE164Phone("9876543210"), false);
    });
  });

  describe("signed workflow callbacks", () => {
    it("eval: callback signature uses the literal secret and detects tampering", () => {
      const body = JSON.stringify({ lead: { phone: PHONE } });
      const signature = signBolnaCallbackBody(body, SIGNING_SECRET);

      assert.match(signature, /^sha256=[0-9a-f]{64}$/);
      assert.equal(isBolnaCallbackSignatureValid(body, signature, SIGNING_SECRET), true);
      assert.equal(isBolnaCallbackSignatureValid(`${body} `, signature, SIGNING_SECRET), false);
      assert.equal(isBolnaCallbackSignatureValid(body, undefined, SIGNING_SECRET), false);
      assert.equal(isBolnaCallbackSignatureValid(body, "sha256=deadbeef", SIGNING_SECRET), false);
      assert.doesNotThrow(() => validateCallbackSigningSecret(SIGNING_SECRET));
      assert.throws(() => validateCallbackSigningSecret("a".repeat(63)), BolnaConfigError);
    });

    it("eval: callback bodies require a correlation identifier and E.164 phone", () => {
      const body = buildLeadQualificationCallbackBody({
        event: "lead.qualified",
        phone: PHONE,
        leadId: "lead-1",
        intent: "HOT",
        summary: "Fixture summary",
      });
      const parsed = JSON.parse(body) as { lead: { phone: string; id: string } };

      assert.equal(parsed.lead.phone, PHONE);
      assert.equal(parsed.lead.id, "lead-1");
      assert.doesNotThrow(() => validateCallbackBody(body));
      assert.throws(
        () => buildLeadQualificationCallbackBody({ event: "lead.qualified", phone: "9876543210", leadId: "lead-1" }),
        BolnaConfigError,
      );
      assert.throws(
        () => buildLeadQualificationCallbackBody({ event: "lead.qualified", phone: PHONE }),
        BolnaConfigError,
      );
      assert.throws(() => validateCallbackBody("{}"), BolnaConfigError);
    });

    it("eval: endpoint parser rejects non-HTTPS URLs and malformed secrets", () => {
      const endpoint = parseBolnaWorkflowCallbackEndpoint({
        url: "https://hooks.bolna.ai/callbacks/slug-1",
        slug: "slug-1",
        signing_secret: SIGNING_SECRET,
        created_at: "2026-11-26T10:00:00Z",
        rate_limit_per_min: 60,
      });
      assert.equal(endpoint.signingSecret, SIGNING_SECRET);
      assert.equal(endpoint.rateLimitPerMinute, 60);
      assert.throws(
        () =>
          parseBolnaWorkflowCallbackEndpoint({
            url: "http://hooks.bolna.ai/callbacks/slug-1",
            slug: "slug-1",
            signing_secret: SIGNING_SECRET,
          }),
        BolnaResponseError,
      );
      assert.throws(
        () =>
          parseBolnaWorkflowCallbackEndpoint({
            url: "https://hooks.bolna.ai/callbacks/slug-1",
            slug: "slug-1",
            signing_secret: "short",
          }),
        BolnaResponseError,
      );
    });

    it("eval: get, rotate, and signed POST use documented callback contracts", async () => {
      const endpointResponse = (slug: string) => ({
        url: `https://hooks.bolna.ai/callbacks/${slug}`,
        slug,
        signing_secret: SIGNING_SECRET,
        created_at: "2026-11-26T10:00:00Z",
      });
      const harness = await startServer((request) => {
        if (
          request.method === "GET" &&
          request.url === "/workflows/wf-1/nodes/node-1/callback"
        ) {
          return { status: 200, body: endpointResponse("slug-1") };
        }
        if (
          request.method === "POST" &&
          request.url === "/workflows/wf-1/nodes/node-1/callback:rotate"
        ) {
          return { status: 200, body: endpointResponse("slug-2") };
        }
        if (request.method === "POST" && request.url === "/callback") {
          return { status: 200, body: { status: "accepted", match: "matched" } };
        }
        return { status: 404, body: { error: 404, message: "unexpected request" } };
      });
      const client = testClient(harness.baseUrl);
      const endpoint = await client.getWorkflowCallback("wf-1", "node-1");
      assert.equal(endpoint.slug, "slug-1");
      assert.equal(endpoint.signingSecret, SIGNING_SECRET);

      const rotated = await client.rotateWorkflowCallback("wf-1", "node-1");
      assert.equal(rotated.slug, "slug-2");
      assert.notEqual(endpoint.url, rotated.url);

      const body = buildLeadQualificationCallbackBody({
        event: "callback.requested",
        phone: PHONE,
        executionId: "exec-1",
      });
      const delivery = await client.postWorkflowCallback(
        { ...rotated, url: `${harness.baseUrl}/callback` },
        body,
      );
      assert.equal(delivery.status, "accepted");
      assert.equal(delivery.match, "matched");

      const posted = harness.requests.find((request) => request.url === "/callback");
      assert.ok(posted);
      assert.equal(posted.body, body);
      assert.equal(posted.signature, signBolnaCallbackBody(body, SIGNING_SECRET));
      assert.equal(posted.authorization, undefined);
      assert.ok(harness.requests.some((request) => request.url.endsWith("callback:rotate")));
    });

    it("eval: callback error snippets never expose the signing secret", async () => {
      const harness = await startServer(() => ({
        status: 400,
        body: { message: `bad signature for ${SIGNING_SECRET}` },
      }));
      const client = testClient(harness.baseUrl);
      const body = buildLeadQualificationCallbackBody({
        event: "lead.qualified",
        phone: PHONE,
        leadId: "lead-1",
      });

      await assert.rejects(
        () =>
          client.postWorkflowCallback(
            {
              url: `${harness.baseUrl}/callback-error`,
              slug: "slug-1",
              signingSecret: SIGNING_SECRET,
              createdAt: null,
              rateLimitPerMinute: null,
            },
            body,
          ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message.includes(SIGNING_SECRET), false);
          return true;
        },
      );
    });
  });

  describe("ported callback and WhatsApp behavior", () => {
    it("eval: natural language and explicit callback times resolve in the caller timezone", () => {
      const now = new Date("2026-11-26T05:00:00Z");
      const natural = resolveCallbackTime({
        timezone: "Asia/Kolkata",
        requestText: "tomorrow 4 pm",
        now,
      });
      assert.equal(natural.status, "scheduled");
      assert.equal(natural.scheduledAt.toISOString(), "2026-11-27T10:30:00.000Z");

      const explicit = resolveCallbackTime({
        timezone: "Asia/Kolkata",
        scheduledAt: "2026-11-28T11:00:00+05:30",
        now,
      });
      assert.equal(explicit.status, "scheduled");
      assert.equal(explicit.scheduledAt.toISOString(), "2026-11-28T05:30:00.000Z");

      const past = resolveCallbackTime({
        timezone: "Asia/Kolkata",
        scheduledAt: "2020-01-01T00:00:00Z",
        now,
      });
      assert.equal(past.status, "needs-clarification");
      assert.equal(
        resolveCallbackTime({ timezone: "Asia/Kolkata", now }).status,
        "needs-clarification",
      );
      assert.throws(() =>
        resolveCallbackTime({ timezone: "Not/AZone", requestText: "tomorrow 4 pm", now }),
      );
    });

    it("eval: hot-lead WhatsApp message and Twilio request stay offline", async () => {
      const text = buildHotLeadWhatsAppMessage({
        leadId: "lead-1",
        callerPhoneNumber: PHONE,
        contextText: "Interested in a discovery call",
        resumeTextOrUrl: "https://example.com/resume",
      });
      assert.match(text, /lead-1/);
      assert.match(text, new RegExp(PHONE.replace(/\+/g, "\\+")));
      assert.match(text, /discovery call/);
      assert.equal(normalizeWhatsAppAddress("whatsapp:9876543210"), "whatsapp:+9876543210");

      const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
      const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ sid: "SM-fixture" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const result = await sendWhatsAppMessage(
        {
          provider: "twilio",
          accountSid: "ACfixture",
          authToken: "fixture-token",
          from: "+15550001111",
        },
        PHONE,
        text,
        fakeFetch,
      );

      assert.equal(result.providerMessageId, "SM-fixture");
      assert.equal(calls.length, 1);
      assert.match(calls[0]?.url ?? "", /api\.twilio\.com/);
      const body = calls[0]?.init?.body as URLSearchParams;
      assert.equal(body.get("To"), `whatsapp:${PHONE}`);
      assert.equal(body.get("Body"), text);
    });
  });
});
