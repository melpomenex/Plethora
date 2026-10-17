/**
 * Citation/evidence adapters (design D6, task 3.2).
 *
 * One conversion surface between the task-layer's cited sources and the
 * canonical `Citation`/`RagHit` presentations. Rules:
 *
 *  - `displayNumber` is the *original prompt ordinal*; filtering never
 *    renumbers survivors (defect A4).
 *  - `RagHit.citationNumber` mirrors it (the legacy UI reads this field).
 *  - Legacy answers (raw `[N]` text, no structural evidence) convert to
 *    `validation: "legacy"` and are never promoted to verified sources.
 *  - Locators are source-appropriate: page, CFI/section, timestamp, offsets.
 */

import type { ChunkLocation } from "../../../api/ai-learning";
import type { AskLibraryCitedSource } from "../tasks/definitions/libraryTask";
import type { Citation, SourceLocator } from "./conversations/types";

/** Structural shape of the legacy `RagHit` (kept decoupled for tests). */
export interface RagHitLike {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  chunkText: string;
  score: number;
  /** Original prompt ordinal; undefined for pre-fix persisted hits. */
  citationNumber?: number;
}

/** Map a retrieval location to a source-appropriate locator. */
export function locationToLocator(location: ChunkLocation | undefined): SourceLocator | undefined {
  if (!location) return undefined;
  switch (location.sourceType) {
    case "pdf":
      return location.pageNumber !== undefined ? { page: location.pageNumber } : undefined;
    case "epub":
      return location.cfiRange
        ? { cfi: location.cfiRange }
        : location.spineIndex !== undefined
          ? { sectionId: `spine-${location.spineIndex}` }
          : undefined;
    case "video":
    case "audio":
    case "transcript":
      return location.timestampMs !== undefined
        ? { timeSeconds: location.timestampMs / 1000 }
        : undefined;
    case "markdown":
    case "html":
    case "text":
    case "fts":
      return {
        textRange: { start: location.startOffset, end: location.endOffset },
        anchor: location.anchorId ?? undefined,
      };
    default:
      return undefined;
  }
}

function locatorFor(source: AskLibraryCitedSource): SourceLocator | undefined {
  return locationToLocator(source.location);
}

/**
 * Convert one cited source into a canonical citation. `validation` is
 * `verified` because the task validator already dropped fabricated refs and
 * checked the quote against the supplied text.
 */
export function citedSourceToCitation(
  source: AskLibraryCitedSource,
  options: { id?: string; claimBindings?: string[] } = {},
): Citation {
  return {
    id: options.id ?? `cite-${source.referenceNumber}-${source.chunkId}`,
    displayNumber: source.referenceNumber,
    refId: source.chunkId,
    chunkId: source.origin === "library" ? source.chunkId : undefined,
    claimBindings: options.claimBindings,
    quote: source.quote,
    documentId: source.origin === "library" ? source.documentId : undefined,
    title: source.documentTitle,
    sourceType: source.sourceType,
    headingPath: source.headingPath,
    locator: source.origin === "library" ? locatorFor(source) : undefined,
    origin: source.origin,
    validation: "verified",
  };
}

export function citedSourcesToCitations(
  sources: readonly AskLibraryCitedSource[],
  options: { claimBindings?: (source: AskLibraryCitedSource) => string[] | undefined } = {},
): Citation[] {
  return sources.map((source) =>
    citedSourceToCitation(source, {
      claimBindings: options.claimBindings?.(source),
    }),
  );
}

/**
 * Canonical citations → legacy `RagHit`s for the existing footer renderer.
 * The original number is preserved in `citationNumber`; `chunkIndex` falls
 * back to the locator's ordinal for display, and the validated quote is used
 * as the chunk text so the footer never shows a whole chunk instead of the
 * supporting passage.
 */
export function citationsToRagHits(citations: readonly Citation[]): RagHitLike[] {
  return citations
    .filter((citation) => citation.validation !== "invalid")
    .map((citation) => ({
      documentId: citation.documentId ?? citation.refId ?? "selection-context",
      documentTitle: citation.title ?? citation.documentId ?? "Selected passage",
      chunkIndex: 0,
      chunkText: citation.quote ?? "",
      score: 1,
      citationNumber: citation.displayNumber,
    }));
}

/**
 * Legacy persisted `RagHit`s → canonical citations, marked `legacy` unless a
 * number and quote are present. These stay readable and are never promoted to
 * verified sources merely because they exist.
 */
export function ragHitsToCitations(hits: readonly RagHitLike[]): Citation[] {
  return hits.map((hit, index) => ({
    id: `legacy-${hit.documentId}-${index}`,
    // Pre-fix persisted hits have no number; the array position is the only
    // honest value and the citation is still marked legacy.
    displayNumber: hit.citationNumber ?? index + 1,
    chunkId: `legacy-chunk-${index}`,
    quote: hit.chunkText,
    documentId: hit.documentId,
    title: hit.documentTitle,
    origin: "library",
    validation: "legacy",
  }));
}

/**
 * True when the displayed set can claim verified evidence. A set consisting
 * only of legacy/unresolved citations cannot.
 */
export function citationsSupportEvidence(citations: readonly Citation[]): boolean {
  return citations.some((citation) => citation.validation === "verified");
}

/**
 * Build display slots for inline markers. Markers whose number has no
 * surviving citation render as inert text: `resolvable` is false and the UI
 * must not present a link (defect: dangling markers).
 */
export function mapInlineMarkers(
  answerText: string,
  citations: readonly Citation[],
): Array<{ number: number; resolvable: boolean; citation?: Citation }> {
  const byNumber = new Map(citations.map((citation) => [citation.displayNumber, citation]));
  const seen = new Set<number>();
  const markers: Array<{ number: number; resolvable: boolean; citation?: Citation }> = [];
  for (const match of answerText.matchAll(/\[(\d{1,2})\]/g)) {
    const number = Number(match[1]);
    if (seen.has(number)) continue;
    seen.add(number);
    const citation = byNumber.get(number);
    markers.push({
      number,
      resolvable: Boolean(citation && citation.validation === "verified"),
      citation,
    });
  }
  return markers;
}
