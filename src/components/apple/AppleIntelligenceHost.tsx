import { useEffect } from "react";
import { useUIStore } from "../../stores/uiStore";
import { ToastType, useToastStore } from "../common/Toast";
import { importAppleDocumentScan } from "../../lib/ai/apple/importVisionDocument";

/**
 * Hosts command-palette Apple intelligence actions that must run at the app
 * root (scan, lecture capture, ask-library navigation).
 */
export function AppleIntelligenceHost() {

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
      // Forward lecture entry into shared recording flow, retaining audio durability
      window.dispatchEvent(new CustomEvent("plethora:record-lecture"));
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
