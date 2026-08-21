/**
 * Hook for consuming native Android/iOS and Web Share Target intents.
 *
 * Listens for incoming shared batches, routes URLs and staged files to
 * useDocumentStore, and creates notifications with immediate "Open" action.
 */

import React, { useEffect, useRef } from "react";
import { fetchPendingShares, registerShareListener } from "../lib/shareTarget";
import { useDocumentStore } from "../stores/documentStore";
import { useTabsStore } from "../stores/tabsStore";
import { useToast } from "../components/common/Toast";
import { useI18n } from "../lib/i18n";
import { createDocument } from "../api/documents";
import { DocumentViewer } from "../components/viewer/DocumentViewer";
import { TextT } from "@phosphor-icons/react";
import type { SharedBatch, SharedItem } from "../types/share";
import { ArticleImportError } from "../utils/articleImport/errors";
import { urlDetectorUtils } from "./useURLDetector";

export function useShareTarget() {
  const toast = useToast();
  const { t } = useI18n();
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const handleBatch = async (batch: SharedBatch) => {
      if (!batch.items || batch.items.length === 0) return;
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      const { importFromUrl, openTwitterThread, importFromFiles, loadDocuments } =
        useDocumentStore.getState();
      const addTab = useTabsStore.getState().addTab;

      const toastId = toast.info(
        t("mainLayout.importingSharedLink"),
        batch.items.length > 1
          ? `${batch.items.length} items`
          : batch.items[0].title || batch.items[0].url || batch.items[0].fileName || "Shared content",
        { duration: 0 }
      );

      try {
        const importedDocs: any[] = [];
        let typedUrlFailures = 0;

        // 1. Process URLs
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
            console.error("[Share Target] Failed to import shared URL:", item.url, e);
            // Typed failure: show the reason with a retry action (or "Open
            // original" for non-retriable extraction failures). No document
            // was created — the user decides what happens next.
            if (e instanceof ArticleImportError) {
              typedUrlFailures += 1;
              const reason = t(`shareImport.error.${e.code}`);
              const openOriginal = () => {
                void import("../lib/tauri").then(({ openExternal }) =>
                  openExternal(item.url as string)
                );
              };
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
                    ? { label: t("webImport.openOriginal"), onClick: openOriginal }
                    : undefined,
              });
            }
          }
        }

        // 2. Process staged files
        const fileItems = batch.items.filter(
          (i) => i.type === "file" && i.filePath
        );
        if (fileItems.length > 0) {
          const paths = fileItems.map((f) => f.filePath as string);
          try {
            const docs = await importFromFiles(paths);
            importedDocs.push(...docs);
          } catch (e) {
            console.error("[Share Target] Failed to import shared files:", paths, e);
          }
        }

        // 3. Process text snippets / notes
        const textItems = batch.items.filter(
          (i) => i.type === "text" && i.text
        );
        for (const item of textItems) {
          if (!item.text) continue;
          try {
            const title = item.title || item.text.slice(0, 50).trim() || "Shared Note";
            const doc = await createDocument(
              title,
              `note://${Date.now()}`,
              "markdown"
            );
            importedDocs.push(doc);
          } catch (e) {
            console.error("[Share Target] Failed to create document from shared text:", e);
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
                    icon: React.createElement(TextT, { className: "w-4 h-4 text-muted-foreground" }),
                    type: "document-viewer",
                    content: DocumentViewer,
                    closable: true,
                    data: { documentId: firstDoc.id },
                  });
                },
              },
            }
          );
          void loadDocuments();
        } else if (typedUrlFailures === 0) {
          // Typed failures already showed their own actionable toast.
          toast.error(
            t("mainLayout.importFailed"),
            "Could not process shared content"
          );
        }
      } catch (err) {
        toast.dismiss(toastId);
        console.error("[Share Target] Failed to process shared batch:", err);
        toast.error(
          t("mainLayout.importFailed"),
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        isProcessingRef.current = false;
      }
    };

    // Check PWA query parameter in hash route: #/?shared_url=... or #/?shared_text=...
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash.includes("?shared_url=") || hash.includes("?shared_text=")) {
        try {
          const hashParams = new URLSearchParams(hash.split("?")[1]);
          const sharedUrl = hashParams.get("shared_url");
          const sharedText = hashParams.get("shared_text");
          const sharedTitle = hashParams.get("title");

          const items: SharedItem[] = [];
          if (sharedUrl) {
            items.push({ type: "url", url: sharedUrl, title: sharedTitle || undefined });
          }
          if (sharedText) {
            items.push({ type: "text", text: sharedText, title: sharedTitle || undefined });
          }

          if (items.length > 0) {
            const cleanHash = hash.split("?")[0];
            window.location.hash = cleanHash;
            void handleBatch({ timestamp: Date.now(), items });
          }
        } catch (e) {
          console.error("[Share Target] Failed to parse hash query params:", e);
        }
      }
    }

    const unsubscribe = registerShareListener(handleBatch);

    // Cold-start drain: consume batches queued before the listener was
    // registered (Android pending queue / iOS App Group staged manifests).
    // The native side returns-and-clears, so this never double-delivers with
    // registerShareListener's own pending-batch return.
    void fetchPendingShares().then((batches) => {
      for (const batch of batches) {
        void handleBatch(batch);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [t, toast]);
}
