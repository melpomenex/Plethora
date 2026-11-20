/**
 * Bounded tutoring context (design D24, task 7.2).
 *
 * Approach (deterministic, NO extra model call):
 *
 * The tutor prompt never carries the full transcript. It carries
 *   1. the last `TUTOR_CONTEXT_MAX_TURNS` (6) turns VERBATIM (each entry
 *      individually length-capped so one pasted wall of text cannot blow the
 *      budget), and
 *   2. a running "distilled summary" of the OLDER turns: the topic plus the
 *      top key terms by frequency (stopword-filtered). Frequency over the
 *      older window is a cheap, stable signal of what the conversation is
 *      actually about; the summary has hard caps (max terms, max chars) so it
 *      cannot grow with session length.
 *
 * Budgets are enforced in characters (~4 chars/token, consistent with
 * `chunkTextByTokens` estimation): turns are dropped from the oldest end
 * (they fold into the summary) until the recent window fits. The very last
 * entry is always kept — the model must respond to it.
 *
 * The same key-term extraction powers retrieval-drift detection: when the
 * dominant term of the learner's latest answer is absent from the retrieval
 * query's signature, the topic has drifted and the session may refresh its
 * retrieved prerequisite context (bounded to ≤ 2 refreshes per session).
 */

/** Recent turns kept verbatim in the prompt. */
export const TUTOR_CONTEXT_MAX_TURNS = 6;
/** Per-turn character cap (validator caps model content at 4000 chars). */
export const TUTOR_TURN_MAX_CHARS = 1_200;
/** Total character budget for the verbatim recent window. */
export const TUTOR_CONTEXT_CHAR_BUDGET = 6_000;
/** Maximum key terms kept in the distilled summary. */
export const TUTOR_SUMMARY_MAX_TERMS = 8;
/** Hard cap on the distilled summary length. */
export const TUTOR_SUMMARY_MAX_CHARS = 400;
/** Character cap for the selected material in the prompt. */
export const TUTOR_MATERIAL_MAX_CHARS = 4_000;
/** Character cap per retrieved chunk (chunker targets 700–900 chars). */
export const TUTOR_CHUNK_MAX_CHARS = 900;
/** Retrieval width for tutor prerequisite grounding (k≈3 per design D24). */
export const TUTOR_RETRIEVAL_K = 3;
/** Maximum retrieval refreshes per session (topic-drift re-query). */
export const TUTOR_MAX_RETRIEVAL_REFRESHES = 2;
/** Default maximum tutor turns before a forced wrap-up. */
export const TUTOR_MAX_SESSION_TURNS = 24;

export interface TutorContextEntry {
  role: "user" | "tutor";
  text: string;
}

/**
 * English-function-word stoplist for the key-term heuristic. Non-English
 * text still works — terms are simply less aggressively filtered. Kept small
 * and deterministic; this is a frequency heuristic, not NLP.
 */
const STOPWORDS = new Set([
  "about", "actually", "after", "again", "already", "always", "answer", "because", "been", "being", "below",
  "between", "both", "came", "come", "could", "does", "doing", "done",
  "down", "each", "even", "every", "from", "give", "given", "goes", "going",
  "gone", "guess", "have", "having", "here", "hint", "into", "just", "know",
  "like", "made", "make", "many", "maybe", "more", "most", "much", "must", "need",
  "next", "only", "other", "over", "please", "really", "same", "should", "some",
  "such", "sure", "take", "taken", "that", "them", "then", "there", "these",
  "they", "think", "this", "those", "through", "under", "until", "very", "want",
  "well", "were", "what", "when", "where", "which", "while", "will", "with",
  "without", "work", "would", "your", "yours",
]);

/** Truncate to `maxChars`, marking the cut with an ellipsis. */
export function capText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Top key terms by frequency (ties: first-seen order). Tokens are
 * unicode letter/number runs, lowercased; stopwords and tokens shorter than
 * 4 characters are dropped (which also means short CJK answers yield no
 * terms — drift detection then simply never fires, which is safe).
 */
export function extractKeyTerms(text: string, limit: number): string[] {
  const counts = new Map<string, { count: number; firstSeen: number }>();
  let seen = 0;
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (token.length < 4 || STOPWORDS.has(token)) continue;
    const existing = counts.get(token);
    if (existing) existing.count += 1;
    else counts.set(token, { count: 1, firstSeen: seen++ });
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].firstSeen - b[1].firstSeen)
    .slice(0, limit)
    .map(([term]) => term);
}

/** Key-term signature of a topic/query — the drift baseline. */
export function topicSignature(topic: string): Set<string> {
  return new Set(extractKeyTerms(topic, 12));
}

/**
 * Deterministic summary of the turns that fell outside the verbatim window:
 * `Topic: …` plus the top key terms across those turns, hard-capped.
 */
export function distillSummary(topic: string, olderTurns: TutorContextEntry[]): string {
  const head = `Topic: ${topic}`;
  if (olderTurns.length === 0) return capText(head, TUTOR_SUMMARY_MAX_CHARS);
  const terms = extractKeyTerms(olderTurns.map((t) => t.text).join(" "), TUTOR_SUMMARY_MAX_TERMS);
  if (terms.length === 0) return capText(head, TUTOR_SUMMARY_MAX_CHARS);
  return capText(`${head}. Key terms so far: ${terms.join(", ")}.`, TUTOR_SUMMARY_MAX_CHARS);
}

export interface TutorBuiltContext {
  /** Verbatim recent turns (oldest first), bounded and capped. */
  recentTurns: TutorContextEntry[];
  /** Distilled summary of every turn older than `recentTurns`. */
  summary: string;
}

/**
 * Build the bounded tutoring context: last 6 turns verbatim (per-turn cap +
 * shared char budget; oldest dropped first and folded into the summary), and
 * a capped distilled summary of everything older. At least the final entry
 * is always kept verbatim.
 */
export function buildTutorContext(
  conversation: readonly TutorContextEntry[],
  topic: string
): TutorBuiltContext {
  const split = Math.max(0, conversation.length - TUTOR_CONTEXT_MAX_TURNS);
  let older = conversation.slice(0, split).map(capEntry);
  let recent = conversation.slice(split).map(capEntry);

  while (recent.length > 1 && totalChars(recent) > TUTOR_CONTEXT_CHAR_BUDGET) {
    older.push(recent.shift()!);
  }
  // A single huge entry still cannot exceed the per-turn cap (already applied).
  return { recentTurns: recent, summary: distillSummary(topic, older) };
}

function capEntry(entry: TutorContextEntry): TutorContextEntry {
  return { role: entry.role, text: capText(entry.text, TUTOR_TURN_MAX_CHARS) };
}

function totalChars(entries: TutorContextEntry[]): number {
  return entries.reduce((sum, e) => sum + e.text.length, 0);
}

/**
 * Topic-drift detection: returns the dominant key term of `answer` when it is
 * NOT part of the retrieval signature (the conversation has moved onto a new
 * concept), else `null`. The caller refreshes retrieval with `topic + term`.
 */
export function detectTopicDrift(
  signature: ReadonlySet<string>,
  answer: string
): string | null {
  const dominant = extractKeyTerms(answer, 1)[0];
  if (!dominant) return null;
  return signature.has(dominant) ? null : dominant;
}

/** First sentence of the material, capped — the session's display topic. */
export function deriveTopicFromMaterial(material: string): string {
  const collapsed = material.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Selected material";
  const firstSentence = collapsed.split(/(?<=[.!?。！？])\s+/)[0] ?? collapsed;
  return capText(firstSentence || collapsed, 80);
}

/**
 * Streaming preview helper: extract the (possibly partial) `content` string
 * from a streamed strict-JSON tutor-turn response. Returns "" when nothing
 * decodable has arrived yet (the UI shows its generic thinking label).
 */
export function extractStreamingTutorContent(streamText: string): string {
  return extractStreamingJsonStringField(streamText, "content", { emptyOnIncompleteEscape: true });
}

/**
 * Safely exposes a partial top-level JSON string field. It skips complete
 * sibling values, so an unknown nested `answer` field cannot become a preview.
 * Incomplete JSON escapes stay buffered until the next chunk completes them.
 */
export function extractStreamingJsonStringField(
  streamText: string,
  fieldName: string,
  options: { emptyOnIncompleteEscape?: boolean } = {},
): string {
  let source = streamText.trimStart();
  if (source.startsWith("```")) {
    const newline = source.indexOf("\n");
    if (newline < 0 || !/^```(?:json)?\s*$/i.test(source.slice(0, newline).trim())) return "";
    source = source.slice(newline + 1).trimStart();
  }
  if (!source.startsWith("{")) return "";

  const readString = (start: number): { end: number; raw: string } | undefined => {
    if (source[start] !== '"') return undefined;
    for (let index = start + 1; index < source.length; index += 1) {
      if (source[index] === "\\") index += 1;
      else if (source[index] === '"') return { end: index + 1, raw: source.slice(start, index + 1) };
    }
    return undefined;
  };
  const skipSpace = (index: number) => {
    while (/\s/.test(source[index] ?? "")) index += 1;
    return index;
  };

  let index = 1;
  while (index < source.length) {
    index = skipSpace(index);
    if (source[index] === ",") { index += 1; continue; }
    if (source[index] === "}" || index >= source.length) return "";

    const key = readString(index);
    if (!key) return "";
    let decodedKey: unknown;
    try { decodedKey = JSON.parse(key.raw); } catch { return ""; }
    index = skipSpace(key.end);
    if (source[index] !== ":") return "";
    index = skipSpace(index + 1);

    if (decodedKey === fieldName) {
      if (source[index] !== '"') return "";
      const start = index + 1;
      let end = start;
      for (; end < source.length; end += 1) {
        if (source[end] === "\\") end += 1;
        else if (source[end] === '"') break;
      }
      const raw = source.slice(start, Math.min(end, source.length));
      if (options.emptyOnIncompleteEscape && hasIncompleteJsonEscape(raw)) return "";
      return decodeJsonStringPrefix(raw);
    }

    // Skip the sibling value while honoring quoted separators and nested
    // containers. No value other than the requested top-level string is read.
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{" || char === "[") depth += 1;
      else if (char === "}" || char === "]") {
        if (depth === 0) return "";
        depth -= 1;
      } else if (char === "," && depth === 0) break;
    }
    if (index >= source.length) return "";
  }
  return "";
}

function hasIncompleteJsonEscape(raw: string): boolean {
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "\\") continue;
    const escaped = raw[index + 1];
    if (escaped == null) return true;
    if (escaped === "u" && !/^[0-9a-f]{4}$/i.test(raw.slice(index + 2, index + 6))) return true;
    index += escaped === "u" ? 5 : 1;
  }
  return false;
}

function decodeJsonStringPrefix(raw: string): string {
  let output = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== "\\") {
      if (char.charCodeAt(0) < 0x20) break;
      output += char;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped == null) break;
    const simple: Record<string, string> = {
      '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
    };
    if (escaped in simple) {
      output += simple[escaped];
      index += 1;
      continue;
    }
    if (escaped === "u") {
      const hex = raw.slice(index + 2, index + 6);
      if (hex.length < 4 || !/^[0-9a-f]{4}$/i.test(hex)) break;
      output += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    break;
  }
  return output;
}
