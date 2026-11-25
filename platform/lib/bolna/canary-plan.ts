import { BolnaConfigError } from "./errors.ts";
import type { BolnaLanguageCode, BolnaCallRequest } from "./agent-types.ts";
import type { CostGateResult } from "./call-cost.ts";
import { canaryTrunkPlanDigest, validateCanaryTrunkPlan, type CanaryTrunkPlan } from "./trunk-config.ts";
import {
  isE164TrunkPhone,
  isUuid,
  parseTrunkCodecs,
  type BolnaTrunk,
  type BolnaTrunkConnectionDetails,
} from "./trunk-types.ts";

export interface OutboundCanaryInput {
  agentId: string;
  agentVersionId: string;
  recipientPhone: string;
  fromPhone: string;
  language: BolnaLanguageCode;
  customerName: string;
  runId: string;
}

export interface CanaryReadinessInput {
  plan: CanaryTrunkPlan;
  trunk: BolnaTrunk;
  connectionDetails: BolnaTrunkConnectionDetails;
  costGate: CostGateResult;
  expectedFromPhone?: string;
  expectedPlanDigest?: string;
}

export interface ReadinessCheck {
  name: string;
  status: "PASS" | "FAIL";
  detail?: string;
}

export interface CanaryReadinessResult {
  status: "PASS" | "FAIL";
  checks: ReadinessCheck[];
  reasons: string[];
}

const LANGUAGES: readonly BolnaLanguageCode[] = ["en", "hi", "te"];

function check(name: string, ok: boolean, detail?: string): ReadinessCheck {
  return { name, status: ok ? "PASS" : "FAIL", ...(detail ? { detail } : {}) };
}

export function buildOutboundCanaryCallRequest(
  plan: CanaryTrunkPlan,
  input: OutboundCanaryInput,
): BolnaCallRequest {
  validateCanaryTrunkPlan(plan);
  if (!plan.outboundEnabled) {
    throw new BolnaConfigError("The canary trunk plan is not outbound-enabled.");
  }
  if (!isUuid(input.agentId) || !isUuid(input.agentVersionId)) {
    throw new BolnaConfigError("Canary calls must pin a UUID agent id and agent version id.");
  }
  if (!isE164TrunkPhone(input.recipientPhone) || !isE164TrunkPhone(input.fromPhone)) {
    throw new BolnaConfigError("Canary phone numbers must be E.164 with a leading plus.");
  }
  if (!plan.numbers.some((number) => number.e164 === input.fromPhone)) {
    throw new BolnaConfigError("Caller ID must be one of the canary trunk numbers.");
  }
  if (!LANGUAGES.includes(input.language)) {
    throw new BolnaConfigError("Canary start language must be en, hi, or te.");
  }
  if (!input.customerName.trim() || !input.runId.trim()) {
    throw new BolnaConfigError("Canary customer name and run id are required.");
  }

  return {
    agent_id: input.agentId,
    agent_version_id: input.agentVersionId,
    recipient_phone_number: input.recipientPhone,
    from_phone_number: input.fromPhone,
    agent_data: { language: input.language },
    user_data: {
      canary: true,
      canary_run_id: input.runId,
      customer_name: input.customerName,
    },
    ...(plan.outboundLeadingPlusEnabled ? {} : {}),
  };
}

export function evaluateCanaryReadiness(input: CanaryReadinessInput): CanaryReadinessResult {
  validateCanaryTrunkPlan(input.plan);
  const checks: ReadinessCheck[] = [];
  const trunk = input.trunk;
  const details = input.connectionDetails;

  checks.push(
    check(
      "trunk_enabled",
      trunk.isActive && trunk.inboundEnabled && trunk.outboundEnabled,
      `isActive=${trunk.isActive}, inbound=${trunk.inboundEnabled}, outbound=${trunk.outboundEnabled}`,
    ),
  );
  checks.push(
    check(
      "trunk_health",
      trunk.health === "ready" || trunk.health === "waiting_for_carrier",
      trunk.health,
    ),
  );
  checks.push(
    check(
      "channel_capacity",
      trunk.activeCalls < trunk.channels,
      `${trunk.activeCalls}/${trunk.channels} active`,
    ),
  );
  checks.push(
    check(
      "gateway_ready",
      trunk.gateways.length > 0 && input.plan.gateways.length > 0,
      `${trunk.gateways.length} live gateways`,
    ),
  );
  checks.push(
    check(
      "carrier_ip_ready",
      trunk.ipAcls.length > 0 && input.plan.ipAcls.length > 0,
      `${trunk.ipAcls.length} live carrier IPs`,
    ),
  );
  const trunkNumbers = new Set(trunk.numbers.map((number) => number.e164));
  const planNumbers = input.plan.numbers.every((number) => trunkNumbers.has(number.e164));
  checks.push(check("numbers_registered", planNumbers, `${trunk.numbers.length} live numbers`));

  const fromPhoneOk =
    input.expectedFromPhone === undefined ||
    trunk.numbers.some((number) => number.e164 === input.expectedFromPhone);
  checks.push(check("caller_id_registered", fromPhoneOk, input.expectedFromPhone));

  const inboundAgentOk =
    Boolean(trunk.defaultInboundAgentId) ||
    trunk.numbers.some((number) => Boolean(number.agentId));
  checks.push(check("inbound_agent_bound", inboundAgentOk));

  checks.push(
    check(
      "edge_transport",
      details.transports.includes(input.plan.transport),
      `edge=${details.transports.join(",")}`,
    ),
  );
  let codecsOk = true;
  try {
    const offered = parseTrunkCodecs(trunk.codecs);
    const planned = parseTrunkCodecs(input.plan.codecs);
    codecsOk = offered.length > 0 && planned.every((codec) => offered.includes(codec));
  } catch {
    codecsOk = false;
  }
  checks.push(check("codecs_supported", codecsOk, `trunk=${trunk.codecs}`));
  checks.push(check("rtp_range_present", Boolean(details.rtpPorts && details.rtpPorts.includes("-"))));
  checks.push(check("cost_gate", input.costGate.status === "PASS", input.costGate.reasons.join("; ")));

  if (input.expectedPlanDigest) {
    checks.push(
      check(
        "plan_digest",
        input.expectedPlanDigest === canaryTrunkPlanDigest(input.plan),
        input.expectedPlanDigest,
      ),
    );
  }

  const reasons = checks
    .filter((item) => item.status === "FAIL")
    .map((item) => `${item.name}: ${item.detail ?? "failed"}`);
  return {
    status: reasons.length > 0 ? "FAIL" : "PASS",
    checks,
    reasons,
  };
}
