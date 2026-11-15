import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowsOutSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  ArrowCounterClockwise,
  X,
} from "@phosphor-icons/react";

export const BREAKOUT_BLOCK_SELECTOR = "table, .katex-display, pre";
export const BREAKOUT_MIN_SCALE = 0.5;
export const BREAKOUT_MAX_SCALE = 3.0;

export function clampBreakoutScale(scale: number): number {
  return Math.min(
    BREAKOUT_MAX_SCALE,
    Math.max(BREAKOUT_MIN_SCALE, Math.round(scale * 100) / 100),
  );
}

export function resolveBreakoutTitle(element: Element): string {
  if (element.matches("table")) return "Table Breakout View";
  if (element.matches(".katex-display")) return "Math Breakout View";
  if (element.matches("pre") || element.querySelector("code")) return "Code Breakout View";
  return "Breakout View";
}

export interface BreakoutOverlayModalProps {
  isOpen: boolean;
  title?: string;
  contentHtml?: string;
  contentNode?: ReactNode;
  onClose: () => void;
}

export function BreakoutOverlayModal({
  isOpen,
  title = "Breakout View",
  contentHtml,
  contentNode,
  onClose,
}: BreakoutOverlayModalProps) {
  const [scale, setScale] = useState(1.0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

  useEffect(() => {
    if (!isOpen) return;
    setScale(1.0);
    setOffset({ x: 0, y: 0 });
  }, [isOpen, contentHtml, contentNode]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "+" || event.key === "=") {
        setScale((s) => clampBreakoutScale(s + 0.25));
      } else if (event.key === "-") {
        setScale((s) => clampBreakoutScale(s - 0.25));
      } else if (event.key === "0") {
        setScale(1.0);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    setOffset({
      x: dragRef.current.originX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.originY + (e.clientY - dragRef.current.startY),
    });
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-breakout-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-background/95 text-foreground backdrop-blur-sm"
    >
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ArrowsOutSimple className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{title}</h2>
          <span
            data-breakout-scale="true"
            className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground"
          >
            {Math.round(scale * 100)}%
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setScale((s) => clampBreakoutScale(s - 0.25))}
            aria-label="Zoom out"
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            <MagnifyingGlassMinus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => clampBreakoutScale(s + 0.25))}
            aria-label="Zoom in"
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            <MagnifyingGlassPlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setScale(1.0);
              setOffset({ x: 0, y: 0 });
            }}
            aria-label="Reset zoom and pan"
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            <ArrowCounterClockwise className="h-3.5 w-3.5" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close breakout view"
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
            <span>Close</span>
          </button>
        </div>
      </header>
      <div
        className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing select-text p-8 flex items-center justify-center"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
          }
          const delta = e.deltaY < 0 ? 0.15 : -0.15;
          setScale((s) => clampBreakoutScale(s + delta));
        }}
      >
        <div
          data-breakout-canvas="true"
          className="max-w-full rounded-lg border border-border bg-card p-6 shadow-xl transition-transform duration-75"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "center center",
          }}
        >
          {contentNode ?? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: contentHtml ?? "" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function useBreakoutOverlay(containerRef: RefObject<HTMLElement | null>) {
  const [hoveredBlock, setHoveredBlock] = useState<{
    title: string;
    html: string;
    rect: { top: number; right: number };
  } | null>(null);
  const [activeBreakout, setActiveBreakout] = useState<{
    title: string;
    html: string;
  } | null>(null);

  const openBreakout = useCallback((element: Element) => {
    setActiveBreakout({
      title: resolveBreakoutTitle(element),
      html: element.outerHTML,
    });
  }, []);

  const attachToDocument = useCallback(
    (doc: Document, frameElement?: HTMLIFrameElement | null) => {
      const handleOverOrFocus = (event: Event) => {
        const target = event.target;
        if (!(target instanceof doc.defaultView!.Element || target instanceof Element)) return;
        const block = (target as Element).closest(BREAKOUT_BLOCK_SELECTOR);
        if (!block) return;
        const rect = block.getBoundingClientRect();
        const frameRect = frameElement?.getBoundingClientRect();
        const top = (frameRect?.top ?? 0) + rect.top;
        const right = (frameRect?.left ?? 0) + rect.right;
        setHoveredBlock({
          title: resolveBreakoutTitle(block),
          html: block.outerHTML,
          rect: {
            top: Math.max(8, top + 6),
            right: Math.max(8, window.innerWidth - right + 6),
          },
        });
      };

      doc.addEventListener("mouseover", handleOverOrFocus);
      doc.addEventListener("focusin", handleOverOrFocus);
      return () => {
        doc.removeEventListener("mouseover", handleOverOrFocus);
        doc.removeEventListener("focusin", handleOverOrFocus);
      };
    },
    []
  );

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const handleOverOrFocus = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const block = target.closest(BREAKOUT_BLOCK_SELECTOR);
      if (!block || !root.contains(block)) return;
      const rect = block.getBoundingClientRect();
      setHoveredBlock({
        title: resolveBreakoutTitle(block),
        html: block.outerHTML,
        rect: {
          top: Math.max(8, rect.top + 6),
          right: Math.max(8, window.innerWidth - rect.right + 6),
        },
      });
    };

    root.addEventListener("mouseover", handleOverOrFocus);
    root.addEventListener("focusin", handleOverOrFocus);
    return () => {
      root.removeEventListener("mouseover", handleOverOrFocus);
      root.removeEventListener("focusin", handleOverOrFocus);
    };
  }, [containerRef]);

  const breakoutTrigger = hoveredBlock ? (
    <button
      type="button"
      data-breakout-trigger="true"
      onClick={() =>
        setActiveBreakout({
          title: hoveredBlock.title,
          html: hoveredBlock.html,
        })
      }
      style={{
        position: "fixed",
        top: hoveredBlock.rect.top,
        right: hoveredBlock.rect.right,
      }}
      className="z-40 inline-flex items-center gap-1 rounded-md border border-border bg-card/95 px-2 py-1 text-xs font-medium text-foreground shadow-md hover:bg-muted"
    >
      <ArrowsOutSimple className="h-3.5 w-3.5 text-primary" />
      <span>Breakout View</span>
    </button>
  ) : null;

  const breakoutModal = (
    <BreakoutOverlayModal
      isOpen={activeBreakout !== null}
      title={activeBreakout?.title}
      contentHtml={activeBreakout?.html}
      onClose={() => setActiveBreakout(null)}
    />
  );

  return {
    openBreakout,
    attachToDocument,
    breakoutTrigger,
    breakoutModal,
  };
}
