/**
 * Flashcard → source resolution and navigation.
 *
 * Turns a review card into a navigable document location by trying, in
 * order (see design D2):
 *   1. the linked extract's structural locator (`selection_context`),
 *   2. the card's own stored `source_reference` envelope,
 *   3. the `ai_provenance` capture record (Learn-This path),
 *   4. a bounded quote match of the stored excerpt,
 *   5. the coarse page/start fallback,
 *   6. "unavailable".
 *
 * Resolution is LAZY: invoked when the user activates the source action,
 * never during card rendering. Everything here is a local read — no network,
 * no AI — so navigation works offline whenever the source is stored locally.
 *
 * A downgrade is always observable (`status: "coarse"` carries a `reason`),
 * and quote matching is uniqueness-gated: the system never highlights text it
 * did not verify, and never lands on a plausible-but-wrong passage silently.
 */

import type { Extract } from "../api/extracts";
import { getExtract } from "../api/extracts";
import { getAiProvenance } from "../api/ai-provenance";
import type { Document } from "../types/document";
import type { ExactSearchHitLocation } from "../types/searchHit";
import {
  parseCardSourceReference,
  type CardSourceReference,
} from "../types/cardSourceReference";
import type { PdfSelectionContext, SelectionContext, WebSelectionAnchor } from "../types/selection";
import { normalizeSearchText, resolveCitationLocation } from "./resolveCitationLocation";
import { openDocumentAtLocation } from "./openDocumentAtLocation";
import type { TabsState } from "../stores/tabsStore";
import { useDocumentStore } from "../stores/documentStore";

/** Shape of the review-session card (subset the resolver needs). */
export interface CardSourceProbe {
  id: string;
  extract_id?: string | null;
  document_id?: string | null;
  source_reference?: string | null;
}

export type CardSourceResolution =
  | {
      status: "ready";
      confidence: "exact" | "matched";
      documentId: string;
      location: ExactSearchHitLocation;
      /** Query the viewer highlights after jumping (verified text only). */
      highlightQuery?: string;
      excerpt: string;
      sectionLabel?: string;
    }
  | {
      status: "coarse";
      reason: "ambiguous" | "stale" | "no-anchor";
      documentId: string;
      location?: ExactSearchHitLocation;
      highlightQuery?: string;
      excerpt: string;
      sectionLabel?: string;
    }
  | {
      status: "unavailable";
      reason: "document-missing" | "no-source";
      excerpt?: string;
      sectionLabel?: string;
    };

const HIGHLIGHT_QUOTE_CHARS = 120;

function isPdfSelectionContext(value: unknown): value is PdfSelectionContext {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: string }).type === "pdf" &&
      Array.isArray((value as { pages?: unknown }).pages)
  );
}

/** Case-preserved, whitespace-collapsed excerpt prefix for viewer matching. */
function quoteFor(text: string, length = HIGHLIGHT_QUOTE_CHARS): string {
  return text.replace(/\s+/g, " ").trim().slice(0, length).trim();
}

function excerptFor(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Map a capture-time selection context onto the document-jump format. */
export function locatorFromSelectionContext(
  selectionContext: SelectionContext | unknown | null | undefined
): ExactSearchHitLocation | undefined {
  if (!selectionContext || typeof selectionContext !== "object") return undefined;
  const context = selectionContext as Record<string, unknown> & Partial<SelectionContext>;

  if (isPdfSelectionContext(context)) {
    const pageNumber = context.pages?.[0]?.pageNumber;
    if (typeof pageNumber !== "number") return undefined;
    return { kind: "pdf", pageNumber };
  }
  if (context.type === "epub" && typeof context.cfiRange === "string" && context.cfiRange) {
    return { kind: "epub", cfi: context.cfiRange, cfiRange: context.cfiRange };
  }
  if (context.type === "text" && (typeof context.startOffset === "number" || context.anchor)) {
    const anchor = context.anchor;
    return {
      kind: context.surface === "markdown" ? "markdown" : "html",
      textQuote:
        anchor?.textQuote.exact?.trim() ||
        (typeof context.selectedText === "string" && context.selectedText.trim()
          ? quoteFor(context.selectedText)
          : undefined),
      ...(anchor?.selector ? { selector: anchor.selector } : {}),
    };
  }
  // Hands-free audio captures persist an `AudioCaptureProvenance` payload in
  // the same column; its timestamp is the authoritative anchor.
  if (
    (context as { kind?: string }).kind === "audio_capture" &&
    typeof (context as { audioTimestampSec?: number }).audioTimestampSec === "number"
  ) {
    // The caller refines youtube vs audio from the document's file type when
    // the context is consumed; "audio" is the correct transcript-jump kind for
    // both (viewers accept timeSeconds + segmentId on both).
    return {
      kind: "audio",
      timeSeconds: (context as { audioTimestampSec?: number }).audioTimestampSec as number,
    };
  }
  return undefined;
}

/**
 * Count verified occurrences of a normalized quote inside the bounded region:
 * the resolved PDF page's text when a page is known, else the whole content.
 */
function countQuoteMatches(
  content: string,
  quote: string,
  location: ExactSearchHitLocation | undefined
): number {
  const normalizedQuote = normalizeSearchText(quote);
  if (!normalizedQuote) return 0;
  let region = content;
  if (location?.kind === "pdf" && typeof location.pageNumber === "number") {
    const pages = content.split("\f");
    region = pages[location.pageNumber - 1] ?? content;
  }
  const normalizedRegion = normalizeSearchText(region);
  let count = 0;
  let index = normalizedRegion.indexOf(normalizedQuote);
  while (index !== -1) {
    count += 1;
    if (count > 1) break;
    index = normalizedRegion.indexOf(normalizedQuote, index + normalizedQuote.length);
  }
  return count;
}

/**
 * Resolve a durable anchor against the document text, requiring the capture-
 * time prefix/suffix context to confirm the occurrence. Repeated passages
 * that the surrounding context cannot disambiguate are ambiguous (0 = no
 * confirmed match, 1 = unique, >1 = ambiguous).
 */
function countAnchorConfirmedMatches(content: string, anchor: WebSelectionAnchor): number {
  const exact = normalizeSearchText(anchor.textQuote.exact);
  if (!exact) return 0;
  const prefix = normalizeSearchText(anchor.textQuote.prefix);
  const suffix = normalizeSearchText(anchor.textQuote.suffix);
  const normalized = normalizeSearchText(content);
  // Boundary whitespace is folded away by normalization on both sides; pad
  // the context windows so adjacency stays whitespace-tolerant.
  const pad = 8;
  let confirmed = 0;
  let index = normalized.indexOf(exact);
  while (index !== -1) {
    const before = prefix
      ? normalized.slice(Math.max(0, index - prefix.length - pad), index).trimEnd()
      : "";
    const after = suffix
      ? normalized.slice(index + exact.length, index + exact.length + suffix.length + pad).trimStart()
      : "";
    if ((!prefix || before.endsWith(prefix)) && (!suffix || after.startsWith(suffix))) {
      confirmed += 1;
      if (confirmed > 1) return confirmed;
    }
    index = normalized.indexOf(exact, index + exact.length);
  }
  return confirmed;
}

/** The document from the store, loading the list once if it is not cached. */
async function findDocument(documentId: string): Promise<Document | undefined> {
  const store = useDocumentStore.getState();
  const known = store.documents.find((d) => d.id === documentId);
  if (known) return known;
  await store.loadDocuments();
  return useDocumentStore.getState().documents.find((d) => d.id === documentId);
}

/** Provenance recorded by Learn-This onto the ai_provenance side table. */
interface AiProvenanceMetadata {
  passage?: string;
  selectionContext?: SelectionContext;
  documentId?: string;
}

async function locatorFromAiProvenance(
  itemId: string
): Promise<{ documentId?: string; location?: ExactSearchHitLocation; excerpt?: string }> {
  try {
    const records = await getAiProvenance("learning_item", itemId);
    for (const record of records) {
      if (!record.metadata_json) continue;
      let metadata: AiProvenanceMetadata;
      try {
        metadata = JSON.parse(record.metadata_json) as AiProvenanceMetadata;
      } catch {
        continue;
      }
      const fromContext = locatorFromSelectionContext(metadata.selectionContext);
      if (fromContext && metadata.documentId) {
        return { documentId: metadata.documentId, location: fromContext, excerpt: metadata.passage };
      }
      if (metadata.documentId && metadata.passage) {
        return { documentId: metadata.documentId, excerpt: metadata.passage };
      }
    }
  } catch {
    // Provenance lookup is best-effort; failures fall through to the next rung.
  }
  return {};
}

/** Resolve a stored card envelope's locator, verifying the excerpt if given. */
async function resolveFromEnvelope(
  document: Document,
  reference: CardSourceReference
): Promise<CardSourceResolution> {
  const excerpt = excerptFor(reference.excerpt);
  const label = reference.section_label;
  const locator = reference.locator as ExactSearchHitLocation;

  // Structural locators are authoritative (CFI, page, timestamp): the viewer
  // performs its own verified text matching for the highlight.
  const structural =
    locator.kind === "pdf" && typeof locator.pageNumber === "number" && !locator.textQuote
      ? undefined
      : locator;
  if (structural && (locator.kind !== "html" && locator.kind !== "markdown")) {
    return {
      status: "ready",
      confidence: "exact",
      documentId: document.id,
      location: locator,
      highlightQuery: locator.textQuote ?? quoteFor(excerpt),
      excerpt,
      sectionLabel: label,
    };
  }

  // Offset/scroll locators (html/markdown) drift after reflow; keep the coarse
  // position but let a uniqueness-gated quote match decide the highlight.
  const quote = locator.textQuote ?? excerpt;
  const matches = countQuoteMatches(document.content ?? "", quote, locator);
  if (matches === 1) {
    return {
      status: "ready",
      confidence: "exact",
      documentId: document.id,
      location: locator,
      highlightQuery: quoteFor(quote),
      excerpt,
      sectionLabel: label,
    };
  }
  if (matches > 1) {
    return {
      status: "coarse",
      reason: "ambiguous",
      documentId: document.id,
      location: locator,
      excerpt,
      sectionLabel: label,
    };
  }
  return {
    status: "coarse",
    reason: "stale",
    documentId: document.id,
    location: locator,
    excerpt,
    sectionLabel: label,
  };
}

/** Resolve an extract-backed card, quote-matching when anchors are missing. */
async function resolveFromExtract(
  document: Document,
  extract: Extract
): Promise<CardSourceResolution> {
  const excerpt = excerptFor(extract.content);
  const label = extract.page_title ?? undefined;
  const location = locatorFromSelectionContext(extract.selection_context);

  if (location) {
    // For pure quote-style text locators (no offsets), verify uniqueness;
    // structural locators (PDF page / EPUB CFI / timestamps) go as-is — the
    // viewer performs its own verified text matching for the highlight.
    if (location.kind === "html" || location.kind === "markdown") {
      // A durable anchor carries capture-time context: prefer an occurrence
      // confirmed by its prefix/suffix before falling back to the plain
      // quote count (legacy offsets-only extracts have no anchor).
      const anchor = (extract.selection_context as SelectionContext | null | undefined)?.type === "text"
        ? (extract.selection_context as { anchor?: WebSelectionAnchor }).anchor
        : undefined;
      if (anchor) {
        const confirmed = countAnchorConfirmedMatches(document.content ?? "", anchor);
        if (confirmed === 1) {
          return {
            status: "ready",
            confidence: "exact",
            documentId: document.id,
            location,
            highlightQuery: location.textQuote ?? quoteFor(excerpt),
            excerpt,
            sectionLabel: label,
          };
        }
        if (confirmed > 1) {
          return {
            status: "coarse",
            reason: "ambiguous",
            documentId: document.id,
            location,
            excerpt,
            sectionLabel: label,
          };
        }
        // No context-confirmed occurrence: fall through to the plain quote
        // count, which still resolves single bare occurrences.
      }
      const quote = location.textQuote ?? excerpt;
      const matches = countQuoteMatches(document.content ?? "", quote, undefined);
      if (matches > 1) {
        return {
          status: "coarse",
          reason: "ambiguous",
          documentId: document.id,
          location,
          excerpt,
          sectionLabel: label,
        };
      }
      if (matches === 0) {
        return {
          status: "coarse",
          reason: "stale",
          documentId: document.id,
          location,
          excerpt,
          sectionLabel: label,
        };
      }
    }
    return {
      status: "ready",
      confidence: "exact",
      documentId: document.id,
      location,
      highlightQuery: location.textQuote ?? quoteFor(excerpt),
      excerpt,
      sectionLabel: label,
    };
  }

  // No structural anchor on the extract: try the constrained quote match.
  if (excerpt) {
    const matched = await resolveCitationLocation(document, quoteFor(excerpt));
    if (matched) {
      const matches = countQuoteMatches(document.content ?? "", excerpt, matched);
      if (matches === 1) {
        return {
          status: "ready",
          confidence: "matched",
          documentId: document.id,
          location: matched,
          highlightQuery: quoteFor(excerpt),
          excerpt,
          sectionLabel: label,
        };
      }
      return {
        status: "coarse",
        reason: "ambiguous",
        documentId: document.id,
        location: matched,
        excerpt,
        sectionLabel: label,
      };
    }
  }

  // Coarse page number is the last usable signal for extract-backed cards.
  if (typeof extract.page_number === "number" && document.fileType === "pdf") {
    return {
      status: "coarse",
      reason: "no-anchor",
      documentId: document.id,
      location: { kind: "pdf", pageNumber: extract.page_number },
      excerpt,
      sectionLabel: label,
    };
  }
  return {
    status: "coarse",
    reason: "no-anchor",
    documentId: document.id,
    excerpt,
    sectionLabel: label,
  };
}

/**
 * Resolve where a card came from. Never throws: every failure mode resolves
 * to a degradation level the UI can present.
 */
export async function resolveCardSource(item: CardSourceProbe): Promise<CardSourceResolution> {
  // 1. Extract-backed cards anchor through the extract.
  if (item.extract_id) {
    const extract = await getExtract(item.extract_id).catch(() => null);
    if (extract) {
      const document = await findDocument(extract.document_id);
      if (!document) {
        return { status: "unavailable", reason: "document-missing", excerpt: excerptFor(extract.content) };
      }
      return resolveFromExtract(document, extract);
    }
  }

  // 2. The card's own stored envelope.
  const reference = parseCardSourceReference(item.source_reference);
  if (reference) {
    const document = await findDocument(reference.document_id);
    if (!document) {
      return {
        status: "unavailable",
        reason: "document-missing",
        excerpt: excerptFor(reference.excerpt),
        sectionLabel: reference.section_label,
      };
    }
    return resolveFromEnvelope(document, reference);
  }

  // 3. The ai_provenance capture record (Learn-This path; local-only).
  const fromProvenance = await locatorFromAiProvenance(item.id);
  if (fromProvenance.documentId) {
    const document = await findDocument(fromProvenance.documentId);
    if (!document) {
      return {
        status: "unavailable",
        reason: "document-missing",
        excerpt: fromProvenance.excerpt ? excerptFor(fromProvenance.excerpt) : undefined,
      };
    }
    if (fromProvenance.location) {
      return {
        status: "ready",
        confidence: "exact",
        documentId: document.id,
        location: fromProvenance.location,
        highlightQuery: fromProvenance.excerpt ? quoteFor(fromProvenance.excerpt) : undefined,
        excerpt: excerptFor(fromProvenance.excerpt ?? ""),
      };
    }
    if (fromProvenance.excerpt) {
      const excerpt = excerptFor(fromProvenance.excerpt);
      const matched = await resolveCitationLocation(document, quoteFor(excerpt));
      if (matched) {
        return {
          status: "ready",
          confidence: "matched",
          documentId: document.id,
          location: matched,
          highlightQuery: quoteFor(excerpt),
          excerpt,
        };
      }
      return {
        status: "coarse",
        reason: "stale",
        documentId: document.id,
        excerpt,
      };
    }
  }

  return { status: "unavailable", reason: "no-source" };
}

/**
 * Resolve and open the card's source. Returns the resolution so callers can
 * present degraded outcomes (toasts, unavailable panels).
 */
export async function openCardSource(
  item: CardSourceProbe,
  addTab: TabsState["addTab"],
  options: { reviewReturn?: boolean; originTabId?: string } = {}
): Promise<CardSourceResolution> {
  const resolution = await resolveCardSource(item);

  if (resolution.status === "unavailable") return resolution;

  const location = resolution.location;
  if (!location && resolution.status === "coarse") {
    // No locator at all: open the document at its stored reading position.
    openDocumentAtLocation(
      resolution.documentId,
      {},
      addTab,
      options.reviewReturn
        ? { reviewReturn: true, originTabId: options.originTabId }
        : undefined
    );
    return resolution;
  }

  openDocumentAtLocation(
    resolution.documentId,
    {
      highlightQuery: resolution.highlightQuery,
      initialJump: location,
    },
    addTab,
    options.reviewReturn
      ? { reviewReturn: true, originTabId: options.originTabId }
      : undefined
  );
  return resolution;
}
