/**
 * Privacy-safe stage instrumentation (design D8, task 6.5).
 *
 * Records *only* durations, counts, platform/provider capability and
 * anonymous error codes. Questions, quotes, document text, paths, keys and
 * raw model output must never enter a span — enforced structurally: the
 * recorder accepts no free-text parameters at all.
 */

export type TurnStage =
  | "invoke_to_interactive"
  | "submit_to_context"
  | "retrieval"
  | "source_preparation"
  | "provider_first_event"
  | "provider_first_visible_text"
  | "generation"
  | "citation_validation"
  | "persistence_ack"
  | "citation_open"
  | "citation_return";

export type AnonymousErrorCode =
  | "provider_error"
  | "provider_timeout"
  | "validation_failure"
  | "cancelled"
  | "quota_exceeded"
  | "storage_unavailable"
  | "source_unavailable"
  | "privacy_denied"
  | "unknown";

export interface StageSpan {
  stage: TurnStage;
  durationMs: number;
  /** Platform class, never a device path or user id. */
  platform: string;
  /** Provider capability class (e.g. "ondevice", "cloud", "retrieval-only"). */
  providerKind: string;
  /** Counts only (chunks, messages, dom rows...). */
  counts?: Record<string, number>;
  /** Anonymous code for failed stages. */
  errorCode?: AnonymousErrorCode;
  cold: boolean;
}

export interface SpanRecorderOptions {
  platform: string;
  now?: () => number;
  /** Sink for completed spans (tests inject a capture array). */
  sink?: (span: StageSpan) => void;
  /** Bound so instrumentation cannot grow unboundedly. */
  maxSpans?: number;
}

/**
 * A single stage span recorder. `startTurn` timestamps one turn; nested
 * stages use `begin`/`end`.
 */
export class StageRecorder {
  private spans: StageSpan[] = [];
  private now: () => number;
  private maxSpans: number;

  constructor(private options: SpanRecorderOptions) {
    this.now = options.now ?? (() => Date.now());
    this.maxSpans = options.maxSpans ?? 512;
  }

  begin(stage: TurnStage, details: { providerKind: string; cold?: boolean }): (counts?: Record<string, number>, errorCode?: AnonymousErrorCode) => StageSpan {
    const startedAt = this.now();
    return (counts, errorCode) => {
      const span: StageSpan = {
        stage,
        durationMs: Math.max(0, this.now() - startedAt),
        platform: this.options.platform,
        providerKind: details.providerKind,
        counts,
        errorCode,
        cold: details.cold ?? false,
      };
      this.record(span);
      return span;
    };
  }

  /** Record a pre-measured span (e.g. from browser performance marks). */
  record(span: StageSpan): StageSpan {
    this.spans.push(span);
    if (this.spans.length > this.maxSpans) this.spans.shift();
    this.options.sink?.(span);
    return span;
  }

  all(): readonly StageSpan[] {
    return this.spans;
  }

  /** Median/p95 for one stage, cold and warm separated. */
  summarize(stage: TurnStage): { count: number; median: number; p95: number; coldCount: number } {
    const warm = this.spans
      .filter((span) => span.stage === stage && !span.cold)
      .map((span) => span.durationMs)
      .sort((a, b) => a - b);
    const coldCount = this.spans.filter((span) => span.stage === stage && span.cold).length;
    if (!warm.length) return { count: 0, median: 0, p95: 0, coldCount };
    return {
      count: warm.length,
      median: warm[Math.floor(warm.length / 2)],
      p95: warm[Math.min(warm.length - 1, Math.ceil(warm.length * 0.95) - 1)],
      coldCount,
    };
  }
}

/** Global default recorder; platforms replace it with their own class. */
let defaultRecorder: StageRecorder | null = null;

export function defaultStageRecorder(platform: string): StageRecorder {
  if (!defaultRecorder) defaultRecorder = new StageRecorder({ platform });
  return defaultRecorder;
}

/**
 * The stable, privacy-safe span shape (documented for review): adding a field
 * here is the only way to log something new, and free text is not permitted.
 */
export const SPAN_FIELDS = [
  "stage",
  "durationMs",
  "platform",
  "providerKind",
  "counts",
  "errorCode",
  "cold",
] as const;
