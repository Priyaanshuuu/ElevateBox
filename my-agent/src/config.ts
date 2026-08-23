import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const config = {
  livekitUrl: requireEnv("LIVEKIT_URL"),
  livekitApiKey: requireEnv("LIVEKIT_API_KEY"),
  livekitApiSecret: requireEnv("LIVEKIT_API_SECRET"),
};