import { config } from "./config.ts";
import { WhisperSttEngine, PcmChunker, TranscriptStore } from "./stt/index.ts";
import {
  AudioStream,
  type RemoteParticipant,
  type RemoteTrack,
  RemoteAudioTrack,
  type RemoteTrackPublication,
  RoomEvent,
  type Room,
} from "@livekit/rtc-node";

export function createAgent(room?: Room) {
  const stt = new WhisperSttEngine({
    apiKey: config.sttOpenAiApiKey,
    model: config.sttModel,
  });

  const chunker = new PcmChunker({
    sampleRate: 16000,
    channels: 1,
    chunkMs: 2500,
  });

  const transcript = new TranscriptStore();
  const activeTrackReaders = new Map<string, ReadableStreamDefaultReader<any>>();

  console.log("Voice Sales Agent initialized with STT");

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
      }
    })();
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
    return;
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