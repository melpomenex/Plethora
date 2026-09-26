/**
 * Shared import routing for share targets and external-open events.
 */

import React from "react";
import { TextT } from "@phosphor-icons/react";
import { createDocument, updateDocument } from "../api/documents";
import { DocumentViewer } from "../components/viewer/DocumentViewer";
import type { useToast } from "../components/common/Toast";
import { ArticleImportError } from "../utils/articleImport/errors";
import { urlDetectorUtils } from "../hooks/useURLDetector";
import { mapManifestToProvenance } from "./shareTarget";
import type { SharedBatch } from "../types/share";
import type { useDocumentStore } from "../stores/documentStore";
import type { useTabsStore } from "../stores/tabsStore";

type DocumentStore = ReturnType<typeof useDocumentStore.getState>;
type TabsStore = ReturnType<typeof useTabsStore.getState>;

export interface ProcessSharedBatchDeps {
  t: (key: string, params?: Record<string, unknown>) => string;
  toast: ReturnType<typeof useToast>;
  getDocumentStore: () => DocumentStore;
  getTabsStore: () => TabsStore;
  openExternal: (url: string) => Promise<void>;
}

export interface ProcessSharedBatchResult {
  imported: number;
  failed: number;
}

/**
 * Route a normalized share/external batch through the existing import pipeline.
 */
export async function processSharedBatch(
  batch: SharedBatch,
  deps: ProcessSharedBatchDeps,
): Promise<ProcessSharedBatchResult> {
  if (!batch.items?.length) {
    return { imported: 0, failed: 0 };
  }

  const { t, toast, getDocumentStore, getTabsStore, openExternal } = deps;
  const { importFromUrl, openTwitterThread, importFromFiles, loadDocuments, persistWebArticleFailure } =
    getDocumentStore();
  const addTab = getTabsStore().addTab;

  const toastId = toast.info(
    t("mainLayout.importingSharedLink"),
    batch.items.length > 1
      ? `${batch.items.length} items`
      : batch.items[0].title ||
          batch.items[0].url ||
          batch.items[0].fileName ||
          "Shared content",
    { duration: 0 },
  );

  const importedDocs: Array<{ id: string; title?: string }> = [];
  let typedUrlFailures = 0;
  let failedCount = 0;

  try {
    const urlItems = batch.items.filter((i) => i.type === "url" && i.url);
    for (const item of urlItems) {
      if (!item.url) continue;
      try {
        if (urlDetectorUtils.isTwitterURL(item.url)) {
          const doc = await openTwitterThread(item.url);
          importedDocs.push(doc);
        } else {
          const doc = await importFromUrl(item.url);
          importedDocs.push(doc);
        }
      } catch (e) {
        failedCount += 1;
        console.error("[ImportRouting] Failed to import URL:", item.url, e);
        // FR-15: a failed capture must not lose the saved URL — preserve it
        // as a minimal library source (marked capture-failed) so the user
        // can retry from the reader. Malformed URLs cannot become sources.
        if (e instanceof ArticleImportError && e.code !== "invalid_url") {
          typedUrlFailures += 1;
          void persistWebArticleFailure(item.url, e.code);
          const reason = t(`shareImport.error.${e.code}`);
          toast.error(t("mainLayout.importFailed"), reason, {
            duration: 12000,
            action: e.retriable
              ? {
                  label: t("common.retry"),
                  onClick: () => {
                    importFromUrl(item.url as string)
                      .then(() => void loadDocuments())
                      .catch(() => undefined);
                  },
                }
              : e.openOriginalUseful
                ? {
                    label: t("webImport.openOriginal"),
                    onClick: () => void openExternal(item.url as string),
                  }
                : undefined,
          });
        }
      }
    }

    const fileItems = batch.items.filter((i) => i.type === "file" && i.filePath);
    if (fileItems.length > 0) {
      const paths = fileItems.map((f) => f.filePath as string);
      try {
        const docs = await importFromFiles(paths);
        importedDocs.push(...docs);
      } catch (e) {
        failedCount += fileItems.length;
        console.error("[ImportRouting] Failed to import files:", paths, e);
      }
    }

    const textItems = batch.items.filter((i) => i.type === "text" && i.text);
    for (const item of textItems) {
      if (!item.text) continue;
      try {
        const title = item.title || item.text.slice(0, 50).trim() || "Shared Note";
        const doc = await createDocument(title, `note://${Date.now()}`, "markdown");
        if (batch.id) {
          try {
            const provenance = mapManifestToProvenance(
              {
                id: batch.id,
                receivedAt: batch.timestamp,
                items: [{ kind: "text", text: item.text, title }],
              },
              "share_extension",
            );
            await updateDocument(doc.id, {
              ...doc,
              metadata: { ...doc.metadata, ...provenance },
            } as Parameters<typeof updateDocument>[1]);
          } catch (metaErr) {
            console.warn("[ImportRouting] Failed to persist share provenance:", metaErr);
          }
        }
        importedDocs.push(doc);
      } catch (e) {
        failedCount += 1;
        console.error("[ImportRouting] Failed to create note from text:", e);
      }
    }

    toast.dismiss(toastId);

    if (importedDocs.length > 0) {
      const firstDoc = importedDocs[0];
      toast.success(
        t("mainLayout.importedSuccessfully"),
        importedDocs.length === 1
          ? firstDoc.title || t("mainLayout.sharedLinkAdded")
          : `${importedDocs.length} documents imported`,
        {
          duration: 10000,
          action: {
            label: t("mainLayout.open"),
            onClick: () => {
              addTab({
                title: firstDoc.title,
                icon: React.createElement(TextT, {
                  className: "w-4 h-4 text-muted-foreground",
                }),
                type: "document-viewer",
                content: DocumentViewer,
                closable: true,
                data: { documentId: firstDoc.id },
              });
            },
          },
        },
      );
      void loadDocuments();
    } else if (typedUrlFailures === 0) {
      toast.error(t("mainLayout.importFailed"), "Could not process shared content");
    }
  } catch (err) {
    failedCount += batch.items.length;
    toast.dismiss(toastId);
    console.error("[ImportRouting] Failed to process batch:", err);
    toast.error(
      t("mainLayout.importFailed"),
      err instanceof Error ? err.message : String(err),
    );
  }

  return { imported: importedDocs.length, failed: failedCount };
}
