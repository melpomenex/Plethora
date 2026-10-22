/**
 * User-facing copy derived from AI feature readiness.
 *
 * A readiness row carries two different kinds of strings:
 * - `dependencies[].reasonKey` — safe translation keys for an unmet dependency,
 *   i.e. the reason a feature cannot run; and
 * - `limitations` — disclosure keys for a row that is usually *usable but
 *   degraded* (`ai.limitation.lexicalRetrieval`, `ai.limitation.indexing`).
 *
 * Consumers must never present a limitation as the blocking reason. On mobile
 * the optional embedding route reports `ai.limitation.lexicalRetrieval` on the
 * learning-agent row, which is not why the mode is unavailable.
 */

import type { TranslateFn } from "../../i18n";
import type { DependencyState, FeatureReadiness } from "./types";

/**
 * Dependency states that block the feature. `degraded` is deliberately absent:
 * the registry emits it for dependencies that still permit the operation.
 */
const UNMET_DEPENDENCY_STATES: ReadonlySet<DependencyState> = new Set<DependencyState>([
  "missing",
  "unsupported",
  "unknown",
  "checking",
]);

/**
 * Translated reason the Learning Agent mode cannot start, or `null` when the
 * row is ready (or no probe has produced a row yet).
 *
 * The reason comes from the first *unmet* dependency that exposes a
 * `reasonKey`, in registry order. `limitations` are never read. When no unmet
 * dependency exposes copy — or its key does not resolve — the stable
 * `assistant.agent.modeBlocked` fallback is returned already translated, so
 * callers can interpolate it directly.
 */
export function learningAgentBlockedReason(
  row: FeatureReadiness | undefined,
  t: TranslateFn
): string | null {
  if (!row || row.status === "ready") return null;

  for (const dependency of row.dependencies) {
    if (!UNMET_DEPENDENCY_STATES.has(dependency.state)) continue;
    const reasonKey = dependency.reasonKey;
    if (!reasonKey) continue;
    const translated = t(reasonKey);
    // `t()` returns its argument when a lookup misses. Never let a raw dotted
    // key reach the notice: fall through to the stable fallback copy instead.
    if (translated === reasonKey) continue;
    return translated;
  }

  return t("assistant.agent.modeBlocked");
}
