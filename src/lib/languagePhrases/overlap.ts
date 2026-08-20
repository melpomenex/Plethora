import type { PhraseCandidate } from "./types";

export interface PhraseSpan {
  candidate: PhraseCandidate;
  start: number;
  end: number;
}

function spanLength(span: PhraseSpan): number {
  return span.end - span.start;
}

/** Longest/highest-confidence wins; ties resolve by source order then id. */
export function selectNonOverlappingPhrases(spans: readonly PhraseSpan[]): PhraseSpan[] {
  const ordered = [...spans].sort((left, right) =>
    spanLength(right) - spanLength(left) ||
    right.candidate.confidence - left.candidate.confidence ||
    left.start - right.start ||
    left.candidate.id.localeCompare(right.candidate.id),
  );
  const selected: PhraseSpan[] = [];
  for (const span of ordered) {
    if (selected.some((existing) => span.start < existing.end && existing.start < span.end)) continue;
    selected.push(span);
  }
  return selected.sort((left, right) => left.start - right.start || left.end - right.end || left.candidate.id.localeCompare(right.candidate.id));
}

export function phraseSpanFromTokenIds(candidate: PhraseCandidate, tokenPositions: ReadonlyMap<string, { start: number; end: number }>): PhraseSpan | null {
  const positions = candidate.constituents
    .map((constituent) => tokenPositions.get(`${candidate.id}:${constituent.position}`))
    .filter((position): position is { start: number; end: number } => Boolean(position));
  if (positions.length !== candidate.constituents.length || positions.length === 0) return null;
  return {
    candidate,
    start: Math.min(...positions.map((position) => position.start)),
    end: Math.max(...positions.map((position) => position.end)),
  };
}
