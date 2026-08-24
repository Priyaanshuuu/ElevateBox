import { LiveKitAPI, SipCallError } from "livekit-server-sdk";
import {
  getDueScheduledCallbacks,
  markCallbackCompleted,
  markCallbackFailed,
} from "../../platform/lib/services/callback.service.ts";
import { config } from "./config.ts";

async function processDueCallbacks(): Promise<void> {
  if (!config.livekitOutboundTrunkId) {
    throw new Error("Missing LIVEKIT_OUTBOUND_TRUNK_ID. Create an outbound LiveKit SIP trunk first.");
  }

  const callbacks = await getDueScheduledCallbacks();
  for (const callback of callbacks) {
    const roomName = `callback-${callback.id}`;
    const api = new LiveKitAPI({
      host: config.livekitUrl,
      apiKey: config.livekitApiKey,
      secret: config.livekitApiSecret,
    });

    try {
      await api.agentDispatch.createDispatch(roomName, config.livekitAgentName, {
        metadata: JSON.stringify({ phone_number: callback.lead.phoneNumber }),
      });
      await api.sip.createSipParticipant(
        config.livekitOutboundTrunkId,
        callback.lead.phoneNumber,
        roomName,
        {
          participantIdentity: callback.lead.phoneNumber,
          participantName: callback.lead.name ?? "Callback customer",
          waitUntilAnswered: true,
        },
      );
      await markCallbackCompleted(callback.id);
      console.log(`Callback ${callback.id} connected to ${callback.lead.phoneNumber}.`);
    } catch (error) {
      const message = error instanceof SipCallError
        ? `SIP ${error.sipStatusCode}: ${error.sipStatus}`
        : error instanceof Error ? error.message : String(error);
      await markCallbackFailed(callback.id, `Outbound callback failed: ${message}`);
      console.error(`Callback ${callback.id} failed: ${message}`);
    }
  }
}

async function run(): Promise<void> {
  console.log(`Callback worker polling every ${config.callbackPollIntervalMs}ms.`);
  while (true) {
    try {
      await processDueCallbacks();
    } catch (error) {
      console.error("Callback worker error:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, config.callbackPollIntervalMs));
  }
}

void run();