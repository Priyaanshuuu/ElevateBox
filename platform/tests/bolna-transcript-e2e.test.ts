import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BolnaConfigError,
  buildStaticTranscriptCases,
  buildTranscriptWebhookPayload,
  detectTranscriptScript,
  evaluatePreCallGate,
  evaluateStaticTranscript,
  extractLeadFacts,
  extractTranscriptSignals,
  parseBolnaWebhookPayload,
  parseStaticTranscript,
  runOfflineTranscriptGate,
  sanitizeCallSummary,
  staticTranscriptDigest,
  transcriptFixtureDigest,
} from "../lib/bolna/index.ts";
import { NO_USER_TURN_SUMMARY, QUALIFICATION_TRANSCRIPT } from "../lib/bolna/index.ts";
import type { StaticTranscriptEvalResult } from "../lib/bolna/index.ts";

function passingTranscriptResult(id: string): StaticTranscriptEvalResult {
  return {
    id,
    status: "PASS",
    digest: "a".repeat(64),
    checks: [{ name: "fixture", status: "PASS" }],
    reasons: [],
    signals: {
      userTurns: 4,
      agentTurns: 4,
      business: true,
      productCount: 120,
      budget: 50000,
      timeline: true,
      features: true,
      callbackRequested: false,
      hotIntent: true,
      scripts: ["latin"],
    },
  };
}

describe("Step 7 — static transcript pre-call gate evals", () => {
  describe("static transcript parsing", () => {
    it("eval: parser produces ordered, speaker-tagged turns and detects scripts", () => {
      const cases = buildStaticTranscriptCases();
      assert.equal(cases.length, 4);
      assert.deepEqual(
        cases.map((item) => item.id),
        ["en-qualification", "hi-qualification", "te-qualification", "hi-en-code-switch"],
      );

      const hindi = cases.find((item) => item.id === "hi-qualification");
      assert.equal(hindi?.transcript.turns.length, 8);
      assert.equal(hindi?.transcript.turns[0]?.speaker, "agent");
      assert.equal(hindi?.transcript.turns[1]?.speaker, "user");
      assert.equal(hindi?.transcript.turns[1]?.script, "devanagari");
      assert.equal(detectTranscriptScript("నమస్తే"), "telugu");
      assert.equal(detectTranscriptScript("Namaste"), "latin");

      const telugu = cases.find((item) => item.id === "te-qualification");
      assert.equal(telugu?.transcript.turns[1]?.script, "telugu");
      assert.equal(telugu?.transcript.codeSwitch, false);
      assert.equal(
        cases.find((item) => item.id === "hi-en-code-switch")?.transcript.codeSwitch,
        true,
      );
    });

    it("eval: parser digest is deterministic and changes with transcript text", () => {
      const first = parseStaticTranscript(QUALIFICATION_TRANSCRIPT, {
        id: "en-qualification",
        expectedLanguage: "en",
      });
      const second = parseStaticTranscript(QUALIFICATION_TRANSCRIPT, {
        id: "en-qualification",
        expectedLanguage: "en",
      });
      const changed = parseStaticTranscript(`${QUALIFICATION_TRANSCRIPT}\nUser: One more thing.`, {
        id: "en-qualification",
        expectedLanguage: "en",
      });
      assert.equal(staticTranscriptDigest(first), staticTranscriptDigest(second));
      assert.match(staticTranscriptDigest(first), /^[0-9a-f]{64}$/);
      assert.notEqual(staticTranscriptDigest(first), staticTranscriptDigest(changed));
      assert.equal(transcriptFixtureDigest(), transcriptFixtureDigest());
    });

    it("eval: malformed transcripts and languages fail closed", () => {
      assert.throws(
        () => parseStaticTranscript("", { id: "empty", expectedLanguage: "en" }),
        BolnaConfigError,
      );
      assert.throws(
        () => parseStaticTranscript("Agent hello", { id: "no-separator", expectedLanguage: "en" }),
        BolnaConfigError,
      );
      assert.throws(
        () =>
          parseStaticTranscript("System: hello", { id: "unknown-speaker", expectedLanguage: "en" }),
        BolnaConfigError,
      );
      assert.throws(
        () => parseStaticTranscript("Agent:", { id: "empty-turn", expectedLanguage: "en" }),
        BolnaConfigError,
      );
      assert.throws(
        () =>
          parseStaticTranscript("Agent: hello", {
            id: "bad-language",
            expectedLanguage: "fr" as "en",
          }),
        BolnaConfigError,
      );
    });

    it("eval: signal extraction reads qualification facts from code-switch turns", () => {
      const caseFixture = buildStaticTranscriptCases().find(
        (item) => item.id === "hi-en-code-switch",
      );
      assert.ok(caseFixture);
      const signals = extractTranscriptSignals(caseFixture.transcript);
      assert.equal(signals.userTurns, 4);
      assert.equal(signals.agentTurns, 4);
      assert.equal(signals.business, true);
      assert.equal(signals.productCount, 120);
      assert.equal(signals.budget, 50000);
      assert.equal(signals.timeline, true);
      assert.equal(signals.features, true);
      assert.equal(signals.hotIntent, true);
      assert.deepEqual(signals.scripts, ["latin"]);
    });
  });

  describe("offline transcript pipeline", () => {
    it("eval: each en/hi/te/code-switch transcript passes end-to-end checks", async () => {
      const report = await runOfflineTranscriptGate();
      assert.equal(report.transcriptResults.length, 4);
      assert.equal(
        report.transcriptResults.every((item) => item.status === "PASS"),
        true,
        JSON.stringify(report.transcriptResults.map((item) => item.reasons)),
      );
      assert.equal(report.extractionMatches, true);
      assert.equal(report.result.status, "PASS", JSON.stringify(report.result.reasons));
      assert.equal(report.result.liveChecksRequired.length, 3);
    });

    it("eval: webhook normalization projects expected facts for every transcript", () => {
      for (const testCase of buildStaticTranscriptCases()) {
        const normalized = parseBolnaWebhookPayload(buildTranscriptWebhookPayload(testCase));
        assert.equal(normalized.status, "completed");
        assert.equal(normalized.transcript, testCase.transcript.raw);
        assert.deepEqual(extractLeadFacts(normalized), testCase.expectedFacts);
        assert.equal(
          evaluateStaticTranscript({
            transcript: testCase.transcript,
            facts: extractLeadFacts(normalized),
            summary: normalized.summary,
            status: normalized.status,
          }).status,
          "PASS",
        );
      }
    });

    it("eval: no-user-turn summary is removed but real summaries survive", () => {
      assert.equal(sanitizeCallSummary(NO_USER_TURN_SUMMARY), null);
      assert.equal(sanitizeCallSummary("Customer is interested in a store."), "Customer is interested in a store.");
      assert.equal(sanitizeCallSummary("  "), null);
    });

    it("eval: transcript tool calls execute once and replay is flagged duplicate", async () => {
      const report = await runOfflineTranscriptGate();
      assert.equal(report.toolDedupePassed, true);
      const dedupeCheck = report.result.checks.find((item) => item.name === "tool_dedupe");
      assert.equal(dedupeCheck?.status, "PASS");
    });

    it("eval: callback signatures verify the exact body and reject tampering", async () => {
      const report = await runOfflineTranscriptGate();
      assert.equal(report.callbackSignatureSafe, true);
    });

    it("eval: WhatsApp alert is built offline from transcript context", async () => {
      const report = await runOfflineTranscriptGate();
      assert.equal(report.whatsappOffline, true);
    });

    it("eval: gate runs with no network access", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() => {
        throw new Error("Step 7 gate must not use the network");
      }) as typeof fetch;
      try {
        const report = await runOfflineTranscriptGate();
        assert.equal(report.result.status, "PASS");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("pre-call gate aggregation", () => {
    const goodInput = () => ({
      transcriptResults: [
        passingTranscriptResult("en-qualification"),
        passingTranscriptResult("hi-qualification"),
        passingTranscriptResult("te-qualification"),
        passingTranscriptResult("hi-en-code-switch"),
      ],
      extractionFactsMatch: true,
      summarySafe: true,
      toolDedupePassed: true,
      callbackSignatureSafe: true,
      whatsappOffline: true,
    });

    it("eval: pre-call gate passes only when every offline check passes", () => {
      assert.equal(evaluatePreCallGate(goodInput()).status, "PASS");
      assert.equal(
        evaluatePreCallGate({ ...goodInput(), transcriptResults: [] }).status,
        "FAIL",
      );
      assert.equal(
        evaluatePreCallGate({
          ...goodInput(),
          transcriptResults: [
            ...goodInput().transcriptResults.slice(0, 3),
            { ...passingTranscriptResult("hi-en-code-switch"), status: "FAIL" },
          ],
        }).status,
        "FAIL",
      );
      for (const key of [
        "extractionFactsMatch",
        "summarySafe",
        "toolDedupePassed",
        "callbackSignatureSafe",
        "whatsappOffline",
      ] as const) {
        assert.equal(evaluatePreCallGate({ ...goodInput(), [key]: false }).status, "FAIL");
      }
    });

    it("eval: pre-call gate digest is deterministic and reflects transcript changes", () => {
      const first = evaluatePreCallGate(goodInput());
      const repeated = evaluatePreCallGate(goodInput());
      const changed = evaluatePreCallGate({
        ...goodInput(),
        transcriptResults: [
          ...goodInput().transcriptResults.slice(0, 3),
          { ...passingTranscriptResult("hi-en-code-switch"), digest: "b".repeat(64) },
        ],
      });
      assert.equal(first.digest, repeated.digest);
      assert.notEqual(first.digest, changed.digest);
      assert.equal(first.status, "PASS");
    });
  });
});
