import {
  createProductionToolHandlers,
  handleBolnaToolRequest,
} from "../../../../../lib/bolna/tool-handler.ts";
import { createPrismaToolStore } from "../../../../../lib/bolna/tool-store.prisma.ts";
import { loadBolnaToolAuthConfig } from "../../../../../lib/bolna/tool-auth.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ tool: string }>;
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

export async function POST(request: Request, context: RouteContext) {
  let config;
  try {
    config = loadBolnaToolAuthConfig();
  } catch {
    return Response.json({ ok: false, error: "tool_auth_not_configured" }, { status: 500 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > config.maxBodyBytes) {
    return Response.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  const { tool } = await context.params;
  const rawBody = await request.text();

  try {
    const result = await handleBolnaToolRequest({
      toolName: tool,
      headers: headersToRecord(request.headers),
      rawBody,
      config,
      store: createPrismaToolStore(),
      handlers: createProductionToolHandlers(),
    });
    return Response.json(result.body, { status: result.status });
  } catch {
    return Response.json({ ok: false, error: "tool_processing_failed" }, { status: 500 });
  }
}
