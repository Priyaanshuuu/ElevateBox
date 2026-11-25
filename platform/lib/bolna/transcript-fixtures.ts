import { createHash } from "node:crypto";
import type { JsonValue } from "./webhook.ts";
import type { LeadFacts } from "./webhook.ts";
import {
  CODE_SWITCH_TRANSCRIPT,
  EXPECTED_LEAD_FACTS,
  QUALIFICATION_EXTRACTED_DATA,
  QUALIFICATION_TRANSCRIPT,
} from "./qualification-fixtures.ts";
import { parseStaticTranscript, type StaticTranscript } from "./transcript-eval.ts";

export const HINDI_TRANSCRIPT = [
  "Agent: नमस्ते, ElevateBox से बात कर रहे हैं। क्या ऑनलाइन स्टोर के बारे में बात कर सकते हैं?",
  "User: हाँ, मैं Acme Store से हूँ। मेरे पास 120 उत्पाद हैं।",
  "Agent: आपको कौन-कौन सी विशेषताएँ चाहिए?",
  "User: कैटलॉग, चेकआउट और WhatsApp सूचनाएँ चाहिए।",
  "Agent: बजट और समयसीमा क्या है?",
  "User: बजट 50000 रुपये है और समयसीमा 4 सप्ताह है।",
  "Agent: क्या आप अंतिम निर्णय ले सकते हैं?",
  "User: हाँ, मैं जल्दी शुरू करने के लिए इच्छुक हूँ।",
].join("\n");

export const TELUGU_TRANSCRIPT = [
  "Agent: నమస్తే, ElevateBox నుండి మాట్లాడుతున్నాను. మీ ఆన్ లైన్ స్టోర్ గురించి మాట్లాడగలరా?",
  "User: అవును, నేను Acme Store నుండి వచ్చాను. నా దగ్గర 120 ప్రొడక్టులు ఉన్నాయి.",
  "Agent: మీకు ఏయే ఫీచర్లు కావాలి?",
  "User: కేటలాగ్, చెకౌట్ మరియు WhatsApp సూచనలు కావాలి.",
  "Agent: బడ్జెట్ మరియు సమయం ఎంత?",
  "User: బడ్జెట్ 50000 రూపాయలు మరియు సమయం 4 వారాలు.",
  "Agent: మీరు తుది నిర్ణయం తీసుకోగలరా?",
  "User: అవును, నేను త్వరగా మొదలుపెట్టడానికి ఆసక్తి కలిగి ఉన్నాను.",
].join("\n");

export interface StaticTranscriptCase {
  id: string;
  transcript: StaticTranscript;
  extractedData: JsonValue;
  expectedFacts: LeadFacts;
  summary: string;
}

export function buildStaticTranscriptCases(): StaticTranscriptCase[] {
  return [
    {
      id: "en-qualification",
      transcript: parseStaticTranscript(QUALIFICATION_TRANSCRIPT, {
        id: "en-qualification",
        expectedLanguage: "en",
      }),
      extractedData: QUALIFICATION_EXTRACTED_DATA,
      expectedFacts: EXPECTED_LEAD_FACTS,
      summary: "Customer runs Acme Store with 120 products, a 50000 rupee budget, and a 4 week timeline. Hot intent.",
    },
    {
      id: "hi-qualification",
      transcript: parseStaticTranscript(HINDI_TRANSCRIPT, {
        id: "hi-qualification",
        expectedLanguage: "hi",
      }),
      extractedData: QUALIFICATION_EXTRACTED_DATA,
      expectedFacts: EXPECTED_LEAD_FACTS,
      summary: "ग्राहक Acme Store चलाते हैं, 120 उत्पाद हैं, बजट 50000 रुपये और समयसीमा 4 सप्ताह है।",
    },
    {
      id: "te-qualification",
      transcript: parseStaticTranscript(TELUGU_TRANSCRIPT, {
        id: "te-qualification",
        expectedLanguage: "te",
      }),
      extractedData: QUALIFICATION_EXTRACTED_DATA,
      expectedFacts: EXPECTED_LEAD_FACTS,
      summary: "కస్టమర్ Acme Store నిర్వహిస్తున్నారు, 120 ప్రొడక్టులు, 50000 రూపాయల బడ్జెట్, 4 వారాల సమయం.",
    },
    {
      id: "hi-en-code-switch",
      transcript: parseStaticTranscript(CODE_SWITCH_TRANSCRIPT, {
        id: "hi-en-code-switch",
        expectedLanguage: "hi",
        codeSwitch: true,
      }),
      extractedData: QUALIFICATION_EXTRACTED_DATA,
      expectedFacts: EXPECTED_LEAD_FACTS,
      summary: "Customer is interested in an ecommerce store with catalog, checkout, and WhatsApp notifications.",
    },
  ];
}

const EXECUTION_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_PHONE = "+919876543210";
const AGENT_PHONE = "+918035739222";

export function buildTranscriptWebhookPayload(
  testCase: StaticTranscriptCase,
  executionId: string = EXECUTION_ID,
): Record<string, unknown> {
  return {
    id: executionId,
    agent_id: "22222222-2222-4222-8222-222222222222",
    agent_version_id: "33333333-3333-4333-8333-333333333333",
    status: "completed",
    termination_reason: "user_hung_up",
    conversation_duration: 180,
    total_cost: 0.5,
    transcript: testCase.transcript.raw,
    summary: testCase.summary,
    user_number: CALLER_PHONE,
    agent_number: AGENT_PHONE,
    telephony_data: {
      duration: 180,
      to_number: CALLER_PHONE,
      from_number: AGENT_PHONE,
      recording_url: `https://api.bolna.ai/recordings/call/${executionId}`,
      call_type: "outbound",
      provider: "trunk",
      provider_call_id: `call-${executionId}`,
    },
    cost_breakdown: { voice_ai: 0.3, platform: 0.05, telephony: 0.15 },
    extracted_data: testCase.extractedData,
    created_at: "2026-11-26T10:00:00Z",
    updated_at: "2026-11-26T10:03:00Z",
  };
}

export interface TranscriptToolCallFixture {
  toolName: "schedule_callback" | "trigger_hot_lead_whatsapp";
  rawBody: string;
}

export const TRANSCRIPT_TOOL_CALLS: TranscriptToolCallFixture[] = [
  {
    toolName: "schedule_callback",
    rawBody: JSON.stringify({
      execution_id: EXECUTION_ID,
      lead_id: "lead-1",
      call_id: "call-1",
      timezone: "Asia/Kolkata",
      request_text: "call me tomorrow at 4 pm",
      notes: "Warm follow-up requested during the call",
    }),
  },
  {
    toolName: "trigger_hot_lead_whatsapp",
    rawBody: JSON.stringify({
      execution_id: EXECUTION_ID,
      lead_id: "lead-1",
      call_id: "call-1",
      to_phone_number: CALLER_PHONE,
      context_text: "Interested in a custom store with catalog, checkout, and WhatsApp notifications.",
      resume_text_or_url: "ElevateBox discovery call - Acme Store",
      my_phone_number: AGENT_PHONE,
    }),
  },
];

export function transcriptFixtureDigest(): string {
  return createHash("sha256")
    .update(JSON.stringify(buildStaticTranscriptCases().map((item) => item.transcript.raw)))
    .update(JSON.stringify(TRANSCRIPT_TOOL_CALLS))
    .digest("hex");
}
