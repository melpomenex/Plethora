/**
 * Truncation-tolerant JSON salvage for structured model output.
 *
 * On-device models frequently hit the `maxOutputTokens` cap mid-JSON, which
 * surfaces as `SyntaxError: Unterminated string ...` — exactly the reports
 * seen for `learn-this` (cut at position 605) and `tutor-turn-full` (cut at
 * position 74). Before burning the repair retry (which would truncate again
 * at the same cap), close what can be closed programmatically:
 *
 *  1. close an unterminated string (dropping a dangling escape),
 *  2. strip a trailing comma / colon fragment,
 *  3. close all open braces/brackets,
 *  4. if that still fails, progressively drop the last property/array
 *     element and retry (a proposal losing its final, half-written card is
 *     far better than no proposal at all).
 *
 * The result is only a PARSE success — the task's validator still gates
 * every field. Returns `null` when nothing parses.
 */

const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

interface ScanState {
  /** Characters needed to close everything left open at end of input. */
  closers: string;
  inString: boolean;
}

function scan(text: string): ScanState {
  const stack: string[] = [];
  const closerFor: Record<string, string> = { "{": "}", "[": "]" };
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(closerFor[ch]);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
  }
  return {
    closers: stack.reverse().join(""),
    inString,
  };
}

/** Close strings/brackets and strip dangling separators; null if unparseable. */
function closeAndParse(text: string): unknown | undefined {
  let candidate = text.trim();
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return undefined;

  const state = scan(candidate);
  if (state.inString) {
    // Drop a trailing dangling escape before closing the string.
    if (candidate.endsWith("\\")) candidate = candidate.slice(0, -1);
    candidate += '"';
  }

  // Strip trailing whitespace/comma/colon fragments left by the cut. A
  // trailing `:` means the cut happened mid-property and no value can be
  // completed — the caller's drop-last-property path handles that.
  candidate = candidate.replace(/[\s,]+$/, "");
  if (candidate.endsWith(":")) return undefined;

  candidate += scan(candidate).closers;

  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/**
 * Cut point for dropping the incomplete tail. Prefers the last comma that
 * separated ARRAY ELEMENTS (so a half-written list entry is dropped whole —
 * a salvaged proposal should contain only complete entries), falling back
 * to the last property comma inside an object.
 */
function lastPropertyBoundary(text: string): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastElementComma = -1;
  let lastAnyComma = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === ",") {
      lastAnyComma = i;
      if (stack[stack.length - 1] === "[") lastElementComma = i;
    }
  }
  return lastElementComma >= 0 ? lastElementComma : lastAnyComma;
}

const MAX_DROPS = 4;

export function repairTruncatedJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = FENCE.test(trimmed) ? FENCE.exec(trimmed)![1].trim() : trimmed;

  // Valid JSON parses immediately — nothing to repair.
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to repair */
  }

  let work = candidate;
  for (let drop = 0; drop <= MAX_DROPS; drop++) {
    const parsed = closeAndParse(work);
    if (parsed !== undefined) return parsed;
    const boundary = lastPropertyBoundary(work);
    if (boundary <= 0) return null;
    work = work.slice(0, boundary);
  }
  return null;
}
