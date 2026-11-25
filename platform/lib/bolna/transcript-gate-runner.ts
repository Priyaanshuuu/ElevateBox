import {
  buildHotLeadWhatsAppMessage,
  type HotLeadWhatsAppMessageInput,
} from "../services/whatsapp.service.ts";
import { NO_USER_TURN_SUMMARY } from "./qualification-fixtures.ts";
import {
  buildStaticTranscriptCases,
  buildTranscriptWebhookPayload,
  transcriptFixtureDigest,
  TRANSCRIPT_TOOL_CALLS,
} from "./transcript-fixtures.ts";
import { evaluateStaticTranscript, type StaticTranscriptEvalResult } from "./transcript-eval.ts";
import {
  evaluatePreCallGate,
  type PreCallGateResult,
} from "./precall-gate.ts";
import {
  createMemoryToolStore,
  handleBolnaToolRequest,
  type ToolHandlers,
} from "./tool-handler.ts";
import {
  extractLeadFacts,
  parseBolnaWebhookPayload,
  sanitizeCallSummary,
} from "./webhook.ts";
import {
  isBolnaCallbackSignatureValid,
  signBolnaCallbackBody,
  validateCallbackSigningSecret,
} from "./callback-types.ts";
import { loadBolnaToolAuthConfig } from "./tool-auth.ts";

const TOOL_TOKEN = "step7-offline-tool-token-0123456789";
const SIGNING_SECRET = "a".repeat(64);

export interface OfflineTranscriptGateReport {
  result: PreCallGateResult;
  transcriptResults: StaticTranscriptEvalResult[];
  extractionMatches: boolean;
  summarySafe: boolean;
  toolDedupePassed: boolean;
  callbackSignatureSafe: boolean;
  whatsappOffline: boolean;
  fixtureDigest: string;
}

function sameFacts(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export async function runOfflineTranscriptGate(): Promise<OfflineTranscriptGateReport> {
  const transcriptResults: StaticTranscriptEvalResult[] = [];
  let extractionMatches = true;

  for (const testCase of buildStaticTranscriptCases()) {
    const payload = buildTranscriptWebhookPayload(testCase);
    const normalized = parseBolnaWebhookPayload(payload);
    const facts = extractLeadFacts(normalized);
    if (!sameFacts(facts, testCase.expectedFacts)) extractionMatches = false;
    transcriptResults.push(
      evaluateStaticTranscript({
        transcript: testCase.transcript,
        facts,
        summary: normalized.summary,
        status: normalized.status,
      }),
    );
  }

  const summarySafe =
    sanitizeCallSummary(NO_USER_TURN_SUMMARY) === null &&
    sanitizeCallSummary("Customer is interested in an ecommerce store.") ===
      "Customer is interested in an ecommerce store.";

  const authConfig = loadBolnaToolAuthConfig({
    BOLNA_TOOL_TOKEN: TOOL_TOKEN,
    BOLNA_TOOL_IP_ALLOWLIST: "127.0.0.1",
  });
  const headers = {
    authorization: `Bearer ${TOOL_TOKEN}`,
    "x-forwarded-for": "127.0.0.1",
  };
  const invoked: string[] = [];
  const handlers: ToolHandlers = {
    async scheduleCallback(args) {
      invoked.push(`callback:${args.leadId}:${args.requestText ?? args.scheduledAt ?? ""}`);
      return { status: "scheduled", callbackId: "cb-step7", scheduledAt: "2026-11-27T10:30:00.000Z" };
    },
    async triggerHotLeadWhatsApp(args) {
      invoked.push(`whatsapp:${args.toPhoneNumber}`);
      return { status: "triggered", eventId: "event-step7" };
    },
  };

  let toolDedupePassed = true;
  for (const toolCall of TRANSCRIPT_TOOL_CALLS) {
    const store = createMemoryToolStore();
    const first = await handleBolnaToolRequest({
      toolName: toolCall.toolName,
      headers,
      rawBody: toolCall.rawBody,
      config: authConfig,
      store,
      handlers,
      now: new Date("2026-11-26T05:00:00Z"),
    });
    const replay = await handleBolnaToolRequest({
      toolName: toolCall.toolName,
      headers,
      rawBody: toolCall.rawBody,
      config: authConfig,
      store,
      handlers,
      now: new Date("2026-11-26T05:00:00Z"),
    });
    if (
      first.status !== 200 ||
      first.body.duplicate !== false ||
      replay.status !== 200 ||
      replay.body.duplicate !== true
    ) {
      toolDedupePassed = false;
    }
  }
  if (invoked.length !== TRANSCRIPT_TOOL_CALLS.length) toolDedupePassed = false;

  let callbackSignatureSafe = true;
  try {
    validateCallbackSigningSecret(SIGNING_SECRET);
    const body = JSON.stringify({ event: "lead.qualified", leadId: "lead-1", phone: "+919876543210" });
    const signature = signBolnaCallbackBody(body, SIGNING_SECRET);
    callbackSignatureSafe =
      isBolnaCallbackSignatureValid(body, signature, SIGNING_SECRET) &&
      !isBolnaCallbackSignatureValid(`${body} `, signature, SIGNING_SECRET);
  } catch {
    callbackSignatureSafe = false;
  }

  const whatsappInput: HotLeadWhatsAppMessageInput = {
    leadId: "lead-1",
    callerPhoneNumber: "+919876543210",
    contextText: "Interested in a custom store with catalog, checkout, and WhatsApp notifications.",
    resumeTextOrUrl: "ElevateBox discovery call - Acme Store",
  };
  const message = buildHotLeadWhatsAppMessage(whatsappInput);
  const whatsappOffline =
    message.includes("Hot lead alert from ElevateBox.") &&
    message.includes(whatsappInput.contextText) &&
    message.includes(whatsappInput.resumeTextOrUrl);

  const result = evaluatePreCallGate({
    transcriptResults,
    extractionFactsMatch: extractionMatches,
    summarySafe,
    toolDedupePassed,
    callbackSignatureSafe,
    whatsappOffline,
  });

  return {
    result,
    transcriptResults,
    extractionMatches,
    summarySafe,
    toolDedupePassed,
    callbackSignatureSafe,
    whatsappOffline,
    fixtureDigest: transcriptFixtureDigest(),
  };
}
