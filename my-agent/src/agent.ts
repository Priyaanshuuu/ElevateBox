import { config } from "./config.ts";
import { WhisperSttEngine, PcmChunker, TranscriptStore } from "./stt/index.ts";
import { voice } from "@livekit/agents";
import {
  AudioStream,
  type AudioFrame,
  type RemoteParticipant,
  type RemoteTrack,
  RemoteAudioTrack,
  type RemoteTrackPublication,
  RoomEvent,
  type Room,
} from "@livekit/rtc-node";
import { buildSalesSystemPrompt } from "./prompts/sales.ts";
import { createConversationState, updateConversationState } from "./conversation/state.ts";
import { formatRagContext, PgVectorRag } from "./rag/index.ts";
import { classifyLeadIntent } from "./intent/classifier.ts";
import { getOrCreateLeadForIdentity, persistLeadIntent } from "./intent/persistence.ts";
import { LeadIntent } from "../../platform/generated/prisma/enums.ts";
import {
  completeCall,
  createCall,
  startCall,
} from "../../platform/lib/services/call.service.ts";
import { HotLeadWhatsAppTool } from "./automation/whatsapp.ts";

export function createAgent(room?: Room): voice.Agent {
  const stt = new WhisperSttEngine({
    apiKey: config.sttApiKey,
    model: config.sttModel,
    endpoint: config.sttEndpoint,
  });

  const chunker = new PcmChunker({
    sampleRate: 16000,
    channels: 1,
    chunkMs: 2500,
  });

  const transcript = new TranscriptStore();
  const activeTrackReaders = new Map<string, ReadableStreamDefaultReader<AudioFrame>>();
  const conversationState = createConversationState();
  const rag =
    config.ragEnabled && config.databaseUrl && config.embeddingApiKey
      ? new PgVectorRag({
          databaseUrl: config.databaseUrl,
          embeddingApiKey: config.embeddingApiKey,
          embeddingEndpoint: config.embeddingEndpoint,
          embeddingModel: config.embeddingModel,
        })
      : null;

  const salesAgent = new voice.Agent({
    instructions: buildSalesSystemPrompt(conversationState),
    llm: config.llmModel,
    tts: config.ttsModel,
    // STT is handled by the existing custom STT pipeline in this file.
    stt: null,
    vad: null,
  });

  const session = new voice.AgentSession({
    turnHandling: {
      turnDetection: "manual",
    },
  });

  let sessionStarted = false;
  let lastHandledTranscript = "";
  let activeLeadId: string | null = null;
  let activeLeadPhone: string | null = null;
  let activeCallId: string | null = null;
  let lastPersistedIntent: LeadIntent = LeadIntent.UNKNOWN;
  let hotWhatsAppTriggered = false;

  const whatsappTool = new HotLeadWhatsAppTool({
    provider: config.whatsappProvider,
    ...(config.whatsappTwilioAccountSid ? { twilioAccountSid: config.whatsappTwilioAccountSid } : {}),
    ...(config.whatsappTwilioAuthToken ? { twilioAuthToken: config.whatsappTwilioAuthToken } : {}),
    ...(config.whatsappTwilioFrom ? { twilioWhatsAppFrom: config.whatsappTwilioFrom } : {}),
  });

  console.log("Voice Sales Agent initialized with STT");

  async function ensureSessionStarted(currentRoom: Room): Promise<void> {
    if (sessionStarted) {
      return;
    }

    await session.start({
      agent: salesAgent,
      room: currentRoom,
    });

    sessionStarted = true;
    console.log("Sales LLM + TTS session started.");
  }

  async function handleUserTranscript(text: string): Promise<void> {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    if (normalized.toLowerCase() === lastHandledTranscript.toLowerCase()) {
      return;
    }

    lastHandledTranscript = normalized;

    const nextState = updateConversationState(conversationState, normalized);
    Object.assign(conversationState, nextState);

    const nextIntent = classifyLeadIntent(conversationState);
    if (nextIntent !== lastPersistedIntent) {
      lastPersistedIntent = nextIntent;
      console.log("Lead intent updated:", nextIntent);
      if (activeLeadId) {
        try {
          await persistLeadIntent(activeLeadId, nextIntent);
        } catch (error) {
          console.error("Lead intent persistence error:", error);
        }
      }

      if (
        nextIntent === LeadIntent.HOT &&
        !hotWhatsAppTriggered &&
        activeLeadId &&
        activeLeadPhone
      ) {
        hotWhatsAppTriggered = true;
        const contextText = buildCurrentCallContext(transcript.fullText(), normalized);
        void triggerHotLeadWhatsApp({
          leadId: activeLeadId,
          ...(activeCallId ? { callId: activeCallId } : {}),
          toPhoneNumber: activeLeadPhone,
          contextText,
        });
      }
    }

    let ragContext = "";
    if (rag) {
      try {
        const chunks = await rag.retrieve(normalized, config.ragTopK);
        ragContext = formatRagContext(chunks);
      } catch (error) {
        console.error("RAG retrieval error:", error);
      }
    }

    const instructions = ragContext
      ? `${buildSalesSystemPrompt(conversationState)}\n\nUse the following factual reference context when relevant:\n${ragContext}`
      : buildSalesSystemPrompt(conversationState);

    await salesAgent.updateInstructions(instructions);

    session.generateReply({
      userInput: normalized,
      inputModality: "audio",
    });
  }

  async function onIncomingPcm16Frame(frame: Int16Array) {
    const chunks = chunker.pushPcm16(frame);
    for (const pcmChunk of chunks) {
      const wavBytes = pcm16ToWavBytes(pcmChunk, 16000, 1);
      const segment = await stt.transcribeWav({
        wavBytes,
        language: config.sttLanguage as "auto" | "en" | "hi" | "te",
      });
      transcript.add(segment);
      console.log("STT:", segment.text);
      await handleUserTranscript(segment.text);
    }
  }

  function trackKey(participant: RemoteParticipant, publication: RemoteTrackPublication): string {
    return `${participant.identity}:${publication.sid ?? "unknown"}`;
  }

  function stopTrack(key: string): void {
    const reader = activeTrackReaders.get(key);
    if (!reader) {
      return;
    }

    activeTrackReaders.delete(key);
    void reader.cancel();
  }

  function startTrack(
    participant: RemoteParticipant,
    publication: RemoteTrackPublication,
    track: RemoteAudioTrack,
  ): void {
    const key = trackKey(participant, publication);
    if (activeTrackReaders.has(key)) {
      return;
    }

    const stream = new AudioStream(track, 16000, 1);
    const reader = stream.getReader();
    activeTrackReaders.set(key, reader);

    console.log(`STT subscribed to audio: ${participant.identity} (${publication.sid ?? "no-sid"})`);

    void (async () => {
      try {
        if (!activeLeadId) {
          try {
            const lead = await getOrCreateLeadForIdentity(participant.identity);
            if (lead) {
              activeLeadId = lead.id;
              activeLeadPhone = lead.phoneNumber;
              console.log(`Lead resolved for intent tracking: ${lead.phoneNumber}`);
              if (lastPersistedIntent !== LeadIntent.UNKNOWN) {
                await persistLeadIntent(activeLeadId, lastPersistedIntent);
              }

              if (!activeCallId) {
                const call = await createCall(activeLeadId);
                activeCallId = call.id;
                await startCall(activeCallId);
                console.log(`Call tracking started: ${activeCallId}`);
              }
            }
          } catch (error) {
            console.error("Lead resolution error:", error);
          }
        }

        if (room) {
          await ensureSessionStarted(room);
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          await onIncomingPcm16Frame(value.data);
        }
      } catch (error) {
        console.error("STT audio stream error:", error);
      } finally {
        activeTrackReaders.delete(key);
        void reader.cancel();

        if (activeCallId) {
          try {
            await completeCall(activeCallId, transcript.fullText());
          } catch (error) {
            console.error("Call completion error:", error);
          }
        }
      }
    })();
  }

  async function triggerHotLeadWhatsApp(input: {
    leadId: string;
    callId?: string;
    toPhoneNumber: string;
    contextText: string;
  }): Promise<void> {
    try {
      const result = await whatsappTool.trigger({
        ...input,
        resumeTextOrUrl: config.myResumeTextOrUrl,
        myPhoneNumber: config.myPhoneNumber,
      });
      if (result === "skipped-duplicate") {
        console.log("WhatsApp automation skipped (duplicate event).");
      } else {
        console.log("WhatsApp automation triggered for HOT lead.");
      }
    } catch (error) {
      console.error("WhatsApp automation error:", error);
    }
  }

  function handleTrackSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void {
    if (!(track instanceof RemoteAudioTrack)) {
      return;
    }

    startTrack(participant, publication, track);
  }

  function handleTrackUnsubscribed(
    _track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void {
    stopTrack(trackKey(participant, publication));
  }

  if (!room) {
    console.log("STT pipeline is ready. Pass a LiveKit room to createAgent(room) to stream caller audio.");
    return salesAgent;
  }

  room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
  room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (!(publication.track instanceof RemoteAudioTrack)) {
        continue;
      }

      startTrack(participant, publication, publication.track);
    }
  }

  console.log("LiveKit audio track wiring enabled for STT.");
  return salesAgent;
}

function pcm16ToWavBytes(samples: Int16Array, sampleRate: number, channels: number): Uint8Array {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits/sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (sample === undefined) {
      continue;
    }
    view.setInt16(offset, sample, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function buildCurrentCallContext(fullTranscript: string, latestUtterance: string): string {
  const merged = [fullTranscript, latestUtterance].filter(Boolean).join(" ").trim();
  if (!merged) {
    return "No transcript context available yet.";
  }
  if (merged.length <= 900) {
    return merged;
  }
  return merged.slice(merged.length - 900);
}