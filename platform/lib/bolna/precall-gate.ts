import { createHash } from "node:crypto";
import type { StaticTranscriptEvalResult } from "./transcript-eval.ts";

export interface PreCallGateCheck {
  name: string;
  status: "PASS" | "FAIL";
  detail?: string;
}

export interface PreCallGateInput {
  transcriptResults: readonly StaticTranscriptEvalResult[];
  extractionFactsMatch: boolean;
  summarySafe: boolean;
  toolDedupePassed: boolean;
  callbackSignatureSafe: boolean;
  whatsappOffline: boolean;
}

export interface PreCallGateResult {
  status: "PASS" | "FAIL";
  checks: PreCallGateCheck[];
  reasons: string[];
  digest: string;
  liveChecksRequired: string[];
}

function check(name: string, ok: boolean, detail?: string): PreCallGateCheck {
  return { name, status: ok ? "PASS" : "FAIL", ...(detail ? { detail } : {}) };
}

export function evaluatePreCallGate(input: PreCallGateInput): PreCallGateResult {
  const checks: PreCallGateCheck[] = [
    check(
      "transcript_count",
      input.transcriptResults.length === 4,
      `${input.transcriptResults.length} static transcripts`,
    ),
    check(
      "transcripts_pass",
      input.transcriptResults.length > 0 &&
        input.transcriptResults.every((result) => result.status === "PASS"),
      input.transcriptResults
        .filter((result) => result.status === "FAIL")
        .map((result) => result.id)
        .join(",") || "all pass",
    ),
    check("extraction_facts_match", input.extractionFactsMatch),
    check("summary_safety", input.summarySafe),
    check("tool_dedupe", input.toolDedupePassed),
    check("callback_signature", input.callbackSignatureSafe),
    check("whatsapp_offline", input.whatsappOffline),
  ];

  const reasons = checks
    .filter((item) => item.status === "FAIL")
    .map((item) => `${item.name}: ${item.detail ?? "failed"}`);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        checks: checks.map((item) => [item.name, item.status]),
        transcripts: input.transcriptResults.map((item) => [item.id, item.digest]),
      }),
    )
    .digest("hex");

  return {
    status: reasons.length > 0 ? "FAIL" : "PASS",
    checks,
    reasons,
    digest,
    liveChecksRequired: [
      "Step 6 canary readiness against the real carrier trunk",
      "Step 6 cost gate with real Bolna and carrier rates",
      "explicit live canary authorization with a reviewed plan digest",
    ],
  };
}
