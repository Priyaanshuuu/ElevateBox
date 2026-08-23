export type SttLanguage = "auto" | "en" | "hi" | "te";

export interface SttTranscribeInput {
wavBytes: Uint8Array;
mimeType?: string; // default audio/wav
language?: SttLanguage;
prompt?: string;
}

export interface SttSegment {
text: string;
language?: string;
confidence?: number;
isFinal: boolean;
startedAtMs: number;
endedAtMs: number;
}

export interface SttEngine {
transcribeWav(input: SttTranscribeInput): Promise<SttSegment>;
}