import { useEffect, useMemo } from "react";
import { ArrowRight, Scissors, WarningCircle } from "@phosphor-icons/react";
import { useDocumentStore, useTabsStore } from "../../stores";
import { useExtractStore } from "../../stores/extractStore";
import { usePaneId } from "../common/Tabs";
import { useI18n } from "../../lib/i18n";
import { ExtractsList } from "../extracts/ExtractsList";
import { DocumentViewer } from "./TabRegistry";
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

  useEffect(() => {
    // The store swallows load errors (legacy callers fire-and-forget); the
    // error state below is driven by the store's `error` field instead.
    void loadExtracts().catch(() => {});
  }, [loadExtracts]);

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
  const { groups, visibleCount } = useMemo(() => {
    const sorted = [...extracts]
      .filter((extract) => !!extract.document_id)
      .sort(
        (a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime(),
      );
    const byDocument = new Map<string, Extract[]>();
    for (const extract of sorted) {
      const list = byDocument.get(extract.document_id) ?? [];
      list.push(extract);
      byDocument.set(extract.document_id, list);
    }
    const grouped = Array.from(byDocument.entries()).map(([documentId, items]) => ({
      documentId,
      title:
        titleByDocumentId.get(documentId) ??
        items.find((extract) => extract.page_title)?.page_title ??
        t("extractsTab.untitledDocument"),
      focusedExtractId: items[0]?.id,
    }));
    return { groups: grouped, visibleCount: sorted.length };
  }, [extracts, titleByDocumentId, t]);

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

  if (extracts.length === 0 || groups.length === 0) {
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

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("extractsTab.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("extractsTab.subtitle", { count: visibleCount })}</p>
          </div>
        </div>

        <div className="space-y-8">
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
              <ExtractsList documentId={group.documentId} focusedExtractId={undefined} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
