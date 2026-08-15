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
      window.dispatchEvent(new CustomEvent("incrementum:create-image-occlusion", {
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
