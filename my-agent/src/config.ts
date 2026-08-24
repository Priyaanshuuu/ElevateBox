import "dotenv/config";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("Missing required environment variable: " + name);
  return value;
}

function getEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function getFirstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function getRequiredFromAny(names: string[]): string {
  const value = getFirstEnv(names);
  if (!value) {
    throw new Error("Missing required environment variable. Set one of: " + names.join(", "));
  }
  return value;
}

function getOptionalFromAny(names: string[]): string | undefined {
  return getFirstEnv(names);
}

function resolveSttEndpoint(provider: string): string {
  if (provider === "openai") {
    return "https://api.openai.com/v1/audio/transcriptions";
  }
  // Groq provides an OpenAI-compatible audio transcription endpoint.
  return "https://api.groq.com/openai/v1/audio/transcriptions";
}

function resolveSttModel(provider: string): string {
  if (provider === "openai") {
    return "whisper-1";
  }
  return "whisper-large-v3-turbo";
}

const sttProvider = getEnv("STT_PROVIDER", "groq").toLowerCase();

export const config = {
  livekitUrl: getRequiredEnv("LIVEKIT_URL"),
  livekitApiKey: getRequiredEnv("LIVEKIT_API_KEY"),
  livekitApiSecret: getRequiredEnv("LIVEKIT_API_SECRET"),

  sttProvider,
  sttApiKey: getRequiredFromAny(["STT_API_KEY", "STT_GROQ_API_KEY", "STT_OPENAI_API_KEY"]),
  sttEndpoint: getEnv("STT_ENDPOINT", resolveSttEndpoint(sttProvider)),
  sttModel: getEnv("STT_MODEL", resolveSttModel(sttProvider)),
  sttLanguage: getEnv("STT_LANGUAGE", "auto"),

  llmModel: getEnv("LLM_MODEL", "google/gemini-2.5-flash"),
  ttsModel: getEnv("TTS_MODEL", "fishaudio/s2.1-pro-free"),

  ragEnabled: getEnv("RAG_ENABLED", "true").toLowerCase() !== "false",
  ragTopK: Number.parseInt(getEnv("RAG_TOP_K", "3"), 10),
  ragKnowledgeDir: getEnv("RAG_KNOWLEDGE_DIR", "../knowledge"),

  databaseUrl: getEnv("DATABASE_URL", ""),
  embeddingApiKey: getOptionalFromAny([
    "EMBEDDING_API_KEY",
    "EMBEDDING_GROQ_API_KEY",
    "STT_API_KEY",
  ]),
  embeddingEndpoint: getEnv("EMBEDDING_ENDPOINT", "https://api.groq.com/openai/v1/embeddings"),
  embeddingModel: getEnv("EMBEDDING_MODEL", "text-embedding-3-small"),

  whatsappProvider: getEnv("WHATSAPP_PROVIDER", "disabled") as "disabled" | "meta",
  whatsappMetaPhoneNumberId: getEnv("WHATSAPP_META_PHONE_NUMBER_ID", ""),
  whatsappMetaAccessToken: getEnv("WHATSAPP_META_ACCESS_TOKEN", ""),
  myResumeTextOrUrl: getEnv("MY_RESUME_TEXT_OR_URL", ""),
  myPhoneNumber: getEnv("MY_PHONE_NUMBER", ""),
};