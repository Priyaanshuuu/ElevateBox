import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  BolnaConfigError,
  BolnaResponseError,
  createBolnaClient,
  createElevateBoxKnowledgePlan,
  createKnowledgeBasePdf,
  evaluateKnowledgeGrounding,
  KNOWLEDGE_GROUNDING_EVALS,
  parseBolnaKnowledgeBase,
  parseBolnaKnowledgeBaseListResponse,
  SERVICE_OVERVIEW_PDF_PREFIX,
  validateKnowledgeSource,
  type BolnaClient,
  type BolnaConfig,
  type ElevateBoxKnowledgePlan,
} from "../lib/bolna/index.ts";

const API_KEY = "bolna-step5-knowledge-test-key";
const KNOWLEDGE_FILE_NAME = "elevatebox-service-overview-0123456789ab.pdf";
const KNOWLEDGE_BASE_RESPONSE = {
  rag_id: "f265b06a-7fa7-4fbf-8923-55d5ae9c4ba2",
  vector_id: "77a3473c-c78f-4695-ba56-95b1f4f9e80b",
  file_name: KNOWLEDGE_FILE_NAME,
  source_type: "pdf",
  status: "processed",
  language_support: "multilingual",
  created_at: "2026-11-26T10:00:00Z",
  updated_at: "2026-11-26T10:01:00Z",
};

interface SeenRequest {
  method: string;
  url: string;
  contentType: string | undefined;
  authorization: string | undefined;
  body: Buffer;
}

let server: Server | undefined;

async function startServer(
  handler: (request: SeenRequest) => { status: number; body: unknown },
): Promise<{ baseUrl: string; requests: SeenRequest[] }> {
  const requests: SeenRequest[] = [];
  const current = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const seen: SeenRequest = {
      method: request.method ?? "",
      url: request.url ?? "",
      contentType: request.headers["content-type"],
      authorization: request.headers.authorization,
      body: Buffer.concat(chunks),
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

async function loadPlan(): Promise<ElevateBoxKnowledgePlan> {
  const source = await readFile("../knowledge/service-overview.md", "utf8");
  return createElevateBoxKnowledgePlan(source);
}

describe("Step 5 — Bolna knowledge grounding evals", () => {
  describe("canonical knowledge config", () => {
    it("eval: canonical source passes validation and produces a deterministic plan", async () => {
      const first = await loadPlan();
      const second = await loadPlan();

      assert.equal(first.digest, second.digest);
      assert.match(first.fileName, new RegExp(`^${SERVICE_OVERVIEW_PDF_PREFIX}-[0-9a-f]{12}\\.pdf$`));
      assert.equal(first.languageSupport, "multilingual");
      assert.equal(first.chunkSize, 512);
      assert.equal(first.similarityTopK, 15);
      assert.equal(first.overlapping, 128);
      assert.doesNotThrow(() => validateKnowledgeSource(first.sourceText));
    });

    it("eval: missing required facts are rejected", () => {
      const badSource = "A short page. ".repeat(30) + "No e-commerce facts here.";
      assert.throws(() => validateKnowledgeSource(badSource), BolnaConfigError);
    });

    it("eval: generated PDF is a valid single-page document", async () => {
      const plan = await loadPlan();
      const pdf = createKnowledgeBasePdf(plan);
      const text = pdf.toString("latin1");

      assert.match(text, /^%PDF-1\.4/);
      assert.match(text, /\/Type \/Catalog/);
      assert.match(text, /\/Count 1/);
      assert.match(text, /startxref/);
      assert.match(text, /%%EOF/);
      assert.ok(text.includes("Razorpay"));
      assert.ok(pdf.length > 1000);
    });

    it("eval: grounding answers must contain source facts and avoid fabrication", async () => {
      const plan = await loadPlan();
      assert.equal(plan.sourceText.includes("2 to 4 weeks"), true);

      const basicTimeline = KNOWLEDGE_GROUNDING_EVALS.find(
        (item) => item.id === "basic-store-timeline",
      );
      const pricing = KNOWLEDGE_GROUNDING_EVALS.find((item) => item.id === "pricing-guardrail");
      assert.ok(basicTimeline);
      assert.ok(pricing);
      assert.equal(
        evaluateKnowledgeGrounding("A basic store usually takes 2 to 4 weeks.", basicTimeline),
        true,
      );
      assert.equal(
        evaluateKnowledgeGrounding("It will be ready tomorrow, guaranteed.", basicTimeline),
        false,
      );
      assert.equal(
        evaluateKnowledgeGrounding(
          "Price depends on complexity; a discovery call is required before a quote.",
          pricing,
        ),
        true,
      );
      assert.equal(
        evaluateKnowledgeGrounding("It is a fixed price of 50000.", pricing),
        false,
      );
    });
  });

  describe("typed knowledge base API", () => {
    it("eval: parser rejects malformed knowledge base responses", () => {
      assert.throws(() => parseBolnaKnowledgeBase({ rag_id: 1 }), BolnaResponseError);
      assert.throws(() => parseBolnaKnowledgeBaseListResponse({ nope: [] }), BolnaResponseError);
    });

    it("eval: create, list, get, and delete use documented endpoints with bearer auth", async () => {
      const harness = await startServer((request) => {
        if (request.method === "POST" && request.url === "/knowledgebase") {
          return { status: 200, body: KNOWLEDGE_BASE_RESPONSE };
        }
        if (request.method === "GET" && request.url === "/knowledgebase/all") {
          return { status: 200, body: [KNOWLEDGE_BASE_RESPONSE] };
        }
        if (
          request.method === "GET" &&
          request.url === `/knowledgebase/${KNOWLEDGE_BASE_RESPONSE.rag_id}`
        ) {
          return { status: 200, body: KNOWLEDGE_BASE_RESPONSE };
        }
        if (
          request.method === "DELETE" &&
          request.url === `/knowledgebase/${KNOWLEDGE_BASE_RESPONSE.rag_id}`
        ) {
          return { status: 200, body: { message: "Knowledge base deleted successfully" } };
        }
        return { status: 404, body: { error: 404, message: "unexpected request" } };
      });
      const client = testClient(harness.baseUrl);
      const plan = await loadPlan();
      const pdf = createKnowledgeBasePdf(plan);

      const created = await client.createKnowledgeBase({
        source: { kind: "pdf", fileName: plan.fileName, bytes: pdf },
        chunkSize: plan.chunkSize,
        similarityTopK: plan.similarityTopK,
        overlapping: plan.overlapping,
        languageSupport: plan.languageSupport,
      });
      assert.equal(created.ragId, KNOWLEDGE_BASE_RESPONSE.rag_id);
      assert.equal(created.languageSupport, "multilingual");

      const listed = await client.listKnowledgeBases();
      assert.equal(listed.knowledgeBases[0]?.vectorId, KNOWLEDGE_BASE_RESPONSE.vector_id);

      const fetched = await client.getKnowledgeBase(KNOWLEDGE_BASE_RESPONSE.rag_id);
      assert.equal(fetched.status, "processed");

      const deleted = await client.deleteKnowledgeBase(KNOWLEDGE_BASE_RESPONSE.rag_id);
      assert.equal(deleted.acknowledged, true);

      assert.equal(harness.requests.length, 4);
      assert.ok(harness.requests.every((item) => item.authorization === `Bearer ${API_KEY}`));
      assert.match(harness.requests[0]?.contentType ?? "", /^multipart\/form-data/);
      const uploadBody = harness.requests[0]?.body.toString("latin1") ?? "";
      assert.match(uploadBody, /language_support/);
      assert.match(uploadBody, /multilingual/);
      assert.match(uploadBody, /%PDF-1\.4/);
    });
  });
});
