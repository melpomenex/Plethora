import { useEffect, useState, useRef } from "react";
import { Check, CircleNotch, FrameCorners, Images } from "@phosphor-icons/react";
import { ingestImageBlob, ingestRemoteImage } from "../../api/image-registry";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import { isTauri } from "../../lib/tauri";
import {
  base64ToBlob,
  captureAppWindowRegion,
} from "../../utils/screenshotCapture";

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

  const loadHoveredImageBlob = async (): Promise<Blob> => {
    if (!hoverData) throw new Error("No image selected");
    if (hoverData.src.startsWith("data:")) {
      const response = await fetch(hoverData.src);
      return response.blob();
    }

    try {
      const response = await fetch(hoverData.src);
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
      return response.blob();
    } catch (fetchError) {
      if (!isTauri()) throw fetchError;
      const filePath = getFilePathFromUrl(hoverData.src);
      if (!filePath) throw fetchError;
      const fs = await import("@tauri-apps/plugin-fs");
      const bytes = await fs.readFile(filePath);
      const ext = filePath.split(".").pop()?.toLowerCase();
      const mimeType =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "gif"
            ? "image/gif"
            : ext === "webp"
              ? "image/webp"
              : ext === "svg"
                ? "image/svg+xml"
                : "image/png";
      return new Blob([bytes], { type: mimeType });
    }
  };

  const ingestHoveredImage = async () => {
    if (!hoverData) throw new Error("No image selected");
    if (isTauri() && isPublicRemoteImageUrl(hoverData.src)) {
      try {
        return await ingestRemoteImage(
          hoverData.src,
          getRemoteImageFileName(hoverData.src),
          hoverData.referrerUrl,
        );
      } catch (downloadError) {
        try {
          if (overlayRef.current) overlayRef.current.style.visibility = "hidden";
          await waitForNextPaint();
          const base64 = await captureAppWindowRegion(hoverData.rect);
          return await ingestImageBlob(
            base64ToBlob(base64),
            `captured-image-${Date.now()}.png`,
          );
        } catch (captureError) {
          console.warn("Rendered-image capture fallback failed", captureError);
          throw downloadError;
        } finally {
          if (overlayRef.current) overlayRef.current.style.visibility = "";
        }
      }
    }
    const blob = await loadHoveredImageBlob();
    const fileExt = blob.type.split("/")[1] || "png";
    return ingestImageBlob(blob, `saved-image-${Date.now()}.${fileExt}`);
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

function isPublicRemoteImageUrl(src: string): boolean {
  try {
    const url = new URL(src);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return ![
      "localhost",
      "127.0.0.1",
      "::1",
      "asset.localhost",
    ].includes(host);
  } catch {
    return false;
  }
}

function getRemoteImageFileName(src: string): string | undefined {
  try {
    const name = decodeURIComponent(new URL(src).pathname.split("/").pop() || "").trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

function getFilePathFromUrl(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol === "asset:" || url.host === "asset.localhost" || url.protocol === "file:") {
      let pathname = decodeURIComponent(url.pathname);
      // On Windows, pathname might be like "/C:/Users/..." or "/C:\Users\..."
      // If we have a drive letter pattern "/[a-zA-Z]:", strip the leading slash
      if (/^\/[a-zA-Z]:/.test(pathname)) {
        pathname = pathname.substring(1);
      }
      return pathname;
    }
  } catch {
    // If URL parsing fails, fall back to string parsing
  }

  // Fallback string matching
  let cleanSrc = src.split("?")[0].split("#")[0];
  const prefixes = [
    "asset://localhost/",
    "https://asset.localhost/",
    "http://asset.localhost/",
    "asset://",
    "file:///",
    "file://"
  ];

  for (const prefix of prefixes) {
    if (cleanSrc.startsWith(prefix)) {
      let path = decodeURIComponent(cleanSrc.substring(prefix.length));
      if (/^[a-zA-Z]:/.test(path)) {
        // Windows path style
        return path;
      }
      // Absolute path or Unix path
      if (!path.startsWith("/")) {
        path = "/" + path;
      }
      return path;
    }
  }

  return null;
}

export default ImageSaveOverlay;
