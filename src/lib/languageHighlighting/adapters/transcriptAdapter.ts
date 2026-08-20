import type { LanguageHighlightReaderAdapter } from "./types";
import { anchorConfidence, tokenizeLanguageText } from "./tokenizer";
import type { ReaderTokenAnchor, VisibleRange } from "../types";

export interface TranscriptLanguageSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

export class TranscriptLanguageHighlightAdapter implements LanguageHighlightReaderAdapter {
  readonly surface = "transcript" as const;
  private readonly anchors: ReaderTokenAnchor[];
  private readonly documentLength: number;

  constructor(readonly sourceId: string, segments: readonly TranscriptLanguageSegment[]) {
    let cursor = 0;
    const anchors: ReaderTokenAnchor[] = [];
    segments.forEach((segment) => {
      for (const token of tokenizeLanguageText(segment.text)) {
        const start = cursor + token.start;
        const end = cursor + token.end;
        anchors.push({
          id: `${sourceId}:transcript:${segment.id}:${anchors.length}`,
          sourceId,
          surface: token.text,
          range: { start, end },
          anchor: {
            kind: "transcript-segment",
            sourceId,
            segmentId: segment.id,
            startMs: segment.startMs,
            endMs: segment.endMs,
            start,
            end,
            confidence: anchorConfidence(1),
            confidenceScore: 1,
          },
        });
      }
      cursor += segment.text.length;
    });
    this.anchors = anchors;
    this.documentLength = cursor;
  }

  getTokenAnchors(): readonly ReaderTokenAnchor[] {
    return this.anchors;
  }

  getVisibleRange(): VisibleRange {
    return { start: 0, end: this.documentLength };
  }

  dispose(): void {
    // Transcript playback and seeking remain owned by the transcript host.
  }
}
