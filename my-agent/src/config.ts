import "dotenv/config";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("Missing required environment variable: " + name);
  return value;
}

function getEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  livekitUrl: getRequiredEnv("LIVEKIT_URL"),
  livekitApiKey: getRequiredEnv("LIVEKIT_API_KEY"),
  livekitApiSecret: getRequiredEnv("LIVEKIT_API_SECRET"),

  sttProvider: getEnv("STT_PROVIDER", "whisper"),
  sttOpenAiApiKey: getRequiredEnv("STT_OPENAI_API_KEY"),
  sttModel: getEnv("STT_MODEL", "whisper-1"),
  sttLanguage: getEnv("STT_LANGUAGE", "auto"),
};