/**
 * Split text into chunks that fit a small model's context window.
 *
 * On-device Gemini Nano has a ~1k–4k token window, versus the 100k+ we
 * implicitly assume for cloud providers. Every on-device call must be chunked
 * before invocation — the native bridge deliberately does not truncate, because
 * silent truncation hides a caller bug as a quality problem.
 *
 * Splitting is hierarchical and always terminates:
 *   paragraph boundary -> sentence boundary -> hard character cut
 *
 * The token estimate is the usual ~4 characters/token heuristic. It is an
 * estimate, not a tokenizer: budgets should leave headroom for the prompt
 * instructions the caller prepends.
 */

/** Average characters per token. Rough, and deliberately so. */
const CHARS_PER_TOKEN = 4;

/** Default budget per chunk, in estimated tokens. */
export const DEFAULT_TOKEN_BUDGET = 3000;

/**
 * Smallest budget callers may ask for. Below this, chunks get small enough that
 * a summary of the chunks is no cheaper than the original text.
 */
export const MIN_TOKEN_BUDGET = 1000;

/** Estimated token count for a string. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Clamp a requested budget to the supported floor. */
export function resolveTokenBudget(maxTokens = DEFAULT_TOKEN_BUDGET): number {
  return Math.max(MIN_TOKEN_BUDGET, Math.floor(maxTokens));
}

/**
 * Split `text` into chunks whose estimated token count is within `maxTokens`.
 *
 * Returns `[]` for blank input. Every returned chunk is non-empty and trimmed.
 */
export function chunkTextByTokens(text: string, maxTokens = DEFAULT_TOKEN_BUDGET): string[] {
  const budget = resolveTokenBudget(maxTokens);
  const maxChars = budget * CHARS_PER_TOKEN;

  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // Paragraphs first: they are the most meaningful boundary, so a chunk that
  // ends at one reads as a unit to the model.
  const units = splitParagraphs(trimmed);
  return packUnits(units, maxChars, "\n\n");
}

/** Split on blank lines, dropping empties. */
function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Split on sentence-ending punctuation followed by whitespace. Keeps the
 * punctuation with the sentence it ends.
 */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Cut a string into fixed-size pieces. The terminating case: always splits. */
function splitHard(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    const piece = text.slice(i, i + maxChars).trim();
    if (piece) out.push(piece);
  }
  return out;
}

/**
 * Greedily pack units into chunks, recursing into any single unit that is
 * itself over budget. A paragraph too big for a chunk is re-split by sentence;
 * a sentence too big is hard-cut on a character boundary.
 */
function packUnits(units: string[], maxChars: number, joiner: string): string[] {
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const unit of units) {
    if (unit.length > maxChars) {
      // Oversized on its own: finish what we have, then split it further.
      flush();
      const finer =
        joiner === "\n\n"
          ? packUnits(splitSentences(unit), maxChars, " ")
          : splitHard(unit, maxChars);
      chunks.push(...finer);
      continue;
    }

    const candidate = current ? current + joiner + unit : unit;
    if (candidate.length > maxChars) {
      flush();
      current = unit;
    } else {
      current = candidate;
    }
  }

  flush();
  return chunks;
}
