export interface ChunkerConfig {
sampleRate: number; // ex: 16000
channels: number; // ex: 1
chunkMs: number; // ex: 2500
}

export class PcmChunker {
private readonly sampleRate: number;
private readonly channels: number;
private readonly chunkSamples: number;
private readonly samples: number[] = [];

constructor(config: ChunkerConfig) {
this.sampleRate = config.sampleRate;
this.channels = config.channels;
this.chunkSamples = Math.floor((config.sampleRate * config.chunkMs) / 1000) * config.channels;
}

pushPcm16(frame: Int16Array): Int16Array[] {
for (const s of frame) this.samples.push(s);

const out: Int16Array[] = [];
while (this.samples.length >= this.chunkSamples) {
const part = this.samples.splice(0, this.chunkSamples);
out.push(Int16Array.from(part));
}
return out;
}
flush(): Int16Array | null {
if (this.samples.length === 0) return null;
const tail = Int16Array.from(this.samples);
this.samples.length = 0;
return tail;
}
}