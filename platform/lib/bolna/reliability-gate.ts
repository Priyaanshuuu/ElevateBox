import { createHash } from "node:crypto";
import {
  evaluateCanaryCostGate,
  estimateWorstCaseCallCost,
  type CallCostRates,
} from "./call-cost.ts";
import { MemoryWebhookStore, ReliabilityStoreError } from "./memory-webhook-store.ts";
import {
  createMemoryToolStore,
  handleBolnaToolRequest,
  type BolnaToolStore,
  type ToolHandlers,
} from "./tool-handler.ts";
import { ingestBolnaWebhook } from "./webhook-service.ts";

export const RELIABILITY_GATE_CHECKS = [
  "input_validation",
  "webhook_replay",
  "key_order_dedupe",
  "out_of_order",
  "terminal_refresh",
  "non_terminal_guard",
  "missing_phone",
  "store_failure_recovery",
  "concurrent_webhook_load",
  "concurrent_tool_load",
  "tool_pending_claim",
  "cost_gate",
  "budget_failure",
] as const;

export type ReliabilityCheckName = (typeof RELIABILITY_GATE_CHECKS)[number];

export interface ReliabilityCheck {
  name: ReliabilityCheckName;
  status: "PASS" | "FAIL";
  detail: string;
}

export interface ReliabilityMetrics {
  webhookBurst: number;
  webhookAccepted: number;
  webhookDuplicates: number;
  executions: number;
  calls: number;
  leads: number;
  events: number;
  failedEvents: number;
  toolBurst: number;
  toolExecutions: number;
  toolDuplicates: number;
  toolPending: number;
  currency: string;
  worstCaseCostPerCall: number;
  projectedCanaryCost: number;
}

export interface ReliabilityGateResult {
  status: "PASS" | "FAIL";
  checks: ReliabilityCheck[];
  reasons: string[];
  digest: string;
  metrics: ReliabilityMetrics;
  networkRequests: 0;
  liveChecksRequired: string[];
}

export interface ReliabilityGateInput {
  webhookBurst?: number;
  toolBurst?: number;
  callCapSeconds?: number;
  rates?: CallCostRates;
  perCallCap?: number;
  canaryCap?: number;
}

const DEFAULT_WEBHOOK_BURST = 32;
const DEFAULT_TOOL_BURST = 16;
const MAX_WEBHOOK_BURST = 128;
const MAX_TOOL_BURST = 64;

const DEFAULT_RATES: CallCostRates = {
  currency: "USD",
  voiceAiPerMinute: 0.1,
  bolnaPlatformPerMinute: 0.05,
  carrierPerMinute: 0.02,
  carrierConnectionFee: 0.01,
  carrierMinimumMinutes: 1,
  carrierBillingIncrementSeconds: 60,
};

const TOOL_TOKEN = "step10-offline-tool-token-0123456789";
const TOOL_CONFIG = {
  token: TOOL_TOKEN,
  allowUnauthenticated: false,
  allowedSourceIps: ["127.0.0.1"],
  maxBodyBytes: 65_536,
};
const TOOL_HEADERS = {
  authorization: `Bearer ${TOOL_TOKEN}`,
  "x-forwarded-for": "127.0.0.1",
};

const LIVE_CHECKS_REQUIRED = [
  "Step 6 canary readiness against the real carrier trunk.",
  "Step 6 cost gate with real Bolna and carrier rates.",
  "Step 8 explicit live canary authorization with a reviewed plan digest.",
];

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestFor(checks: readonly ReliabilityCheck[], metrics: ReliabilityMetrics): string {
  return createHash("sha256")
    .update(canonical({ checks, metrics, networkRequests: 0 }))
    .digest("hex");
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function webhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "step10-execution-1",
    agent_id: "agent-1",
    agent_version_id: "version-1",
    status: "completed",
    conversation_duration: 180,
    total_cost: 3.23,
    transcript: "User: We need a store\nAgent: Let me help with that",
    summary: "Customer is interested in an ecommerce store.",
    user_number: "+919876543210",
    agent_number: "+911122233344",
    telephony_data: {
      provider: "plivo",
      provider_call_id: "ca-step10",
      recording_url: "https://api.bolna.ai/recordings/call/step10-execution-1",
      call_type: "outbound",
    },
    cost_breakdown: { voice_ai: 2, carrier: 1.23 },
    extracted_data: {
      General: { "Lead Intent": { subjective: "HOT" } },
      business: "Acme Store",
    },
    created_at: "2026-11-26T10:00:00Z",
    updated_at: "2026-11-26T10:03:00Z",
    ...overrides,
  };
}

function toolBody(): string {
  return JSON.stringify({
    execution_id: "step10-execution-1",
    agent_id: "agent-1",
    tool_call_id: "step10-tool-call-1",
    lead_id: "lead-1",
    timezone: "Asia/Kolkata",
    request_text: "call me tomorrow at 10 am",
    notes: "offline reliability gate",
  });
}

function toolHandlers(counter: { calls: number }): ToolHandlers {
  return {
    async scheduleCallback() {
      counter.calls += 1;
      return { ok: true, scheduled: true };
    },
    async triggerHotLeadWhatsApp() {
      counter.calls += 1;
      return { ok: true, sent: false };
    },
  };
}

async function check(
  name: ReliabilityCheckName,
  fn: () => Promise<string> | string,
): Promise<ReliabilityCheck> {
  try {
    return { name, status: "PASS", detail: await fn() };
  } catch (error) {
    const label = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    return { name, status: "FAIL", detail: `${label}: ${message}` };
  }
}

function initialMetrics(input: Required<Pick<ReliabilityGateInput, "webhookBurst" | "toolBurst">>): ReliabilityMetrics {
  return {
    webhookBurst: input.webhookBurst,
    webhookAccepted: 0,
    webhookDuplicates: 0,
    executions: 0,
    calls: 0,
    leads: 0,
    events: 0,
    failedEvents: 0,
    toolBurst: input.toolBurst,
    toolExecutions: 0,
    toolDuplicates: 0,
    toolPending: 0,
    currency: DEFAULT_RATES.currency,
    worstCaseCostPerCall: 0,
    projectedCanaryCost: 0,
  };
}

/**
 * Offline Step 10 gate. It composes only pure Bolna functions and in-memory
 * adapters: no Prisma client, no provider client, no network, no live call.
 */
export async function runReliabilityGate(
  input: ReliabilityGateInput = {},
): Promise<ReliabilityGateResult> {
  const webhookBurst = input.webhookBurst ?? DEFAULT_WEBHOOK_BURST;
  const toolBurst = input.toolBurst ?? DEFAULT_TOOL_BURST;
  const callCapSeconds = input.callCapSeconds ?? 300;
  const rates = input.rates ?? DEFAULT_RATES;
  const perCallCap = input.perCallCap ?? 1;
  const canaryCap = input.canaryCap ?? 1;
  const metrics = initialMetrics({ webhookBurst, toolBurst });
  const checks: ReliabilityCheck[] = [];

  const finish = (): ReliabilityGateResult => {
    const reasons = checks
      .filter((item) => item.status === "FAIL")
      .map((item) => `${item.name}: ${item.detail}`);
    return {
      status: reasons.length === 0 ? "PASS" : "FAIL",
      checks,
      reasons,
      digest: digestFor(checks, metrics),
      metrics,
      networkRequests: 0,
      liveChecksRequired: [...LIVE_CHECKS_REQUIRED],
    };
  };

  checks.push(
    await check("input_validation", () => {
      expect(
        Number.isInteger(webhookBurst) && webhookBurst >= 2 && webhookBurst <= MAX_WEBHOOK_BURST,
        `webhookBurst must be 2 to ${MAX_WEBHOOK_BURST}.`,
      );
      expect(
        Number.isInteger(toolBurst) && toolBurst >= 2 && toolBurst <= MAX_TOOL_BURST,
        `toolBurst must be 2 to ${MAX_TOOL_BURST}.`,
      );
      expect(
        Number.isInteger(callCapSeconds) && callCapSeconds >= 1 && callCapSeconds <= 600,
        "callCapSeconds must be 1 to 600.",
      );
      expect(perCallCap > 0 && canaryCap > 0, "Cost caps must be positive.");
      return `burst limits ${webhookBurst}/${toolBurst} and caps ${perCallCap}/${canaryCap} accepted`;
    }),
  );
  if (checks.some((item) => item.status === "FAIL")) return finish();

  checks.push(
    await check("webhook_replay", async () => {
      const store = new MemoryWebhookStore();
      const payload = webhookPayload();
      const first = await ingestBolnaWebhook({ payload, store });
      const replay = await ingestBolnaWebhook({ payload, store });
      expect(first.outcome === "accepted" && first.projected, "First delivery was not accepted.");
      expect(replay.outcome === "duplicate" && !replay.projected, "Replay was not deduped.");
      const snapshot = store.snapshot();
      expect(snapshot.events === 1 && snapshot.executions === 1, "Replay created duplicate rows.");
      expect(snapshot.calls === 1 && snapshot.leads === 1, "Replay duplicated business records.");
      metrics.events += snapshot.events;
      metrics.executions += snapshot.executions;
      metrics.calls += snapshot.calls;
      metrics.leads += snapshot.leads;
      metrics.webhookAccepted += 1;
      metrics.webhookDuplicates += 1;
      return "one accepted delivery, one duplicate, one projected call";
    }),
  );

  checks.push(
    await check("key_order_dedupe", async () => {
      const store = new MemoryWebhookStore();
      const payload = webhookPayload();
      const reordered = Object.fromEntries(Object.entries(payload).reverse());
      await ingestBolnaWebhook({ payload, store });
      const replay = await ingestBolnaWebhook({ payload: reordered, store });
      expect(replay.outcome === "duplicate", "Reordered JSON keys were not deduped.");
      expect(store.events.length === 1, "Reordered replay created a second event.");
      return "stable dedupe key ignores object key order";
    }),
  );

  checks.push(
    await check("out_of_order", async () => {
      const store = new MemoryWebhookStore();
      await ingestBolnaWebhook({ payload: webhookPayload(), store });
      const late = await ingestBolnaWebhook({
        payload: webhookPayload({ status: "in-progress", delivery_attempt: 2 }),
        store,
      });
      expect(!late.projected, "Late non-terminal event was projected.");
      expect(store.executions[0]?.status === "completed", "Terminal execution status was downgraded.");
      expect(store.calls[0]?.status === "COMPLETED", "Terminal call status was downgraded.");
      expect(typeof store.executions[0]?.transcript === "string", "Final transcript was lost.");
      return "late in-progress webhook did not downgrade a completed call";
    }),
  );

  checks.push(
    await check("terminal_refresh", async () => {
      const store = new MemoryWebhookStore();
      await ingestBolnaWebhook({ payload: webhookPayload(), store });
      const refresh = await ingestBolnaWebhook({
        payload: webhookPayload({ delivery_attempt: 2, total_cost: 4.5 }),
        store,
      });
      expect(refresh.outcome === "accepted" && refresh.projected, "Terminal refresh was rejected.");
      expect(store.executions[0]?.totalCost === 4.5, "Terminal cost refresh was not applied.");
      expect(store.calls.length === 1, "Terminal refresh created a second call.");
      expect(store.events.length === 2, "Terminal refresh did not record a new event.");
      return "repeated terminal status refreshed cost without duplicating the call";
    }),
  );

  checks.push(
    await check("non_terminal_guard", async () => {
      const store = new MemoryWebhookStore();
      const result = await ingestBolnaWebhook({
        payload: webhookPayload({ status: "call-disconnected" }),
        store,
      });
      expect(result.callId === undefined, "call-disconnected created a call.");
      expect(store.calls.length === 0 && store.leads.length === 0, "Non-terminal event created business records.");
      expect(store.events.length === 1, "Non-terminal event was not stored.");
      return "call-disconnected stayed non-terminal with no call or lead";
    }),
  );

  checks.push(
    await check("missing_phone", async () => {
      const store = new MemoryWebhookStore();
      const result = await ingestBolnaWebhook({
        payload: webhookPayload({ user_number: null }),
        store,
      });
      expect(result.callId === undefined, "Missing phone created a call.");
      expect(store.calls.length === 0 && store.leads.length === 0, "Missing phone created business records.");
      expect(store.executions.length === 1 && store.events.length === 1, "Event was not stored for replay.");
      return "missing phone stored the event without creating a lead or call";
    }),
  );

  checks.push(
    await check("store_failure_recovery", async () => {
      const store = new MemoryWebhookStore({ failProcessedEvents: true });
      let failed = false;
      try {
        await ingestBolnaWebhook({ payload: webhookPayload(), store });
      } catch {
        failed = true;
      }
      expect(failed, "Store failure was not surfaced to the caller.");
      expect(store.events[0]?.failedAt !== null, "Failed event was not marked failed.");
      expect(
        store.events[0]?.errorMessage === new ReliabilityStoreError("").name,
        "Failure name was not persisted on the event.",
      );
      store.failProcessedEvents = false;
      const retry = await ingestBolnaWebhook({ payload: webhookPayload(), store });
      expect(retry.outcome === "duplicate", "Recovery replay was not deduped.");
      expect(store.calls.length === 1, "Recovery replay duplicated the call.");
      metrics.failedEvents += 1;
      return "failed delivery marked the event and recovered through idempotent replay";
    }),
  );

  checks.push(
    await check("concurrent_webhook_load", async () => {
      const store = new MemoryWebhookStore();
      const payload = webhookPayload();
      const results = await Promise.all(
        Array.from({ length: webhookBurst }, () => ingestBolnaWebhook({ payload, store })),
      );
      const accepted = results.filter((item) => item.outcome === "accepted").length;
      const duplicates = results.filter((item) => item.outcome === "duplicate").length;
      const snapshot = store.snapshot();
      expect(accepted === 1, `Expected one accepted delivery, got ${accepted}.`);
      expect(duplicates === webhookBurst - 1, "Concurrent duplicates were not all deduped.");
      expect(snapshot.events === 1 && snapshot.calls === 1, "Concurrent load duplicated side effects.");
      metrics.webhookAccepted += accepted;
      metrics.webhookDuplicates += duplicates;
      metrics.events += snapshot.events;
      metrics.executions += snapshot.executions;
      metrics.calls += snapshot.calls;
      metrics.leads += snapshot.leads;
      return `${webhookBurst} concurrent deliveries produced exactly one call`;
    }),
  );

  checks.push(
    await check("concurrent_tool_load", async () => {
      const store = createMemoryToolStore();
      const counter = { calls: 0 };
      const body = toolBody();
      const results = await Promise.all(
        Array.from({ length: toolBurst }, () =>
          handleBolnaToolRequest({
            toolName: "schedule_callback",
            headers: TOOL_HEADERS,
            rawBody: body,
            config: TOOL_CONFIG,
            store,
            handlers: toolHandlers(counter),
          }),
        ),
      );
      const executed = results.filter((item) => item.body.duplicate === false).length;
      const duplicates = results.filter((item) => item.body.duplicate === true).length;
      expect(results.every((item) => item.status === 200 || item.status === 202), "Tool load returned an error.");
      expect(executed === 1 && counter.calls === 1, "Concurrent tool load executed the handler more than once.");
      expect(duplicates === toolBurst - 1, "Concurrent tool duplicates were not deduped.");
      metrics.toolExecutions += executed;
      metrics.toolDuplicates += duplicates;
      return `${toolBurst} concurrent invocations executed the tool exactly once`;
    }),
  );

  checks.push(
    await check("tool_pending_claim", async () => {
      const pendingStore: BolnaToolStore = {
        async claim({ dedupeKey, toolName }) {
          return {
            claimed: false,
            existing: {
              dedupeKey,
              toolName,
              status: "pending",
              result: null,
              errorMessage: null,
            },
          };
        },
        async complete() {},
        async fail() {},
      };
      const counter = { calls: 0 };
      const result = await handleBolnaToolRequest({
        toolName: "schedule_callback",
        headers: TOOL_HEADERS,
        rawBody: toolBody(),
        config: TOOL_CONFIG,
        store: pendingStore,
        handlers: toolHandlers(counter),
      });
      expect(result.status === 202, "A pending tool claim did not return 202.");
      expect(counter.calls === 0, "A pending tool claim executed the handler.");
      metrics.toolPending += 1;
      return "in-flight tool claim returned 202 without re-executing";
    }),
  );

  let projectedCanaryCost = 0;
  checks.push(
    await check("cost_gate", async () => {
      const estimate = estimateWorstCaseCallCost({
        rates,
        callCapSeconds,
        usesPreferredModels: true,
      });
      const gate = evaluateCanaryCostGate({
        estimate,
        plannedCalls: 1,
        maxCallsPerCanary: 1,
        maxCostPerCall: perCallCap,
        maxCanaryCost: canaryCap,
        maxConcurrentCalls: 1,
      });
      expect(gate.status === "PASS", `Cost gate failed: ${gate.reasons.join(" ")}`);
      expect(gate.projectedCanaryCost > 0, "Projected cost was not positive.");
      projectedCanaryCost = gate.projectedCanaryCost;
      metrics.currency = estimate.currency;
      metrics.worstCaseCostPerCall = estimate.totalCost;
      metrics.projectedCanaryCost = gate.projectedCanaryCost;
      return `${estimate.currency} worst case ${estimate.totalCost} within caps ${perCallCap}/${canaryCap}`;
    }),
  );

  checks.push(
    await check("budget_failure", async () => {
      const estimate = estimateWorstCaseCallCost({
        rates,
        callCapSeconds,
        usesPreferredModels: true,
      });
      const overBudget = evaluateCanaryCostGate({
        estimate,
        plannedCalls: 1,
        maxCallsPerCanary: 1,
        maxCostPerCall: perCallCap,
        maxCanaryCost: Math.max(0, projectedCanaryCost - 0.01),
        maxConcurrentCalls: 1,
      });
      expect(overBudget.status === "FAIL", "A budget breach was not blocked.");
      expect(overBudget.reasons.length > 0, "Budget breach produced no reason.");
      const badConcurrency = evaluateCanaryCostGate({
        estimate,
        plannedCalls: 1,
        maxCallsPerCanary: 1,
        maxCostPerCall: perCallCap,
        maxCanaryCost: canaryCap,
        maxConcurrentCalls: 0,
      });
      expect(badConcurrency.status === "FAIL", "Zero concurrency was not blocked.");
      return "over-budget and invalid-concurrency inputs fail closed";
    }),
  );

  return finish();
}
