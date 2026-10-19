import { planVideoContext, type VideoContextPlan, type VideoSegment } from "./videoContextPlanner";
import { synthesizeWholeVideo } from "./videoMapReduce";

/** Canonical timestamped text remains usable while the index is still warming. */
export function parseTranscriptSegments(text: string): VideoSegment[] {
  const segments: VideoSegment[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*\[(?:(\d+):)?(\d+):([0-5]\d)\]\s*(.+)$/);
    if (!match) continue;
    segments.push({ start: Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), duration: 5, text: match[4] });
  }
  for (let i = 0; i < segments.length - 1; i++) segments[i].duration = Math.max(0, segments[i + 1].start - segments[i].start);
  return segments;
}
export async function resolveVideoSourceContext(input: {
  videoId: string; content?: string; segments?: readonly VideoSegment[]; query: string;
  sourceBudgetTokens: number; currentTime?: number; selection?: string; cacheNamespace?: string;
  requireCompleteCoverage?: boolean;
  retrieveChunks?: () => Promise<ReadonlyArray<{ text: string; start: number; end: number; score: number }>>;
  summarize: (text: string, maxOutputTokens: number) => Promise<string>;
}): Promise<VideoContextPlan> {
  const segments = input.segments ?? parseTranscriptSegments(input.content ?? "");
  let plan = planVideoContext({ ...input, segments });
  if (plan.mode === "retrieval" && input.retrieveChunks) {
    try { plan = planVideoContext({ ...input, segments, semanticChunks: await input.retrieveChunks() }); }
    catch { /* The in-memory lexical index remains usable while indexing is pending. */ }
  }
  if (plan.mode !== "map-reduce") return plan;
  try {
    const content = await synthesizeWholeVideo({ ...input, segments });
    return { ...plan, content, coverage: "hierarchical-full" };
  } catch {
    // Hierarchical synthesis failed (e.g. a summarizer error or the summaries
    // cannot fit): fall back to a bounded retrieval plan so the turn can still
    // answer with honest bounded coverage instead of failing outright.
    plan = planVideoContext({ ...input, segments, allowMapReduce: false });
    if (plan.mode === "retrieval" && input.retrieveChunks) {
      try { plan = planVideoContext({ ...input, segments, semanticChunks: await input.retrieveChunks(), allowMapReduce: false }); }
      catch { /* Lexical windows remain usable without semantic bonus. */ }
    }
    return plan;
  }
}
