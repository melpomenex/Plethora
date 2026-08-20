import type { AssistSpan, ReadingAssistResult } from "./types";

/** Reader-owned host: annotations are overlays and never mutate source DOM/text. */
export class ReadingAssistLayerHost {
  private result: ReadingAssistResult | null = null;

  setResult(result: ReadingAssistResult | null): void { this.result = result; }

  getResult(): ReadingAssistResult | null { return this.result; }

  spansForRange(start: number, end: number): readonly AssistSpan[] {
    if (!this.result || this.result.status !== "ready") return [];
    return this.result.spans.filter((span) => span.sourceStart < end && start < span.sourceEnd);
  }

  clear(): void { this.result = null; }
}
