import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { BolnaError, createBolnaClient } from "../lib/bolna/index.ts";

loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true, quiet: true });

const runLive = process.env.BOLNA_RUN_TRUNK_CHECK === "1";

if (!runLive) {
  console.log(
    "SKIP: set BOLNA_RUN_TRUNK_CHECK=1 and BOLNA_EVAL_GATE=PASS for read-only SIP trunk checks.",
  );
  process.exit(0);
}

if (process.env.BOLNA_EVAL_GATE !== "PASS") {
  console.error("FAIL: BOLNA_EVAL_GATE=PASS is required for live read-only trunk checks.");
  process.exit(1);
}

function maskPhone(value: string): string {
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

try {
  const client = createBolnaClient();
  const [connectionDetails, trunkList] = await Promise.all([
    client.getTrunkConnectionDetails(),
    client.listTrunks(),
  ]);
  const requestedTrunkId = process.env.BOLNA_TRUNK_ID?.trim() || undefined;
  const trunk = requestedTrunkId
    ? await client.getTrunk(requestedTrunkId)
    : trunkList.trunks[0];

  if (trunk) {
    await client.listTrunkCalls(trunk.id, { direction: "failed", limit: 10 });
  }

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        note: "read-only SIP trunk check — no call was placed",
        connectionDetails: {
          sipDomain: connectionDetails.sipDomain,
          ips: connectionDetails.ips,
          port: connectionDetails.port,
          transports: connectionDetails.transports,
          rtpPorts: connectionDetails.rtpPorts,
        },
        trunkCount: trunkList.trunks.length,
        trunk: trunk
          ? {
              id: trunk.id,
              name: trunk.name,
              health: trunk.health,
              activeCalls: trunk.activeCalls,
              channels: trunk.channels,
              transport: trunk.transport,
              codecs: trunk.codecs,
              gateways: trunk.gateways.length,
              carrierIps: trunk.ipAcls.length,
              numbers: trunk.numbers.map((number) => ({
                id: number.id,
                e164: maskPhone(number.e164),
                hasAgent: Boolean(number.agentId ?? trunk.defaultInboundAgentId),
              })),
            }
          : null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof BolnaError || error instanceof Error ? error.message : String(error);
  console.error(`FAIL: read-only SIP trunk check — ${message}`);
  process.exit(1);
}
