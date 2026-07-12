import { useEffect, useState, useRef } from "react";
import { Check, CircleNotch, Images } from "@phosphor-icons/react";
import { ingestImageBlob } from "../../api/image-registry";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import { isTauri } from "../../lib/tauri";

interface ImageHoverData {
  src: string;
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
  const [isSaved, setIsSaved] = useState(false);
  const hideTimeoutRef = useRef<number | null>(null);
  const isMouseOverButtonRef = useRef(false);

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

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hoverData || isSaving || isSaved) return;

    setIsSaving(true);
    try {
      // Fetch image data
      let blob: Blob;
      if (hoverData.src.startsWith("data:")) {
        const response = await fetch(hoverData.src);
        blob = await response.blob();
      } else {
        try {
          const response = await fetch(hoverData.src);
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`);
          }
          blob = await response.blob();
        } catch (fetchError) {
          // If we are in Tauri and it's a local/asset file, try reading it using plugin-fs
          if (isTauri()) {
            const filePath = getFilePathFromUrl(hoverData.src);
            if (filePath) {
              const fs = await import("@tauri-apps/plugin-fs");
              const bytes = await fs.readFile(filePath);
              // Guess mime type from file extension
              const ext = filePath.split(".").pop()?.toLowerCase();
              let mimeType = "image/png"; // default
              if (ext === "jpg" || ext === "jpeg") {
                mimeType = "image/jpeg";
              } else if (ext === "gif") {
                mimeType = "image/gif";
              } else if (ext === "webp") {
                mimeType = "image/webp";
              } else if (ext === "svg") {
                mimeType = "image/svg+xml";
              }
              blob = new Blob([bytes], { type: mimeType });
            } else {
              throw fetchError;
            }
          } else {
            throw fetchError;
          }
        }
      }

      // Generate a reasonable file name based on current timestamp
      const fileExt = blob.type.split("/")[1] || "png";
      const fileName = `saved-image-${Date.now()}.${fileExt}`;

      // Ingest image blob into registry
      await ingestImageBlob(blob, fileName);

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

  if (!hoverData) return null;

  // Position the button near the top right of the hovered image
  const buttonSize = 40;
  const padding = 12;
  const top = hoverData.rect.top + padding;
  const left = hoverData.rect.left + hoverData.rect.width - buttonSize - padding;

  return (
    <div
      className="fixed z-[9999] pointer-events-auto"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${buttonSize}px`,
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
      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        title={isSaved ? "Saved to Image Registry" : "Save to Image Registry"}
        className={cn(
          "w-full h-full flex items-center justify-center rounded-xl transition-all duration-300 shadow-lg cursor-pointer",
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
    </div>
  );
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
