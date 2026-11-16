import { useState } from "react";
import { Camera, CircleNotch, Scissors, Sparkle, X } from "@phosphor-icons/react";
import { invokeCommand, isTauri } from "../../lib/tauri";
import {
  generateMirageOcclusionCards,
  snapImageToExtract,
  type MirageSnapExtractResult,
} from "../../api/vision";

export interface SnapToExtractModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  onExtracted?: (result: MirageSnapExtractResult) => void;
}

/**
 * Local "Snap-to-Extract" & Desktop Screen-Capture modal powered by Mirage (`mirage.cact`).
 * Supports importing/capturing photos of book pages, whiteboards, or lecture slides
 * as well as capturing the active app/PDF region on desktop.
 */
export function SnapToExtractModal({
  isOpen,
  onClose,
  documentId,
  onExtracted,
}: SnapToExtractModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MirageSnapExtractResult | null>(null);
  const [occlusionCount, setOcclusionCount] = useState<number | null>(null);

  if (!isOpen) return null;

  const processBase64 = async (base64Data: string) => {
    setBusy(true);
    setError(null);
    setOcclusionCount(null);
    try {
      const res = await snapImageToExtract({
        base64Data,
        documentId,
      });
      setResult(res);
      onExtracted?.(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        void processBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleScreenSnip = async () => {
    setBusy(true);
    setError(null);
    try {
      const b64 = await invokeCommand<string>("capture_app_window");
      await processBase64(b64);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const handleAutoOcclusion = async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const cards = await generateMirageOcclusionCards({
        assetId: result.sourceAssetId,
        documentId,
      });
      setOcclusionCount(cards.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="snap-to-extract-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkle className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              Mirage Snap-to-Extract (Offline)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Capture a book page, whiteboard, slide, or screen region. Mirage extracts
          reading-order text, pairs nearby diagrams, and indexes everything locally.
        </p>

        <div className="flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium cursor-pointer hover:opacity-90">
            <Camera className="w-4 h-4" />
            <span>Snap / Import Image</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void handleFileChange(e)}
              disabled={busy}
            />
          </label>

          {isTauri() && (
            <button
              type="button"
              onClick={() => void handleScreenSnip()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <Scissors className="w-4 h-4" />
              <span>Capture Window Region</span>
            </button>
          )}
        </div>

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <CircleNotch className="w-4 h-4 animate-spin" />
            <span>Running Mirage vision inference locally...</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs">
            <div className="font-medium text-foreground">
              Extract created in reading queue
            </div>
            {result.scene && (
              <div className="text-muted-foreground">
                <strong>Scene:</strong> {result.scene}
              </div>
            )}
            <div className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded bg-background p-2 border border-border font-mono text-[11px]">
              {result.readingOrderText || result.extract.content}
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-muted-foreground">
                Paired figures cropped: {result.croppedFigureAssetIds.length}
              </span>
              <button
                type="button"
                onClick={() => void handleAutoOcclusion()}
                disabled={busy}
                className="px-2.5 py-1 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-50"
              >
                Auto-Generate Occlusion Cards
              </button>
            </div>
            {occlusionCount !== null && (
              <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                Generated {occlusionCount} image-occlusion flashcard(s).
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
