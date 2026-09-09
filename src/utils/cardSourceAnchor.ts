/**
 * Builders that turn capture-time context into a `CardSourceReference`
 * envelope (serialized onto `learning_items.source_reference`).
 *
 * Capture happens at card-creation time, while the originating context is
 * still in memory — the envelope is never reconstructed after the fact.
 */

import type { CardSourceReference } from "../types/cardSourceReference";
import {
  CARD_SOURCE_EXCERPT_MAX_CHARS,
  serializeCardSourceReference,
} from "../types/cardSourceReference";
import type { SectionSourceReference } from "./sectionIndex";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

/**
 * Build a provenance envelope from the Studio/assistant section focus.
 * `texts` are the candidate full-document texts the section char ranges may
 * have been computed against (the live preferred text and the stored
 * document content); the first text that yields a non-blank section slice
 * wins. Returns undefined when no locator can be trusted (no ranges, no
 * document, blank text everywhere) — an absent anchor beats a wrong one.
 */
export function buildSourceReferenceFromSection(
  source: SectionSourceReference,
  texts: Array<string | undefined | null>,
  fileType?: string
): CardSourceReference | undefined {
  const range = source.ranges[0];
  if (!range || range.end <= range.start) return undefined;
  if (!source.documentId) return undefined;

  let excerpt = "";
  let anchorTextLength = 0;
  for (const text of texts) {
    if (!text || text.length === 0) continue;
    const slice = text.slice(range.start, range.end).trim();
    if (slice.length > 0) {
      excerpt = slice.slice(0, CARD_SOURCE_EXCERPT_MAX_CHARS);
      anchorTextLength = text.length;
      break;
    }
  }
  if (!excerpt) return undefined;

  const scrollPercent =
    anchorTextLength > 0 ? clampPercent((range.start / anchorTextLength) * 100) : undefined;
  const kind = fileType === "markdown" ? "markdown" : "html";

  return {
    version: 1,
    document_id: source.documentId,
    locator: { kind, scrollPercent, textQuote: excerpt },
    excerpt,
    section_label: source.labels.join(" · ") || undefined,
    fingerprint: source.contentHash || undefined,
    captured_at: new Date().toISOString(),
  };
}

/** Serialize an envelope for the create command; undefined stays undefined. */
export function serializeSourceReference(
  ref: CardSourceReference | undefined
): string | undefined {
  return ref ? serializeCardSourceReference(ref) : undefined;
}

/**
 * Flatten an envelope back into the flat `source` argument shape accepted by
 * the card-creation MCP tools (`document_id` + `excerpt` + locator fields).
 */
export function referenceToToolSourceArg(ref: CardSourceReference): Record<string, unknown> {
  const locator = ref.locator as Record<string, unknown>;
  return {
    document_id: ref.document_id,
    excerpt: ref.excerpt,
    kind: locator.kind,
    ...(typeof locator.pageNumber === "number" ? { page_number: locator.pageNumber } : {}),
    ...(typeof locator.scrollPercent === "number" ? { scroll_percent: locator.scrollPercent } : {}),
    ...(typeof locator.timeSeconds === "number" ? { time_seconds: locator.timeSeconds } : {}),
    ...(typeof locator.segmentId === "string" ? { segment_id: locator.segmentId } : {}),
    ...(ref.section_label ? { section_label: ref.section_label } : {}),
  };
}
