import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  BolnaError,
  buildAgentVersionPlan,
  createBolnaClient,
  createElevateBoxAgentSpec,
  promoteAgentVersion,
  registerCandidateAgentVersion,
  type BolnaLanguageCode,
  type ElevateBoxVoiceConfig,
} from "../lib/bolna/index.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true, quiet: true });

const runLive = process.env.BOLNA_RUN_AGENT_APPLY === "1";

if (!runLive) {
  console.log(
    "SKIP: set BOLNA_RUN_AGENT_APPLY=1 to register a candidate agent version with Bolna.",
  );
  process.exit(0);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the live agent apply step.`);
  }
  return value;
}

function voiceFor(language: BolnaLanguageCode): ElevateBoxVoiceConfig {
  const suffix = language.toUpperCase();
  const defaults: Record<BolnaLanguageCode, Omit<ElevateBoxVoiceConfig, "voiceId">> = {
    en: {
      provider: "elevenlabs",
      model: "eleven_turbo_v2_5",
      voice: "Angelica",
      language: "en",
    },
    hi: { provider: "sarvam", model: "bulbul:v3", voice: "Priya", language: "hi" },
    te: { provider: "sarvam", model: "bulbul:v3", voice: "Anushka", language: "te" },
  };
  const fallback = defaults[language];

  return {
    provider: process.env[`BOLNA_VOICE_PROVIDER_${suffix}`]?.trim() || fallback.provider,
    model: process.env[`BOLNA_VOICE_MODEL_${suffix}`]?.trim() || fallback.model,
    voice: process.env[`BOLNA_VOICE_NAME_${suffix}`]?.trim() || fallback.voice,
    voiceId: requiredEnv(`BOLNA_VOICE_ID_${suffix}`),
    language,
  };
}

try {
  const webhookUrl = requiredEnv("BOLNA_WEBHOOK_URL");
  const webhookToken = requiredEnv("BOLNA_WEBHOOK_URL_TOKEN");
  if (!webhookUrl.endsWith(`/${webhookToken}`)) {
    throw new Error("BOLNA_WEBHOOK_URL must end with /<BOLNA_WEBHOOK_URL_TOKEN>.");
  }
  const spec = createElevateBoxAgentSpec({
    webhookUrl,
    versionName: process.env.BOLNA_AGENT_VERSION_NAME?.trim() || "elevatebox-step3",
    agentName: process.env.BOLNA_AGENT_NAME?.trim(),
    voices: {
      en: voiceFor("en"),
      hi: voiceFor("hi"),
      te: voiceFor("te"),
    },
  });
  const plan = buildAgentVersionPlan(spec);
  const client = createBolnaClient();
  const agentId = process.env.BOLNA_AGENT_ID?.trim() || undefined;

  const registered = await registerCandidateAgentVersion(client, plan, { agentId });
  const allowPromote = process.env.BOLNA_ALLOW_PROMOTE === "1";
  const evalGatePassed = process.env.BOLNA_EVAL_GATE === "PASS";
  const shouldPromote = allowPromote && evalGatePassed;

  if (allowPromote !== evalGatePassed) {
    throw new Error(
      "Promotion requires both BOLNA_ALLOW_PROMOTE=1 and BOLNA_EVAL_GATE=PASS.",
    );
  }

  const promotedVersionId = shouldPromote
    ? await promoteAgentVersion(client, registered.agentId, registered.versionId)
    : undefined;

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        registeredKind: registered.kind,
        agentId: registered.agentId,
        candidateVersionId: registered.versionId,
        configDigest: plan.digest,
        promoted: shouldPromote,
        liveVersionId: promotedVersionId ?? null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof BolnaError ? error.message : (error as Error).message;
  console.error(`FAIL: Bolna agent version apply — ${message}`);
  process.exit(1);
}
