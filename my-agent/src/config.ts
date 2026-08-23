import "dotenv/config";

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const config = {
  livekitUrl: getRequiredEnv("LIVEKIT_URL"),
  livekitApiKey: getRequiredEnv("LIVEKIT_API_KEY"),
  livekitApiSecret: getRequiredEnv("LIVEKIT_API_SECRET"),
};