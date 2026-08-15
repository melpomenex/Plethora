/**
 * Open the source a "Ask library" citation points at (ai-library-rag spec:
 * "Source references navigate to origin").
 *
 * Reuses the existing citation-jump machinery: the chunk's stored location
 * (`location_json`, design D13) is mapped onto the same
 * `ExactSearchHitLocation` the Document Q&A sources footer and command
 * palette produce, then handed to `openDocumentAtLocation`. When the stored
 * location cannot be mapped directly (e.g. EPUB chunks before CFI
 * enrichment), the quote is re-resolved against the document content via
 * `resolveCitationLocation` — the exact DocumentQASources path.
 *
 * Extract/annotation/card chunks navigate to their owning document at the
 * quote (document-level open with highlight); their `anchor_id`/
 * `extract_id` give the domain surface, but the document view with the quote
 * highlighted is the one jump surface every source type shares.
 */

import type { ChunkLocation } from "../api/ai-learning";
import { getDocument } from "../api/documents";
import type { Document } from "../types/document";
import type { ExactSearchHitLocation } from "../types/searchHit";
import { resolveCitationLocation } from "./resolveCitationLocation";
import { openDocumentAtLocation } from "./openDocumentAtLocation";
import { useTabsStore } from "../stores/tabsStore";

/** Quote prefix used as the highlight/jump text. */
const QUOTE_PREFIX_CHARS = 120;

function quoteText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, QUOTE_PREFIX_CHARS).trim();
}

/**
 * Map a stored chunk location to a viewer jump when the mapping is direct.
 * Returns `undefined` when the location must be re-resolved from content
 * (caller falls back to `resolveCitationLocation`).
 */
export function chunkLocationToSearchHit(
  document: Document,
  location: ChunkLocation,
  chunkText: string
): ExactSearchHitLocation | undefined {
  const quote = quoteText(chunkText);
  switch (location.sourceType) {
    case "pdf":
      if (typeof location.pageNumber === "number" && location.pageNumber > 0) {
        return { kind: "pdf", pageNumber: location.pageNumber, textQuote: quote };
      }
      return undefined;
    case "epub":
      if (location.cfiRange) {
        return { kind: "epub", cfi: location.cfiRange, cfiRange: location.cfiRange, textQuote: quote };
      }
      return undefined;
    case "html":
    case "markdown":
    case "text":
    case "fts":
      return undefined; // offsets are chunker-projection scoped; re-resolve.
    default:
      return undefined;
  }
}

/**
 * Open the document a cited chunk belongs from, at the chunk's location when
 * resolvable, else at the document level with the quote highlighted.
 * Never throws — navigation is best-effort (matches DocumentQASources).
 */
export async function openLibrarySource(
  documentId: string,
  chunkText: string,
  location: ChunkLocation | undefined
): Promise<void> {
  try {
    const document = await getDocument(documentId).catch(() => null);
    if (!document) return;

    let jump: ExactSearchHitLocation | null = null;
    if (location) {
      jump = chunkLocationToSearchHit(document, location, chunkText) ?? null;
    }
    if (!jump) {
      // Fall back to resolving the quote in the document content — the same
      // best-effort path the Document Q&A sources footer uses.
      jump = await resolveCitationLocation(document, chunkText);
    }

    openDocumentAtLocation(
      documentId,
      {
        highlightQuery: quoteText(chunkText),
        initialJump: jump ?? undefined,
      },
      useTabsStore.getState().addTab
    );
  } catch {
    // Best-effort navigation; a failed jump must never surface an error over
    // the answer the user is reading.
  }
}
