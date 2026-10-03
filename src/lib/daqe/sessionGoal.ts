/**
 * The session goal: the user's stated objective for the current study session.
 *
 * The goal is the input the `goalRelevance` knob weights but has never been given.
 * It is normalised here at the boundary rather than at each consumer, because the
 * three places it can be wrong — a whitespace-only field, an over-long paste, a
 * hand-edited settings blob — would otherwise each need their own guard.
 *
 * Refusal rather than truncation is the governing decision. A goal silently cut at
 * 200 characters is a goal the user did not write, and the ranker would reorder
 * their queue against an objective they never gave.
 */

/**
 * Maximum goal length, in characters.
 *
 * Bounded because the statement rides the ranking payload on every re-rank, and a
 * pasted essay is not an objective. Long enough for a comma-separated list of
 * topics, which is how people actually phrase one.
 */
export const MAX_SESSION_GOAL_LENGTH = 200;

/**
 * How many previously used goals the quick-select control keeps.
 *
 * A short row, not a history list: the chips exist to re-pick something you meant a
 * moment ago, not to browse.
 */
export const MAX_RECENT_GOALS = 5;

export interface SessionGoalValidationResult {
  ok: boolean;
  /** Present only when `ok` is false, for display next to the field. */
  error?: string;
}

/**
 * The canonical form of a goal: trimmed, and absent rather than empty.
 *
 * Returns `undefined` for anything that carries no objective — an absent value, a
 * non-string, or whitespace only. That distinction is what lets the ranker tell
 * "no goal" apart from "a goal that happened to match nothing", which is the
 * difference between an unavailable term and a fabricated zero.
 */
export function normalizeSessionGoal(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Whether a raw value is acceptable as a goal. */
export function validateSessionGoal(raw: unknown): SessionGoalValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "A session goal must be text." };
  }
  const normalized = normalizeSessionGoal(raw);
  if (normalized === undefined) {
    return { ok: false, error: "Enter a goal, or clear the field." };
  }
  if (normalized.length > MAX_SESSION_GOAL_LENGTH) {
    return {
      ok: false,
      error: `A session goal is at most ${MAX_SESSION_GOAL_LENGTH} characters.`,
    };
  }
  return { ok: true };
}

/** The goal and history a commit produces. */
export interface SessionGoalCommit {
  goal: string;
  recentGoals: string[];
}

/**
 * Promote a goal to the front of the history, newest first.
 *
 * Deduplication is case-insensitive but preserves the casing of the incoming goal,
 * so re-typing a goal differently updates how it reads rather than leaving a
 * near-duplicate chip beside it.
 */
function pushRecentGoal(recentGoals: readonly string[], goal: string): string[] {
  const match = goal.toLowerCase();
  return [
    goal,
    ...recentGoals.filter((entry) => entry.toLowerCase() !== match),
  ].slice(0, MAX_RECENT_GOALS);
}

/**
 * Commit a goal and return the new pair, or `null` when the value is refused.
 *
 * Refusing rather than clamping is deliberate, and the caller is expected to keep
 * the previously accepted goal and surface `validateSessionGoal`'s error — the same
 * contract `applyKnobUpdate` follows for an out-of-range slider.
 *
 * An empty commit means "no goal" and deliberately leaves the history alone: clearing
 * the field is not the same event as choosing a different goal, and recording every
 * erasure as a recent goal would fill the chips with blanks.
 */
export function applySessionGoal(
  raw: unknown,
  recentGoals: readonly string[] = [],
): SessionGoalCommit | null {
  const normalized = normalizeSessionGoal(raw);
  if (normalized === undefined) {
    return { goal: "", recentGoals: coerceRecentGoals(recentGoals) };
  }
  if (!validateSessionGoal(normalized).ok) return null;
  return {
    goal: normalized,
    recentGoals: pushRecentGoal(coerceRecentGoals(recentGoals), normalized),
  };
}

/**
 * Coerce a stored goal into a usable one.
 *
 * Reads a persisted settings blob, which may predate the field, come from an older
 * build, or have been hand-edited. Over-long is dropped to absent rather than
 * truncated, for the same reason `applySessionGoal` refuses it.
 */
export function coerceSessionGoal(candidate: unknown): string {
  const normalized = normalizeSessionGoal(candidate);
  if (normalized === undefined) return "";
  return normalized.length > MAX_SESSION_GOAL_LENGTH ? "" : normalized;
}

/**
 * Coerce a stored history into a bounded, deduplicated, well-formed list.
 *
 * Filters rather than repairs: an entry that is not usable text cannot be displayed
 * as a chip, and a chip that sets a goal the field would then refuse is worse than
 * no chip.
 */
export function coerceRecentGoals(candidate: unknown): string[] {
  if (!Array.isArray(candidate)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of candidate) {
    const normalized = normalizeSessionGoal(entry);
    if (normalized === null || normalized === undefined) continue;
    if (normalized.length > MAX_SESSION_GOAL_LENGTH) continue;
    const match = normalized.toLowerCase();
    if (seen.has(match)) continue;
    seen.add(match);
    result.push(normalized);
    if (result.length === MAX_RECENT_GOALS) break;
  }
  return result;
}