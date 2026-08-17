import { useEffect, useState, useRef } from "react";
import { Check, CircleNotch, FrameCorners, Images } from "@phosphor-icons/react";
import { ingestImageBlob, ingestImageFromPath, ingestRemoteImage } from "../../api/image-registry";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import { isTauri } from "../../lib/tauri";
import {
  base64ToBlob,
  captureAppWindowRegion,
} from "../../utils/screenshotCapture";
import { acquireImageAsset } from "../../utils/imageAcquisition";

interface ImageHoverData {
  src: string;
  documentId?: string;
  referrerUrl?: string;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

/**
 * Locate the <img> element currently displaying this src — in the main
 * document or inside a same-origin iframe (epub.js renders EPUB sections in
 * iframes and substitutes archived images with blob: URLs).
 */
function findDisplayedImage(src: string): HTMLImageElement | null {
  const selectorSrc = src.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const collect = (doc: Document): HTMLImageElement | null => {
    const candidates = Array.from(
      doc.querySelectorAll<HTMLImageElement>(`img[src="${selectorSrc}"]`),
    );
    return (
      candidates.find((img) => img.complete && img.naturalWidth > 0) ??
      candidates[0] ??
      null
    );
  };
  const direct = collect(window.document);
  if (direct) return direct;
  for (const iframe of Array.from(window.document.querySelectorAll("iframe"))) {
    try {
      const doc = iframe.contentDocument;
      const found = doc ? collect(doc) : null;
      if (found) return found;
    } catch {
      // Cross-origin iframe — not reachable, keep looking.
    }
  }
  return null;
}

/**
 * Re-read the pixels of the on-screen image via canvas. A displayed blob: or
 * data: image keeps its decoded pixels even after the object URL was revoked
 * (the case where re-fetching the src fails), and same-origin images never
 * taint the canvas.
 */
async function captureElementPixels(src: string): Promise<Blob> {
  const img = findDisplayedImage(src);
  if (!img) throw new Error("the image is no longer on screen");
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) throw new Error("the image has no rendered pixels");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas rendering is unavailable");
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("canvas export failed (cross-origin pixels)");
  return blob;
}

export function ImageSaveOverlay() {
  const toast = useToast();
  const { t } = useI18n();
  const [hoverData, setHoverData] = useState<ImageHoverData | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingOcclusion, setIsCreatingOcclusion] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const hideTimeoutRef = useRef<number | null>(null);
  const isMouseOverButtonRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleImageHover = (e: CustomEvent<ImageHoverData>) => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      setHoverData(e.detail);
      // Reset saved state if we switch to a new image hover
      if (hoverData?.src !== e.detail.src) {
        setIsSaved(false);
      }
    };

    const handleImageLeave = () => {
      // Small timeout to give user time to transition mouse to the button
      hideTimeoutRef.current = window.setTimeout(() => {
        if (!isMouseOverButtonRef.current) {
          setHoverData(null);
          setIsSaved(false);
        }
      }, 300);
    };

    // Hide overlay immediately when scrolling
    const handleScroll = () => {
      setHoverData(null);
      setIsSaved(false);
    };

    window.addEventListener("image-hover" as any, handleImageHover);
    window.addEventListener("image-leave" as any, handleImageLeave);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("image-hover" as any, handleImageHover);
      window.removeEventListener("image-leave" as any, handleImageLeave);
      window.removeEventListener("scroll", handleScroll, true);
      if (hideTimeoutRef.current) window.clearTimeout(hideTimeoutRef.current);
    };
  }, [hoverData?.src]);

  /**
   * Single acquisition path shared by Save to Registry and Create Occlusion,
   * so the two can never diverge again. Every strategy — including native
   * ingestion and rendered-pixel capture — is available for every image source,
   * not just public remote URLs.
   */
  const ingestHoveredImage = async () => {
    if (!hoverData) throw new Error("No image selected");
    return acquireImageAsset(
      {
        src: hoverData.src,
        referrerUrl: hoverData.referrerUrl,
        rect: hoverData.rect,
      },
      {
        isTauri,
        fetchBlob: async (src) => {
          const response = await fetch(src);
          if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
          return response.blob();
        },
        ingestBlob: ingestImageBlob,
        ingestRemote: ingestRemoteImage,
        // Rust-side read+ingest. The old path (plugin-fs readFile → Blob →
        // base64 back over IPC) was doubly broken on Android: the fs
        // capability grants no read permission, and images inside documents
        // are served from the loopback media server the webview cannot fetch.
        ingestFromPath: ingestImageFromPath,
        captureElement: captureElementPixels,
        captureRect: async (rect) => {
          // The overlay's own buttons sit on top of the image being captured.
          if (overlayRef.current) overlayRef.current.style.visibility = "hidden";
          try {
            await waitForNextPaint();
            return base64ToBlob(await captureAppWindowRegion(rect));
          } finally {
            if (overlayRef.current) overlayRef.current.style.visibility = "";
          }
        },
      },
    );
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hoverData || isSaving || isCreatingOcclusion || isSaved) return;

    setIsSaving(true);
    try {
      // Generate a reasonable file name based on current timestamp
      await ingestHoveredImage();

      setIsSaved(true);
      toast.success(
        t("imageRegistry.assetsAdded") || "Saved to Image Registry",
        "Successfully added image to registry.",
        {
          action: {
            label: "View Registry",
            onClick: () => {
              window.dispatchEvent(new CustomEvent("navigate", { detail: "/image-registry" }));
            },
          },
        }
      );
    } catch (error) {
      console.error("Failed to save image to registry", error);
      toast.error(
        "Save Failed",
        error instanceof Error ? error.message : "An unknown error occurred while saving."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateOcclusion = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hoverData || isSaving || isCreatingOcclusion) return;

    setIsCreatingOcclusion(true);
    try {
      const asset = await ingestHoveredImage();
      window.dispatchEvent(new CustomEvent("plethora:create-image-occlusion", {
        detail: {
          assetId: asset.id,
          documentId: hoverData.documentId,
        },
      }));
      setHoverData(null);
    } catch (error) {
      console.error("Failed to create image occlusion card", error);
      toast.error(
        "Image Occlusion Failed",
        error instanceof Error ? error.message : "An unknown error occurred while importing the image."
      );
    } finally {
      setIsCreatingOcclusion(false);
    }
  };

  if (!hoverData) return null;

  // Position the button near the top right of the hovered image
  const buttonSize = 40;
  const padding = 12;
  const top = hoverData.rect.top + padding;
  const controlsWidth = buttonSize * 2 + 8;
  const left = hoverData.rect.left + hoverData.rect.width - controlsWidth - padding;

  return (
    <div
      ref={overlayRef}
      className="fixed z-[9999] pointer-events-auto"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${controlsWidth}px`,
        height: `${buttonSize}px`,
      }}
      onMouseEnter={() => {
        isMouseOverButtonRef.current = true;
        if (hideTimeoutRef.current) {
          window.clearTimeout(hideTimeoutRef.current);
          hideTimeoutRef.current = null;
        }
      }}
      onMouseLeave={() => {
        isMouseOverButtonRef.current = false;
        // Trigger leave check
        window.dispatchEvent(new CustomEvent("image-leave"));
      }}
    >
      <div className="flex h-full gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || isCreatingOcclusion}
          title={isSaved ? "Saved to Image Registry" : "Save to Image Registry"}
          className={cn(
            "w-10 h-full flex items-center justify-center rounded-xl transition-all duration-300 shadow-lg cursor-pointer",
            "backdrop-blur-md border",
            isSaved
              ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
              : "bg-background/85 border-border/60 text-foreground hover:bg-primary hover:text-primary-foreground hover:scale-105 active:scale-95",
            "animate-in fade-in zoom-in-90 duration-200"
          )}
        >
          {isSaving ? (
            <CircleNotch className="w-5 h-5 animate-spin" />
          ) : isSaved ? (
            <Check className="w-5 h-5 animate-in zoom-in-75 duration-200" />
          ) : (
            <Images className="w-5 h-5" />
          )}
        </button>
        <button
          type="button"
          onClick={handleCreateOcclusion}
          disabled={isSaving || isCreatingOcclusion}
          title="Create image occlusion card"
          className={cn(
            "h-full w-10 flex items-center justify-center rounded-xl transition-all duration-300 shadow-lg cursor-pointer",
            "backdrop-blur-md border bg-background/85 border-border/60 text-foreground",
            "hover:bg-primary hover:text-primary-foreground hover:scale-105 active:scale-95",
            "disabled:opacity-60 animate-in fade-in zoom-in-90 duration-200"
          )}
        >
          {isCreatingOcclusion
            ? <CircleNotch className="w-5 h-5 animate-spin" />
            : <FrameCorners className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}




export default ImageSaveOverlay;
