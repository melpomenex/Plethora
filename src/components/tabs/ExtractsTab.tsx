import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, MagnifyingGlass, Scissors, WarningCircle, X } from "@phosphor-icons/react";
import { useDocumentStore, useTabsStore } from "../../stores";
import { useCollectionStore } from "../../stores/collectionStore";
import { useExtractStore } from "../../stores/extractStore";
import { usePaneId } from "../common/Tabs";
import { useI18n } from "../../lib/i18n";
import { ExtractsList } from "../extracts/ExtractsList";
import { VideoExtractLibraryList } from "../video/VideoExtracts";
import { useAllVideoExtracts } from "../../hooks/useVideoExtracts";
import { DocumentViewer } from "./TabRegistry";
import { matchesExtractSearch, matchesVideoExtractSearch } from "../../utils/extractSearch";
import type { Extract } from "../../api/extracts";

/**
 * Library-wide extracts tab, opened from the toolbar's Extracts button.
 *
 * Loads every extract in the active collection through the shared extract
 * store (no document filter — same cache the command palette warms), groups
 * the result by source document, and renders one headed `ExtractsList` section
 * per document, most recently created first.
 *
 * Reusing `ExtractsList` keeps the card surface (selection, source context,
 * card generation, edit/delete) identical to the document viewer; the tab only
 * adds the grouping + navigation layer on top.
 */
export function ExtractsTab() {
  const { t } = useI18n();
  const addTab = useTabsStore((state) => state.addTab);
  const paneId = usePaneId();
  const extracts = useExtractStore((state) => state.extracts) as Extract[];
  const isLoading = useExtractStore((state) => state.isLoading);
  const loadError = useExtractStore((state) => state.error);
  const loadExtracts = useExtractStore((state) => state.loadExtracts);
  const documents = useDocumentStore((state) => state.documents);
  const activeCollectionId = useCollectionStore((state) => state.activeCollectionId);
  const videoQuery = useAllVideoExtracts(activeCollectionId);
  const videoCount = videoQuery.data?.length ?? 0;
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trimmedQuery = searchQuery.trim();

  useEffect(() => {
    // The store swallows load errors (legacy callers fire-and-forget); the
    // error state below is driven by the store's `error` field instead.
    void loadExtracts().catch(() => {});
  }, [loadExtracts]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (searchInputRef.current) {
        event.preventDefault();
        searchInputRef.current.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const titleByDocumentId = useMemo(() => {
    const map = new Map<string, string>();
    for (const doc of documents) {
      map.set(doc.id, doc.title);
    }
    return map;
  }, [documents]);

  // Group by source document, preserving recency (newest first). Extracts
  // without a document_id (e.g. browser-extension drops) are skipped: every
  // group renders the per-document `ExtractsList`, which requires a real
  // document id, so a fallback group would show an empty section and a
  // dead "jump to source" link.
  const { groups, totalTextCount, matchingTextCount } = useMemo(() => {
    const sorted = [...extracts]
      .filter((extract) => !!extract.document_id)
      .sort(
        (a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime(),
      );

    const fallbackTitleByDoc = new Map<string, string>();
    for (const extract of sorted) {
      if (!fallbackTitleByDoc.has(extract.document_id) && extract.page_title) {
        fallbackTitleByDoc.set(extract.document_id, extract.page_title);
      }
    }

    const resolveTitle = (documentId: string) =>
      titleByDocumentId.get(documentId) ??
      fallbackTitleByDoc.get(documentId) ??
      t("extractsTab.untitledDocument");

    const filtered = trimmedQuery
      ? sorted.filter((extract) =>
          matchesExtractSearch(extract, trimmedQuery, resolveTitle(extract.document_id)),
        )
      : sorted;

    const byDocument = new Map<string, Extract[]>();
    for (const extract of filtered) {
      const list = byDocument.get(extract.document_id) ?? [];
      list.push(extract);
      byDocument.set(extract.document_id, list);
    }
    const grouped = Array.from(byDocument.entries()).map(([documentId, items]) => ({
      documentId,
      title: resolveTitle(documentId),
      focusedExtractId: items[0]?.id,
    }));
    return {
      groups: grouped,
      totalTextCount: sorted.length,
      matchingTextCount: filtered.length,
    };
  }, [extracts, titleByDocumentId, trimmedQuery, t]);

  const matchingVideoCount = useMemo(() => {
    const videos = videoQuery.data ?? [];
    if (!trimmedQuery) return videos.length;
    return videos.filter((extract) =>
      matchesVideoExtractSearch(
        extract,
        trimmedQuery,
        titleByDocumentId.get(extract.document_id) ?? extract.document_title,
      ),
    ).length;
  }, [videoQuery.data, trimmedQuery, titleByDocumentId]);

  const openVideoExtract = (documentId: string, title: string, extractId: string) => {
    addTab(
      {
        title,
        icon: <Scissors className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId, focusedVideoExtractId: extractId, hideRatingOrbs: true },
      },
      paneId,
    );
  };

  const openSourceDocument = (documentId: string, title: string, focusedExtractId?: string) => {
    addTab(
      {
        title,
        icon: <Scissors className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: {
          documentId,
          initialViewMode: "extracts",
          ...(focusedExtractId ? { focusedExtractId } : {}),
        },
      },
      paneId,
    );
  };

  if (isLoading && extracts.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">{t("extractsTab.loading")}</p>
      </div>
    );
  }

  if (loadError && extracts.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
          <WarningCircle className="mx-auto mb-3 w-10 h-10 text-destructive" />
          <h3 className="mb-1 text-base font-semibold text-foreground">{t("extractsTab.failedToLoad")}</h3>
          <p className="mb-4 text-sm text-muted-foreground">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadExtracts().catch(() => {})}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (totalTextCount === 0 && videoCount === 0 && !videoQuery.isLoading && !videoQuery.error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <Scissors className="mx-auto mb-4 w-14 h-14 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold text-foreground">{t("extractsTab.emptyTitle")}</h3>
          <p className="text-sm text-muted-foreground">{t("extractsTab.emptyBody")}</p>
        </div>
      </div>
    );
  }

  const totalCount = totalTextCount + videoCount;
  const matchingCount = matchingTextCount + matchingVideoCount;

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("extractsTab.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {trimmedQuery
                ? t("extractsTab.searchResultsCount", {
                    count: matchingCount,
                    total: totalCount,
                  })
                : t("extractsTab.subtitle", { count: totalCount })}
            </p>
          </div>
        </div>

        <div className="sticky top-0 z-20 -mx-6 mb-6 border-b border-border/50 bg-background/85 px-6 py-2.5 backdrop-blur-md">
          <div className="relative">
            <MagnifyingGlass
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  if (searchQuery) {
                    event.preventDefault();
                    setSearchQuery("");
                  } else {
                    searchInputRef.current?.blur();
                  }
                }
              }}
              placeholder={t("extractsTab.searchPlaceholder")}
              aria-label={t("extractsTab.searchPlaceholder")}
              className="w-full rounded-lg border border-border bg-card/80 py-2 pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-shadow focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary [&::-webkit-search-cancel-button]:hidden"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                aria-label={t("extractsTab.clearSearch")}
                title={t("extractsTab.clearSearch")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-block">
                /
              </kbd>
            )}
          </div>
        </div>

        <div className="space-y-8">
          {trimmedQuery && groups.length === 0 && matchingVideoCount === 0 ? (
            <div className="rounded-xl border border-border bg-card/40 px-6 py-12 text-center">
              <MagnifyingGlass className="mx-auto mb-3 h-10 w-10 text-muted-foreground/70" />
              <h3 className="mb-1 text-base font-semibold text-foreground">
                {t("extractsTab.noSearchResultsTitle", { query: trimmedQuery })}
              </h3>
              <p className="mb-4 text-sm text-muted-foreground">
                {t("extractsTab.noSearchResultsBody")}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                className="rounded-md border border-border bg-background px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {t("extractsTab.clearSearch")}
              </button>
            </div>
          ) : (
            <>
              {!trimmedQuery && groups.length === 0 && !videoQuery.isLoading && videoCount > 0 && (
                <p className="text-sm text-muted-foreground">{t("extractsTab.noTextExtracts")}</p>
              )}

              {groups.map((group) => (
                <section key={group.documentId} className="space-y-3">
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                    <button
                      type="button"
                      onClick={() => openSourceDocument(group.documentId, group.title, group.focusedExtractId)}
                      className="group flex min-w-0 items-center gap-2 text-left"
                      title={t("extractsTab.jumpToSourceTitle")}
                    >
                      <span className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                        {group.title}
                      </span>
                      <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openSourceDocument(group.documentId, group.title, group.focusedExtractId)}
                      className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                    >
                      {t("documentsView.openDocument")}
                    </button>
                  </div>
                  {/* ponytail: with a very large library this renders one fetch + card
                      grid per document group; if it ever becomes slow, window the
                      groups inside this component only. */}
                  <ExtractsList
                    documentId={group.documentId}
                    documentTitle={group.title}
                    focusedExtractId={undefined}
                    searchQuery={trimmedQuery}
                  />
                </section>
              ))}
              {(!trimmedQuery || matchingVideoCount > 0) && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                    <h3 className="text-sm font-medium text-foreground">{t("videoExtract.libraryTitle")}</h3>
                  </div>
                  <VideoExtractLibraryList
                    collectionId={activeCollectionId}
                    searchQuery={trimmedQuery}
                    onPlayExtract={(extract) => openVideoExtract(extract.document_id, extract.title, extract.id)}
                  />
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
