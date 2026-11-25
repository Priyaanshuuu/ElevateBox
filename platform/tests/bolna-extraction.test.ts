import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  BolnaConfigError,
  CODE_SWITCH_TRANSCRIPT,
  createBolnaClient,
  createLeadQualificationPlan,
  DISPOSITION_TEST_RESPONSE,
  EXPECTED_LEAD_FACTS,
  extractLeadFacts,
  extractLeadFactsFromData,
  LEAD_QUALIFICATION_CATEGORY,
  LOW_CONFIDENCE_EXTRACTED_DATA,
  NO_USER_TURN_SUMMARY,
  parseBolnaDispositionTestResponse,
  parseBolnaWebhookPayload,
  QUALIFICATION_EXTRACTED_DATA,
  QUALIFICATION_TRANSCRIPT,
  sanitizeCallSummary,
  SKIPPED_EXTRACTED_DATA,
  validateLeadQualificationPlan,
  buildLeadQualificationDispositions,
} from "../lib/bolna/index.ts";
import type { BolnaClient, BolnaConfig } from "../lib/bolna/index.ts";

const API_KEY = "bolna-step4-test-key";

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

afterEach(async () => {
  if (!server) return;
  const current = server;
  server = undefined;
  current.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("Step 4 — Bolna extraction, disposition, and summary evals", () => {
  describe("extraction config-as-code", () => {
    it("eval: qualification plan is valid, deterministic, and a starting category", () => {
      const first = createLeadQualificationPlan();
      const second = createLeadQualificationPlan();

      assert.equal(first.digest, second.digest);
      assert.equal(first.category.name, LEAD_QUALIFICATION_CATEGORY);
      assert.equal(first.category.model, "gpt-4.1-mini");
      assert.equal(first.category.min_duration_s, 8);
      assert.equal(first.category.skip_voicemail, true);
      assert.equal(first.category.parent_disposition_id, undefined);
      assert.equal(first.category.match_mode, undefined);
      assert.doesNotThrow(() => validateLeadQualificationPlan(first));

      const invalid = structuredClone(first);
      invalid.dispositions[0].is_subjective = false;
      invalid.dispositions[0].is_objective = false;
      assert.throws(() => validateLeadQualificationPlan(invalid), BolnaConfigError);
    });

    it("eval: dispositions attach by category_id and keep objective options", () => {
      const dispositions = buildLeadQualificationDispositions("category-1");

      assert.equal(dispositions.length, 6);
      assert.ok(dispositions.every((item) => item.category_id === "category-1"));
      assert.ok(dispositions.every((item) => item.category === undefined));

      const intent = dispositions.find((item) => item.name === "lead_intent");
      assert.equal(intent?.is_objective, true);
      assert.equal(intent?.is_subjective, false);
      assert.deepEqual(
        intent?.objective_options?.map((option) => option.value),
        ["HOT", "WARM", "COLD", "UNKNOWN"],
      );
    });
  });

  describe("typed extraction API", () => {
    it("eval: category, disposition, bulk, and test calls use the documented endpoints", async () => {
      const categoryResponse = {
        id: "category-1",
        name: LEAD_QUALIFICATION_CATEGORY,
        model: "gpt-4.1-mini",
        agent_id: "agent 1",
        min_duration_s: 8,
        skip_voicemail: true,
        parent_disposition_id: null,
        match_mode: null,
        match_values: null,
        dispositions: [],
      };

      const harness = await startServer((request) => {
        if (request.method === "POST" && request.url === "/agent/agent%201/extraction-categories") {
          return { status: 201, body: categoryResponse };
        }
        if (request.method === "GET" && request.url === "/agent/agent%201/extraction-categories") {
          return { status: 200, body: { categories: [categoryResponse] } };
        }
        if (request.method === "POST" && request.url === "/dispositions/") {
          return {
            status: 201,
            body: { message: "Disposition created successfully", id: "disp-1", category_id: "category-1" },
          };
        }
        if (request.method === "POST" && request.url === "/dispositions/bulk") {
          return {
            status: 201,
            body: { message: "Dispositions created successfully", ids: ["disp-1", "disp-2"] },
          };
        }
        if (
          request.method === "POST" &&
          request.url === "/v2/agent/agent%201/dispositions/test"
        ) {
          return { status: 200, body: DISPOSITION_TEST_RESPONSE };
        }
        return { status: 404, body: { error: 404, message: "unexpected request" } };
      });

      const client = testClient(harness.baseUrl);
      const plan = createLeadQualificationPlan();

      const created = await client.createExtractionCategory("agent 1", plan.category);
      assert.equal(created.id, "category-1");
      assert.deepEqual(created.dispositions, []);

      const listed = await client.listExtractionCategories("agent 1");
      assert.equal(listed.categories[0]?.name, LEAD_QUALIFICATION_CATEGORY);

      const disposition = await client.createDisposition({
        agent_id: "agent 1",
        name: "business",
        question: "What business was mentioned?",
        is_subjective: true,
      });
      assert.equal(disposition.id, "disp-1");
      assert.equal(disposition.categoryId, "category-1");

      const bulk = await client.createDispositionsBulk({
        agent_id: "agent 1",
        dispositions: [
          { name: "business", question: "What business was mentioned?" },
          { name: "budget", question: "What budget was mentioned?" },
        ],
      });
      assert.deepEqual(bulk.ids, ["disp-1", "disp-2"]);

      const tested = await client.testDispositions("agent 1", {
        transcript: QUALIFICATION_TRANSCRIPT,
      });
      assert.equal(tested.extractedData["Lead Qualification"]?.business?.confidence, 0.97);

      assert.equal(harness.requests.length, 5);
      assert.ok(harness.requests.every((item) => item.authorization === `Bearer ${API_KEY}`));
      assert.equal(
        JSON.parse(harness.requests[0]?.body ?? "{}").agent_id,
        undefined,
        "category create must not duplicate agent_id in the body",
      );
    });
  });

  describe("grouped extraction normalization", () => {
    it("eval: nested results override legacy flat keys with expected lead facts", () => {
      const facts = extractLeadFactsFromData(QUALIFICATION_EXTRACTED_DATA, {
        business: "Wrong Legacy Business",
        intent: "COLD",
      });
      assert.deepEqual(facts, EXPECTED_LEAD_FACTS);
    });

    it("eval: low-confidence results are treated as missing", () => {
      const facts = extractLeadFactsFromData(LOW_CONFIDENCE_EXTRACTED_DATA);
      assert.equal(facts.business, null);
      assert.equal(facts.intent, null);
      assert.equal(facts.productCount, 120);
    });

    it("eval: skipped results never fall back to a flat legacy value", () => {
      const facts = extractLeadFactsFromData(SKIPPED_EXTRACTED_DATA, { budget: "999999" });
      assert.equal(facts.budget, null);
      assert.equal(facts.business, "Acme Store");
    });

    it("eval: disposition test parser preserves grouped category/name structure", () => {
      const parsed = parseBolnaDispositionTestResponse(DISPOSITION_TEST_RESPONSE);
      const business = parsed.extractedData["Lead Qualification"]?.business;

      assert.equal(business?.subjective, "Acme Store");
      assert.equal(business?.confidence, 0.97);
      assert.equal(business?.status, "completed");
      assert.equal(business?.statusReason, null);
    });

    it("eval: English and code-switch fixtures both carry qualification signals", () => {
      for (const transcript of [QUALIFICATION_TRANSCRIPT, CODE_SWITCH_TRANSCRIPT]) {
        assert.match(transcript, /120 products|120 products hain/i);
        assert.match(transcript, /50000 rupees/i);
        assert.match(transcript, /checkout/i);
      }
      assert.match(CODE_SWITCH_TRANSCRIPT, /Haan|Mere paas|chahiye/);
    });
  });

  describe("summary safety", () => {
    it("eval: no-user-turn sentinel is never stored as a summary", () => {
      assert.equal(sanitizeCallSummary(NO_USER_TURN_SUMMARY), null);
      assert.equal(sanitizeCallSummary(`  ${NO_USER_TURN_SUMMARY}  `), null);
      assert.equal(
        sanitizeCallSummary("Customer asked about checkout and pricing."),
        "Customer asked about checkout and pricing.",
      );
    });

    it("eval: webhook normalization sanitizes summary and still extracts facts", () => {
      const normalized = parseBolnaWebhookPayload({
        id: "exec-step4",
        status: "completed",
        summary: NO_USER_TURN_SUMMARY,
        phone_number: "+919999999999",
        extracted_data: QUALIFICATION_EXTRACTED_DATA,
      });

      assert.equal(normalized.summary, null);
      assert.deepEqual(extractLeadFacts(normalized), EXPECTED_LEAD_FACTS);
    });
  });
});
