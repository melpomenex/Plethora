/**
 * Bounded, duplicate-aggregating error recorder (change
 * eliminate-long-running-memory-growth, task 3.2 / design D6).
 *
 * Replaces the unbounded `window.__plethoraTestErrors` array (incident
 * finding 1): a repeating error used to cost one `{type,message,stack}`
 * object per occurrence in every build. This recorder keeps at most
 * `DEFAULT_SIGNATURE_CAP` distinct signatures as
 * `{ signature, type, message, sampleStack?, count, firstSeen, lastSeen }` —
 * one repeating exception costs O(1) memory.
 *
 * Signature normalization (spec'd): `type + ":" + normalizedMessage`, where
 * the message is whitespace-collapsed, numbers replaced by `#`, and
 * truncated to `MAX_MESSAGE_CHARS`. Distinct errors that normalize alike
 * share an aggregate — acceptable: the sample stack preserves the first
 * occurrence's real site.
 *
 * Disabled in production unless the diagnostics gate is on: `recordError` is
 * a no-op then, and nothing is retained (spec "Production builds do not
 * record by default").
 */

import { isDiagnosticsEnabled } from "./gate";

export interface ErrorAggregate {
  signature: string;
  type: string;
  /** Truncated, normalized-form message (first occurrence's shape). */
  message: string;
  sampleStack?: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

/** Documented default cap on distinct signatures. */
export const DEFAULT_SIGNATURE_CAP = 64;
/** Documented truncation for retained messages. */
export const MAX_MESSAGE_CHARS = 200;
/** Documented truncation for sample stacks. */
export const MAX_STACK_CHARS = 2_000;

const aggregates = new Map<string, ErrorAggregate>();

export function normalizeMessage(message: string): string {
  const collapsed = String(message).replace(/\s+/g, " ").trim();
  const numberless = collapsed.replace(/\d+/g, "#");
  return numberless.slice(0, MAX_MESSAGE_CHARS);
}

export function makeSignature(type: string, message: string): string {
  return `${type}:${normalizeMessage(message)}`;
}

/**
 * Record one error occurrence. Inert when the diagnostics gate is off.
 */
export function recordError(input: { type: string; message: string; stack?: string }): void {
  if (!isDiagnosticsEnabled()) return;
  const signature = makeSignature(input.type, input.message);
  const now = Date.now();
  const existing = aggregates.get(signature);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = now;
    return;
  }
  if (aggregates.size >= DEFAULT_SIGNATURE_CAP) {
    // Evict the lowest-count (ties: oldest first) signature — spec
    // "Signature diversity is capped".
    let victim: string | null = null;
    let victimKey = Infinity;
    for (const [sig, agg] of aggregates) {
      const key = agg.count * 2 ** 31 + agg.firstSeen; // count-major, age-minor
      if (key < victimKey) {
        victimKey = key;
        victim = sig;
      }
    }
    if (victim !== null) aggregates.delete(victim);
  }
  aggregates.set(signature, {
    signature,
    type: input.type,
    message: normalizeMessage(input.message),
    ...(input.stack ? { sampleStack: input.stack.slice(0, MAX_STACK_CHARS) } : {}),
    count: 1,
    firstSeen: now,
    lastSeen: now,
  });
}

/** Current aggregates (readonly; callers must not mutate). */
export function getErrorAggregates(): readonly ErrorAggregate[] {
  return [...aggregates.values()];
}

/** Approximate retained bytes (diagnostic display; bounded by construction). */
export function getErrorRecorderRetainedBytes(): number {
  let bytes = 0;
  for (const agg of aggregates.values()) {
    bytes += agg.signature.length + agg.message.length + (agg.sampleStack?.length ?? 0) + 64;
  }
  return bytes;
}

/** Test-only: drop all aggregates. */
export function resetErrorRecorderForTests(): void {
  aggregates.clear();
}
