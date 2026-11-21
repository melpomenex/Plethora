import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { AnnotationMode, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";

const ROW_HEIGHT = 144;
const PREVIEW_WIDTH = 132;
const PREVIEW_HEIGHT = 108;

function PagePreview({ pdf, pageNumber }: { pdf: PDFDocumentProxy; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const { t } = useI18n();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    setState("loading");
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(PREVIEW_WIDTH / base.width, PREVIEW_HEIGHT / base.height);
        const viewport = page.getViewport({ scale: scale * Math.min(2, window.devicePixelRatio || 1) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${base.width * scale}px`;
        canvas.style.height = `${base.height * scale}px`;
        renderTask = page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE });
        await renderTask.promise;
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [pdf, pageNumber]);

  return (
    <span className="flex h-[108px] w-full items-center justify-center" aria-hidden="true">
      <canvas ref={canvasRef} className={cn("max-w-full", state !== "ready" && "hidden")} />
      {state === "loading" && <span className="h-[108px] w-[76px] rounded-md bg-muted" />}
      {state === "failed" && <span className="text-xs text-muted-foreground">{t("viewer.pdfPreviewUnavailable")}</span>}
    </span>
  );
}

interface PdfPageThumbnailsProps {
  pdf: PDFDocumentProxy;
  firstPage: number;
  lastPage: number;
  currentPage: number;
  pageLabels: string[] | null;
  onNavigate: (page: number) => void;
}

export function PdfPageThumbnails({ pdf, firstPage, lastPage, currentPage, pageLabels, onNavigate }: PdfPageThumbnailsProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<number | null>(null);
  const count = Math.max(0, lastPage - firstPage + 1);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, Math.min(count - 1, currentPage - firstPage)));
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 2,
    initialOffset: activeIndex * ROW_HEIGHT,
    rangeExtractor: (range) => [...new Set([...defaultRangeExtractor(range), activeIndex])].sort((a, b) => a - b),
  });
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: count - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusTarget.current = Math.max(0, Math.min(count - 1, target));
    if (focusTarget.current === index) {
      focusTarget.current = null;
      return;
    }
    setActiveIndex(focusTarget.current);
    virtualizer.scrollToIndex(focusTarget.current, { align: "auto" });
  };

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <ol aria-label={t("viewer.pdfThumbnails")} className="relative mx-3" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const physicalPage = firstPage + row.index;
          const pageLabel = pageLabels?.[physicalPage - 1];
          const selected = physicalPage === currentPage;
          return (
            <li key={physicalPage} className="absolute inset-x-0 top-0 flex justify-center p-1" style={{ transform: `translateY(${row.start}px)`, height: row.size }}>
              <button
                ref={(element) => {
                  if (element && focusTarget.current === row.index) {
                    focusTarget.current = null;
                    element.focus({ preventScroll: true });
                  }
                }}
                type="button"
                aria-label={t("viewer.page", { current: physicalPage })}
                aria-current={selected ? "page" : undefined}
                title={pageLabel !== undefined && pageLabel !== String(physicalPage) ? t("viewer.printedPageLabel", { label: pageLabel }) : undefined}
                tabIndex={row.index === activeIndex ? 0 : -1}
                className={cn(
                  "md-state flex w-full max-w-[164px] flex-col items-center justify-center gap-1 rounded-md px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                  selected ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted",
                )}
                onFocus={() => setActiveIndex(row.index)}
                onKeyDown={(event) => moveFocus(event, row.index)}
                onClick={() => onNavigate(physicalPage)}
              >
                <PagePreview pdf={pdf} pageNumber={physicalPage} />
                <span className="max-w-full truncate text-xs tabular-nums"><bdi>{pageLabel ?? physicalPage}</bdi></span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
