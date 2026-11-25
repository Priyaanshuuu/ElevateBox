import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  BolnaConfigError,
  BolnaHttpError,
  BolnaResponseError,
  buildAgentTelephonyPatchRequest,
  buildCanaryTrunkCreateRequest,
  buildCanaryTrunkNumberRequests,
  buildOutboundCanaryCallRequest,
  canaryTrunkPlanDigest,
  createBolnaClient,
  evaluateCanaryCostGate,
  evaluateCanaryReadiness,
  estimateWorstCaseCallCost,
  isPublicIpv4Cidr,
  isTrunkGatewayHost,
  maskedCanaryTrunkPlan,
  parseBolnaTrunk,
  parseBolnaTrunkCallListResponse,
  parseBolnaTrunkConnectionDetails,
  parseBolnaTrunkListResponse,
  serializeTrunkCreateRequest,
  validateBolnaTrunkCreateRequest,
  validateCanaryTrunkPlan,
  type BolnaClient,
  type BolnaConfig,
  type BolnaTrunk,
  type CanaryTrunkPlan,
  type CostGateResult,
} from "../lib/bolna/index.ts";

const API_KEY = "bolna-step6-trunk-test-key";
const TRUNK_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const NUMBER_ID = "44444444-4444-4444-8444-444444444444";
const GATEWAY_ID = "55555555-5555-4555-8555-555555555555";
const CARRIER_IP_ID = "66666666-6666-4666-8666-666666666666";
const FROM_PHONE = "+919876543210";
const TO_PHONE = "+919999999999";
const CARRIER_PASSWORD = "step6-carrier-secret-0123456789";

interface SeenRequest {
  method: string;
  url: string;
  body: string;
  authorization: string | undefined;
}

let server: Server | undefined;

async function startServer(
  handler: (request: SeenRequest) => { status: number; body: unknown },
): Promise<{ baseUrl: string; requests: SeenRequest[] }> {
  const requests: SeenRequest[] = [];
  const current = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const seen: SeenRequest = {
      method: request.method ?? "",
      url: request.url ?? "",
      body: Buffer.concat(chunks).toString("utf8"),
      authorization: request.headers.authorization,
    };
    requests.push(seen);
    const result = handler(seen);
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  server = current;
  await new Promise<void>((resolve, reject) => {
    current.once("error", reject);
    current.listen(0, "127.0.0.1", () => resolve());
  });
  const address = current.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests };
}

afterEach(async () => {
  if (!server) return;
  const current = server;
  server = undefined;
  current.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
});

function fixtureTrunk(overrides: Partial<BolnaTrunk> = {}): BolnaTrunk {
  const base: BolnaTrunk = {
    id: TRUNK_ID,
    name: "ElevateBox canary SIP trunk",
    description: null,
    preset: "custom",
    isActive: true,
    inboundEnabled: true,
    outboundEnabled: true,
    channels: 2,
    defaultInboundAgentId: AGENT_ID,
    authUsername: "bolna-outbound",
    transport: "udp",
    codecs: "PCMU,PCMA",
    outboundLeadingPlusEnabled: true,
    lastInboundAt: null,
    lastOutboundAt: null,
    convertedFromByotTrunkId: null,
    organizationId: null,
    subAccountId: null,
    userId: null,
    createdAt: "2026-11-26T00:00:00Z",
    updatedAt: "2026-11-26T00:00:00Z",
    isDeleted: false,
    deletedAt: null,
    health: "waiting_for_carrier",
    activeCalls: 0,
    gateways: [
      {
        id: GATEWAY_ID,
        trunkId: TRUNK_ID,
        host: "sip.example.com",
        resolvedIps: ["203.0.113.30"],
        port: 5060,
        priority: 0,
        createdAt: "2026-11-26T00:00:00Z",
        updatedAt: "2026-11-26T00:00:00Z",
        isDeleted: false,
        deletedAt: null,
      },
    ],
    ipAcls: [
      {
        id: CARRIER_IP_ID,
        trunkId: TRUNK_ID,
        cidr: "198.51.100.0/28",
        createdAt: "2026-11-26T00:00:00Z",
        updatedAt: "2026-11-26T00:00:00Z",
        isDeleted: false,
        deletedAt: null,
      },
    ],
    numbers: [
      {
        id: NUMBER_ID,
        trunkId: TRUNK_ID,
        e164: FROM_PHONE,
        destinationKey: "919876543210",
        agentId: AGENT_ID,
        lastInboundAt: null,
        lastOutboundAt: null,
        createdAt: "2026-11-26T00:00:00Z",
        updatedAt: "2026-11-26T00:00:00Z",
        isDeleted: false,
        deletedAt: null,
      },
    ],
  };
  return { ...base, ...overrides };
}

function rawTrunk(): Record<string, unknown> {
  const trunk = fixtureTrunk();
  return {
    id: trunk.id,
    name: trunk.name,
    description: trunk.description,
    preset: trunk.preset,
    is_active: trunk.isActive,
    inbound_enabled: trunk.inboundEnabled,
    outbound_enabled: trunk.outboundEnabled,
    channels: trunk.channels,
    default_inbound_agent_id: trunk.defaultInboundAgentId,
    auth_username: trunk.authUsername,
    transport: trunk.transport,
    codecs: trunk.codecs,
    outbound_leading_plus_enabled: trunk.outboundLeadingPlusEnabled,
    last_inbound_at: trunk.lastInboundAt,
    last_outbound_at: trunk.lastOutboundAt,
    converted_from_byot_trunk_id: trunk.convertedFromByotTrunkId,
    organization_id: trunk.organizationId,
    sub_account_id: trunk.subAccountId,
    user_id: trunk.userId,
    created_at: trunk.createdAt,
    updated_at: trunk.updatedAt,
    is_deleted: trunk.isDeleted,
    deleted_at: trunk.deletedAt,
    health: trunk.health,
    active_calls: trunk.activeCalls,
    gateways: trunk.gateways.map((gateway) => ({
      id: gateway.id,
      trunk_id: gateway.trunkId,
      host: gateway.host,
      resolved_ips: gateway.resolvedIps,
      port: gateway.port,
      priority: gateway.priority,
      created_at: gateway.createdAt,
      updated_at: gateway.updatedAt,
      is_deleted: gateway.isDeleted,
      deleted_at: gateway.deletedAt,
    })),
    ip_acls: trunk.ipAcls.map((ip) => ({
      id: ip.id,
      trunk_id: ip.trunkId,
      cidr: ip.cidr,
      created_at: ip.createdAt,
      updated_at: ip.updatedAt,
      is_deleted: ip.isDeleted,
      deleted_at: ip.deletedAt,
    })),
    numbers: trunk.numbers.map((number) => ({
      id: number.id,
      trunk_id: number.trunkId,
      e164: number.e164,
      destination_key: number.destinationKey,
      agent_id: number.agentId,
      last_inbound_at: number.lastInboundAt,
      last_outbound_at: number.lastOutboundAt,
      created_at: number.createdAt,
      updated_at: number.updatedAt,
      is_deleted: number.isDeleted,
      deleted_at: number.deletedAt,
    })),
  };
}

function fixturePlan(): CanaryTrunkPlan {
  return {
    trunkName: "ElevateBox canary SIP trunk",
    preset: "custom",
    inboundEnabled: true,
    outboundEnabled: true,
    channels: 2,
    defaultInboundAgentId: AGENT_ID,
    transport: "udp",
    outboundLeadingPlusEnabled: true,
    codecs: "PCMU,PCMA",
    gateways: [{ host: "sip.example.com", port: 5060, priority: 0 }],
    ipAcls: ["198.51.100.0/28"],
    numbers: [{ e164: FROM_PHONE, destinationKey: "919876543210", agentId: AGENT_ID }],
    authUsername: "bolna-outbound",
    authPasswordEnv: "BOLNA_TRUNK_AUTH_PASSWORD",
  };
}

function fixtureCostGate(status: "PASS" | "FAIL" = "PASS"): CostGateResult {
  return { status, reasons: status === "PASS" ? [] : ["fixture failure"], projectedCanaryCost: 0.5 };
}

function testClient(baseUrl: string): BolnaClient {
  const config: BolnaConfig = { apiKey: API_KEY, baseUrl, timeoutMs: 2000 };
  return createBolnaClient({ config });
}

describe("Step 6 — SIP trunk and canary readiness evals", () => {
  describe("typed trunk contracts", () => {
    it("eval: trunk parsers normalize nested resources and reject malformed responses", () => {
      const parsed = parseBolnaTrunk(rawTrunk());
      assert.equal(parsed.health, "waiting_for_carrier");
      assert.equal(parsed.gateways[0]?.host, "sip.example.com");
      assert.equal(parsed.numbers[0]?.e164, FROM_PHONE);
      assert.deepEqual(parseBolnaTrunkListResponse({ trunks: [rawTrunk()] }).trunks, [parsed]);

      const broken = rawTrunk();
      delete broken.gateways;
      assert.throws(() => parseBolnaTrunk(broken), BolnaResponseError);
    });

    it("eval: connection details and trunk calls use documented shapes", () => {
      const details = parseBolnaTrunkConnectionDetails({
        sip_domain: "trunk.bolna.ai",
        ips: ["15.252.21.46", "13.206.230.198"],
        port: 5060,
        transports: ["udp", "tcp"],
        rtp_ports: "30000-40000",
      });
      assert.equal(details.sipDomain, "trunk.bolna.ai");
      assert.deepEqual(details.transports, ["udp", "tcp"]);

      const calls = parseBolnaTrunkCallListResponse({
        calls: [
          {
            execution_id: VERSION_ID,
            started_at: "2026-11-26T10:00:00Z",
            direction: "outbound",
            number: TO_PHONE,
            duration_s: 143,
            outcome: "completed",
            sip_code: null,
            sip_cause: "NORMAL_CLEARING",
          },
        ],
      });
      assert.equal(calls.calls[0]?.durationSeconds, 143);
      assert.throws(
        () =>
          parseBolnaTrunkCallListResponse({
            calls: [{ ...calls.calls[0], direction: "sideways" }],
          }),
        BolnaResponseError,
      );
    });

    it("eval: unsafe trunk inputs fail closed", () => {
      const base = serializeTrunkCreateRequest({
        name: "Fixture trunk",
        gateways: [{ host: "sip.example.com" }],
        ipAcls: ["198.51.100.0/28"],
      });
      assert.doesNotThrow(() => validateBolnaTrunkCreateRequest(base));
      assert.equal(isTrunkGatewayHost("10.0.0.5"), false);
      assert.equal(isPublicIpv4Cidr("198.48.0.0/12"), false);

      assert.throws(
        () =>
          validateBolnaTrunkCreateRequest({
            ...base,
            gateways: [{ host: "10.0.0.5" }],
          }),
        BolnaConfigError,
      );
      assert.throws(
        () =>
          validateBolnaTrunkCreateRequest({
            ...base,
            ip_acls: ["198.48.0.0/12"],
          }),
        BolnaConfigError,
      );
      assert.throws(
        () => validateBolnaTrunkCreateRequest({ ...base, transport: "tls" }),
        BolnaConfigError,
      );
      assert.throws(
        () => validateBolnaTrunkCreateRequest({ ...base, codecs: "G729" }),
        BolnaConfigError,
      );
      assert.throws(
        () =>
          validateBolnaTrunkCreateRequest({
            ...base,
            authUsername: "bolna-outbound",
          }),
        BolnaConfigError,
      );
      assert.throws(
        () => validateBolnaTrunkCreateRequest({ ...base, surprise: true }),
        BolnaConfigError,
      );
    });
  });

  describe("canary trunk plan", () => {
    it("eval: plan digest is deterministic and excludes carrier secret values", () => {
      const plan = fixturePlan();
      assert.doesNotThrow(() => validateCanaryTrunkPlan(plan));
      const digest = canaryTrunkPlanDigest(plan);
      assert.equal(digest, canaryTrunkPlanDigest(fixturePlan()));
      assert.notEqual(
        digest,
        canaryTrunkPlanDigest({
          ...fixturePlan(),
          gateways: [{ host: "sip2.example.com", port: 5060, priority: 0 }],
        }),
      );

      const first = buildCanaryTrunkCreateRequest(plan, {
        BOLNA_TRUNK_AUTH_PASSWORD: CARRIER_PASSWORD,
      });
      const second = buildCanaryTrunkCreateRequest(plan, {
        BOLNA_TRUNK_AUTH_PASSWORD: "different-secret",
      });
      assert.equal(first.authPassword, CARRIER_PASSWORD);
      assert.equal(second.authPassword, "different-secret");
      assert.equal(canaryTrunkPlanDigest(plan), digest);
      assert.equal(JSON.stringify(first).includes(CARRIER_PASSWORD), true);
      assert.equal(JSON.stringify(maskedCanaryTrunkPlan(plan)).includes(FROM_PHONE), false);
      assert.deepEqual(buildCanaryTrunkNumberRequests(plan), [
        { e164: FROM_PHONE, destinationKey: "919876543210", agentId: AGENT_ID },
      ]);
    });

    it("eval: canary plan requires gateways, carrier IPs, numbers, and an inbound agent", () => {
      const plan = fixturePlan();
      assert.throws(
        () => validateCanaryTrunkPlan({ ...plan, gateways: [] }),
        BolnaConfigError,
      );
      assert.throws(
        () => validateCanaryTrunkPlan({ ...plan, ipAcls: [] }),
        BolnaConfigError,
      );
      assert.throws(() => validateCanaryTrunkPlan({ ...plan, numbers: [] }), BolnaConfigError);
      assert.throws(
        () =>
          validateCanaryTrunkPlan({
            ...plan,
            defaultInboundAgentId: null,
            numbers: [{ e164: FROM_PHONE, destinationKey: "919876543210" }],
          }),
        BolnaConfigError,
      );
      assert.throws(
        () => validateCanaryTrunkPlan({ ...plan, channels: 50 }),
        BolnaConfigError,
      );
      assert.throws(
        () => buildCanaryTrunkCreateRequest(plan, {}),
        BolnaConfigError,
      );
    });

    it("eval: cost estimate separates Bolna AI, platform, and carrier charges", () => {
      const estimate = estimateWorstCaseCallCost({
        rates: {
          currency: "USD",
          voiceAiPerMinute: 0.06,
          bolnaPlatformPerMinute: 0.01,
          carrierPerMinute: 0.02,
          carrierConnectionFee: 0.05,
          carrierMinimumMinutes: 1,
          carrierBillingIncrementSeconds: 30,
        },
        callCapSeconds: 300,
        usesPreferredModels: true,
      });
      assert.equal(estimate.bolnaBillableMinutes, 5);
      assert.equal(estimate.carrierBillableMinutes, 5);
      assert.equal(estimate.voiceAiCost, 0.3);
      assert.equal(estimate.bolnaPlatformCost, 0.05);
      assert.equal(estimate.carrierMinutesCost, 0.1);
      assert.equal(estimate.totalCost, 0.5);

      const rounded = estimateWorstCaseCallCost({
        rates: {
          currency: "USD",
          voiceAiPerMinute: 0.06,
          bolnaPlatformPerMinute: 0.01,
          carrierPerMinute: 0.02,
          carrierConnectionFee: 0,
          carrierMinimumMinutes: 0,
          carrierBillingIncrementSeconds: 30,
        },
        callCapSeconds: 61,
        usesPreferredModels: true,
      });
      assert.equal(rounded.carrierBillableMinutes, 2);
      assert.throws(
        () =>
          estimateWorstCaseCallCost({
            rates: {
              currency: "USD",
              voiceAiPerMinute: -1,
              bolnaPlatformPerMinute: 0,
              carrierPerMinute: 0,
              carrierConnectionFee: 0,
              carrierMinimumMinutes: 0,
              carrierBillingIncrementSeconds: 60,
            },
            callCapSeconds: 60,
            usesPreferredModels: true,
          }),
        BolnaConfigError,
      );
    });

    it("eval: cost gate blocks non-preferred models and budget overruns", () => {
      const estimate = estimateWorstCaseCallCost({
        rates: {
          currency: "USD",
          voiceAiPerMinute: 0.06,
          bolnaPlatformPerMinute: 0.01,
          carrierPerMinute: 0.02,
          carrierConnectionFee: 0.05,
          carrierMinimumMinutes: 0,
          carrierBillingIncrementSeconds: 60,
        },
        callCapSeconds: 300,
        usesPreferredModels: true,
      });
      const base = {
        estimate,
        plannedCalls: 1,
        maxCallsPerCanary: 2,
        maxCostPerCall: 1,
        maxCanaryCost: 2,
        maxConcurrentCalls: 1,
      };
      assert.equal(evaluateCanaryCostGate(base).status, "PASS");
      assert.equal(
        evaluateCanaryCostGate({ ...base, estimate: { ...estimate, usesPreferredModels: false } })
          .status,
        "FAIL",
      );
      assert.equal(evaluateCanaryCostGate({ ...base, maxCostPerCall: 0.1 }).status, "FAIL");
      assert.equal(evaluateCanaryCostGate({ ...base, plannedCalls: 5 }).status, "FAIL");
      assert.equal(evaluateCanaryCostGate({ ...base, maxConcurrentCalls: 0 }).status, "FAIL");
    });
  });

  describe("canary call and readiness gates", () => {
    it("eval: outbound canary pins version and trunk caller ID without retries", () => {
      const request = buildOutboundCanaryCallRequest(fixturePlan(), {
        agentId: AGENT_ID,
        agentVersionId: VERSION_ID,
        recipientPhone: TO_PHONE,
        fromPhone: FROM_PHONE,
        language: "hi",
        customerName: "Asha",
        runId: "step6-fixture",
      });
      assert.equal(request.agent_version_id, VERSION_ID);
      assert.equal(request.from_phone_number, FROM_PHONE);
      assert.deepEqual(request.agent_data, { language: "hi" });
      assert.equal(request.user_data?.canary, true);
      assert.equal(request.retry_config, undefined);
      assert.equal(request.bypass_call_guardrails, undefined);

      assert.throws(
        () =>
          buildOutboundCanaryCallRequest(fixturePlan(), {
            agentId: AGENT_ID,
            agentVersionId: VERSION_ID,
            recipientPhone: TO_PHONE,
            fromPhone: "+910000000000",
            language: "en",
            customerName: "Asha",
            runId: "step6-fixture",
          }),
        BolnaConfigError,
      );
    });

    it("eval: readiness fails degraded trunks and missing inbound prerequisites", () => {
      const details = {
        sipDomain: "trunk.bolna.ai",
        ips: ["15.252.21.46"],
        port: 5060,
        transports: ["udp", "tcp"] as const,
        rtpPorts: "30000-40000",
      };
      const base = {
        plan: fixturePlan(),
        trunk: fixtureTrunk(),
        connectionDetails: { ...details, transports: [...details.transports] as ("udp" | "tcp")[] },
        costGate: fixtureCostGate(),
        expectedFromPhone: FROM_PHONE,
        expectedPlanDigest: canaryTrunkPlanDigest(fixturePlan()),
      };
      assert.equal(evaluateCanaryReadiness(base).status, "PASS");

      const degraded = evaluateCanaryReadiness({
        ...base,
        trunk: fixtureTrunk({ health: "degraded", activeCalls: 2 }),
      });
      assert.equal(degraded.status, "FAIL");
      assert.ok(degraded.reasons.some((reason) => reason.includes("trunk_health")));
      assert.ok(degraded.reasons.some((reason) => reason.includes("channel_capacity")));

      const noInbound = evaluateCanaryReadiness({
        ...base,
        trunk: fixtureTrunk({ ipAcls: [] }),
      });
      assert.equal(noInbound.status, "FAIL");
      assert.ok(noInbound.reasons.some((reason) => reason.includes("carrier_ip_ready")));

      const wrongTransport = evaluateCanaryReadiness({
        ...base,
        connectionDetails: {
          ...base.connectionDetails,
          transports: ["tcp"],
        },
      });
      assert.equal(wrongTransport.status, "FAIL");
      assert.ok(wrongTransport.reasons.some((reason) => reason.includes("edge_transport")));

      const failedCost = evaluateCanaryReadiness({
        ...base,
        costGate: fixtureCostGate("FAIL"),
      });
      assert.equal(failedCost.status, "FAIL");
      assert.ok(failedCost.reasons.some((reason) => reason.includes("cost_gate")));
    });

    it("eval: telephony patch request only changes the provider", () => {
      assert.deepEqual(buildAgentTelephonyPatchRequest("trunk"), {
        agent_config: { telephony_provider: "trunk" },
      });
      const agentRequest = serializeTrunkCreateRequest({
        name: "Fixture trunk",
        gateways: [{ host: "sip.example.com" }],
        ipAcls: ["198.51.100.0/28"],
      });
      assert.equal(agentRequest.transport, "udp");
    });
  });

  describe("typed SIP trunk client", () => {
    it("eval: trunk client uses /trunk endpoints and redacts carrier password from errors", async () => {
      const harness = await startServer((request) => {
        if (request.method === "GET" && request.url === "/trunk/trunks") {
          return { status: 200, body: { trunks: [rawTrunk()] } };
        }
        if (request.method === "GET" && request.url === `/trunk/trunks/${TRUNK_ID}`) {
          return { status: 200, body: rawTrunk() };
        }
        if (request.method === "POST" && request.url === "/trunk/trunks") {
          if (request.body.includes(CARRIER_PASSWORD)) {
            return {
              status: 400,
              body: { message: `bad carrier password ${CARRIER_PASSWORD}` },
            };
          }
          return { status: 200, body: rawTrunk() };
        }
        if (request.method === "GET" && request.url === "/trunk/pop") {
          return {
            status: 200,
            body: {
              sip_domain: "trunk.bolna.ai",
              ips: ["15.252.21.46"],
              port: 5060,
              transports: ["udp", "tcp"],
              rtp_ports: "30000-40000",
            },
          };
        }
        if (
          request.method === "GET" &&
          request.url === `/trunk/trunks/${TRUNK_ID}/calls?direction=failed&limit=10`
        ) {
          return { status: 200, body: { calls: [] } };
        }
        if (request.method === "POST" && request.url === `/trunk/trunks/${TRUNK_ID}/numbers`) {
          return {
            status: 200,
            body: (rawTrunk().numbers as Record<string, unknown>[])[0],
          };
        }
        if (request.method === "PATCH" && request.url === `/trunk/numbers/${NUMBER_ID}`) {
          return { status: 200, body: (rawTrunk().numbers as Record<string, unknown>[])[0] };
        }
        if (request.method === "PATCH" && request.url === `/v2/agent/${AGENT_ID}`) {
          return { status: 200, body: { message: "success", state: "updated" } };
        }
        return { status: 404, body: { message: "unexpected path" } };
      });
      const client = testClient(harness.baseUrl);

      assert.equal((await client.listTrunks()).trunks.length, 1);
      assert.equal((await client.getTrunk(TRUNK_ID)).id, TRUNK_ID);
      assert.equal((await client.getTrunkConnectionDetails()).port, 5060);
      assert.deepEqual(
        (await client.listTrunkCalls(TRUNK_ID, { direction: "failed", limit: 10 })).calls,
        [],
      );
      assert.equal(
        (await client.addTrunkNumber(TRUNK_ID, {
          e164: FROM_PHONE,
          destinationKey: "919876543210",
          agentId: AGENT_ID,
        })).e164,
        FROM_PHONE,
      );
      assert.equal((await client.assignTrunkAgent(NUMBER_ID, AGENT_ID)).id, NUMBER_ID);
      assert.deepEqual(await client.patchAgentTelephonyProvider(AGENT_ID, "trunk"), {
        message: "success",
        state: "updated",
      });

      await assert.rejects(
        () =>
          client.createTrunk({
            name: "Fixture trunk",
            authUsername: "bolna-outbound",
            authPassword: CARRIER_PASSWORD,
            gateways: [{ host: "sip.example.com" }],
            ipAcls: ["198.51.100.0/28"],
          }),
        (error: unknown) => {
          assert.ok(error instanceof BolnaHttpError);
          assert.equal(error.message.includes(CARRIER_PASSWORD), false);
          return true;
        },
      );

      const paths = harness.requests.map((request) => request.url);
      assert.ok(paths.includes("/trunk/trunks"));
      assert.ok(paths.includes("/trunk/pop"));
      assert.ok(paths.includes(`/trunk/trunks/${TRUNK_ID}/numbers`));
      assert.ok(paths.includes(`/v2/agent/${AGENT_ID}`));
      assert.ok(
        harness.requests.every((request) => request.authorization === `Bearer ${API_KEY}`),
      );
    });
  });
});
