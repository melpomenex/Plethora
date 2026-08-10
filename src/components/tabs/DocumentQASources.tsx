/**
 * Interactive sources footer for Document Q&A answers.
 *
 * Renders one entry per retrieval citation: index, document title, a quote
 * from the cited chunk, and a resolved location label (page number /
 * timestamp / passage). Activating a resolved entry opens the cited document
 * at the passage, highlighted — the same payload the command palette builds
 * (via `openDocumentAtLocation`).
 *
 * Resolution is best-effort and async (see `utils/resolveCitationLocation`).
 * The document store only carries content-less summaries (the backend NULLs
 * `content`/`content_hash` in list queries), so the footer fetches the full
 * document via `getDocument(id)` before resolving. Some cited rows are
 * "ghosts": RAG-chunked documents whose row has neither content nor a file
 * path (the real file lives on a same-title sibling row with a matching
 * content hash). When that happens, the footer resolves — and opens — through
 * the openable sibling, and only when the cited quote is actually found in it.
 *
 * Results are memoized per `(documentId, chunkIndex)` + content version for
 * the session so re-renders do not rescan large documents and a re-import with
 * changed content re-resolves instead of replaying a stale location. Entries
 * whose document is unavailable or whose passage can no longer be located
 * render inert with a stated reason instead of jumping to an arbitrary
 * position.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { RagHit } from "../../api/rag";
import type { Document } from "../../types/document";
import type { ExactSearchHitLocation } from "../../types/searchHit";
import { getDocument } from "../../api/documents";
import { resolveCitationLocation } from "../../utils/resolveCitationLocation";
import { openDocumentAtLocation } from "../../utils/openDocumentAtLocation";
import { useDocumentStore } from "../../stores/documentStore";
import { useTabsStore } from "../../stores/tabsStore";
import { t, useI18n } from "../../lib/i18n";

const QUOTE_DISPLAY_CHARS = 200;

interface CachedResolution {
  /** Content version the location was resolved against (for re-import detection). */
  version: string;
  location: ExactSearchHitLocation | null;
  /** Document to open on activation (the cited row, or its openable sibling). */
  openDocumentId: string;
}

/** Session-scoped resolution cache: (documentId, chunkIndex) -> cached result. */
const resolutionCache = new Map<string, CachedResolution>();

function cacheKey(citation: RagHit): string {
  return `${citation.documentId}:${citation.chunkIndex}`;
}

function contentVersion(document: Document): string {
  return document.contentHash ?? document.dateModified ?? document.id;
}

/** File types whose location is resolved from the document's stored content. */
function needsDocumentContent(fileType: Document["fileType"]): boolean {
  return fileType === "pdf" || fileType === "epub" || fileType === "html" || fileType === "markdown";
}

function formatTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function locationLabel(
  location: ExactSearchHitLocation,
  translate: (key: string, vars?: Record<string, string | number>) => string
): string {
  switch (location.kind) {
    case "pdf":
      return translate("qaSources.page", { page: location.pageNumber });
    case "youtube":
    case "audio":
      return formatTimestamp(location.timeSeconds);
    case "epub":
    case "html":
    case "markdown":
      return translate("qaSources.passage");
  }
}

type Resolution =
  | { state: "missing-document" }
  | { state: "pending" }
  | { state: "located"; location: ExactSearchHitLocation; openDocumentId: string }
  | { state: "not-located" };

export function DocumentQASources({ citations }: { citations: RagHit[] }) {
  const { t: translate } = useI18n();
  const documents = useDocumentStore((state) => state.documents);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  // Monotonic run id: a stale effect run (superseded by a newer one) must not
  // write its resolution into state after the newer run has taken over.
  const runRef = useRef(0);
  // Full-document fetch cache for the current resolution pass. Rebuilt whenever
  // the library changes so a deletion or re-import is observed on the next pass.
  const documentFetchCacheRef = useRef(new Map<string, Promise<Document | null>>());

  // Rebuild the per-pass fetch cache when the library changes.
  useEffect(() => {
    documentFetchCacheRef.current = new Map();
  }, [documents]);

  const entries = useMemo(
    () => citations.map((citation) => ({ citation, key: cacheKey(citation) })),
    [citations]
  );

  useEffect(() => {
    const run = ++runRef.current;
    const immediate: Record<string, Resolution> = {};
    for (const { citation, key } of entries) {
      immediate[key] = { state: "pending" };
      void (async () => {
        const fetchCache = documentFetchCacheRef.current;
        let fullDocPromise = fetchCache.get(citation.documentId);
        if (!fullDocPromise) {
          fullDocPromise = getDocument(citation.documentId).catch(() => null);
          fetchCache.set(citation.documentId, fullDocPromise);
        }
        const citedDoc = await fullDocPromise;
        if (run !== runRef.current) return;
        if (!citedDoc) {
          // Document is truly unavailable (deleted). Deliberately NOT cached so
          // a later re-import of the same id can resolve again — caching null
          // here would also conflate "document missing" with "quote not
          // located" and flip the stated reason.
          setResolutions((prev) => ({ ...prev, [key]: { state: "missing-document" } }));
          return;
        }

        let target = citedDoc;
        let openDocumentId = citedDoc.id;
        if (needsDocumentContent(citedDoc.fileType) && !citedDoc.content?.trim()) {
          // The cited row is a content-less "ghost" (RAG-chunked rows can exist
          // without a file); resolve through its openable sibling — same title,
          // has a file path, matching content hash — so the citation still
          // opens the real document. The quote match below is the safety net:
          // no location is produced unless the passage is found in the target.
          const sibling = await findOpenableSibling(citedDoc, documents, fetchCache);
          if (run !== runRef.current) return;
          if (sibling) {
            target = sibling;
            openDocumentId = sibling.id;
          }
        }

        const version = contentVersion(target);
        const cached = resolutionCache.get(key);
        if (cached && cached.version === version && cached.openDocumentId === openDocumentId) {
          setResolutions((prev) => ({
            ...prev,
            [key]:
              cached.location === null
                ? { state: "not-located" }
                : {
                    state: "located",
                    location: cached.location,
                    openDocumentId: cached.openDocumentId,
                  },
          }));
          return;
        }
        const location = await resolveCitationLocation(target, citation.chunkText);
        if (run !== runRef.current) return;
        resolutionCache.set(key, { version, location, openDocumentId });
        setResolutions((prev) => ({
          ...prev,
          [key]:
            location === null
              ? { state: "not-located" }
              : { state: "located", location, openDocumentId },
        }));
      })();
    }
    setResolutions((prev) => ({ ...prev, ...immediate }));
  }, [entries, documents]);

  const handleActivate = (
    citation: RagHit,
    location: ExactSearchHitLocation,
    openDocumentId: string
  ) => {
    openDocumentAtLocation(
      openDocumentId,
      {
        highlightQuery:
          typeof location.textQuote === "string" && location.textQuote.trim()
            ? location.textQuote
            : citation.chunkText,
        initialJump: location,
      },
      useTabsStore.getState().addTab
    );
  };

  if (citations.length === 0) return null;

  return (
    <div className="mt-3 pt-2.5 border-t border-border/70">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
        {translate("qaSources.heading")}
      </div>
      <ol className="space-y-1">
        {entries.map(({ citation, key }, index) => {
          const resolution = resolutions[key];
          const location = resolution?.state === "located" ? resolution.location : undefined;
          const disabled = resolution?.state !== "located";
          const reason =
            resolution?.state === "missing-document"
              ? translate("qaSources.documentUnavailable")
              : resolution?.state === "not-located"
                ? translate("qaSources.passageNotLocated")
                : undefined;
          const quote =
            citation.chunkText.length > QUOTE_DISPLAY_CHARS
              ? `${citation.chunkText.slice(0, QUOTE_DISPLAY_CHARS)}…`
              : citation.chunkText;

          return (
            <li key={`${citation.documentId}-${citation.chunkIndex}`}>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  location &&
                  resolution?.state === "located" &&
                  handleActivate(citation, location, resolution.openDocumentId)
                }
                className="w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {citation.documentTitle}
                  </span>
                  <span className="block text-muted-foreground line-clamp-2">{quote}</span>
                  <span className="block text-[11px] text-primary/80">
                    {location ? locationLabel(location, translate) : reason}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Find the openable sibling of a content-less cited row: another document with
 * the same title that has a file path and (when both hashes are known) the
 * same content hash. Returns the sibling's full document, or `null`.
 */
async function findOpenableSibling(
  cited: Document,
  documents: Document[],
  fetchCache: Map<string, Promise<Document | null>>
): Promise<Document | null> {
  for (const candidate of documents) {
    if (candidate.id === cited.id) continue;
    if (candidate.title !== cited.title) continue;
    if (!candidate.filePath || !candidate.filePath.trim()) continue;
    let promise = fetchCache.get(candidate.id);
    if (!promise) {
      promise = getDocument(candidate.id).catch(() => null);
      fetchCache.set(candidate.id, promise);
    }
    const full = await promise;
    if (!full || !full.content || !full.content.trim()) continue;
    if (cited.contentHash && full.contentHash && cited.contentHash !== full.contentHash) continue;
    return full;
  }
  return null;
}

/**
 * Plain-text rendering of an answer plus its sources, used by the copy button.
 * When no citations are present, returns the answer text alone (older
 * persisted messages keep copying exactly what they render).
 */
export function sourcesCopyText(content: string, citations: RagHit[] | undefined): string {
  if (!citations || citations.length === 0) return content;
  const lines = [content, "", t("qaSources.heading")];
  citations.forEach((citation, index) => {
    // Only known locations are listed — if resolution has not landed yet (the
    // footer resolves asynchronously on render), the title is still included
    // and the location suffix is omitted rather than guessed.
    const cached = resolutionCache.get(cacheKey(citation));
    const location = cached?.location;
    const suffix = location ? ` — ${locationLabel(location, t)}` : "";
    lines.push(`${index + 1}. ${citation.documentTitle}${suffix}`);
  });
  return lines.join("\n");
}
