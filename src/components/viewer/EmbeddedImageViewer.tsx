import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CornersOut, Minus, Plus, X } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import "./embeddedImageViewer.css";

export interface EmbeddedImageRequest {
  src: string;
  alt?: string;
  caption?: string;
  trigger: HTMLElement;
  /** Optional PDF-specific action. */
  onViewOriginal?: () => void;
}

interface EmbeddedImageViewerProps {
  image: EmbeddedImageRequest;
  onClose: () => void;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function EmbeddedImageViewer({ image, onClose, fallbackFocusRef }: EmbeddedImageViewerProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const pointerMovedRef = useRef(false);
  const pinchRef = useRef<{
    distance: number;
    scale: number;
    midpoint: { x: number; y: number };
    offset: { x: number; y: number };
  } | null>(null);
  const fittedRef = useRef(true);
  const focusFallbackOnCloseRef = useRef(false);
  const savedSelectionRef = useRef<{ doc: Document; ranges: Range[] } | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loadFailed, setLoadFailed] = useState(false);

  const fitFor = useCallback((width: number, height: number, viewWidth: number, viewHeight: number) => {
    if (!width || !height || !viewWidth || !viewHeight) return 1;
    return clampScale(Math.min(1, (viewWidth - 32) / width, (viewHeight - 32) / height));
  }, []);

  const fitImage = useCallback(() => {
    const stage = stageRef.current;
    const img = imageRef.current;
    if (!stage || !img?.naturalWidth || !img.naturalHeight) return;
    const bounds = stage.getBoundingClientRect();
    const nextFit = fitFor(img.naturalWidth, img.naturalHeight, bounds.width, bounds.height);
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    setStageSize({ width: bounds.width, height: bounds.height });
    setScale(nextFit);
    setOffset({ x: 0, y: 0 });
    fittedRef.current = true;
  }, [fitFor]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateBounds = () => {
      const bounds = stage.getBoundingClientRect();
      setStageSize({ width: bounds.width, height: bounds.height });
      const img = imageRef.current;
      if (!img?.naturalWidth || !img.naturalHeight) return;
      const nextFit = fitFor(img.naturalWidth, img.naturalHeight, bounds.width, bounds.height);
      if (fittedRef.current) {
        setScale(nextFit);
        setOffset({ x: 0, y: 0 });
      }
    };
    updateBounds();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateBounds);
    observer?.observe(stage);
    window.addEventListener("resize", updateBounds);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, [fitFor]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sourceDocument = image.trigger.ownerDocument;
    const sourceSelection = sourceDocument.defaultView?.getSelection();
    if (sourceSelection && !sourceSelection.isCollapsed && sourceSelection.rangeCount > 0) {
      savedSelectionRef.current = {
        doc: sourceDocument,
        ranges: Array.from({ length: sourceSelection.rangeCount }, (_, index) => sourceSelection.getRangeAt(index).cloneRange()),
      };
    } else {
      savedSelectionRef.current = null;
    }
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
    return () => {
      document.body.style.overflow = originalOverflow;
      cancelAnimationFrame(focusFrame);
      requestAnimationFrame(() => {
        const trigger = image.trigger;
        const fallback = fallbackFocusRef?.current;
        const target = !focusFallbackOnCloseRef.current && trigger?.isConnected
          ? trigger
          : fallback?.isConnected
            ? fallback
            : null;
        target?.focus({ preventScroll: true });
        const savedSelection = savedSelectionRef.current;
        const selection = savedSelection?.doc.defaultView?.getSelection();
        const connectedRanges = savedSelection?.ranges.filter((range) =>
          range.startContainer.isConnected && range.endContainer.isConnected,
        ) ?? [];
        if (selection && connectedRanges.length > 0) {
          selection.removeAllRanges();
          connectedRanges.forEach((range) => selection.addRange(range));
        }
      });
    };
  }, [fallbackFocusRef, image.trigger]);

  const clampOffset = useCallback((next: { x: number; y: number }, nextScale = scale) => {
    if (!naturalSize || !stageSize.width || !stageSize.height) return next;
    const renderedWidth = naturalSize.width * nextScale;
    const renderedHeight = naturalSize.height * nextScale;
    const maxX = Math.max(0, (renderedWidth - stageSize.width) / 2);
    const maxY = Math.max(0, (renderedHeight - stageSize.height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, [naturalSize, scale, stageSize]);

  useEffect(() => {
    setOffset((current) => clampOffset(current));
  }, [clampOffset]);

  const zoomAt = useCallback((nextScale: number, point?: { x: number; y: number }) => {
    const bounded = clampScale(nextScale);
    if (point && stageRef.current) {
      const bounds = stageRef.current.getBoundingClientRect();
      const relative = { x: point.x - bounds.left - bounds.width / 2, y: point.y - bounds.top - bounds.height / 2 };
      const ratio = bounded / scale;
      setOffset((current) => clampOffset({
        x: (1 - ratio) * relative.x + ratio * current.x,
        y: (1 - ratio) * relative.y + ratio * current.y,
      }, bounded));
    } else {
      setOffset((current) => clampOffset(current, bounded));
    }
    fittedRef.current = false;
    setScale(bounded);
  }, [clampOffset, scale]);

  const zoomBy = useCallback((factor: number) => zoomAt(scale * factor), [scale, zoomAt]);

  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1.25);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomBy(1 / 1.25);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      zoomAt(1);
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    if (focusables.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const updatePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      if (!pinchRef.current) {
        pinchRef.current = { distance: distance(points[0], points[1]), scale, midpoint, offset };
      }
      return;
    }
    if (!dragRef.current) dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length >= 2 && pinchRef.current) {
      pointerMovedRef.current = true;
      const first = points[0];
      const second = points[1];
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const nextScale = clampScale(pinchRef.current.scale * (distance(first, second) / Math.max(1, pinchRef.current.distance)));
      const stage = stageRef.current?.getBoundingClientRect();
      if (stage) {
        const startMidpoint = {
          x: pinchRef.current.midpoint.x - stage.left - stage.width / 2,
          y: pinchRef.current.midpoint.y - stage.top - stage.height / 2,
        };
        const movedMidpoint = { x: midpoint.x - pinchRef.current.midpoint.x, y: midpoint.y - pinchRef.current.midpoint.y };
        const ratio = nextScale / pinchRef.current.scale;
        setOffset(clampOffset({
          x: pinchRef.current.offset.x + movedMidpoint.x + (1 - ratio) * startMidpoint.x,
          y: pinchRef.current.offset.y + movedMidpoint.y + (1 - ratio) * startMidpoint.y,
        }, nextScale));
      }
      setScale(nextScale);
      fittedRef.current = false;
      return;
    }
    if (!dragRef.current) return;
    if (Math.hypot(event.clientX - dragRef.current.x, event.clientY - dragRef.current.y) > 3) {
      pointerMovedRef.current = true;
    }
    setOffset(clampOffset({
      x: dragRef.current.offsetX + event.clientX - dragRef.current.x,
      y: dragRef.current.offsetY + event.clientY - dragRef.current.y,
    }));
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = null;
    dragRef.current = null;
    if (pointersRef.current.size === 1) {
      const [pointerId, point] = [...pointersRef.current.entries()][0];
      dragRef.current = { x: point.x, y: point.y, offsetX: offset.x, offsetY: offset.y };
      pointersRef.current.set(pointerId, point);
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already have ended after a touch gesture.
    }
  };

  const title = image.alt?.trim() || image.caption?.trim() || t("viewer.genericImageDescription");
  const caption = image.caption?.trim() || image.alt?.trim();

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("viewer.imageViewerTitle")}
      tabIndex={-1}
      className="embedded-image-viewer"
      onKeyDownCapture={handleKeyDownCapture}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="embedded-image-viewer__toolbar">
        <div className="embedded-image-viewer__description" aria-live="polite">
          <span className="embedded-image-viewer__title">{title}</span>
        </div>
        <div className="embedded-image-viewer__controls" role="toolbar" aria-label={t("viewer.imageViewerTitle")}>
          <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label={t("viewer.zoomOut")} title={t("viewer.zoomOut")}>
            <Minus aria-hidden="true" />
          </button>
          <output className="embedded-image-viewer__scale" aria-live="polite">{Math.round(scale * 100)}%</output>
          <button type="button" onClick={() => zoomBy(1.25)} aria-label={t("viewer.zoomIn")} title={t("viewer.zoomIn")}>
            <Plus aria-hidden="true" />
          </button>
          <button type="button" onClick={fitImage} aria-label={t("viewer.fitImage")} title={t("viewer.fitImage")}>
            <CornersOut aria-hidden="true" />
          </button>
          <button type="button" onClick={() => zoomAt(1)} aria-label={t("viewer.actualSize")} title={t("viewer.actualSize")}>
            <span aria-hidden="true">100%</span>
          </button>
          {image.onViewOriginal && (
            <button
              type="button"
              onClick={() => {
                focusFallbackOnCloseRef.current = true;
                onClose();
                image.onViewOriginal!();
              }}
              className="embedded-image-viewer__original"
            >
              {t("viewer.viewInOriginal")}
            </button>
          )}
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={t("viewer.close")} title={t("viewer.close")}>
            <X aria-hidden="true" />
          </button>
        </div>
      </header>
      <div
        ref={stageRef}
        className="embedded-image-viewer__stage"
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
        onClick={(event) => {
          if (pointerMovedRef.current) {
            pointerMovedRef.current = false;
            return;
          }
          const bounds = imageRef.current?.getBoundingClientRect();
          const clickedImage = bounds && event.clientX >= bounds.left && event.clientX <= bounds.right
            && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
          if (!clickedImage) onClose();
        }}
        onWheel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          zoomAt(scale * Math.exp(-event.deltaY * 0.0015), { x: event.clientX, y: event.clientY });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          if (pointersRef.current.size === 0) pointerMovedRef.current = false;
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* unsupported pointer capture */ }
          updatePointer(event);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        {loadFailed ? (
          <p role="status" className="embedded-image-viewer__error">{t("viewer.imageDecodeFailed")}</p>
        ) : (
          <img
            ref={imageRef}
            src={image.src}
            alt={title}
            draggable={false}
            onLoad={fitImage}
            onError={() => setLoadFailed(true)}
            className="embedded-image-viewer__image"
            style={{
              width: naturalSize ? `${naturalSize.width}px` : undefined,
              height: naturalSize ? `${naturalSize.height}px` : undefined,
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            }}
          />
        )}
      </div>
      {caption && <p className="embedded-image-viewer__caption">{caption}</p>}
    </div>,
    document.body,
  );
}
