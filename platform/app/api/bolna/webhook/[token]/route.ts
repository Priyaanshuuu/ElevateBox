import { createBolnaClient } from "../../../../../lib/bolna/client.ts";
import {
  extractClientIp,
  isAllowedWebhookSource,
  isWebhookUrlTokenValid,
  loadWebhookConfig,
  type BolnaWebhookConfig,
} from "../../../../../lib/bolna/webhook-config.ts";
import {
  isTerminalBolnaStatus,
  parseBolnaWebhookPayload,
} from "../../../../../lib/bolna/webhook.ts";
import { ingestBolnaWebhook } from "../../../../../lib/bolna/webhook-service.ts";
import { createPrismaWebhookStore } from "../../../../../lib/bolna/webhook-store.prisma.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

function headersToRecord(headers: Headers): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};
  for (const [name, value] of headers.entries()) {
    const existing = output[name];
    if (existing === undefined) {
      output[name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      output[name] = [existing, value];
    }
  }
  return output;
}

async function verifyTerminalExecution(
  payload: unknown,
  config: BolnaWebhookConfig,
): Promise<"ok" | "mismatch" | "unavailable"> {
  if (!config.verifyExecution) return "ok";

  let normalized;
  try {
    normalized = parseBolnaWebhookPayload(payload);
  } catch {
    return "mismatch";
  }
  if (!normalized.isTerminal) return "ok";

  try {
    const execution = await createBolnaClient().getExecution(normalized.executionId);
    const incomingStatus = normalized.status.toLowerCase();
    const sourceStatus = execution.status.toLowerCase();
    const sourceIsTerminal = isTerminalBolnaStatus(sourceStatus);
    return sourceIsTerminal && sourceStatus === incomingStatus ? "ok" : "mismatch";
  } catch {
    return "unavailable";
  }
}

export async function POST(request: Request, context: RouteContext) {
  let config: BolnaWebhookConfig;
  try {
    config = loadWebhookConfig(process.env);
  } catch {
    return Response.json({ error: "webhook_not_configured" }, { status: 500 });
  }

  const { token } = await context.params;
  if (!isWebhookUrlTokenValid(token, config)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const headers = headersToRecord(request.headers);
  const clientIp = extractClientIp(headers);
  if (!isAllowedWebhookSource(clientIp, config)) {
    return Response.json({ error: "forbidden_source" }, { status: 403 });
  }

  const rawBody = await request.text();
  if (rawBody.length > config.maxBodyBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const verification = await verifyTerminalExecution(payload, config);
  if (verification === "unavailable") {
    return Response.json({ error: "execution_verification_unavailable" }, { status: 502 });
  }
  if (verification === "mismatch") {
    return Response.json({ error: "execution_mismatch" }, { status: 409 });
  }

  try {
    const result = await ingestBolnaWebhook({
      payload,
      headers,
      sourceIp: clientIp,
      store: createPrismaWebhookStore(),
    });
    return Response.json({ received: true, ...result }, { status: 200 });
  } catch {
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
