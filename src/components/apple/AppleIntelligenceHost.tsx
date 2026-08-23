import { useEffect, useRef } from "react";
import { createDocument, updateDocumentContent } from "../../api/documents";
import { useDocumentStore } from "../../stores/documentStore";
import { useUIStore } from "../../stores/uiStore";
import { ToastType, useToastStore } from "../common/Toast";
import { appleStartLiveSpeech, appleStopLiveSpeech } from "../../lib/ai/apple/speech";
import { importAppleDocumentScan } from "../../lib/ai/apple/importVisionDocument";

/**
 * Hosts command-palette Apple intelligence actions that must run at the app
 * root (scan, lecture capture, ask-library navigation).
 */
export function AppleIntelligenceHost() {
  const lectureDocId = useRef<string | null>(null);
  const recording = useRef(false);

  useEffect(() => {
    const onScan = () => {
      void (async () => {
        try {
          const doc = await importAppleDocumentScan();
          useToastStore.getState().addToast({
            type: ToastType.Success,
            title: "Document scan",
            message: doc.title,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/cancelled/i.test(message)) return;
          useToastStore.getState().addToast({
            type: ToastType.Error,
            title: "Document scan failed",
            message,
          });
        }
      })();
    };

    const onAskLibrary = () => {
          useUIStore.getState().setCommandPaletteOpen(false);
      window.dispatchEvent(new CustomEvent("navigate", { detail: "/search" }));
    };

    const onLecture = () => {
      void (async () => {
        try {
          if (recording.current) {
            recording.current = false;
            const result = (await appleStopLiveSpeech()) as { text?: string };
            const id = lectureDocId.current;
            lectureDocId.current = null;
            if (id && result?.text) {
              await updateDocumentContent(id, result.text);
            }
            useToastStore.getState().addToast({
              type: ToastType.Success,
              title: "Lecture recording stopped",
              message: "Transcript saved to the new document.",
            });
            return;
          }
          const created = await createDocument(
            `Lecture ${new Date().toISOString().slice(0, 16)}`,
            `lecture://apple/${Date.now()}`,
            "markdown",
          );
          useDocumentStore.getState().addDocument(created);
          lectureDocId.current = created.id;
          await appleStartLiveSpeech();
          recording.current = true;
          useToastStore.getState().addToast({
            type: ToastType.Info,
            title: "Recording lecture",
            message: "Run Record lecture again to stop and save the transcript.",
          });
        } catch (error) {
          recording.current = false;
          lectureDocId.current = null;
          useToastStore.getState().addToast({
            type: ToastType.Error,
            title: "Lecture recording failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    };

    window.addEventListener("import-document-scan", onScan);
    window.addEventListener("ask-library", onAskLibrary);
    window.addEventListener("record-lecture", onLecture);
    return () => {
      window.removeEventListener("import-document-scan", onScan);
      window.removeEventListener("ask-library", onAskLibrary);
      window.removeEventListener("record-lecture", onLecture);
    };
  }, []);

  return null;
}
