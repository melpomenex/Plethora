import type { YouTubeTranscriptSegment } from "../../transcript/sourceChain";
import type { ConversationHistoryTurn } from "./promptBuilder";

export type VideoSegment = Pick<YouTubeTranscriptSegment, "start" | "duration" | "text">;
/**
 * Transcript acquisition status, tracked separately from the selected
 * coverage (task 2.8). A partial transcript never becomes "full" merely
 * because the text that *is* available happens to fit the budget.
 */
export type TranscriptAcquisition =
  | "loading"
  | "ready-full"
  | "ready-indexed"
  | "partial"
  | "unavailable"
  | "failed";

export interface VideoContextInput {
  segments: readonly VideoSegment[];
  query: string;
  sourceBudgetTokens: number;
  currentTime?: number;
  duration?: number;
  selection?: string;
  conversationHistory?: readonly ConversationHistoryTurn[];
  semanticChunks?: readonly { text: string; start: number; end: number; score: number }[];
  /** Acquisition status; defaults to `ready-full` for legacy callers. */
  acquisition?: TranscriptAcquisition;
  /** Whether a failed/partial acquisition may be retried. */
  retryable?: boolean;
  /** Where the available transcript actually ends, when partial. */
  coveredUntilSeconds?: number;
}
export interface VideoContextPlan {
  mode: "full" | "timestamp" | "playback" | "retrieval" | "map-reduce" | "unavailable";
  coverage: "full" | "window" | "chunks" | "hierarchical-full" | "none";
  content: string;
  chunkCount: number;
  timeRangeCovered?: { startSeconds: number; endSeconds: number };
  /** Echoed acquisition status for honest disclosure downstream. */
  acquisitionStatus: TranscriptAcquisition;
  /** True only when the plan covers the *complete* transcript. */
  fullTranscript: boolean;
  /** Honest limitations ("transcript is partial up to 04:12"). */
  limitations: string[];
  /** A retry is offered when acquisition failed or was partial. */
  retryable: boolean;
}

function finalize(
  plan: Omit<VideoContextPlan, "acquisitionStatus" | "fullTranscript" | "limitations" | "retryable"> & {
    limitations?: string[];
  },
  input: VideoContextInput,
): VideoContextPlan {
  const acquisition = input.acquisition ?? "ready-full";
  const limitations = [...(plan.limitations ?? [])];
  let fullTranscript = plan.coverage === "full" && (acquisition === "ready-full" || acquisition === "ready-indexed");
  if (acquisition === "partial" || acquisition === "loading" || acquisition === "failed" || acquisition === "unavailable") {
    fullTranscript = false;
    const until =
      input.coveredUntilSeconds !== undefined
        ? ` (available up to ${formatVideoTimestamp(input.coveredUntilSeconds)})`
        : "";
    if (acquisition === "partial") {
      limitations.push(`The transcript is partial${until}; it may be missing later speech.`);
    } else if (acquisition === "loading") {
      limitations.push("The transcript is still loading; only the available portion is used.");
    } else if (acquisition === "failed") {
      limitations.push(`Transcript acquisition failed${until}.`);
    } else {
      limitations.push("No transcript is available for this video.");
    }
  }
  return {
    ...plan,
    acquisitionStatus: acquisition,
    fullTranscript,
    limitations,
    retryable: Boolean(input.retryable) || acquisition === "failed" || acquisition === "partial",
  };
}
export function formatVideoTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${s}` : `${String(minutes).padStart(2, "0")}:${s}`;
}
export function parseTimestampReferences(query: string): number[] {
  const times: number[] = [];
  for (const match of query.matchAll(/\b(?:(\d{1,3}):)?(\d{1,3}):([0-5]\d)\b/g)) {
    times.push(Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]));
  }
  for (const match of query.matchAll(/\b(?:(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)|(?:minute|min)\s+(\d+(?:\.\d+)?))\b/gi)) {
    times.push(Number(match[1] || match[2]) * 60);
  }
  return [...new Set(times)];
}
export function formatTranscript(segments: readonly VideoSegment[]): string {
  return segments.map((s) => `[${formatVideoTimestamp(s.start)}] ${s.text}`).join("\n");
}
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
interface TranscriptWindow { text: string; start: number; end: number; terms: Map<string, number>; length: number }
interface TranscriptIndex { windows: TranscriptWindow[]; full: string; df: Map<string, number>; averageLength: number }
const indexes = new WeakMap<readonly VideoSegment[], TranscriptIndex>();
function indexTranscript(segments: readonly VideoSegment[]): TranscriptIndex {
  const cached = indexes.get(segments);
  if (cached) return cached;
  const windows: TranscriptWindow[] = [];
  let group: VideoSegment[] = [];
  let chars = 0;
  const flush = () => {
    if (!group.length) return;
    const text = formatTranscript(group);
    const terms = new Map<string, number>();
    for (const word of words(text)) terms.set(word, (terms.get(word) ?? 0) + 1);
    windows.push({ text, start: group[0].start, end: group.at(-1)!.start + group.at(-1)!.duration, terms, length: words(text).length });
  };
  for (const segment of segments) {
    if (!segment.text.trim() || !Number.isFinite(segment.start)) continue;
    if (chars >= 900) { flush(); group = group.slice(-1); chars = group[0]?.text.length ?? 0; }
    group.push(segment); chars += segment.text.length;
  }
  flush();
  const df = new Map<string, number>();
  for (const window of windows) for (const term of window.terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const index = { windows, df, full: formatTranscript(segments), averageLength: windows.reduce((n, w) => n + w.length, 0) / Math.max(1, windows.length) };
  indexes.set(segments, index);
  return index;
}
/** Cached lexical index; playback ticks never tokenize the transcript. */
export function planVideoContext(input: VideoContextInput): VideoContextPlan {
  const index = indexTranscript(input.segments);
  if (!index.windows.length) {
    return finalize({ mode: "unavailable", coverage: "none", content: "", chunkCount: 0 }, input);
  }
  const budget = Math.max(0, input.sourceBudgetTokens) * 4;
  const range = { startSeconds: index.windows[0].start, endSeconds: index.windows.at(-1)!.end };
  if (index.full.length <= budget) {
    return finalize(
      { mode: "full", coverage: "full", content: index.full, chunkCount: index.windows.length, timeRangeCovered: range },
      input,
    );
  }
  const references = parseTimestampReferences(input.query);
  const playback = input.currentTime != null && /\b(just (?:say|said)|this part|this passage|right now|speaker.*here|mean.*that|currently|playing)\b/i.test(input.query);
  if (!references.length && !playback && /\b(summar(?:y|ize)|main arguments|key takeaways|whole video|full outline|entire video|overview)\b/i.test(input.query)) {
    return finalize(
      { mode: "map-reduce", coverage: "none", content: "", chunkCount: index.windows.length, timeRangeCovered: range },
      input,
    );
  }
  const terms = [...new Set(words(`${input.query} ${input.selection ?? ""}`))];
  const ranked = index.windows.map((window, ordinal) => {
    let score = 0;
    for (const term of terms) {
      const frequency = window.terms.get(term) ?? 0;
      const idf = Math.log(1 + (index.windows.length - (index.df.get(term) ?? 0) + 0.5) / ((index.df.get(term) ?? 0) + 0.5));
      score += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * window.length / index.averageLength));
    }
    for (const hit of input.semanticChunks ?? []) if (hit.start <= window.end && hit.end >= window.start) score += Math.max(0, hit.score) * 3;
    const target = references.some((t) => window.start <= t + 180 && window.end >= t - 180);
    const playing = playback && window.start <= input.currentTime! + 45 && window.end >= input.currentTime! - 90;
    if (target || playing) score += 1000 - Math.min(...(references.length ? references : [input.currentTime!]).map((t) => Math.abs(window.start - t))) / 100;
    return { window, ordinal, score };
  }).sort((a, b) => b.score - a.score);
  const chosen = new Map<number, TranscriptWindow>();
  let used = 0;
  for (const item of ranked) {
    if (item.score <= 0) continue;
    for (const ordinal of [item.ordinal, item.ordinal - 1, item.ordinal + 1]) {
      const window = index.windows[ordinal];
      if (!window || chosen.has(ordinal) || used + window.text.length + 2 > budget) continue;
      chosen.set(ordinal, window); used += window.text.length + 2;
    }
  }
  const selected = [...chosen].sort(([a], [b]) => a - b).map(([, window]) => window);
  return finalize(
    {
      mode: references.length ? "timestamp" : playback ? "playback" : "retrieval",
      coverage: selected.length ? (references.length || playback ? "window" : "chunks") : "none",
      content: selected.map((w) => w.text).join("\n\n"),
      chunkCount: selected.length,
      timeRangeCovered: selected.length
        ? { startSeconds: selected[0].start, endSeconds: selected.at(-1)!.end }
        : undefined,
    },
    input,
  );
}
