import { useCallback, useEffect, useRef, useState } from "react";
import { CircleNotch, ImageSquare, Minus, Plus, WarningCircle, X } from "@phosphor-icons/react";
import { convertFileSrc, isTauri } from "../../lib/tauri";
import { readDocumentFile } from "../../api/documents";
import { useI18n } from "../../lib/i18n";

/**
 * Minimal image document viewer: display, zoom, pan — no editing.
 *
 * Follows the same source-resolution conventions as the audio/video viewers:
 *  1. http(s)/blob/data URLs render directly.
 *  2. In the Tauri desktop app the local file path is served via
 *     `convertFileSrc` (the asset protocol).
 *  3. Elsewhere (web mode / dev) the file is read through the backend and
 *     turned into an object URL.
 *
 * When the file is missing or cannot be decoded the viewer shows an
 * explanatory message instead of an empty or broken view.
 */
interface ImageViewerProps {
  documentId: string;
  title: string;
  filePath: string;
}

interface ResolvedImage {
  src: string;
  revokeOnDispose: boolean;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);

function isWebUrl(value: string): boolean {
  return /^(https?:|blob:|data:)/i.test(value);
}

export function ImageViewer({ documentId, title, filePath }: ImageViewerProps) {
  const { t } = useI18n();
  const [imageSrc, setImageSrc] = useState<ResolvedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const revokeObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const resolveImage = async () => {
      if (!filePath) {
        setError("Image document has no file path.");
        return;
      }
      setIsResolving(true);
      setError(null);
      setLoaded(false);
      setScale(1);
      setPan({ x: 0, y: 0 });
      try {
        if (isWebUrl(filePath)) {
          if (!cancelled) setImageSrc({ src: filePath, revokeOnDispose: false });
          return;
        }
        if (isTauri()) {
          const src = await convertFileSrc(filePath);
          if (!cancelled) setImageSrc({ src, revokeOnDispose: false });
          return;
        }
        // Browser/web mode: read the file through the backend and render an
        // object URL so the image is not subject to file:// restrictions.
        const bytes = await readDocumentFile(filePath);
        const mime = `image/${filePath.split(".").pop()?.toLowerCase() === "svg" ? "svg+xml" : (filePath.split(".").pop()?.toLowerCase() || "png")}`;
        const blob = new Blob([bytes], { type: mime });
        objectUrlRef.current = URL.createObjectURL(blob);
        if (!cancelled) setImageSrc({ src: objectUrlRef.current, revokeOnDispose: true });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    };
    void resolveImage();
    return () => {
      cancelled = true;
      revokeObjectUrl();
    };
  }, [filePath, documentId]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!loaded) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setScale((prev) => Math.min(8, Math.max(0.25, prev * factor)));
  }, [loaded]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const zoomBy = (factor: number) => {
    setScale((prev) => Math.min(8, Math.max(0.25, prev * factor)));
  };

  const resetView = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-950 flex items-center justify-center flex-shrink-0">
            <ImageSquare className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground truncate" title={title}>
              {title}
            </h3>
            <p className="text-[10px] text-muted-foreground">{t("viewer.imageTypeLabel")}</p>
          </div>
        </div>
        {loaded && (
          <div className="flex items-center gap-1 ml-3 flex-shrink-0">
            <button
              onClick={() => zoomBy(1 / 1.25)}
              className="p-1.5 hover:bg-muted rounded transition-colors"
              title="Zoom out"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="text-xs text-muted-foreground tabular-nums w-12 text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={() => zoomBy(1.25)}
              className="p-1.5 hover:bg-muted rounded transition-colors"
              title="Zoom in"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={resetView}
              className="p-1.5 hover:bg-muted rounded transition-colors"
              title="Reset view"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-muted/30 relative select-none"
        onWheel={handleWheel}
      >
        {isResolving && (
          <div className="absolute inset-0 flex items-center justify-center">
            <CircleNotch className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center max-w-md px-4">
              <div className="text-6xl mb-4 flex justify-center">
                <WarningCircle className="w-14 h-14 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">{t("viewer.imageMissingTitle")}</h3>
              <p className="text-muted-foreground mb-2">{error}</p>
              <p className="text-sm text-muted-foreground">
                {t("viewer.imageMissingDesc")}
              </p>
            </div>
          </div>
        ) : (
          imageSrc && (
            <div
              className="w-full h-full flex items-center justify-center overflow-hidden"
              style={{ cursor: loaded && scale > 1 ? "grab" : "default" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img
                src={imageSrc.src}
                alt={title}
                draggable={false}
                onLoad={() => setLoaded(true)}
                onError={() => {
                  setError(t("viewer.imageDecodeFailed"));
                  setLoaded(false);
                }}
                className="max-w-none"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                  transformOrigin: "center",
                  transition: dragRef.current ? "none" : "transform 80ms ease-out",
                  maxHeight: "100%",
                }}
              />
            </div>
          )
        )}
      </div>
    </div>
  );
}

export { IMAGE_EXTENSIONS };
