import assert from "node:assert/strict";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  buildLeadQualificationDispositions,
  CODE_SWITCH_TRANSCRIPT,
  createBolnaClient,
  createLeadQualificationPlan,
  EXPECTED_LEAD_FACTS,
  extractLeadFactsFromData,
  LEAD_QUALIFICATION_CATEGORY,
  validateLeadQualificationPlan,
} from "../lib/bolna/index.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true, quiet: true });

const runLive = process.env.BOLNA_RUN_EXTRACTION_APPLY === "1";

if (!runLive) {
  console.log(
    "SKIP: set BOLNA_RUN_EXTRACTION_APPLY=1 and BOLNA_EVAL_GATE=PASS to apply extraction config.",
  );
  process.exit(0);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the live extraction apply step.`);
  }
  return value;
}

try {
  if (process.env.BOLNA_EVAL_GATE !== "PASS") {
    throw new Error("BOLNA_EVAL_GATE must be PASS before extraction config can be applied.");
  }

  const agentId = requiredEnv("BOLNA_AGENT_ID");
  const plan = createLeadQualificationPlan();
  validateLeadQualificationPlan(plan);

  const client = createBolnaClient();
  const { categories } = await client.listExtractionCategories(agentId);
  let category = categories.find((item) => item.name === LEAD_QUALIFICATION_CATEGORY);

  if (!category) {
    category = await client.createExtractionCategory(agentId, plan.category);
    console.log(`Created extraction category: ${LEAD_QUALIFICATION_CATEGORY}.`);
  } else {
    console.log(`Reusing existing extraction category: ${LEAD_QUALIFICATION_CATEGORY}.`);
  }

  const existingNames = new Set(
    category.dispositions.map((disposition) => disposition.name.toLowerCase()),
  );
  const dispositions = buildLeadQualificationDispositions(category.id).filter(
    (disposition) => !existingNames.has(disposition.name.toLowerCase()),
  );

  if (dispositions.length > 0) {
    await client.createDispositionsBulk({ agent_id: agentId, dispositions });
    console.log(`Created ${dispositions.length} disposition(s).`);
  } else {
    console.log("Dispositions already present; no disposition mutation.");
  }

  const testResult = await client.testDispositions(agentId, {
    transcript: CODE_SWITCH_TRANSCRIPT,
  });
  const facts = extractLeadFactsFromData(testResult.extractedData);
  assert.deepEqual(facts, EXPECTED_LEAD_FACTS);

  console.log("PASS: grouped disposition fixture matched expected lead facts.");
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
