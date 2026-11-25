import { createHash } from "node:crypto";
import { BolnaConfigError } from "./errors.ts";
import type {
  BolnaAgentRequestV2,
  BolnaAgentVersionRequestV2,
  BolnaLanguageCode,
  BolnaLlmAgentConfig,
  BolnaLlmConfig,
  BolnaMultilingualLanguageEntry,
  BolnaSynthesizerConfig,
  BolnaTranscriberConfig,
} from "./agent-types.ts";
import { validateBolnaToolConfig, type BolnaApiToolsConfig } from "./tool-config.ts";

export interface ElevateBoxVoiceConfig {
  provider: string;
  model: string;
  voice: string;
  voiceId: string;
  language: string;
}

export interface ElevateBoxLanguageConfig {
  systemPrompt: string;
  welcomeMessage: string;
  handoffMessage: string;
  agentName: string;
  voice: ElevateBoxVoiceConfig;
}

export interface ElevateBoxAgentSpec {
  agentName: string;
  webhookUrl: string;
  versionName: string;
  tags: string[];
  activeLanguage: BolnaLanguageCode;
  llm: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
    verbosity: "low" | "medium" | "high";
    compactThreshold: number | null;
  };
  transcriber: {
    provider: string;
    model: string;
    endpointingMs: number;
    vadThreshold: number;
    vadPrefixPaddingMs: number;
    keywords: string | null;
    context: string | null;
  };
  turnTaking: {
    incrementalDelayMs: number;
    interruptionWords: number;
    backchanneling: boolean;
    noiseCancellationLevel: number | null;
    checkIfUserOnline: boolean;
    userOnlineAfterSeconds: number;
  };
  callPolicy: {
    callTerminateSeconds: number;
    hangupAfterSilenceSeconds: number;
    welcomeMessageDelayMs: number;
    voicemail: boolean;
  };
  knowledgeBaseIds: string[];
  apiTools: BolnaApiToolsConfig | null;
  languages: Record<BolnaLanguageCode, ElevateBoxLanguageConfig>;
}

export interface AgentVersionPlan {
  versionName: string;
  tags: string[];
  digest: string;
  createRequest: BolnaAgentRequestV2;
  versionRequest: BolnaAgentVersionRequestV2;
}

const LANGUAGE_CODES: readonly BolnaLanguageCode[] = ["en", "hi", "te"];
const FORBIDDEN_PROMPT_PATTERNS = [
  /switch\s+(the\s+)?language/i,
  /language\s+switch/i,
  /if\s+(the\s+)?caller\s+(switches|changes)\s+language/i,
  /detect\s+(the\s+)?language/i,
  /change\s+language/i,
  /same\s+language\s+(as|the)\s+caller/i,
];
const LANGUAGE_REQUIRED_TTS_PROVIDERS = new Set([
  "cartesia",
  "sarvam",
  "smallest",
  "rime",
  "azuretts",
  "gemini",
  "soniox",
  "navana",
  "polly",
]);

type JsonPrimitive = string | number | boolean | null;
type JsonCanonical = JsonPrimitive | JsonCanonical[] | { [key: string]: JsonCanonical };

function canonicalize(value: unknown): JsonCanonical {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    const sorted: Record<string, JsonCanonical> = {};
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [key, entryValue] of entries) {
      sorted[key] = canonicalize(entryValue);
    }
    return sorted;
  }
  return String(value);
}

function isLocalUrl(url: URL): boolean {
  return new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname);
}

function validateWebhookUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BolnaConfigError("Agent webhook URL must be a valid absolute URL.");
  }

  if (parsed.username || parsed.password) {
    throw new BolnaConfigError("Agent webhook URL must not contain credentials.");
  }
  if (parsed.protocol !== "https:" && !isLocalUrl(parsed)) {
    throw new BolnaConfigError("Agent webhook URL must use HTTPS outside local development.");
  }
}

function voiceProviderConfig(voice: ElevateBoxVoiceConfig): Record<string, unknown> {
  const config: Record<string, unknown> = {
    voice: voice.voice,
    voice_id: voice.voiceId,
    model: voice.model,
  };
  if (LANGUAGE_REQUIRED_TTS_PROVIDERS.has(voice.provider)) {
    config.language = voice.language;
  }
  return config;
}

function synthesizerFor(voice: ElevateBoxVoiceConfig): BolnaSynthesizerConfig {
  return {
    provider: voice.provider,
    provider_config: voiceProviderConfig(voice),
    stream: true,
    caching: true,
    buffer_size: 250,
    audio_format: "wav",
  };
}

export function createElevateBoxAgentSpec(options: {
  webhookUrl: string;
  voices: Record<BolnaLanguageCode, ElevateBoxVoiceConfig>;
  versionName?: string;
  tags?: string[];
  agentName?: string;
  knowledgeBaseIds?: string[];
  apiTools?: BolnaApiToolsConfig | null;
}): ElevateBoxAgentSpec {
  return {
    agentName: options.agentName ?? "ElevateBox Ecommerce Sales Agent",
    webhookUrl: options.webhookUrl,
    versionName: options.versionName ?? "elevatebox-sales-agent",
    tags: options.tags ?? ["elevatebox", "sales", "multilingual"],
    activeLanguage: "en",
    llm: {
      provider: "openai",
      model: "gpt-5.4-mini",
      temperature: 1,
      maxTokens: 180,
      verbosity: "low",
      compactThreshold: 8_000,
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      endpointingMs: 250,
      vadThreshold: 0.5,
      vadPrefixPaddingMs: 300,
      keywords: "ElevateBox,Razorpay,Stripe,WhatsApp",
      context:
        "Outbound sales call about custom e-commerce website development, catalogs, checkout, payments, and admin panels.",
    },
    turnTaking: {
      incrementalDelayMs: 450,
      interruptionWords: 2,
      backchanneling: true,
      noiseCancellationLevel: 80,
      checkIfUserOnline: true,
      userOnlineAfterSeconds: 12,
    },
    callPolicy: {
      callTerminateSeconds: 600,
      hangupAfterSilenceSeconds: 15,
      welcomeMessageDelayMs: 250,
      voicemail: true,
    },
    knowledgeBaseIds: [...(options.knowledgeBaseIds ?? [])],
    apiTools: options.apiTools ?? null,
    languages: {
      en: {
        systemPrompt: [
          "You are a concise, friendly sales voice agent for ElevateBox e-commerce website development.",
          "Goal: understand the customer's needs and move naturally to a discovery call or next step.",
          "Ask only one short question at a time and keep each reply to one to three spoken sentences.",
          "Collect or confirm: business, products, product count, existing website, required features,",
          "budget, timeline, decision maker, and interest level.",
          "Acknowledge answers briefly. Never repeat information the caller already gave.",
          "Treat quiet moments as normal. Wait instead of interpreting silence.",
          "Do not invent pricing, timelines, or capabilities. A discovery call is required before a quote.",
          "When the caller is interested, offer a convenient discovery call and confirm the next step.",
        ].join(" "),
        welcomeMessage:
          "Hi {{customer_name}}, this is ElevateBox. Do you have a few minutes to talk about your online store?",
        handoffMessage: "Sure, I can help with that.",
        agentName: "ElevateBox",
        voice: options.voices.en,
      },
      hi: {
        systemPrompt: [
          "आप ElevateBox के ई-कॉमर्स वेबसाइट डेवलपमेंट के लिए संक्षेप और मित्रवत बिक्री सहायक हैं।",
          "लक्ष्य: ग्राहक की आवश्यकताएँ समझना और स्वाभाविक रूप से अगले चरण या डिस्कवरी कॉल की ओर बढ़ना।",
          "एक बार में केवल एक छोटा प्रश्न पूछें और प्रत्येक उत्तर एक से तीन बोले गए वाक्यों में रखें।",
          "व्यवसाय, उत्पाद, उत्पादों की संख्या, मौजूदा वेबसाइट, आवश्यक सुविधाएँ, बजट, समयसीमा,",
          "निर्णय लेने वाला व्यक्ति और रुचि के स्तर को समझें या पुष्टि करें।",
          "उत्तरों को संक्षेप में स्वीकार करें। ग्राहक द्वारा पहले दी गई जानकारी दोबारा न पूछें।",
          "शांत क्षणों को सामान्य मानें। मौन की व्याख्या किए बिना प्रतीक्षा करें।",
          "मूल्य, समयसीमा या क्षमताएँ न बनाएँ। उद्धरण से पहले डिस्कवरी कॉल आवश्यक है।",
        ].join(" "),
        welcomeMessage:
          "नमस्ते {{customer_name}}, मैं ElevateBox से बोल रहा हूँ। क्या आप अपने ऑनलाइन स्टोर के बारे में कुछ मिनट बात कर सकते हैं?",
        handoffMessage: "ठीक है, मैं हिंदी में बात करता हूँ।",
        agentName: "ElevateBox",
        voice: options.voices.hi,
      },
      te: {
        systemPrompt: [
          "మీరు ElevateBox ఈ-కామర్స్ వెబ్ సైట్ డెవలప్ మెంట్ కోసం సంక్షిప్తంగా, స్నేహితులైన అమ్మకాల సహాయకులు.",
          "లక్ష్యం: కస్టమర్ అవసరాలను అర్థం చేసుకుని సహజంగా తదుపరి దశ లేదా డిస్కవరీ కాల్ వైపు వెళ్లడం.",
          "ఒక్కసారిగా ఒకే చిన్న ప్రశ్న అడగండి. ప్రతి సమాధానం ఒకటి నుంచి మూడు వాక్యాలుగా ఉంచండి.",
          "వ్యాపారం, ఉత్పత్తులు, ఉత్పత్తుల సంఖ్య, ప్రస్తుత వెబ్ సైట్, కావాల్సిన ఫీచర్లు,",
          "బడ్జెట్, సమయం, నిర్ణయం తీసుకునే వ్యక్తి, ఆసక్తి స్థాయి వీటిని అర్థం చేసుకోండి.",
          "సమాధానాలను క్లుప్తంగా అంగీకరించండి. కస్టమర్ ఇప్పటికే చెప్పిన విషయాలను మళ్లీ అడగకండి.",
          "నిశ్శబ్దాన్ని సాధారణంగా తీసుకోండి. దానికి అర్థం ఊహించకుండా వేచి ఉండండి.",
          "ధర, సమయం లేదా సామర్థ్యాలను ఊహించకండి. కోట్ కు ముందు డిస్కవరీ కాల్ అవసరం.",
        ].join(" "),
        welcomeMessage:
          "నమస్తే {{customer_name}}, నేను ElevateBox నుండి మాట్లాడుతున్నాను. మీ ఆన్ లైన్ స్టోర్ గురించి కొన్ని నిమిషాలు మాట్లాడగలరా?",
        handoffMessage: "సరే, నేను తెలుగులో మాట్లాడుతాను.",
        agentName: "ElevateBox",
        voice: options.voices.te,
      },
    },
  };
}

export function validateElevateBoxAgentSpec(spec: ElevateBoxAgentSpec): void {
  validateWebhookUrl(spec.webhookUrl);

  if (!Array.isArray(spec.knowledgeBaseIds) || spec.knowledgeBaseIds.length > 10) {
    throw new BolnaConfigError("Attach at most 10 knowledge bases to the agent.");
  }
  const seenKnowledgeIds = new Set<string>();
  for (const id of spec.knowledgeBaseIds) {
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
      throw new BolnaConfigError("Knowledge base vector ids must be UUIDs.");
    }
    if (seenKnowledgeIds.has(id)) {
      throw new BolnaConfigError("Knowledge base vector ids must be unique.");
    }
    seenKnowledgeIds.add(id);
  }
  if (spec.apiTools) validateBolnaToolConfig(spec.apiTools);

  if (!spec.versionName.trim()) {
    throw new BolnaConfigError("Agent version name is required.");
  }
  if (!LANGUAGE_CODES.includes(spec.activeLanguage)) {
    throw new BolnaConfigError("Agent active language must be en, hi, or te.");
  }
  if (!spec.llm.model.startsWith("gpt-5") && spec.llm.temperature !== 1) {
    throw new BolnaConfigError("GPT-5 models require temperature 1.");
  }
  if (spec.llm.maxTokens > 256) {
    throw new BolnaConfigError("Voice responses are capped at 256 tokens to control cost.");
  }
  if (spec.transcriber.endpointingMs < 200 || spec.transcriber.endpointingMs > 300) {
    throw new BolnaConfigError("Endpointing must be between 200ms and 300ms for telephone turns.");
  }
  if (
    spec.turnTaking.incrementalDelayMs < 400 ||
    spec.turnTaking.incrementalDelayMs > 500
  ) {
    throw new BolnaConfigError("Linear delay must be between 400ms and 500ms.");
  }
  if (
    spec.turnTaking.userOnlineAfterSeconds < 8 ||
    spec.turnTaking.userOnlineAfterSeconds > 15
  ) {
    throw new BolnaConfigError("User-online detection must trigger after 8 to 15 seconds.");
  }

  for (const language of LANGUAGE_CODES) {
    const config = spec.languages[language];
    if (!config) {
      throw new BolnaConfigError(`Missing ${language} agent configuration.`);
    }
    if (!config.systemPrompt.trim() || !config.welcomeMessage.trim()) {
      throw new BolnaConfigError(`Missing ${language} prompt or welcome message.`);
    }
    if (FORBIDDEN_PROMPT_PATTERNS.some((pattern) => pattern.test(config.systemPrompt))) {
      throw new BolnaConfigError(
        `${language} prompt must not contain language-switching instructions.`,
      );
    }
    if (/thinking|\buser is (still )?there\b/i.test(config.systemPrompt)) {
      throw new BolnaConfigError(
        `${language} prompt must not infer user state from silence.`,
      );
    }
    if (!config.voice.voiceId.trim() || /REPLACE|PLACEHOLDER/i.test(config.voice.voiceId)) {
      throw new BolnaConfigError(`A real ${language} voice id is required before deploy.`);
    }
  }
}

export function buildElevateBoxAgentRequest(
  spec: ElevateBoxAgentSpec,
): BolnaAgentRequestV2 {
  validateElevateBoxAgentSpec(spec);

  const active = spec.languages[spec.activeLanguage];
  const baseTranscriber: BolnaTranscriberConfig = {
    provider: spec.transcriber.provider,
    model: spec.transcriber.model,
    language: spec.activeLanguage,
    stream: true,
    encoding: "linear16",
    sampling_rate: 16000,
    endpointing: spec.transcriber.endpointingMs,
    keywords: spec.transcriber.keywords,
    context: spec.transcriber.context,
    vad_threshold: spec.transcriber.vadThreshold,
    vad_prefix_padding_ms: spec.transcriber.vadPrefixPaddingMs,
    language_hints: [...LANGUAGE_CODES],
  };
  const llmConfig: BolnaLlmConfig = {
    provider: spec.llm.provider,
    model: spec.llm.model,
    temperature: spec.llm.temperature,
    max_tokens: spec.llm.maxTokens,
    verbosity: spec.llm.verbosity,
    compact_threshold: spec.llm.compactThreshold,
  };
  const knowledgeIds = [...spec.knowledgeBaseIds];
  const llmAgent: BolnaLlmAgentConfig = {
    agent_type: knowledgeIds.length > 0 ? "knowledgebase_agent" : "simple_llm_agent",
    agent_flow_type: "streaming",
    llm_config: llmConfig,
    ...(knowledgeIds.length > 0
      ? {
          vector_store: {
            provider: "lancedb",
            provider_config: { vector_ids: knowledgeIds },
          },
        }
      : {}),
  };
  const languages: Record<string, BolnaMultilingualLanguageEntry> = {};

  for (const language of LANGUAGE_CODES) {
    const config = spec.languages[language];
    languages[language] = {
      transcriber: {
        language,
        model: spec.transcriber.model,
        language_hints: [...LANGUAGE_CODES],
      },
      synthesizer: synthesizerFor(config.voice),
      system_prompt: config.systemPrompt,
      handoff_message: config.handoffMessage,
      agent_name: config.agentName,
      welcome_message: config.welcomeMessage,
    };
  }

  return {
    agent_config: {
      agent_name: spec.agentName,
      agent_welcome_message: active.welcomeMessage,
      webhook_url: spec.webhookUrl,
      call_summary_enabled: true,
      tasks: [
        {
          task_type: "conversation",
          toolchain: {
            execution: "sequential",
            pipelines: [["transcriber", "llm", "synthesizer"]],
          },
          tools_config: {
            llm_agent: llmAgent,
            transcriber: baseTranscriber,
            synthesizer: synthesizerFor(active.voice),
            input: { provider: "trunk", format: "linear16" },
            output: { provider: "trunk", format: "linear16" },
            api_tools: spec.apiTools,
            s2s: null,
            multilingual_config: {
              enabled: true,
              active_language: spec.activeLanguage,
              language_switch_trigger: "requested_or_auto_detected",
              languages,
            },
          },
          task_config: {
            hangup_after_silence: spec.callPolicy.hangupAfterSilenceSeconds,
            hangup_after_LLMCall: false,
            incremental_delay: spec.turnTaking.incrementalDelayMs,
            number_of_words_for_interruption: spec.turnTaking.interruptionWords,
            backchanneling: spec.turnTaking.backchanneling,
            backchanneling_message_gap: 5,
            backchanneling_start_delay: 5,
            call_terminate: spec.callPolicy.callTerminateSeconds,
            welcome_message_delay: spec.callPolicy.welcomeMessageDelayMs,
            noise_cancellation_level: spec.turnTaking.noiseCancellationLevel,
            check_if_user_online: spec.turnTaking.checkIfUserOnline,
            trigger_user_online_message_after: spec.turnTaking.userOnlineAfterSeconds,
            voicemail: spec.callPolicy.voicemail,
            voicemail_detection_duration: 30,
            voicemail_check_interval: 7,
            voicemail_min_transcript_length: 7,
          },
        },
      ],
    },
    agent_prompts: {
      task_1: {
        system_prompt: active.systemPrompt,
      },
    },
  };
}

export function agentRequestDigest(request: BolnaAgentRequestV2): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(request)))
    .digest("hex");
}

export function buildAgentVersionPlan(spec: ElevateBoxAgentSpec): AgentVersionPlan {
  const createRequest = buildElevateBoxAgentRequest(spec);
  const digest = agentRequestDigest(createRequest);
  const tags = [...new Set([...spec.tags, `config-sha256:${digest}`])];
  const versionRequest: BolnaAgentVersionRequestV2 = {
    ...structuredClone(createRequest),
    version_name: spec.versionName,
    tags,
  };

  return {
    versionName: spec.versionName,
    tags,
    digest,
    createRequest,
    versionRequest,
  };
}
