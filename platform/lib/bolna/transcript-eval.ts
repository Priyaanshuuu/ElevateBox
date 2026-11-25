import { createHash } from "node:crypto";
import { BolnaConfigError } from "./errors.ts";
import type { BolnaLanguageCode } from "./agent-types.ts";
import type { LeadFacts } from "./webhook.ts";

export type TranscriptSpeaker = "agent" | "user";
export type TranscriptScript = "latin" | "devanagari" | "telugu";

export interface TranscriptTurn {
  index: number;
  speaker: TranscriptSpeaker;
  text: string;
  script: TranscriptScript;
  nonLatinScript: boolean;
}

export interface StaticTranscript {
  id: string;
  expectedLanguage: BolnaLanguageCode;
  codeSwitch: boolean;
  turns: TranscriptTurn[];
  raw: string;
}

export interface TranscriptSignals {
  userTurns: number;
  agentTurns: number;
  business: boolean;
  productCount: number | null;
  budget: number | null;
  timeline: boolean;
  features: boolean;
  callbackRequested: boolean;
  hotIntent: boolean;
  scripts: TranscriptScript[];
}

export interface TranscriptEvalCheck {
  name: string;
  status: "PASS" | "FAIL";
  detail?: string;
}

export interface StaticTranscriptEvalResult {
  id: string;
  status: "PASS" | "FAIL";
  digest: string;
  checks: TranscriptEvalCheck[];
  reasons: string[];
  signals: TranscriptSignals;
}

const DEVANAGARI = /[\u0900-\u097F]/;
const TELUGU = /[\u0C00-\u0C7F]/;
const LANGUAGES: readonly BolnaLanguageCode[] = ["en", "hi", "te"];

function check(name: string, ok: boolean, detail?: string): TranscriptEvalCheck {
  return { name, status: ok ? "PASS" : "FAIL", ...(detail ? { detail } : {}) };
}

export function detectTranscriptScript(text: string): TranscriptScript {
  if (DEVANAGARI.test(text)) return "devanagari";
  if (TELUGU.test(text)) return "telugu";
  return "latin";
}

export function parseStaticTranscript(
  raw: string,
  options: { id: string; expectedLanguage: BolnaLanguageCode; codeSwitch?: boolean },
): StaticTranscript {
  if (!options.id.trim()) throw new BolnaConfigError("Static transcript id is required.");
  if (!LANGUAGES.includes(options.expectedLanguage)) {
    throw new BolnaConfigError("Static transcript language must be en, hi, or te.");
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new BolnaConfigError("Static transcript is empty.");

  const turns: TranscriptTurn[] = lines.map((line, index) => {
    const separator = line.indexOf(":");
    if (separator < 0) {
      throw new BolnaConfigError(`Transcript line ${index + 1} has no speaker separator.`);
    }
    const speakerRaw = line.slice(0, separator).trim().toLowerCase();
    const text = line.slice(separator + 1).trim();
    if (speakerRaw !== "agent" && speakerRaw !== "user") {
      throw new BolnaConfigError(`Transcript line ${index + 1} has an unknown speaker.`);
    }
    if (!text) throw new BolnaConfigError(`Transcript line ${index + 1} has no text.`);
    const script = detectTranscriptScript(text);
    return {
      index,
      speaker: speakerRaw as TranscriptSpeaker,
      text,
      script,
      nonLatinScript: script !== "latin",
    };
  });

  return {
    id: options.id,
    expectedLanguage: options.expectedLanguage,
    codeSwitch: options.codeSwitch ?? false,
    turns,
    raw,
  };
}

export function staticTranscriptDigest(transcript: StaticTranscript): string {
  const canonical = {
    id: transcript.id,
    expectedLanguage: transcript.expectedLanguage,
    codeSwitch: transcript.codeSwitch,
    turns: transcript.turns.map((turn) => [turn.speaker, turn.script, turn.text]),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function userText(transcript: StaticTranscript): string {
  return transcript.turns
    .filter((turn) => turn.speaker === "user")
    .map((turn) => turn.text)
    .join("\n");
}

function firstNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function extractTranscriptSignals(transcript: StaticTranscript): TranscriptSignals {
  const text = userText(transcript);
  const scripts = [...new Set(transcript.turns.map((turn) => turn.script))].sort();
  return {
    userTurns: transcript.turns.filter((turn) => turn.speaker === "user").length,
    agentTurns: transcript.turns.filter((turn) => turn.speaker === "agent").length,
    business: /(store|shop|दुकान|स्टोर|స్టోర్)/i.test(text),
    productCount: firstNumber(text, /(\d+)\s*(products?|items?|उत्पाद|ప్రొడక్టులు)/i),
    budget: firstNumber(text, /(\d+)\s*(rupees?|rs\.?|रुपये|रू|రూపాయలు)/i),
    timeline: /(\d+)\s*(weeks?|days?|months?|सप्ताह|हफ्ते|వారాలు)/i.test(text),
    features: /(catalog|checkout|whatsapp|कैटलॉग|చెకౌట్|కేటలాగ్)/i.test(text),
    callbackRequested: /(call me|callback|कॉल करें|కాల్ చేయండి|tomorrow|कल|రేపు)/i.test(text),
    hotIntent: /(interested|decision maker|start soon|इच्छुक|ఆసక్తి)/i.test(text),
    scripts,
  };
}

function scriptMatchesLanguage(script: TranscriptScript, language: BolnaLanguageCode): boolean {
  if (language === "hi") return script === "devanagari" || script === "latin";
  if (language === "te") return script === "telugu" || script === "latin";
  return script === "latin";
}

export function evaluateStaticTranscript(input: {
  transcript: StaticTranscript;
  facts: LeadFacts;
  summary: string | null;
  status: string;
}): StaticTranscriptEvalResult {
  const { transcript, facts, summary, status } = input;
  const signals = extractTranscriptSignals(transcript);
  const checks: TranscriptEvalCheck[] = [];

  checks.push(check("agent_turns_present", signals.agentTurns > 0, `${signals.agentTurns} turns`));
  checks.push(check("user_turns_present", signals.userTurns > 0, `${signals.userTurns} turns`));
  checks.push(
    check(
      "terminal_status",
      status === "completed",
      status,
    ),
  );
  checks.push(
    check(
      "summary_safe",
      Boolean(summary) && !/^Summary not generated as there was no user turn$/.test(summary ?? ""),
      summary ?? "null",
    ),
  );
  checks.push(
    check(
      "language_covered",
      transcript.turns.every((turn) =>
        scriptMatchesLanguage(turn.script, transcript.expectedLanguage),
      ),
      `${transcript.expectedLanguage}: ${signals.scripts.join(",")}`,
    ),
  );
  checks.push(
    check(
      "code_switch_visible",
      transcript.codeSwitch
        ? signals.userTurns > 0 && signals.scripts.includes("latin")
        : !transcript.turns.some((turn) => turn.nonLatinScript) ||
          transcript.expectedLanguage !== "en",
      transcript.codeSwitch ? "romanized mixed-language turns" : "single-language fixture",
    ),
  );
  checks.push(
    check(
      "business_matches_signal",
      signals.business && Boolean(facts.business),
      facts.business ?? "null",
    ),
  );
  checks.push(
    check(
      "product_count_matches_signal",
      signals.productCount !== null && facts.productCount === signals.productCount,
      `${facts.productCount ?? "null"} vs ${signals.productCount ?? "null"}`,
    ),
  );
  checks.push(
    check(
      "budget_matches_signal",
      signals.budget !== null && facts.budget === signals.budget,
      `${facts.budget ?? "null"} vs ${signals.budget ?? "null"}`,
    ),
  );
  checks.push(
    check(
      "timeline_matches_signal",
      signals.timeline && Boolean(facts.timeline),
      facts.timeline ?? "null",
    ),
  );
  checks.push(
    check(
      "features_match_signal",
      signals.features && facts.features.length > 0,
      `${facts.features.length} features`,
    ),
  );
  checks.push(
    check(
      "intent_matches_signal",
      signals.hotIntent && facts.intent === "HOT",
      facts.intent ?? "null",
    ),
  );

  const reasons = checks
    .filter((item) => item.status === "FAIL")
    .map((item) => `${item.name}: ${item.detail ?? "failed"}`);
  return {
    id: transcript.id,
    status: reasons.length > 0 ? "FAIL" : "PASS",
    digest: staticTranscriptDigest(transcript),
    checks,
    reasons,
    signals,
  };
}
