import type { ExactSearchHitLocation } from "../../../types/searchHit";
import type { StudySourceAnchor } from "../../../types/studyMode";

interface RawCitation {
  sourceId?: string;
  quote?: string;
  label?: string;
  timeSeconds?: number;
  pageNumber?: number;
}

function collectRawCitations(container: Record<string, unknown>, out: RawCitation[]): void {
  for (const key of ["citations", "sourceRefs"] as const) {
    const raw = container[key];
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const sourceId =
        typeof obj.sourceId === "string"
          ? obj.sourceId
          : typeof obj.documentId === "string"
          ? obj.documentId
          : undefined;
      const quote =
        typeof obj.quote === "string"
          ? obj.quote
          : typeof obj.excerpt === "string"
          ? obj.excerpt
          : undefined;
      const label = typeof obj.label === "string" ? obj.label : undefined;
      const timeSeconds = typeof obj.timeSeconds === "number" ? obj.timeSeconds : undefined;
      const pageNumber = typeof obj.pageNumber === "number" ? obj.pageNumber : undefined;
      out.push({ sourceId, quote, label, timeSeconds, pageNumber });
    }
  }
}

export function extractRawCitationsFromPayload(payload: Record<string, unknown>): RawCitation[] {
  const out: RawCitation[] = [];
  collectRawCitations(payload, out);
  for (const arrayKey of ["nodes", "events", "slides", "turns"] as const) {
    const items = payload[arrayKey];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item && typeof item === "object") {
        collectRawCitations(item as Record<string, unknown>, out);
      }
    }
  }
  return out;
}

export function findQuoteOffsets(
  passageText: string,
  quote: string
): { charStart: number; charEnd: number } | null {
  const trimmed = quote.trim();
  if (!trimmed || !passageText) return null;

  const exactIdx = passageText.indexOf(trimmed);
  if (exactIdx >= 0) {
    return { charStart: exactIdx, charEnd: exactIdx + trimmed.length };
  }

  const lowerPassage = passageText.toLowerCase();
  const lowerQuote = trimmed.toLowerCase();
  const ciIdx = lowerPassage.indexOf(lowerQuote);
  if (ciIdx >= 0) {
    return { charStart: ciIdx, charEnd: ciIdx + trimmed.length };
  }

  // Fallback: match first 32 characters for minor whitespace/punctuation drift
  if (lowerQuote.length > 32) {
    const prefix = lowerQuote.slice(0, 32);
    const prefixIdx = lowerPassage.indexOf(prefix);
    if (prefixIdx >= 0) {
      return {
        charStart: prefixIdx,
        charEnd: Math.min(passageText.length, prefixIdx + trimmed.length),
      };
    }
  }

  return null;
}

export function buildDefaultLocator(
  baseLocator?: ExactSearchHitLocation | null,
  quote?: string
): ExactSearchHitLocation {
  if (baseLocator) {
    return quote ? { ...baseLocator, textQuote: quote } : { ...baseLocator };
  }
  return {
    kind: "text",
    scrollPercent: 0,
    ...(quote ? { textQuote: quote } : {}),
  };
}

/**
 * Builds typed StudySourceAnchor records grounded in Reading Trails'
 * ExactSearchHitLocation model. Never returns an empty array when a valid
 * documentId is supplied — falls back to the active scope locator.
 */
export function buildStudyAnchorsFromPayload(input: {
  documentId: string;
  sourceRevision: string;
  passageText: string;
  payload: Record<string, unknown>;
  baseLocator?: ExactSearchHitLocation | null;
}): StudySourceAnchor[] {
  const rawCitations = extractRawCitationsFromPayload(input.payload);
  const anchors: StudySourceAnchor[] = [];
  const seen = new Set<string>();

  for (const citation of rawCitations) {
    const quote = citation.quote?.trim();
    const sourceId = citation.sourceId?.trim() || input.documentId;
    const offsets = quote ? findQuoteOffsets(input.passageText, quote) : null;

    let locator = buildDefaultLocator(input.baseLocator, quote);
    if (typeof citation.pageNumber === "number" && locator.kind === "pdf") {
      locator = { ...locator, pageNumber: citation.pageNumber };
    } else if (
      typeof citation.timeSeconds === "number" &&
      (locator.kind === "audio" || locator.kind === "video" || locator.kind === "youtube")
    ) {
      locator = { ...locator, timeSeconds: citation.timeSeconds };
    }

    const dedupeKey = `${sourceId}:${quote ?? ""}:${offsets?.charStart ?? -1}:${JSON.stringify(locator)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    anchors.push({
      sourceId,
      sourceRevision: input.sourceRevision,
      ...(quote ? { quote } : {}),
      ...(offsets ? { charStart: offsets.charStart, charEnd: offsets.charEnd } : {}),
      locator,
      ...(citation.label ? { label: citation.label } : {}),
    });
  }

  if (anchors.length === 0) {
    const fallbackQuote = input.passageText.trim().slice(0, 140) || undefined;
    anchors.push({
      sourceId: input.documentId,
      sourceRevision: input.sourceRevision,
      ...(fallbackQuote ? { quote: fallbackQuote, charStart: 0, charEnd: fallbackQuote.length } : {}),
      locator: buildDefaultLocator(input.baseLocator, fallbackQuote),
      label: "Active Scope",
    });
  }

  return anchors;
}

export function formatAnchorLocationLabel(anchor: StudySourceAnchor): string {
  const loc = anchor.locator;
  if (!loc) return "Source";
  switch (loc.kind) {
    case "pdf":
      return `p. ${loc.pageNumber}`;
    case "epub":
      return "Section";
    case "youtube":
    case "audio":
    case "video": {
      const mins = Math.floor(loc.timeSeconds / 60);
      const secs = Math.floor(loc.timeSeconds % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    }
    case "html":
    case "markdown":
    case "text":
      return typeof loc.scrollPercent === "number"
        ? `${Math.round(loc.scrollPercent * 100)}%`
        : "Passage";
    case "image":
      return "Image";
  }
}
