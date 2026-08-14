import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import type { ImageAsset } from "../../api/image-registry";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";
import { useI18n } from "../../lib/i18n";

type ImgBounds = { offsetX: number; offsetY: number; width: number; height: number };

/**
 * Full-screen masked view of an image with its occlusion regions.
 *
 * Portalled to `document.body` so it escapes any hosting stacking context and
 * renders above the app UI. The masked rendering (image + percent overlay
 * boxes) is also the pattern the composer's card preview reuses for its front
 * face, so review-time appearance is structural rather than a second
 * implementation.
 */
export function OcclusionLightbox({
  isOpen,
  asset,
  regions,
  title,
  onClose,
}: {
  isOpen: boolean;
  asset: ImageAsset;
  regions: ImageOcclusionRegion[];
  title: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const lbImgRef = useRef<HTMLImageElement>(null);
  const [lbImgBounds, setLbImgBounds] = useState<ImgBounds | null>(null);

  const computeLbBounds = useCallback(() => {
    const img = lbImgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const containerW = img.clientWidth;
    const containerH = img.clientHeight;
    const scale = Math.min(containerW / img.naturalWidth, containerH / img.naturalHeight);
    const renderedW = img.naturalWidth * scale;
    const renderedH = img.naturalHeight * scale;
    setLbImgBounds({
      offsetX: (containerW - renderedW) / 2,
      offsetY: (containerH - renderedH) / 2,
      width: renderedW,
      height: renderedH,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const img = lbImgRef.current;
    if (!img) return;
    if (img.complete) computeLbBounds();
    img.addEventListener("load", computeLbBounds);
    const ro = new ResizeObserver(computeLbBounds);
    ro.observe(img);
    return () => {
      img.removeEventListener("load", computeLbBounds);
      ro.disconnect();
    };
  }, [isOpen, asset, computeLbBounds]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="text-xs text-slate-300">{t("flashcardStudio.imageLightboxHint")}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 text-slate-100 transition-colors hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="relative mx-auto w-full overflow-hidden rounded-2xl bg-black/40">
            <img
              ref={lbImgRef}
              src={asset.data_url}
              alt={asset.file_name || title}
              className="mx-auto block max-h-[calc(92vh-8rem)] w-full object-contain"
            />
            {lbImgBounds &&
              regions.map((region, index) => (
                <div
                  key={region.id || `${region.x}-${region.y}-${index}`}
                  className="absolute rounded border border-white/50 bg-slate-950"
                  style={{
                    left: `${lbImgBounds.offsetX + (region.x / 100) * lbImgBounds.width}px`,
                    top: `${lbImgBounds.offsetY + (region.y / 100) * lbImgBounds.height}px`,
                    width: `${(region.width / 100) * lbImgBounds.width}px`,
                    height: `${(region.height / 100) * lbImgBounds.height}px`,
                    backgroundColor: region.color || "#0f172a",
                  }}
                />
              ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
