import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  agentRequestDigest,
  buildAgentVersionPlan,
  buildElevateBoxAgentRequest,
  buildElevateBoxCallRequest,
  createElevateBoxAgentSpec,
  formatBolnaScheduledAt,
  promoteAgentVersion,
  registerCandidateAgentVersion,
  type ElevateBoxAgentSpec,
} from "../lib/bolna/index.ts";
import { createBolnaClient, type BolnaClient } from "../lib/bolna/index.ts";
import type { BolnaConfig } from "../lib/bolna/index.ts";
import type { BolnaMultilingualLanguageEntry } from "../lib/bolna/agent-types.ts";
import { BolnaConfigError, BolnaHttpError } from "../lib/bolna/index.ts";

const API_KEY = "bolna-step3-test-key";

interface SeenRequest {
  method: string;
  url: string;
  body: string;
  authorization: string | undefined;
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
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const seen: SeenRequest = {
      method: request.method ?? "",
      url: request.url ?? "",
      body: Buffer.concat(chunks).toString("utf8"),
      authorization: request.headers.authorization,
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
    webhookUrl: "http://127.0.0.1:7777/api/bolna/webhook/step3-test-token-0123456789",
    versionName: "step3-fixture",
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

function captureConsole() {
  const lines: string[] = [];
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
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

afterEach(async () => {
  if (!server) return;
  const current = server;
  server = undefined;
  current.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("Step 3 — Bolna agent config and version evals", () => {
  describe("config-as-code safety", () => {
    it("eval: rejects placeholder voices and unsafe webhook URLs", () => {
      const badVoice = fixtureSpec();
      badVoice.languages.hi.voice.voiceId = "REPLACE_ME";
      assert.throws(() => buildElevateBoxAgentRequest(badVoice), BolnaConfigError);

      assert.throws(
        () => buildElevateBoxAgentRequest(fixtureSpec({ webhookUrl: "http://api.example.com/hook" })),
        BolnaConfigError,
      );
      assert.throws(
        () =>
          buildElevateBoxAgentRequest(
            fixtureSpec({ webhookUrl: "https://user:pass@example.com/hook" }),
          ),
        BolnaConfigError,
      );
    });

    it("eval: compiles a sequential transcriber/llm/synthesizer pipeline", () => {
      const request = buildElevateBoxAgentRequest(fixtureSpec());
      const task = request.agent_config.tasks[0];

      assert.deepEqual(task.toolchain, {
        execution: "sequential",
        pipelines: [["transcriber", "llm", "synthesizer"]],
      });
      assert.equal(task.task_type, "conversation");
      assert.equal(task.tools_config.input.provider, "trunk");
      assert.equal(task.tools_config.input.format, "linear16");
      assert.equal(task.tools_config.output.provider, "trunk");
      assert.equal(request.agent_config.call_summary_enabled, true);
    });

    it("eval: keeps token and cost guardrails inside the agent payload", () => {
      const request = buildElevateBoxAgentRequest(fixtureSpec());
      const llm = request.agent_config.tasks[0].tools_config.llm_agent.llm_config;
      const taskConfig = request.agent_config.tasks[0].task_config;

      assert.equal(llm.temperature, 1);
      assert.equal(llm.max_tokens, 180);
      assert.equal(llm.verbosity, "low");
      assert.equal(taskConfig?.call_terminate, 600);
      assert.equal(taskConfig?.voicemail, true);
      assert.ok(!JSON.stringify(request).includes(API_KEY));
    });

    it("eval: configures en/hi/te multilingual switching without prompt instructions", () => {
      const request = buildElevateBoxAgentRequest(fixtureSpec());
      const multilingual =
        request.agent_config.tasks[0].tools_config.multilingual_config;
      assert.ok(multilingual);

      assert.equal(multilingual.enabled, true);
      assert.equal(multilingual.active_language, "en");
      assert.equal(multilingual.language_switch_trigger, "requested_or_auto_detected");
      assert.deepEqual(Object.keys(multilingual.languages).sort(), ["en", "hi", "te"]);

      const prompts = [
        request.agent_prompts.task_1?.system_prompt ?? "",
        ...Object.values(multilingual.languages).map(
          (language) => language.system_prompt ?? "",
        ),
      ];
      assert.ok(prompts.every((prompt) => prompt.trim().length > 0));
      assert.ok(
        prompts.every((prompt) => !/switch\s+language|language\s+switch|change\s+language/i.test(prompt)),
      );
      assert.ok(multilingual.languages.hi?.handoff_message?.includes("हिंदी"));
      assert.ok(multilingual.languages.te?.handoff_message?.includes("తెలుగు"));
    });

    it("eval: voice settings use native providers and required provider language fields", () => {
      const request = buildElevateBoxAgentRequest(fixtureSpec());
      const multilingual =
        request.agent_config.tasks[0].tools_config.multilingual_config;
      assert.ok(multilingual);

      assert.equal(multilingual.languages.en?.synthesizer.provider, "elevenlabs");
      assert.equal(multilingual.languages.hi?.synthesizer.provider, "sarvam");
      assert.equal(multilingual.languages.te?.synthesizer.provider, "sarvam");
      assert.equal(
        (multilingual.languages.hi?.synthesizer.provider_config as Record<string, unknown>)
          .language,
        "hi",
      );
      assert.equal(
        (multilingual.languages.te?.synthesizer.provider_config as Record<string, unknown>)
          .language,
        "te",
      );
    });

    it("eval: tunes endpointing, VAD, interruption, and pauses instead of LLM inference", () => {
      const request = buildElevateBoxAgentRequest(fixtureSpec());
      const task = request.agent_config.tasks[0];
      const transcriber = task.tools_config.transcriber;
      const taskConfig = task.task_config;

      assert.equal(transcriber.endpointing, 250);
      assert.equal(transcriber.vad_threshold, 0.5);
      assert.equal(transcriber.vad_prefix_padding_ms, 300);
      assert.equal(taskConfig?.incremental_delay, 450);
      assert.equal(taskConfig?.number_of_words_for_interruption, 2);
      assert.equal(taskConfig?.backchanneling, true);
      assert.equal(taskConfig?.check_if_user_online, true);
      assert.equal(taskConfig?.trigger_user_online_message_after, 12);
      assert.equal(taskConfig?.noise_cancellation_level, 80);

      const activePrompt = request.agent_prompts.task_1?.system_prompt ?? "";
      const multilingual = task.tools_config.multilingual_config;
      const prompts = [
        activePrompt,
        ...Object.values(multilingual?.languages ?? {}).map(
          (language: BolnaMultilingualLanguageEntry) => language.system_prompt ?? "",
        ),
      ];
      assert.ok(prompts.every((prompt) => !/thinking/i.test(prompt)));
    });

    it("eval: version digest is deterministic and changes with prompt edits", () => {
      const planA = buildAgentVersionPlan(fixtureSpec());
      const planB = buildAgentVersionPlan(fixtureSpec());
      const edited = fixtureSpec();
      edited.languages.en.systemPrompt += " Add one new discovery question.";
      const planC = buildAgentVersionPlan(edited);

      assert.equal(planA.digest, planB.digest);
      assert.notEqual(planA.digest, planC.digest);
      assert.ok((planA.versionRequest.tags ?? []).includes(`config-sha256:${planA.digest}`));
      assert.equal(agentRequestDigest(planA.createRequest), planA.digest);
    });
  });

  describe("immutable version API flow", () => {
    it("eval: POST /v2/agent returns 201 with state and version_id", async () => {
      const harness = await startServer(() => ({
        status: 201,
        body: {
          agent_id: "agent-1",
          state: "created",
          version_id: "version-1",
        },
      }));

      const result = await registerCandidateAgentVersion(
        testClient(harness.baseUrl),
        buildAgentVersionPlan(fixtureSpec()),
      );

      assert.deepEqual(result, {
        kind: "created-agent",
        agentId: "agent-1",
        versionId: "version-1",
      });
      assert.equal(harness.requests[0]?.url, "/v2/agent");
      assert.equal(harness.requests[0]?.method, "POST");
      assert.equal(harness.requests[0]?.authorization, `Bearer ${API_KEY}`);
      assert.ok(!JSON.parse(harness.requests[0]?.body ?? "{}").version_name);
    });

    it("eval: existing agents save an immutable version and never mutate the live agent", async () => {
      const harness = await startServer((request) => ({
        status: request.url?.includes("/set_current") ? 500 : 200,
        body: {
          agent_id: "agent-1",
          version_id: "version-2",
          version_name: "step3-fixture",
          state: "saved",
        },
      }));

      const plan = buildAgentVersionPlan(fixtureSpec());
      const result = await registerCandidateAgentVersion(testClient(harness.baseUrl), plan, {
        agentId: "agent-1",
      });

      assert.equal(result.kind, "saved-version");
      assert.equal(result.versionId, "version-2");
      assert.equal(harness.requests.length, 1);
      assert.equal(harness.requests[0]?.url, "/v2/agent/agent-1/versions");
      assert.equal(harness.requests[0]?.method, "POST");
      assert.ok(!harness.requests.some((request) => request.url.includes("/set_current")));

      const body = JSON.parse(harness.requests[0]?.body ?? "{}");
      assert.equal(body.version_name, "step3-fixture");
      assert.ok(body.tags.includes(`config-sha256:${plan.digest}`));
      assert.ok(body.agent_config.tasks[0].toolchain.pipelines);
    });

    it("eval: set_current is only reachable through the explicit promote function", async () => {
      const harness = await startServer(() => ({
        status: 200,
        body: {
          message: "Agent version set as current successfully",
          current_version_id: "version-2",
        },
      }));

      const promoted = await promoteAgentVersion(testClient(harness.baseUrl), "agent-1", "version-2");
      assert.equal(promoted, "version-2");
      assert.equal(
        harness.requests[0]?.url,
        "/v2/agent/agent-1/versions/version-2/set_current",
      );
    });

    it("eval: version list normalizes id, current marker, and pagination", async () => {
      const harness = await startServer(() => ({
        status: 200,
        body: {
          versions: [
            {
              id: "version-2",
              version_name: "step3-fixture",
              tags: ["elevatebox"],
              version_status: "saved",
              is_current: false,
              created_at: "2026-11-25T10:00:00",
              updated_at: "2026-11-25T10:00:00",
            },
            {
              id: "version-1",
              version_name: "v1",
              tags: null,
              version_status: "published",
              is_current: true,
              created_at: "2026-11-24T10:00:00",
              updated_at: "2026-11-24T10:00:00",
            },
          ],
          current_version_id: "version-1",
          total: 2,
          page_number: 1,
          page_size: 20,
          has_more: false,
        },
      }));

      const versions = await testClient(harness.baseUrl).listAgentVersions("agent-1");
      assert.equal(versions.versions.length, 2);
      assert.equal(versions.versions[0]?.id, "version-2");
      assert.equal(versions.versions[0]?.is_current, false);
      assert.equal(versions.current_version_id, "version-1");
      assert.equal(harness.requests[0]?.url, "/v2/agent/agent-1/versions?page_number=1&page_size=20");
    });
  });

  describe("pinned call requests and secret safety", () => {
    it("eval: POST /call pins the evaluated version and starting language", async () => {
      const harness = await startServer(() => ({
        status: 200,
        body: {
          message: "done",
          status: "queued",
          execution_id: "execution-1",
        },
      }));

      const request = buildElevateBoxCallRequest({
        agentId: "agent-1",
        versionId: "version-2",
        recipientPhoneNumber: "+919876543210",
        language: "hi",
        userData: { customer_name: "Asha" },
      });
      const response = await testClient(harness.baseUrl).makeCall(request);

      assert.equal(response.execution_id, "execution-1");
      const body = JSON.parse(harness.requests[0]?.body ?? "{}");
      assert.equal(body.agent_version_id, "version-2");
      assert.equal(body.agent_data.language, "hi");
      assert.equal(body.user_data.agent_language, "hi");
      assert.equal(body.user_data.customer_name, "Asha");
      assert.ok(!("voice_id" in body.agent_data));
    });

    it("eval: scheduled_at is UTC with +00:00, rounded up, and at least two minutes out", async () => {
      const now = new Date("2026-11-25T12:00:00.000Z");
      const rounded = formatBolnaScheduledAt(new Date("2026-11-25T12:33:00.000Z"), now);
      assert.equal(rounded, "2026-11-25T12:40:00+00:00");
      assert.ok(!rounded.endsWith("Z"));

      assert.throws(
        () => formatBolnaScheduledAt(new Date("2026-11-25T12:01:00.000Z"), now),
        BolnaConfigError,
      );

      const request = buildElevateBoxCallRequest({
        agentId: "agent-1",
        versionId: "version-2",
        recipientPhoneNumber: "+919876543210",
        scheduledFor: new Date("2026-11-25T12:33:00.000Z"),
        now,
      });
      assert.equal(request.scheduled_at, "2026-11-25T12:40:00+00:00");
    });

    it("eval: rejects malformed call inputs and conflicting language variables", () => {
      assert.throws(
        () =>
          buildElevateBoxCallRequest({
            agentId: "agent-1",
            versionId: "",
            recipientPhoneNumber: "+919876543210",
          }),
        BolnaConfigError,
      );
      assert.throws(
        () =>
          buildElevateBoxCallRequest({
            agentId: "agent-1",
            versionId: "version-2",
            recipientPhoneNumber: "9876543210",
          }),
        BolnaConfigError,
      );
      assert.throws(
        () =>
          buildElevateBoxCallRequest({
            agentId: "agent-1",
            versionId: "version-2",
            recipientPhoneNumber: "+919876543210",
            language: "hi",
            userData: { agent_language: "en" },
          }),
        BolnaConfigError,
      );
    });

    it("eval: redacts API keys in version API errors and logs nothing", async () => {
      const harness = await startServer(() => ({
        status: 400,
        body: { message: `bad key ${API_KEY}`, api_key: API_KEY },
      }));
      const captured = captureConsole();

      try {
        await assert.rejects(
          registerCandidateAgentVersion(
            testClient(harness.baseUrl),
            buildAgentVersionPlan(fixtureSpec()),
          ),
          (error: unknown) => {
            assert.ok(error instanceof BolnaHttpError);
            assert.equal(error.status, 400);
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

    it("eval: GET /executions fetches a typed snapshot for webhook verification", async () => {
      const harness = await startServer(() => ({
        status: 200,
        body: {
          id: "exec-verify",
          agent_id: "agent-1",
          status: "COMPLETED",
          conversation_duration: 42,
          total_cost: 3.23,
          transcript: "assistant: Hi",
          summary: null,
        },
      }));

      const execution = await testClient(harness.baseUrl).getExecution("exec verify");

      assert.equal(execution.executionId, "exec-verify");
      assert.equal(execution.agentId, "agent-1");
      assert.equal(execution.status, "completed");
      assert.equal(execution.conversationDuration, 42);
      assert.equal(execution.totalCost, 3.23);
      assert.equal(execution.transcript, "assistant: Hi");
      assert.equal(execution.summary, null);
      assert.equal(harness.requests[0]?.method, "GET");
      assert.equal(harness.requests[0]?.url, "/executions/exec%20verify");
      assert.equal(harness.requests[0]?.authorization, `Bearer ${API_KEY}`);
    });
  });
});
