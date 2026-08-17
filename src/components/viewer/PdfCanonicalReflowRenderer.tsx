/**
 * Canonical (v2) Reflow renderer: real selectable text with word-ID spans
 * (`data-w`), semantic HTML per block kind, and non-blocking progress /
 * failure states (tasks 4.1/4.3/4.6). Typography comes from CSS variables
 * on the container, so font/margin/theme changes re-layout without touching
 * analysis.
 *
 * Perf: every page section and block is memoized. A long document holds
 * thousands of word spans, and the host re-renders on each scroll-driven
 * page change / state update — without memo boundaries that reconciled the
 * whole analyzed range every frame and dropped frames on phones. Analyzed
 * page objects are immutable, so identity-stable props skip re-rendering
 * finished pages entirely.
 */
import { Fragment, memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PdfCanonicalBlock, PdfCanonicalPage, PdfCanonicalWord } from "../../types/pdfCanonical";
import type { StoredHighlight } from "./HighlightLayer";
import { safePdfLink } from "./PdfReflowRenderer";

function WordText({
  words,
  highlightedIds,
}: {
  words: PdfCanonicalWord[];
  highlightedIds: Set<string>;
}) {
  return (
    <>
      {words.map((word, index) => (
        <Fragment key={word.id}>
          {index > 0 ? " " : null}
          {highlightedIds.has(word.id) ? (
            <span data-w={word.id} className="pdf-reflow-highlight">
              {word.text}
            </span>
          ) : (
            <span data-w={word.id}>{word.text}</span>
          )}
        </Fragment>
      ))}
    </>
  );
}

export interface ZoomableAsset {
  url: string;
  alt: string;
  pageNumber: number;
  block: PdfCanonicalBlock;
}

/** Intrinsic pixel size of a block's rendered source crop. */
export interface PdfVisualAssetDims {
  width: number;
  height: number;
}

/**
 * Aspect basis for a visual block. Measured crop dims are exact; the
 * model's optional sourceWidth/sourceHeight covers blocks whose analysis
 * stamped them; the PDF-space bbox is the last-resort ratio (points, but
 * only the ratio matters). Null when nothing is known.
 */
function visualAspect(
  block: PdfCanonicalBlock,
  assetDims?: Map<string, PdfVisualAssetDims>,
): PdfVisualAssetDims | null {
  const measured = assetDims?.get(block.id);
  if (measured && measured.width > 0 && measured.height > 0) return measured;
  const width = block.sourceWidth ?? undefined;
  const height = block.sourceHeight ?? undefined;
  if (width && height && width > 0 && height > 0) return { width, height };
  const bbox = block.sourceRegions[0]?.bbox;
  if (bbox && bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0) {
    return { width: bbox.x1 - bbox.x0, height: bbox.y1 - bbox.y0 };
  }
  return null;
}

/**
 * Visual crop in a reserved aspect box: the box holds the block's space
 * open before the lazy PNG loads (no scroll jump) and pins the aspect at
 * every rendered width; the img's width/height attributes carry the same
 * intrinsic ratio as a second guarantee.
 */
function VisualAssetImg({
  src,
  alt,
  aspect,
  className,
  onClick,
}: {
  src: string;
  alt: string;
  aspect: PdfVisualAssetDims | null;
  className: string;
  onClick?: () => void;
}) {
  return (
    <span
      className="pdf-reflow-visual-box"
      style={aspect ? { aspectRatio: `${aspect.width} / ${aspect.height}` } : undefined}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        width={aspect?.width}
        height={aspect?.height}
        className={className}
        onClick={onClick}
      />
    </span>
  );
}

export function PdfAssetZoomModal({
  asset,
  onClose,
  onViewOriginal,
}: {
  asset: ZoomableAsset;
  onClose: () => void;
  onViewOriginal?: (block: PdfCanonicalBlock) => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, initialOffsetX: 0, initialOffsetY: 0 });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "+" || e.key === "=") {
        setScale((s) => Math.min(s + 0.25, 4));
      } else if (e.key === "-") {
        setScale((s) => Math.max(s - 0.25, 0.5));
      } else if (e.key === "0") {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      initialOffsetX: offset.x,
      initialOffsetY: offset.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setOffset({
      x: dragStartRef.current.initialOffsetX + dx,
      y: dragStartRef.current.initialOffsetY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={asset.alt || "Visual crop zoom viewer"}
      className="fixed inset-0 z-50 flex flex-col bg-background/90 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between border-b border-border bg-card/80 px-4 py-2 text-foreground">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Page {asset.pageNumber}</span>
          {asset.alt && <span className="text-xs text-muted-foreground truncate max-w-xs">{asset.alt}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            onClick={() => setScale((s) => Math.max(s - 0.25, 0.5))}
            aria-label="Zoom out"
          >
            -
          </button>
          <span className="text-xs font-mono w-12 text-center">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            onClick={() => setScale((s) => Math.min(s + 0.25, 4))}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
          >
            Reset
          </button>
          {onViewOriginal && (
            <button
              type="button"
              className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                onClose();
                onViewOriginal(asset.block);
              }}
            >
              View in Original
            </button>
          )}
          <button
            type="button"
            className="rounded border border-border px-3 py-1 text-xs hover:bg-muted"
            onClick={onClose}
            aria-label="Close viewer"
          >
            ✕
          </button>
        </div>
      </div>

      <div
        className="relative flex-1 overflow-hidden flex items-center justify-center p-4 cursor-grab active:cursor-grabbing select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={(e) => {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.15 : -0.15;
          setScale((s) => Math.min(Math.max(s + delta, 0.5), 4));
        }}
      >
        <img
          src={asset.url}
          alt={asset.alt}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: isDraggingRef.current ? "none" : "transform 0.1s ease-out",
            maxHeight: "85vh",
            maxWidth: "90vw",
            objectFit: "contain",
          }}
          className="shadow-2xl rounded"
          draggable={false}
        />
      </div>
    </div>
  );
}

interface BlockProps {
  block: PdfCanonicalBlock;
  /** Page-level word index (built once per page, not once per block). */
  wordById: Map<string, PdfCanonicalWord>;
  highlightedWordIds: Set<string>;
  onViewOriginal?: (block: PdfCanonicalBlock) => void;
  activeSearchBlockId?: string | null;
  assetUrls?: Map<string, string>;
  /** Measured crop pixel dims by block id (aspect basis for visual blocks). */
  assetDims?: Map<string, PdfVisualAssetDims>;
  onZoomAsset?: (asset: ZoomableAsset) => void;
}

const Block = memo(function Block({
  block,
  wordById,
  highlightedWordIds,
  onViewOriginal,
  activeSearchBlockId,
  assetUrls,
  assetDims,
  onZoomAsset,
}: BlockProps) {
  const words = block.wordIds.flatMap((id) => {
    const word = wordById.get(id);
    return word ? [word] : [];
  });
  const common = {
    id: block.id,
    dir: block.direction === "auto" ? undefined : block.direction,
    "data-pdf-page": block.pageNumber,
    "data-pdf-confidence": block.confidence,
  } as const;
  // Marginal roles are suppressed in the reflow stream (spec
  // pdf-canonical-content-model) but remain in the model and Original view.
  if (block.role === "header" || block.role === "footer" || block.role === "page-number") {
    return null;
  }
  let content: ReactNode;
  const aspect = visualAspect(block, assetDims);
  switch (block.kind) {
    case "heading":
      content = <h2 {...common}>{block.text}</h2>;
      break;
    case "list":
      content = (
        <ul {...common}>
          {(block.items ?? [block.text]).map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
      break;
    case "table":
      content = block.table && block.table.rows.length > 0 ? (
        <div className="overflow-x-auto my-3" role="region" aria-label="PDF table">
          <table {...common}>
            <tbody>
              {block.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : assetUrls?.get(block.id) ? (
        <div className="overflow-x-auto my-3" role="region" aria-label={block.altText ?? "PDF table"}>
          <VisualAssetImg
            src={assetUrls.get(block.id)!}
            alt={block.altText ?? "Table"}
            aspect={aspect}
            className="max-w-full h-auto cursor-zoom-in rounded border border-border shadow-sm hover:opacity-95 transition"
            onClick={() => onZoomAsset?.({ url: assetUrls.get(block.id)!, alt: block.altText ?? "Table", pageNumber: block.pageNumber, block })}
          />
        </div>
      ) : (
        // Confidence too low for structure: the source crop renders instead.
        <div {...common} role="img" aria-label={block.altText ?? "Table image"} className="pdf-reflow-asset-fallback rounded border border-border p-4 text-sm text-muted-foreground">
          {block.altText ?? "Table (see original view)"}
        </div>
      );
      break;
    case "figure":
      content = (
        <figure {...common} className="my-3 flex flex-col items-center">
          {assetUrls?.get(block.id) ? (
            <VisualAssetImg
              src={assetUrls.get(block.id)!}
              alt={block.altText ?? ""}
              aspect={aspect}
              className="max-w-full h-auto cursor-zoom-in rounded-lg shadow-sm hover:opacity-95 transition"
              onClick={() => onZoomAsset?.({ url: assetUrls.get(block.id)!, alt: block.altText ?? "Figure", pageNumber: block.pageNumber, block })}
            />
          ) : (
            <div className="rounded border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              Figure — switch to Original view
            </div>
          )}
        </figure>
      );
      break;
    case "caption":
      content = <figcaption {...common} className="text-center text-sm text-muted-foreground my-1 italic">{block.text}</figcaption>;
      break;
    case "footnote":
      content = <aside {...common} role="note">{block.text}</aside>;
      break;
    case "equation":
      content = assetUrls?.get(block.id) ? (
        <div {...common} role="math" className="pdf-reflow-equation my-3 text-center overflow-x-auto">
          {/* Inline-block flow: no aspect box, the width/height attributes
              carry the intrinsic ratio and reserve the line box instead. */}
          <img
            src={assetUrls.get(block.id)}
            alt={block.altText ?? block.text ?? "Equation"}
            loading="lazy"
            width={aspect?.width}
            height={aspect?.height}
            className="max-w-full h-auto inline-block cursor-zoom-in align-middle dark:invert dark:hue-rotate-180"
            onClick={() => onZoomAsset?.({ url: assetUrls.get(block.id)!, alt: block.altText ?? block.text ?? "Equation", pageNumber: block.pageNumber, block })}
          />
        </div>
      ) : (
        <div {...common} role="math" className="font-mono my-2 text-center overflow-x-auto">
          {block.altText ?? block.text}
        </div>
      );
      break;
    case "code":
      content = (
        <pre {...common}>
          <code>{block.text}</code>
        </pre>
      );
      break;
    case "horizontal-rule":
      content = <hr {...common} />;
      break;
    case "page-break":
      content = <hr {...common} aria-label={`Page ${block.pageNumber}`} />;
      break;
    case "unknown-visual":
      content = assetUrls?.get(block.id) ? (
        <div {...common} role="img" aria-label={block.altText ?? "Original content"} className="my-3 flex flex-col items-center">
          <VisualAssetImg
            src={assetUrls.get(block.id)!}
            alt={block.altText ?? ""}
            aspect={aspect}
            className="max-w-full h-auto cursor-zoom-in rounded border border-border shadow-sm hover:opacity-95 transition"
            onClick={() => onZoomAsset?.({ url: assetUrls.get(block.id)!, alt: block.altText ?? "Original visual content", pageNumber: block.pageNumber, block })}
          />
        </div>
      ) : (
        <div {...common} className="pdf-reflow-asset-fallback rounded border border-border p-3 text-sm text-muted-foreground" role="img" aria-label={block.altText ?? "Original content"}>
          {block.altText ?? "Content preserved in original view"}
        </div>
      );
      break;
    default: {
      const href = safePdfLink(block.href ?? undefined);
      const text = words.length > 0 ? <WordText words={words} highlightedIds={highlightedWordIds} /> : block.text;
      content = <p {...common}>{href ? <a href={href} rel="noreferrer noopener" target="_blank">{text}</a> : text}</p>;
    }
  }
  return (
    <div
      className={`pdf-reflow-block group relative${activeSearchBlockId === block.id ? " pdf-reflow-search-target" : ""}`}
      data-pdf-reflow-block={block.id}
    >
      {content}
    </div>
  );
});

interface PageSectionProps {
  page: PdfCanonicalPage;
  highlights: StoredHighlight[];
  onViewOriginal?: (block: PdfCanonicalBlock) => void;
  activeSearchBlockId?: string | null;
  assetUrls?: Map<string, string>;
  /** Measured crop pixel dims by block id (aspect basis for visual blocks). */
  assetDims?: Map<string, PdfVisualAssetDims>;
  /** OCR / graphical fallback for `ocr-required` pages (tasks 7.3–7.5). */
  onRequestOcr?: (page: PdfCanonicalPage) => void;
  onRequestGraphicalFallback?: (page: PdfCanonicalPage) => void;
  onZoomAsset?: (asset: ZoomableAsset) => void;
}

const PageSection = memo(function PageSection({
  page,
  highlights,
  onViewOriginal,
  activeSearchBlockId,
  assetUrls,
  assetDims,
  onRequestOcr,
  onRequestGraphicalFallback,
  onZoomAsset,
}: PageSectionProps) {
  const wordById = useMemo(() => new Map(page.words.map((word) => [word.id, word])), [page]);
  const highlightedWordIds = useMemo(
    () => new Set(highlights.flatMap((highlight) => highlight.wordIds ?? [])),
    [highlights],
  );
  return (
    <section aria-label={`PDF page ${page.pageNumber}`} data-pdf-reflow-page={page.pageNumber}>
      {page.pageNumber > 1 && (
        <div className="pdf-reflow-page-divider my-6 flex items-center justify-between border-t border-border/40 pt-2 text-xs text-muted-foreground select-none" aria-hidden="true">
          <span className="font-medium tracking-wide">Page {page.pageNumber}</span>
          {onViewOriginal && page.blocks[0] && (
            <button
              type="button"
              className="text-xs hover:text-foreground transition-colors py-1 px-2 rounded hover:bg-muted"
              onClick={() => onViewOriginal(page.blocks[0])}
            >
              View original
            </button>
          )}
        </div>
      )}
      {page.state === "processing" && (
        <p role="status">Preparing page {page.pageNumber}…</p>
      )}
      {page.state === "ocr-required" && (
        <div role="status" className="rounded-xl border border-border p-4">
          <p>Page {page.pageNumber} needs text recognition. It stays readable in Original view.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {onRequestOcr && (
              <button type="button" className="min-h-11 rounded-md border border-border px-4" onClick={() => onRequestOcr(page)}>
                Recognize this page
              </button>
            )}
            {onRequestGraphicalFallback && (
              <button type="button" className="min-h-11 rounded-md border border-border px-4" onClick={() => onRequestGraphicalFallback(page)}>
                Reflow as images
              </button>
            )}
          </div>
        </div>
      )}
      {page.state === "failed" && (
        <p role="alert">Page {page.pageNumber} is available in original view.</p>
      )}
      {page.blocks.map((block) => (
        <Block
          key={block.id}
          block={block}
          wordById={wordById}
          highlightedWordIds={highlightedWordIds}
          onViewOriginal={onViewOriginal}
          activeSearchBlockId={activeSearchBlockId}
          assetUrls={assetUrls}
          assetDims={assetDims}
          onZoomAsset={onZoomAsset}
        />
      ))}
    </section>
  );
});

export function PdfCanonicalReflowRenderer({
  pages,
  pendingPageNumbers = [],
  onViewOriginal,
  highlights = [],
  activeSearchBlockId,
  assetUrls,
  assetDims,
  onRequestOcr,
  onRequestGraphicalFallback,
  style,
  dir,
  className,
}: {
  pages: PdfCanonicalPage[];
  /** Pages still queued/analyzing — rendered as light progress placeholders. */
  pendingPageNumbers?: number[];
  onViewOriginal?: (block: PdfCanonicalBlock) => void;
  highlights?: StoredHighlight[];
  activeSearchBlockId?: string | null;
  /** Lazy source-crop object URLs by block id (task 6.2). */
  assetUrls?: Map<string, string>;
  /** Measured crop pixel dims by block id — aspect basis for visual blocks. */
  assetDims?: Map<string, PdfVisualAssetDims>;
  /** OCR / graphical fallback for `ocr-required` pages (tasks 7.3–7.5). */
  onRequestOcr?: (page: PdfCanonicalPage) => void;
  onRequestGraphicalFallback?: (page: PdfCanonicalPage) => void;
  style?: CSSProperties;
  dir?: string;
  className?: string;
}) {
  const [zoomedAsset, setZoomedAsset] = useState<ZoomableAsset | null>(null);

  const renderedItems = useMemo(() => {
    const pageMap = new Map<number, PdfCanonicalPage>();
    for (const page of pages) {
      pageMap.set(page.pageNumber, page);
    }
    const allPageNumbers = new Set<number>([
      ...pages.map((p) => p.pageNumber),
      ...pendingPageNumbers,
    ]);
    return [...allPageNumbers].sort((a, b) => a - b).map((num) => ({
      pageNumber: num,
      page: pageMap.get(num) ?? null,
    }));
  }, [pages, pendingPageNumbers]);

  return (
    <>
      <article className={`pdf-reflow-content ${className ?? ""}`} aria-label="Reflowed PDF" dir={dir} style={style}>
        {renderedItems.map(({ pageNumber, page }) =>
          page ? (
            <PageSection
              key={pageNumber}
              page={page}
              highlights={highlights}
              onViewOriginal={onViewOriginal}
              activeSearchBlockId={activeSearchBlockId}
              assetUrls={assetUrls}
              assetDims={assetDims}
              onRequestOcr={onRequestOcr}
              onRequestGraphicalFallback={onRequestGraphicalFallback}
              onZoomAsset={setZoomedAsset}
            />
          ) : (
            <section
              key={`pending-${pageNumber}`}
              aria-label={`PDF page ${pageNumber} pending`}
              data-pdf-reflow-page={pageNumber}
              className="my-6 rounded-lg border border-border/40 p-4 bg-muted/10"
            >
              <p role="status" className="text-xs text-muted-foreground flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-primary/60 animate-pulse" />
                Preparing page {pageNumber}…
              </p>
            </section>
          ),
        )}
      </article>
      {zoomedAsset && (
        <PdfAssetZoomModal
          asset={zoomedAsset}
          onClose={() => setZoomedAsset(null)}
          onViewOriginal={onViewOriginal}
        />
      )}
    </>
  );
}
