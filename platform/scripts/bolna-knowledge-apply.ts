import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  BolnaError,
  createBolnaClient,
  createKnowledgeBasePdf,
  loadElevateBoxKnowledgePlan,
} from "../lib/bolna/index.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true, quiet: true });

const runLive = process.env.BOLNA_RUN_KNOWLEDGE_APPLY === "1";

if (!runLive) {
  console.log(
    "SKIP: set BOLNA_RUN_KNOWLEDGE_APPLY=1 and BOLNA_EVAL_GATE=PASS to sync the knowledge base.",
  );
  process.exit(0);
}

try {
  if (process.env.BOLNA_EVAL_GATE !== "PASS") {
    throw new Error("BOLNA_EVAL_GATE must be PASS before knowledge base sync.");
  }

  const plan = await loadElevateBoxKnowledgePlan(resolve(process.cwd(), ".."));
  const pdf = createKnowledgeBasePdf(plan);
  const client = createBolnaClient();
  const { knowledgeBases } = await client.listKnowledgeBases();
  let knowledgeBase = knowledgeBases.find((item) => item.fileName === plan.fileName);

  if (knowledgeBase?.status === "error") {
    throw new Error("Existing knowledge base is in error state; create it again after fixing the source.");
  }

  if (!knowledgeBase) {
    knowledgeBase = await client.createKnowledgeBase({
      source: { kind: "pdf", fileName: plan.fileName, bytes: pdf },
      chunkSize: plan.chunkSize,
      similarityTopK: plan.similarityTopK,
      overlapping: plan.overlapping,
      languageSupport: plan.languageSupport,
    });
    console.log(`Created knowledge base: ${plan.fileName}.`);
  } else {
    console.log(`Reusing knowledge base: ${plan.fileName}.`);
  }

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        ragId: knowledgeBase.ragId,
        vectorId: knowledgeBase.vectorId,
        status: knowledgeBase.status,
        sourceDigest: plan.digest,
        note:
          knowledgeBase.status === "processed"
            ? "Add vectorId to BOLNA_KNOWLEDGE_BASE_IDS and apply the agent version."
            : "Wait for status=processed before attaching the knowledge base to the agent.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof BolnaError ? error.message : (error as Error).message;
  console.error(`FAIL: Bolna knowledge base sync — ${message}`);
  process.exit(1);
}
