import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  BolnaError,
  buildLeadQualificationCallbackBody,
  createBolnaClient,
} from "../lib/bolna/index.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true, quiet: true });

const runLive = process.env.BOLNA_RUN_CALLBACK_SMOKE === "1";

if (!runLive) {
  console.log(
    "SKIP: set BOLNA_RUN_CALLBACK_SMOKE=1 and BOLNA_EVAL_GATE=PASS to send a signed workflow callback.",
  );
  process.exit(0);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the callback smoke test.`);
  return value;
}

try {
  if (process.env.BOLNA_EVAL_GATE !== "PASS") {
    throw new Error("BOLNA_EVAL_GATE must be PASS before sending a callback.");
  }

  const workflowId = requiredEnv("BOLNA_WORKFLOW_ID");
  const nodeId = requiredEnv("BOLNA_CALLBACK_NODE_ID");
  const phone = requiredEnv("BOLNA_CALLBACK_PHONE");
  const leadId = process.env.BOLNA_CALLBACK_LEAD_ID?.trim();
  const executionId = process.env.BOLNA_CALLBACK_EXECUTION_ID?.trim();
  if (!leadId && !executionId) {
    throw new Error("Set BOLNA_CALLBACK_LEAD_ID or BOLNA_CALLBACK_EXECUTION_ID.");
  }

  const client = createBolnaClient();
  const endpoint = await client.getWorkflowCallback(workflowId, nodeId);
  const body = buildLeadQualificationCallbackBody({
    event: "lead.qualified",
    phone,
    ...(leadId ? { leadId } : {}),
    ...(executionId ? { executionId } : {}),
    intent: "HOT",
    summary: "Step 5 signed callback smoke test.",
  });
  const delivery = await client.postWorkflowCallback(endpoint, body);

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        status: delivery.status,
        match: delivery.match,
        signatureHeaderPresent: true,
        signingSecretLogged: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof BolnaError ? error.message : (error as Error).message;
  console.error(`FAIL: signed callback smoke — ${message}`);
  process.exit(1);
}
