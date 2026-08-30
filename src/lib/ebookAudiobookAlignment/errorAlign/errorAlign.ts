/**
 * Token-level error alignment — Storyteller-inspired word-level pass.
 * Adapted from MIT libraries/align/src/errorAlign/errorAlign.ts
 */

import { backtraceAlignments } from "./editDistance";
import type { TokenAlignment } from "./types";

export function errorAlignTokens(
  refTokens: string[],
  hypTokens: string[],
  refNorm: string[],
  hypNorm: string[],
): TokenAlignment[] {
  if (refNorm.length === 0 && hypNorm.length === 0) return [];
  if (refNorm.length === 0) {
    return hypTokens.map((t, i) => ({
      op: "INSERT" as const,
      refTokenIndex: null,
      hypTokenIndex: i,
      refText: null,
      hypText: t,
    }));
  }
  if (hypNorm.length === 0) {
    return refTokens.map((t, i) => ({
      op: "DELETE" as const,
      refTokenIndex: i,
      hypTokenIndex: null,
      refText: t,
      hypText: null,
    }));
  }

  if (refNorm.join("\0") === hypNorm.join("\0")) {
    return refTokens.map((t, i) => ({
      op: "MATCH" as const,
      refTokenIndex: i,
      hypTokenIndex: i,
      refText: t,
      hypText: hypTokens[i] ?? t,
    }));
  }

  return backtraceAlignments(refTokens, hypTokens, refNorm, hypNorm);
}

export function alignmentMatchRate(alignments: TokenAlignment[]): number {
  if (alignments.length === 0) return 0;
  const matched = alignments.filter((a) => a.op === "MATCH" || a.op === "SUBSTITUTE").length;
  const refOps = alignments.filter((a) => a.refTokenIndex !== null).length;
  return refOps === 0 ? 0 : matched / refOps;
}
