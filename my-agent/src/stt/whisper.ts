import type { SttEngine, SttSegment, SttTranscribeInput } from "./types.ts";

export interface WhisperSttConfig {
apiKey: string;
model: string; // ex: whisper-1
endpoint?: string; // default OpenAI endpoint
}

export class WhisperSttEngine implements SttEngine {
	private readonly apiKey: string;
	private readonly model: string;
	private readonly endpoint: string;

	constructor(config: WhisperSttConfig) {
		this.apiKey = config.apiKey;
		this.model = config.model;
		this.endpoint = config.endpoint ?? "https://api.openai.com/v1/audio/transcriptions";
	}

	async transcribeWav(input: SttTranscribeInput): Promise<SttSegment> {
		const start = Date.now();

		// Copy into a fresh Uint8Array so the backing buffer is a plain ArrayBuffer.
		const safeBytes = new Uint8Array(input.wavBytes.byteLength);
		safeBytes.set(input.wavBytes);

		const form = new FormData();
		form.append(
			"file",
			new Blob([safeBytes.buffer], { type: input.mimeType ?? "audio/wav" }),
			"chunk.wav",
		);
		form.append("model", this.model);

		if (input.language && input.language !== "auto") {
			form.append("language", input.language);
		}
		if (input.prompt) {
			form.append("prompt", input.prompt);
		}

		const res = await fetch(this.endpoint, {
			method: "POST",
			headers: {
				Authorization: "Bearer " + this.apiKey,
			},
			body: form,
		});

		if (!res.ok) {
			const body = await res.text();
			throw new Error("STT request failed: " + res.status + " " + body);
		}

		const json = (await res.json()) as { text?: string; language?: string };
		const end = Date.now();

		return {
			text: (json.text ?? "").trim(),
			...(json.language !== undefined ? { language: json.language } : {}),
			isFinal: true,
			startedAtMs: start,
			endedAtMs: end,
		};
	}
}