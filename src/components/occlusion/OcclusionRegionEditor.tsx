import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FrameCorners, Trash, X } from "@phosphor-icons/react";
import type { ImageAsset } from "../../api/image-registry";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";
import { clampPercent, clampRegion } from "../../utils/occlusion";
import { useI18n } from "../../lib/i18n";

interface OcclusionRegionEditorProps {
  asset: ImageAsset | null;
  regions: ImageOcclusionRegion[];
  onChange: (regions: ImageOcclusionRegion[]) => void;
}

type ImgBounds = { offsetX: number; offsetY: number; width: number; height: number };

type Handle = "nw" | "ne" | "sw" | "se";

interface DrawInteraction {
  mode: "draw";
  originX: number;
  originY: number;
  draft: ImageOcclusionRegion;
}

interface TransformInteraction {
  mode: "move" | "resize";
  id: string;
  handle?: Handle;
  startX: number;
  startY: number;
  region: ImageOcclusionRegion;
}

type Interaction = DrawInteraction | TransformInteraction | null;

const HANDLE_HIT_PX = 14;
const HANDLE_SIZE_PX = 10;

/**
 * Shared, controlled occlusion-region editor.
 *
 * Works on percent coordinates (0–100) relative to the image. Every mutation —
 * draw, move, resize, label, import — is clamped to the image bounds via
 * `clampRegion` before it reaches `onChange`. Used by both the manual
 * authoring entry point (ImageSaveOverlay) and AI-proposal correction
 * (Flashcard Studio), so the two surfaces share one interaction model.
 */
export function OcclusionRegionEditor({ asset, regions, onChange }: OcclusionRegionEditorProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const [imgBounds, setImgBounds] = useState<ImgBounds | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [interaction, setInteraction] = useState<Interaction>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const computeImgBounds = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const containerW = img.clientWidth;
    const containerH = img.clientHeight;
    const scale = Math.min(containerW / img.naturalWidth, containerH / img.naturalHeight);
    const renderedW = img.naturalWidth * scale;
    const renderedH = img.naturalHeight * scale;
    setImgBounds({
      offsetX: (containerW - renderedW) / 2,
      offsetY: (containerH - renderedH) / 2,
      width: renderedW,
      height: renderedH,
    });
  }, []);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) computeImgBounds();
    img.addEventListener("load", computeImgBounds);
    const ro = new ResizeObserver(computeImgBounds);
    ro.observe(img);
    return () => {
      img.removeEventListener("load", computeImgBounds);
      ro.disconnect();
    };
  }, [asset, computeImgBounds]);

  const toPercent = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      const bounds = imgBounds;
      if (!rect || !bounds) return null;
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      return {
        x: clampPercent(((cx - bounds.offsetX) / bounds.width) * 100),
        y: clampPercent(((cy - bounds.offsetY) / bounds.height) * 100),
      };
    },
    [imgBounds],
  );

  const hitHandle = useCallback(
    (clientX: number, clientY: number): { id: string; handle: Handle } | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      const bounds = imgBounds;
      if (!rect || !bounds) return null;
      for (const region of regions) {
        const px = bounds.offsetX + (region.x / 100) * bounds.width;
        const py = bounds.offsetY + (region.y / 100) * bounds.height;
        const pw = (region.width / 100) * bounds.width;
        const ph = (region.height / 100) * bounds.height;
        const handles: Array<{ handle: Handle; hx: number; hy: number }> = [
          { handle: "nw", hx: px, hy: py },
          { handle: "ne", hx: px + pw, hy: py },
          { handle: "sw", hx: px, hy: py + ph },
          { handle: "se", hx: px + pw, hy: py + ph },
        ];
        for (const h of handles) {
          if (Math.abs(clientX - rect.left - h.hx) <= HANDLE_HIT_PX && Math.abs(clientY - rect.top - h.hy) <= HANDLE_HIT_PX) {
            return { id: region.id ?? "", handle: h.handle };
          }
        }
      }
      return null;
    },
    [imgBounds, regions],
  );

  const hitRegion = useCallback(
    (clientX: number, clientY: number): string | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      const bounds = imgBounds;
      if (!rect || !bounds) return null;
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      // Check in reverse so the topmost (last-drawn) region wins.
      for (let i = regions.length - 1; i >= 0; i--) {
        const region = regions[i];
        const px = bounds.offsetX + (region.x / 100) * bounds.width;
        const py = bounds.offsetY + (region.y / 100) * bounds.height;
        const pw = (region.width / 100) * bounds.width;
        const ph = (region.height / 100) * bounds.height;
        if (x >= px && x <= px + pw && y >= py && y <= py + ph) {
          return region.id ?? null;
        }
      }
      return null;
    },
    [imgBounds, regions],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (interaction) return;
    // Pressing the "Expand image" button (or any other interactive control
    // layered over the canvas) must not start a draw interaction: capturing
    // the pointer here would retarget the subsequent click to the container
    // and the button's onClick would never fire.
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    event.preventDefault();
    const handle = hitHandle(event.clientX, event.clientY);
    if (handle) {
      const region = regions.find((r) => r.id === handle.id);
      if (region) {
        const start = toPercent(event.clientX, event.clientY);
        if (!start) return;
        setSelectedId(region.id ?? null);
        setInteraction({ mode: "resize", id: region.id ?? "", handle: handle.handle, startX: start.x, startY: start.y, region });
        containerRef.current?.setPointerCapture(event.pointerId);
      }
      return;
    }
    const hitId = hitRegion(event.clientX, event.clientY);
    if (hitId) {
      const region = regions.find((r) => r.id === hitId);
      if (!region) return;
      const start = toPercent(event.clientX, event.clientY);
      if (!start) return;
      setSelectedId(region.id ?? null);
      setInteraction({ mode: "move", id: region.id ?? "", startX: start.x, startY: start.y, region });
      containerRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    // Draw a new region on empty image space.
    const point = toPercent(event.clientX, event.clientY);
    if (!point) return;
    setSelectedId(null);
    setInteraction({
      mode: "draw",
      originX: point.x,
      originY: point.y,
      draft: { id: `region-${Date.now()}`, x: point.x, y: point.y, width: 0, height: 0 },
    });
    containerRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interaction) return;
    const point = toPercent(event.clientX, event.clientY);
    if (!point) return;
    if (interaction.mode === "draw") {
      const { originX, originY } = interaction;
      setInteraction({
        ...interaction,
        draft: clampRegion({
          id: interaction.draft.id,
          x: Math.min(originX, point.x),
          y: Math.min(originY, point.y),
          width: Math.abs(point.x - originX),
          height: Math.abs(point.y - originY),
        }),
      });
      return;
    }
    const { mode, startX, startY, region } = interaction;
    const dx = point.x - startX;
    const dy = point.y - startY;
    let next: ImageOcclusionRegion = region;
    if (mode === "move") {
      next = clampRegion({ ...region, x: region.x + dx, y: region.y + dy });
    } else {
      const handle = interaction.handle ?? "se";
      let { x, y, width, height } = region;
      if (handle.includes("w")) {
        width = region.width - dx;
        x = region.x + dx;
      } else {
        width = region.width + dx;
      }
      if (handle.includes("n")) {
        height = region.height - dy;
        y = region.y + dy;
      } else {
        height = region.height + dy;
      }
      next = clampRegion({ ...region, x, y, width, height });
    }
    setInteraction({ ...interaction, region: next });
  };

  const handlePointerUp = () => {
    if (!interaction) return;
    if (interaction.mode === "draw") {
      const draft = clampRegion(interaction.draft);
      if (draft.width > 0 && draft.height > 0) {
        onChange([...regions, draft]);
        setSelectedId(draft.id ?? null);
      }
    } else {
      const updated = clampRegion(interaction.region);
      if (updated.width > 0 && updated.height > 0) {
        onChange(regions.map((r) => (r.id === interaction.id ? updated : r)));
      } else {
        onChange(regions.filter((r) => r.id !== interaction.id));
      }
    }
    setInteraction(null);
  };

  const selectedRegion = useMemo(
    () => regions.find((r) => r.id === selectedId) ?? null,
    [regions, selectedId],
  );

  const relabelRegion = useCallback(
    (id: string, label: string) => {
      onChange(regions.map((r) => (r.id === id ? { ...r, label: label || undefined } : r)));
    },
    [regions, onChange],
  );

  const deleteRegion = useCallback(
    (id: string) => {
      onChange(regions.filter((r) => r.id !== id));
      setSelectedId(null);
    },
    [regions, onChange],
  );

  useEffect(() => {
    if (!selectedId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        // Ignore when the user is typing in the label input.
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        event.preventDefault();
        deleteRegion(selectedId);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, deleteRegion]);

  const liveRegions = useMemo(() => {
    if (!interaction || interaction.mode === "draw") return regions;
    return regions.map((r) => (r.id === interaction.id ? clampRegion(interaction.region) : r));
  }, [regions, interaction]);

  const draftRegion = interaction?.mode === "draw" ? clampRegion(interaction.draft) : null;

  const regionToPx = (region: ImageOcclusionRegion) => {
    const bounds = imgBounds;
    if (!bounds) return null;
    return {
      left: bounds.offsetX + (region.x / 100) * bounds.width,
      top: bounds.offsetY + (region.y / 100) * bounds.height,
      width: (region.width / 100) * bounds.width,
      height: (region.height / 100) * bounds.height,
    };
  };

  const handles: Array<{ id: string; handle: Handle }> = useMemo(() => {
    const out: Array<{ id: string; handle: Handle }> = [];
    for (const region of liveRegions) {
      for (const handle of ["nw", "ne", "sw", "se"] as Handle[]) {
        out.push({ id: region.id ?? "", handle });
      }
    }
    return out;
  }, [liveRegions]);

  if (!asset) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        {t("flashcardStudio.importImageForOcclusion")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border border-border bg-muted/20 touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIsLightboxOpen(true);
          }}
          className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-black/80"
        >
          <FrameCorners className="h-3 w-3" />
          {t("flashcardStudio.expandImage")}
        </button>
        <img
          ref={imgRef}
          src={asset.data_url}
          alt={asset.file_name || t("flashcardStudio.occlusionEditor")}
          className="w-full object-contain select-none"
          draggable={false}
        />
        {imgBounds &&
          [...liveRegions, ...(draftRegion ? [draftRegion] : [])].map((region, index) => {
            const px = regionToPx(region);
            if (!px) return null;
            const isSelected = region.id === selectedId;
            const key = region.id || `${region.x}-${region.y}-${index}`;
            return (
              <div
                key={key}
                className={`absolute rounded border ${
                  isSelected
                    ? "border-sky-400/90 bg-sky-500/20"
                    : draftRegion && key === draftRegion.id
                    ? "border-white/70 bg-slate-950/60"
                    : "border-white/40 bg-slate-950/75"
                }`}
                style={{
                  left: `${px.left}px`,
                  top: `${px.top}px`,
                  width: `${px.width}px`,
                  height: `${px.height}px`,
                  cursor: "move",
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setSelectedId(region.id ?? null);
                  requestAnimationFrame(() => labelInputRef.current?.focus());
                }}
              />
            );
          })}
        {imgBounds &&
          handles.map(({ id, handle }) => {
            const region = liveRegions.find((r) => r.id === id);
            if (!region) return null;
            const px = regionToPx(region);
            if (!px) return null;
            const style: React.CSSProperties = {
              position: "absolute",
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              borderRadius: 2,
              background: "white",
              border: "1px solid rgba(0,0,0,0.6)",
              cursor: "nwse-resize",
              zIndex: 5,
            };
            if (handle.includes("w")) style.left = px.left - HANDLE_SIZE_PX / 2;
            else style.left = px.left + px.width - HANDLE_SIZE_PX / 2;
            if (handle.includes("n")) style.top = px.top - HANDLE_SIZE_PX / 2;
            else style.top = px.top + px.height - HANDLE_SIZE_PX / 2;
            if (handle === "ne" || handle === "sw") style.cursor = "nesw-resize";
            return <div key={`${id}-${handle}`} style={style} />;
          })}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("flashcardStudio.dragHiddenRegion")}</span>
        <button
          type="button"
          onClick={() => onChange(regions.slice(0, -1))}
          disabled={regions.length === 0}
          className="text-primary hover:opacity-80 disabled:opacity-40"
        >
          {t("flashcardStudio.undoRegion")}
        </button>
      </div>

      {regions.length === 0 && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {t("occlusionEditor.drawAtLeastOneRegion")}
        </p>
      )}

      {selectedRegion && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{t("occlusionEditor.regionLabel")}</span>
            <input
              ref={labelInputRef}
              value={selectedRegion.label ?? ""}
              onChange={(event) => relabelRegion(selectedRegion.id ?? "", event.target.value)}
              placeholder={t("occlusionEditor.labelPlaceholder")}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </label>
          <button
            type="button"
            onClick={() => deleteRegion(selectedRegion.id ?? "")}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash className="h-3.5 w-3.5" />
            {t("occlusionEditor.deleteRegion")}
          </button>
        </div>
      )}

      <OcclusionLightbox
        isOpen={isLightboxOpen}
        asset={asset}
        regions={regions}
        title={asset.file_name || t("flashcardStudio.occlusionEditor")}
        onClose={() => setIsLightboxOpen(false)}
      />
    </div>
  );
}

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

  // Portalled to document.body so the lightbox escapes any stacking context
  // (e.g. a full-screen studio modal) and always renders above the app UI.
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
                  className="absolute rounded border border-white/50 bg-slate-950/75"
                  style={{
                    left: `${lbImgBounds.offsetX + (region.x / 100) * lbImgBounds.width}px`,
                    top: `${lbImgBounds.offsetY + (region.y / 100) * lbImgBounds.height}px`,
                    width: `${(region.width / 100) * lbImgBounds.width}px`,
                    height: `${(region.height / 100) * lbImgBounds.height}px`,
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
