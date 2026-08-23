import type { SttSegment } from "./types.ts";

export class TranscriptStore {
private readonly segments: SttSegment[] = [];

add(segment: SttSegment): void {
if (!segment.text) return;
this.segments.push(segment);
}

all(): SttSegment[] {
return [...this.segments];
}

fullText(): string {
return this.segments.map((s) => s.text).join(" ").trim();
}
}