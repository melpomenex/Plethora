/**
 * Shared import routing for share targets and external-open events.
 */

import { createDocument, mergeDocumentMetadata, updateDocumentContent } from "../api/documents";
import type { useToast } from "../components/common/Toast";
import { ArticleImportError } from "../utils/articleImport/errors";
import { urlDetectorUtils } from "../hooks/useURLDetector";
import { mapShareItemToProvenance, mergeShareAttribution } from "./shareTarget";
import { emitCaptureInvalidation } from "./captureInvalidation";
import { openDocumentAtLocation } from "../utils/openDocumentAtLocation";
import { classifyUrl, detectSharedFileKind } from "../services/recording/urlAdapters";
import { useUIStore } from "../stores/uiStore";
import type { SharedBatch, SharedItem } from "../types/share";
import type { useDocumentStore } from "../stores/documentStore";
import type { useTabsStore } from "../stores/tabsStore";
import type { Document } from "../types/document";

export interface NativeShareIngressContext {
  origin: "share_extension" | "android_share";
  sourceApp?: string;
}

const pendingShareAttributions = new Map<string, Document>();

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

function shareItemKey(batch: SharedBatch, item: SharedItem, ingress: NativeShareIngressContext): string {
  const identity = item.url ?? item.filePath ?? item.fileName ?? item.text ?? item.title ?? "unknown";
  return `${batch.id ?? batch.timestamp}:${ingress.origin}:${item.type}:${identity}`;
}

/**
 * Route a normalized share/external batch through the existing import pipeline.
 */
export async function processSharedBatch(
  batch: SharedBatch,
  deps: ProcessSharedBatchDeps,
  shareIngress?: NativeShareIngressContext,
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
  const savedDocumentIds = new Set<string>();
  let typedUrlFailures = 0;
  let failedCount = 0;
  let attributionFailed = false;
  let hasXThreadError = false;

  const saveAndAttribute = async (
    item: SharedItem,
    save: () => Promise<Document | null | undefined>,
  ): Promise<Document> => {
    const key = shareIngress ? shareItemKey(batch, item, shareIngress) : undefined;
    let document = key ? pendingShareAttributions.get(key) : undefined;
    if (!document) {
      document = (await save()) ?? undefined;
    }
    if (!document?.id) throw new Error("Import did not return a saved document");
    if (!shareIngress) return document;

    try {
      const update = mapShareItemToProvenance(
        { ...batch, sourceApp: batch.sourceApp ?? shareIngress.sourceApp },
        item,
        shareIngress.origin,
      );
      const merged = mergeShareAttribution(document.metadata, update);
      const patch = {
        shareProvenance: merged.shareProvenance,
        ...(document.metadata?.captureProvenance ? {} : merged.captureProvenance
          ? { captureProvenance: merged.captureProvenance }
          : {}),
      };
      await mergeDocumentMetadata(document.id, patch);
      if (key) pendingShareAttributions.delete(key);
      savedDocumentIds.add(document.id);
      return { ...document, metadata: { ...document.metadata, ...merged } };
    } catch (error) {
      if (key) pendingShareAttributions.set(key, document);
      throw new Error(`Share attribution could not be saved for ${document.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const retryAttribution = async (action: () => Promise<Document>): Promise<Document> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await action(); } catch (error) { lastError = error; }
    }
    throw lastError;
  };

  try {
    const urlItems = batch.items.filter((i) => i.type === "url" && i.url);
    for (const item of urlItems) {
      if (!item.url) continue;

      // Policy check before attempting any fetch
      const decision = classifyUrl(item.url);
      if (!decision.isAllowed) {
        failedCount += 1;
        console.warn("[ImportRouting] URL refused by policy:", item.url, decision.reason);
        toast.error(t("mainLayout.importFailed"), decision.reason || "URL refused by policy", {
          duration: 10000,
        });
        continue;
      }

      // Route direct media and transcript URLs into unified capture/import dialog
      if (decision.adapter === "direct-media" || decision.adapter === "direct-transcript") {
        useUIStore.getState().setCaptureImportDialogOpen(
          true,
          "import-url",
          {
            url: item.url,
            title: item.title,
          }
        );
        importedDocs.push({ id: `session-url-${item.url}`, title: item.title || item.url });
        continue;
      }

      try {
        if (urlDetectorUtils.isTwitterURL(item.url)) {
          const doc = await retryAttribution(() => saveAndAttribute(item, () => openTwitterThread(item.url as string)));
          if (doc?.metadata?.xThreadError) {
            failedCount += 1;
            hasXThreadError = true;
            console.warn("[ImportRouting] X thread import returned error metadata:", doc.metadata.xThreadError);
            if (doc.id) {
              openDocumentAtLocation(doc.id, {}, addTab);
            }
          } else if (doc) {
            importedDocs.push(doc);
            if (doc.id) {
              openDocumentAtLocation(doc.id, {}, addTab);
            }
          }
        } else {
          const doc = await retryAttribution(() => saveAndAttribute(item, () => importFromUrl(item.url as string)));
          importedDocs.push(doc);
        }
      } catch (e) {
        failedCount += 1;
        if (shareIngress && !(e instanceof ArticleImportError)) attributionFailed = true;
        console.error("[ImportRouting] Failed to import URL:", item.url, e);
        // FR-15: a failed capture must not lose the saved URL — preserve it
        // as a minimal library source (marked capture-failed) so the user
        // can retry from the reader. Malformed URLs cannot become sources.
        if (e instanceof ArticleImportError && e.code !== "invalid_url") {
          typedUrlFailures += 1;
          try {
            const placeholder = await persistWebArticleFailure(item.url, e.code);
            if (placeholder) {
              await retryAttribution(() => saveAndAttribute(item, async () => placeholder));
              failedCount = Math.max(0, failedCount - 1);
            }
          } catch (persistErr) {
            if (shareIngress) attributionFailed = true;
            console.error("[ImportRouting] Failed to save/attribute URL placeholder:", item.url, persistErr);
          }
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

    const fileItems = batch.items.filter((i) => i.type === "file" && (i.filePath || i.fileName));
    if (fileItems.length > 0) {
      const mediaOrTranscriptFiles: SharedItem[] = [];
      const regularFiles: SharedItem[] = [];

      for (const item of fileItems) {
        const target = item.filePath || item.fileName || "";
        const detection = detectSharedFileKind(target);
        if (detection.isRecording || detection.isTranscript) {
          mediaOrTranscriptFiles.push(item);
        } else {
          regularFiles.push(item);
        }
      }

      // Handle media / transcript shares by opening Capture & Import
      if (mediaOrTranscriptFiles.length > 1) {
        const first = mediaOrTranscriptFiles[0];
        const detection = detectSharedFileKind(first.filePath || first.fileName || "");
        useUIStore.getState().setCaptureImportDialogOpen(
          true,
          detection.suggestedRoute,
          {
            filePath: first.filePath,
            filePaths: mediaOrTranscriptFiles.map((m) => m.filePath).filter(Boolean) as string[],
            fileName: first.fileName,
            fileNames: mediaOrTranscriptFiles.map((m) => m.fileName).filter(Boolean) as string[],
            title: first.title,
          }
        );
        for (const item of mediaOrTranscriptFiles) {
          importedDocs.push({
            id: `session-file-${item.filePath || item.fileName}`,
            title: item.fileName || item.title || "Shared recording",
          });
        }
      } else if (mediaOrTranscriptFiles.length === 1) {
        const item = mediaOrTranscriptFiles[0];
        if (!item.filePath && !item.fileName) {
          failedCount += 1;
          toast.error(t("mainLayout.importFailed"), "The shared file is no longer accessible or has expired.");
        } else {
          const detection = detectSharedFileKind(item.filePath || item.fileName || "");
          useUIStore.getState().setCaptureImportDialogOpen(
            true,
            detection.suggestedRoute,
            {
              filePath: item.filePath,
              fileName: item.fileName,
              title: item.title,
            }
          );
          importedDocs.push({
            id: `session-file-${item.filePath || item.fileName}`,
            title: item.fileName || item.title || "Shared recording",
          });
        }
      }

      // Handle regular files via existing importFromFiles
      if (regularFiles.length > 0) {
        const paths = regularFiles.map((f) => f.filePath as string).filter(Boolean);
        try {
          const docs = await importFromFiles(paths);
          for (const [index, doc] of docs.entries()) {
            const item = regularFiles[index];
            if (!item) continue;
            try {
              const attributed = await retryAttribution(() => saveAndAttribute(item, async () => doc));
              importedDocs.push(attributed);
            } catch (error) {
              failedCount += 1;
              attributionFailed = true;
              console.error("[ImportRouting] Failed to persist file share attribution:", item.filePath, error);
            }
          }
        } catch (e) {
          failedCount += regularFiles.length;
          console.error("[ImportRouting] Failed to import files:", paths, e);
        }
      }
    }

    const textItems = batch.items.filter((i) => i.type === "text" && i.text);
    for (const item of textItems) {
      if (!item.text) continue;
      try {
        const title = item.title || item.text.slice(0, 50).trim() || "Shared Note";
        const doc = await retryAttribution(() => saveAndAttribute(item, async () => {
          const created = await createDocument(title, `note://${Date.now()}`, "markdown");
          return updateDocumentContent(created.id, item.text as string);
        }));
        importedDocs.push(doc);
      } catch (e) {
        failedCount += 1;
        if (shareIngress) attributionFailed = true;
        console.error("[ImportRouting] Failed to create note from text:", e);
      }
    }

    toast.dismiss(toastId);

    if (importedDocs.length > 0 && !attributionFailed) {
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
              openDocumentAtLocation(firstDoc.id, {}, addTab);
            },
          },
        },
      );
      void loadDocuments();
    } else if (attributionFailed) {
      toast.error(t("mainLayout.importFailed"), t("shareTarget.pendingSharesMessage"), {
        duration: 12000,
        action: {
          label: t("common.retry"),
          onClick: () => { void processSharedBatch(batch, deps, shareIngress); },
        },
      });
    } else if (typedUrlFailures === 0 && !hasXThreadError) {
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

  if (shareIngress && savedDocumentIds.size > 0) {
    emitCaptureInvalidation({ source: "share-target", documentIds: [...savedDocumentIds] });
  }
  return { imported: importedDocs.length, failed: failedCount };
}
