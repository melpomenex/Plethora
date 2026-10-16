import { formatTranscript, formatVideoTimestamp, type VideoSegment } from "./videoContextPlanner";
import { hashSectionContent } from "../../../utils/sectionIndex";
const cache = new Map<string, string[]>();
export interface VideoSynthesisInput {
  videoId: string;
  segments: readonly VideoSegment[];
  sourceBudgetTokens: number;
  cacheNamespace?: string;
  summarize: (text: string, maxOutputTokens: number) => Promise<string>;
}
/** Every chronological window is mapped, including the last window of long videos. */
export async function synthesizeWholeVideo(input: VideoSynthesisInput): Promise<string> {
  const text = formatTranscript(input.segments);
  const key = `${input.videoId}:window-summaries:${hashSectionContent(text)}:${input.cacheNamespace ?? "default"}:${input.sourceBudgetTokens}`;
  let summaries = cache.get(key);
  if (!summaries) {
    const windows: VideoSegment[][] = [];
    const windowChars = Math.max(400, Math.min(12000, input.sourceBudgetTokens * 3));
    let current: VideoSegment[] = []; let chars = 0;
    for (const segment of input.segments) {
      if (current.length && chars + segment.text.length > windowChars) { windows.push(current); current = []; chars = 0; }
      current.push(segment); chars += segment.text.length + 12;
    }
    if (current.length) windows.push(current);
    const results = new Array<string>(windows.length);
    let next = 0;
    const worker = async () => {
      while (next < windows.length) {
        const index = next++; const window = windows[index];
        const anchor = `[${formatVideoTimestamp(window[0].start)}]`;
        results[index] = `${anchor} ${await input.summarize(formatTranscript(window), Math.max(64, Math.min(400, Math.floor(input.sourceBudgetTokens / Math.max(1, windows.length)))) )}`;
      }
    };
    await Promise.all([worker(), worker()]);
    summaries = results;
    cache.set(key, summaries);
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
  }
  let level = summaries;
  const maxChars = Math.max(256, input.sourceBudgetTokens * 4);
  for (let depth = 0; level.join("\n\n").length > maxChars && depth < 8; depth++) {
    const groups: string[] = []; let group = "";
    for (const summary of level) {
      if (group && group.length + summary.length > maxChars) { groups.push(group); group = ""; }
      group += `${summary}\n\n`;
    }
    if (group) groups.push(group);
    const outputBudget = Math.max(32, Math.floor(input.sourceBudgetTokens / Math.max(2, groups.length)));
    level = await Promise.all(groups.map((part) => input.summarize(part, outputBudget)));
  }
  if (level.join("\n\n").length > maxChars) throw new Error("Full-video summaries could not fit the source budget. Increase the model context window.");
  return level.join("\n\n");
}
