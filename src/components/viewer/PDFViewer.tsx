import { useEffect, useRef, useState, useCallback, useMemo, useReducer, type CSSProperties } from "react";
import * as pdfjsLib from "pdfjs-dist";
// URL of the compiled bootstrap worker chunk (src/workers/pdfjs.worker.ts).
// Vite's worker cache emits ONE chunk for this file shared by both this
// `?worker&url` import and the `new Worker(new URL(...))` construction below —
// previously workerSrc pointed at a separate `pdf.worker.min.mjs?url` asset,
// which shipped the ~1 MB PDF.js worker twice in every build. The bootstrap
// chunk is a valid workerSrc target for PDF.js's same-thread fake-worker
// fallback because it is emitted as an ES module (worker.format "es" in
// vite.config.ts) re-exporting WorkerMessageHandler.
import pdfWorkerSrc from "../../workers/pdfjs.worker?worker&url";
import { EventBus } from "pdfjs-dist/web/pdf_viewer.mjs";
import { PdfPageViewWrapper } from "./PdfPageView";
import {
  CaretLeft,
  CaretRight,
  CornersIn,
  CornersOut,
  List,
  Scan,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import { cn } from "../../utils";
import type { PdfDest, ViewState } from "../../types/readerPosition";
import type { PdfRect, PdfSelectionContext, ViewportRect } from "../../types/selection";
import type { DocumentPosition } from "../../types/position";
import type { DocumentMetadata, Document } from "../../types/document";
import { saveDocumentPosition, getDocumentPosition, pagePosition, scrollPosition as createScrollPosition } from "../../api/position";
import { getDocumentAuto, updateDocumentProgressAuto } from "../../api/documents";
import { getFormFactor, isTauri } from "../../lib/tauri";
import { shouldUseNativePdfRangeSource, isPdfFeatureEnabled } from "./pdfFeatureFlags";
import { markBusy } from "../../lib/memoryScenario/activity";
import { createPdfDocumentHolder } from "../../lib/pdf/pdfDocumentHolder";
import {
  deriveCurrentPageFromOffsets,
  isNavigationSettled,
  isStaleNavigationToken,
  shouldSuppressProgrammaticScroll,
  type NavigationMode,
} from "./pdfNavigationStability";
import {
  derivePdfTextSelectionCapability,
  selectionAnchorsInTextLayers,
  selectionIntersectsTextLayers,
  canUsePdfSelectionAction,
  type PdfTextSelectionCapability,
} from "./pdfTextSelection";
import {
  reducePdfSelectionPersistence,
  initialPdfSelectionPersistenceState,
  type SelectionClearReason,
} from "./pdfSelectionPersistence";
import { useI18n } from "../../lib/i18n";
import { useVimModeStore } from "../../stores/vimModeStore";
import { useDocumentOutlineStore } from "../../stores/documentOutlineStore";
// 3-layer architecture components
import type { StoredHighlight } from "./HighlightLayer";
import { SelectionPopup, type HighlightColor } from "./SelectionPopup";
import { OcrRegionSelector } from "./OcrRegionSelector";
import { OcrProgressOverlay } from "./OcrProgressOverlay";
import { OcrTextPreview } from "./OcrTextPreview";
import { usePdfOcrManager } from "./PdfOcrManager";
import { createPdfLoadSourceFactories } from "./pdfLoadSources";
import { createNativePdfRangeSource, type NativePdfRangeTransport } from "./nativePdfRangeTransport";
import { normalizePdfError, pdfErrorUserMessage, pdfRecoveryActionsFor, shouldRetryPdfWorker, type NormalizedPdfError } from "./pdfErrors";
import { PdfDiagnostics } from "./pdfDiagnostics";
import { initialPdfReaderState, reducePdfReaderState } from "./pdfReaderState";
import { createBrowserPdfReflowCache } from "./pdfReflowCache";
import { createPdfReflowDocument, pdfReflowCacheKey, type PdfReflowBlock, type PdfReflowDocument } from "./pdfReflowTypes";
import { PdfReflowScheduler } from "./pdfReflowScheduler";
import { PdfReflowRenderer } from "./PdfReflowRenderer";
import { useSettingsStore } from "../../stores/settingsStore";
import { loadPdfMobilePreferences, pdfMobilePreferencesFromSettings, savePdfMobilePreferences } from "./pdfMobilePreferences";
import { PdfReflowOcrController, type PdfPageOcrUpdate } from "./pdfReflowOcr";
import { anchorFromReflowBlock, resolveReflowBlock } from "./pdfAnchorResolver";
import { ReaderFileDownload } from "../sync/ReaderFileDownload";
import type { PdfVimRuntime } from "../../utils/vim/readerRuntimes";
import { useReaderVolumeNavigation } from "../../hooks/useReaderVolumeNavigation";
import { ReaderTapZones } from "./ReaderTapZones";
// Import PDF.js text layer styles
import "pdfjs-dist/web/pdf_viewer.css";
import "./PDFViewer.css";

interface PdfPageIndicatorProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  pageNumber: number;
  numPages: number;
  effectiveStartPage: number;
  effectiveEndPage: number;
  totalEffectivePages: number;
  isChunked: boolean;
  onJump: (page: number) => void;
}

/**
 * Inline "go to page" field for the PDF viewer toolbar.
 *
 * Reads as plain muted text ("Page X of Y" or "X/Y") while unfocused; becomes
 * an editable number input on focus (click or ⌘G). The field always edits the
 * absolute book page number (`pageNumber`), which is what `onJump` accepts and
 * what `handleGoToPage` clamps to the effective chunk bounds. Out-of-range
 * values are silently clamped; Enter jumps, Esc cancels, ArrowUp/Down nudge ±1,
 * mouse-wheel flips pages.
 */
function PdfPageIndicator({
  inputRef,
  pageNumber,
  numPages,
  effectiveStartPage,
  effectiveEndPage,
  totalEffectivePages,
  isChunked,
  onJump,
}: PdfPageIndicatorProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(pageNumber));
  const focusedRef = useRef(false);

  // Keep the draft in sync with the live page number (scroll, prev/next, TOC,
  // deep-link) — but only while the field is NOT being edited.
  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(pageNumber));
    }
  }, [pageNumber]);

  const clamp = useCallback(
    (value: number) => {
      const lo = Math.min(1, effectiveStartPage);
      return Math.max(lo, Math.min(effectiveEndPage, value));
    },
    [effectiveStartPage, effectiveEndPage]
  );

  const commit = useCallback(() => {
    const parsed = parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(pageNumber));
      return;
    }
    const target = clamp(parsed);
    setDraft(String(target));
    if (target !== pageNumber) {
      onJump(target);
    }
  }, [draft, pageNumber, clamp, onJump]);

  const revert = useCallback(() => {
    setDraft(String(pageNumber));
    inputRef.current?.blur();
  }, [pageNumber, inputRef]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        inputRef.current?.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        revert();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        onJump(clamp(pageNumber + 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        onJump(clamp(pageNumber - 1));
      }
    },
    [commit, revert, clamp, pageNumber, onJump, inputRef]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLInputElement>) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 : -1;
      onJump(clamp(pageNumber + delta));
    },
    [clamp, pageNumber, onJump]
  );

  const inputClass =
    "w-[2rem] md:w-[2.25rem] bg-transparent border-none outline-none text-center font-medium text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-background focus:border focus:border-border focus:rounded focus:ring-2 focus:ring-primary transition-colors";
  const inputStyle = { MozAppearance: "textfield" } as React.CSSProperties;

  if (isChunked) {
    // Chunked view: "Page <in> of N  (Book Page <in>)". The editable value is
    // the absolute book page (what onJump accepts); the leading chunk-relative
    // number is shown read-only for orientation.
    const relativePage = pageNumber - effectiveStartPage + 1;
    return (
      <span
        className="text-xs md:text-sm text-muted-foreground min-w-[70px] md:min-w-[100px] text-center whitespace-nowrap px-2 inline-flex items-center justify-center gap-1"
        role="group"
        aria-label="Page indicator"
      >
        <span className="hidden md:inline">Page {relativePage} of {totalEffectivePages}</span>
        <span className="md:hidden">{relativePage}/{totalEffectivePages}</span>
        <span className="text-[10px] text-muted-foreground opacity-80 inline-flex items-center gap-0.5">
          (Book P.
          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            value={draft}
            min={Math.min(1, effectiveStartPage)}
            max={effectiveEndPage}
            aria-label={t("viewer.goToPage")}
            size={4}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              focusedRef.current = true;
              e.target.select();
            }}
            onBlur={() => {
              focusedRef.current = false;
              commit();
            }}
            onKeyDown={handleKeyDown}
            onWheel={handleWheel}
            className={inputClass}
            style={inputStyle}
          />
          )
        </span>
      </span>
    );
  }

  // Non-chunked view: "<in> / N"
  return (
    <span
      className="text-xs md:text-sm text-muted-foreground min-w-[70px] md:min-w-[100px] text-center whitespace-nowrap px-2 inline-flex items-center justify-center"
      role="group"
      aria-label="Page indicator"
    >
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        value={draft}
        min={1}
        max={numPages || undefined}
        aria-label={t("viewer.goToPage")}
        size={4}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          focusedRef.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        className={inputClass}
        style={inputStyle}
      />
      <span className="select-none ml-0.5">/ {numPages}</span>
    </span>
  );
}

// Configure the PDF.js worker.
//
// We build the Worker ourselves and pass it via `workerPort` rather than
// handing PDF.js a `workerSrc` URL string. Two reasons:
//
//  1. Vite rewrites `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`
//     into an *absolute* "/assets/pdf.worker.min-<hash>.mjs" path. On Tauri
//     Android (origin http://asset.localhost), and especially on older
//     Android WebViews such as the Boox Palma's, spawning a module worker
//     from that absolute path fails. PDF.js then falls back to its fake
//     worker, re-reads `PDFWorker.workerSrc`, and throws
//       "No GlobalWorkerOptions.workerSrc specified."
//     which surfaces as "Failed to load PDF". Passing a Worker instance via
//     `workerPort` skips the throwing getter entirely.
//
//  2. The `new Worker(new URL(...), { type: "module" })` form makes Vite emit
//     a *relative* asset reference (same pattern as our argon2id / alignment
//     workers), which resolves correctly under Tauri's custom protocol.
//
// The bootstrap worker (`src/workers/pdfjs.worker.ts`) also installs the
// Promise/Uint8Array polyfills PDF.js v5 needs on older WebViews.
//
// This runs in the main thread only (browser/Tauri), not in Node test runs
// where `Worker` is unavailable and pdfjs is mocked anyway (see test/setup.ts).
try {
  // Keep workerSrc populated even when workerPort is preferred. If Android's
  // WebView rejects the module Worker, PDF.js can still import this bundle as
  // its same-thread fallback instead of throwing that workerSrc is missing.
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  if (typeof Worker !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
      new URL("../../workers/pdfjs.worker.ts", import.meta.url),
      { type: "module" }
    );
  }
} catch {
  // Worker construction is best-effort: if it fails, PDF.js will fall back
  // to its fake (same-thread) worker via the load-retry logic below.
  console.warn("[PDFViewer] Could not construct PDF worker, using fallback");
}

/**
 * Ensure the PDF.js worker module has been evaluated on the MAIN thread so the
 * same-thread "fake worker" fallback can find it.
 *
 * Vite bundles worker entries with `preserveEntrySignatures: false`, so the
 * emitted pdfjs.worker chunk has NO module exports — PDF.js's fallback loader
 * (`(await import(workerSrc)).WorkerMessageHandler`) would read `undefined`
 * from the namespace. Evaluating the module also sets `globalThis.pdfjsWorker`
 * as a side effect, and PDF.js checks that global FIRST, so importing it here
 * (idempotent, only on the fallback path) makes the global-check win before
 * PDF.js attempts the namespace lookup.
 */
async function ensureFakeWorkerModuleLoaded(): Promise<void> {
  const g = globalThis as unknown as { pdfjsWorker?: { WorkerMessageHandler?: unknown } };
  if (g.pdfjsWorker?.WorkerMessageHandler) return;
  try {
    await import(/* @vite-ignore */ pdfWorkerSrc);
  } catch (err) {
    console.warn("[PDFViewer] Failed to preload fake-worker module:", err);
  }
}

// Suppress verbose PDF.js warnings (Unicode mismatch, unknown glyph name, etc.)
// Only show errors, not warnings or info messages
(pdfjsLib as any).GlobalWorkerOptions.verbosity = 0;

// Suppress PDF.js 5.x internal TypeError("Cannot read properties of null (reading 'parentNode')")
// that fires during page virtualization / scroll cleanup. PDF.js private fields (#e, #container)
// reference DOM nodes that get detached before the async text-layer pump finishes.
// Register at module scope so the handler is active before any async PDF.js work begins
// (the useEffect-based handler can be too late on some platforms / WebView engines).
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (reason instanceof TypeError && /parentNode/.test(String(reason.message))) {
      event.preventDefault();
    }
  });
}

interface PDFViewerProps {
  documentId: string;
  /** Full document, for offering a download when the local file is missing
   *  (e.g. a synced PDF whose bytes haven't transferred yet). Optional. */
  doc?: Document;
  fileData?: Uint8Array | null;
  fileUrl?: string | null;
  useNativeRange?: boolean;
  pageNumber: number;
  scale: number;
  zoomMode?: ZoomMode;
  suppressAutoScroll?: boolean;
  highlightQuery?: string;
  highlightPageNumber?: number;
  highlightTextQuote?: string;
  searchQuery?: string;
  searchNavigationRequest?: {
    requestId: number;
    direction?: "next" | "previous";
    targetIndex?: number;
  } | null;
  onPageChange?: (pageNumber: number) => void;
  onScaleChange?: (scale: number) => void;
  onZoomModeChange?: (zoomMode: ZoomMode) => void;
  onLoad?: (numPages: number, outline: any[]) => void;
  onPagesRendered?: () => void;
  onScrollPositionChange?: (state: {
    pageNumber: number;
    scrollTop: number;
    scrollLeft: number;
    scrollHeight: number;
    clientHeight: number;
    scrollPercent: number;
    scale?: number;
    dest?: PdfDest | null;
    pdfAnchor?: ViewState["pdfAnchor"];
  }) => void;
  onPdfInfo?: (info: { fingerprint?: string | null }) => void;
  restoreState?: ViewState | null;
  restoreRequestId?: number;
  onUserScrollDuringRestore?: () => void;
  contextPageWindow?: number;
  onTextWindowChange?: (text: string) => void;
  onSelectionChange?: (text: string, context?: PdfSelectionContext | null) => void;
  onTextSelectionCapabilityChange?: (capability: PdfTextSelectionCapability) => void;
  onSearchResultsChange?: (state: {
    query: string;
    totalMatches: number;
    activeMatchIndex: number;
    isSearchable: boolean;
    status: "idle" | "searching" | "ready" | "unavailable";
  }) => void;
  onOcrExtractText?: (text: string, pageNumber: number) => void;
  persistedHighlights?: StoredHighlight[];
  onHighlightSelection?: (color: HighlightColor, text: string, context: PdfSelectionContext) => void;
  onHighlightSelectionWithDialog?: (color: HighlightColor, text: string, context: PdfSelectionContext) => void;
  metadata?: DocumentMetadata;
  ttsQuery?: string;
  ttsHighlightEnabled?: boolean;
  onTextLayerRootsChange?: (roots: (HTMLDivElement | null)[], scrollContainer: HTMLElement | null) => void;
  onVimRuntimeChange?: (runtime: PdfVimRuntime | null) => void;
}

type PdfSearchMatch = {
  pageNumber: number;
  pageMatchIndex: number;
  globalIndex: number;
};

type ZoomMode = "custom" | "fit-width" | "fit-page";
const VIRTUALIZATION_THRESHOLD_PAGES = 40;
const VIRTUAL_WINDOW_PAGES = 6;
const PAGE_GAP_PX = 24;
const ENABLE_PDF_VIRTUALIZATION = true;
const USER_SCROLL_LOCKOUT_MS = 1200;
const NAV_SETTLE_THRESHOLD_PX = 40;
const NAV_SETTLE_STABLE_MS = 180;
const NAV_SETTLE_TIMEOUT_MS = 1400;
const PDF_NAV_STABILITY_FLAG_KEY = "incrementum.feature.pdfNavigationStability";
const PDF_NAV_STABILITY_DEBUG_KEY = "incrementum.debug.pdfNavigationStability";

export function PDFViewer({
  documentId,
  doc,
  fileData,
  fileUrl,
  useNativeRange = false,
  pageNumber,
  scale,
  zoomMode: externalZoomMode,
  suppressAutoScroll = false,
  highlightQuery,
  highlightPageNumber,
  highlightTextQuote,
  searchQuery,
  searchNavigationRequest,
  onPageChange,
  onScaleChange,
  onZoomModeChange,
  onLoad,
  onPagesRendered,
  onScrollPositionChange,
  onPdfInfo,
  restoreState,
  restoreRequestId,
  onUserScrollDuringRestore,
  contextPageWindow = 2,
  onTextWindowChange,
  onSelectionChange,
  onTextSelectionCapabilityChange,
  onSearchResultsChange,
  onOcrExtractText,
  persistedHighlights = [],
  onHighlightSelection,
  onHighlightSelectionWithDialog,
  metadata,
  ttsQuery,
  ttsHighlightEnabled,
  onTextLayerRootsChange,
  onVimRuntimeChange,
}: PDFViewerProps) {
  const { t } = useI18n();

  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<NormalizedPdfError | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const diagnosticsRef = useRef(new PdfDiagnostics());
  const [readerState, setReaderState] = useState(initialPdfReaderState);
  const [passwordValue, setPasswordValue] = useState("");
  const passwordSubmitRef = useRef<((password: string) => void) | null>(null);
  const [pdfSourceIdentity, setPdfSourceIdentity] = useState<{ identity: string; fingerprint: string } | null>(null);
  const [reflowDocument, setReflowDocument] = useState<PdfReflowDocument | null>(null);
  const [mobilePdfMode, setMobilePdfMode] = useState<"fixed" | "reflow">("fixed");
  const reflowCacheRef = useRef(createBrowserPdfReflowCache());
  const reflowSchedulerRef = useRef<PdfReflowScheduler | null>(null);
  const modeOverriddenRef = useRef(false);
  const isPhone = typeof window !== "undefined" && getFormFactor() === "phone";
  const pdfSettings = useSettingsStore((state) => state.settings.documents.pdfSettings);
  const updateSettingsCategory = useSettingsStore((state) => state.updateSettingsCategory);
  const [mobilePreferences, setMobilePreferences] = useState(() => loadPdfMobilePreferences(documentId, pdfMobilePreferencesFromSettings(pdfSettings)));
  const [showMobileSettings, setShowMobileSettings] = useState(false);
  const [mobileChromeVisible, setMobileChromeVisible] = useState(true);
  const reflowOcrRef = useRef(new PdfReflowOcrController());
  const [pageOcrUpdate, setPageOcrUpdate] = useState<PdfPageOcrUpdate | null>(null);
  const [reflowSearchBlockId, setReflowSearchBlockId] = useState<string | null>(null);

  useEffect(() => {
    setMobilePreferences(loadPdfMobilePreferences(documentId, pdfMobilePreferencesFromSettings(pdfSettings)));
  }, [documentId]);

  const updateMobilePreferences = useCallback((updates: Partial<typeof mobilePreferences>) => {
    setMobilePreferences((current) => {
      const next = { ...current, ...updates };
      savePdfMobilePreferences(documentId, next);
      return next;
    });
  }, [documentId]);
  const [outline, setOutline] = useState<any[]>([]);
  const [flatOutline, setFlatOutline] = useState<{ title: string; dest: any; pageNumber: number }[]>([]);
  const [showTOC, setShowTOC] = useState(false);
  const [zoomMode, setZoomMode] = useState<ZoomMode>(externalZoomMode || "custom");

  // Allow the document-viewer palette action "Toggle Table of Contents" to
  // toggle this sub-viewer's TOC panel (the parent DocumentViewer dispatches
  // the event; only the active sub-viewer is mounted to hear it).
  useEffect(() => {
    const onToggle = () => setShowTOC((prev) => !prev);
    window.addEventListener("viewer-toggle-toc", onToggle);
    return () => window.removeEventListener("viewer-toggle-toc", onToggle);
  }, []);

  const effectiveStartPage = useMemo(() => {
    return metadata?.chunkStartPage ?? 1;
  }, [metadata]);

  const effectiveEndPage = useMemo(() => {
    return metadata?.chunkEndPage ?? numPages;
  }, [metadata, numPages]);

  const totalEffectivePages = useMemo(() => {
    return effectiveEndPage - effectiveStartPage + 1;
  }, [effectiveStartPage, effectiveEndPage]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const outerContainerRef = useRef<HTMLDivElement>(null);
  const pageContainerRefs = useRef<(HTMLDivElement | null)[]>([]);
  // canvas now lives inside PDFPageView's .canvasWrapper; we keep a ref to it
  // (populated via the onCanvasRef callback from PdfPageViewWrapper) so OCR
  // region selection can still capture from it.
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const textLayerRootsRef = useRef<(HTMLDivElement | null)[]>([]);
  const vimRuntimeListenersRef = useRef(new Set<(event: { kind: "content" | "geometry" | "destroyed"; pageNumber?: number }) => void>());
  const pageViewportRefs = useRef<(import("pdfjs-dist").PageViewport | null)[]>([]);
  const pageScaleRefs = useRef<(number | null)[]>([]);
  // Shared pdf.js EventBus — every PDFPageView for this document shares it.
  // We listen for textlayerrendered/pagerendered on it to know when to grab
  // pageView.textLayer.div.
  const eventBusRef = useRef<EventBus | null>(null);
  if (eventBusRef.current === null) {
    eventBusRef.current = new EventBus();
  }
  const scrollRafRef = useRef<number | null>(null);
  const pageNumberRef = useRef(pageNumber);
  const onPageChangeRef = useRef(onPageChange);
  const onVimRuntimeChangeRef = useRef(onVimRuntimeChange);
  const isProgrammaticScrollRef = useRef(false);
  // Keep pageNumberRef in sync so async page-view callbacks can check it
  useEffect(() => { pageNumberRef.current = pageNumber; }, [pageNumber]);
  useEffect(() => { onPageChangeRef.current = onPageChange; }, [onPageChange]);
  useEffect(() => { onVimRuntimeChangeRef.current = onVimRuntimeChange; }, [onVimRuntimeChange]);

  // If the page number update came from scroll syncing, don't auto-scroll to the top of the page.
  // (pageNumberRef sync is above)
  const pageUpdateFromScrollRef = useRef(false);
  // If the user scrolls during an in-flight restore attempt, cancel further restore retries.
  const userScrolledDuringRestoreRef = useRef(false);
  const userScrollSignaledRef = useRef(false);
  const textCacheRef = useRef<Map<number, string>>(new Map());
  const textWindowRef = useRef<{ start: number; end: number }>({ start: 1, end: 1 });
  const skipAutoScrollOnceRef = useRef(false);
  const lastSelectionWasPdfRef = useRef(false);
  const pageTextSelectionAvailabilityRef = useRef<Map<number, boolean>>(new Map());
  // Track the last restored page to prevent scroll events from resetting backwards
  const restoredPageRef = useRef<number | null>(null);
  const restorationWindowRef = useRef<number>(0);
  // Track initial load to suppress resize during first render
  const initialLoadWindowRef = useRef<number>(Date.now() + 5000); // 5 second initial protection
  const searchResultsRef = useRef<PdfSearchMatch[]>([]);
  const pageSearchMatchesRef = useRef<Map<number, PdfSearchMatch[]>>(new Map());
  const searchQueryRef = useRef("");
  const searchStatusRef = useRef<"idle" | "searching" | "ready" | "unavailable">("idle");
  const isSearchableRef = useRef(true);
  const activeSearchMatchIndexRef = useRef(-1);
  const pendingSearchScrollRef = useRef<number | null>(null);
  const searchRequestTokenRef = useRef(0);
  const lastProcessedSearchNavRequestRef = useRef<number | null>(null);
  const lastScrolledTtsQueryRef = useRef("");

  const getHighlightsForPage = useCallback(
    (pageNumberForHighlights: number) =>
      persistedHighlights.filter((highlight) => highlight.pageNumber === pageNumberForHighlights),
    [persistedHighlights],
  );

  // OCR mode manager
  const ocr = usePdfOcrManager();

  // Reset OCR mode when page changes or document unloads
  useEffect(() => {
    if (ocr.flowState !== "idle") {
      ocr.exitOcrMode();
    }
  }, [pageNumber]);  

  // Persisted-selection state: the committed PDF selection (the source of
  // truth for the per-page overlay), the floating popup visibility/rect, and
  // the selected text. Every transition goes through
  // reducePdfSelectionPersistence so the commit/clear semantics are
  // centralized and unit-tested (see pdfSelectionPersistence.ts).
  const [persistedSelection, dispatchPersistence] = useReducer(
    reducePdfSelectionPersistence,
    initialPdfSelectionPersistenceState,
  );
  const persistedSelectionRef = useRef<PdfSelectionContext | null>(null);
  useEffect(() => {
    persistedSelectionRef.current = persistedSelection.selection;
  }, [persistedSelection.selection]);
  // Bumped when a page viewport changes while a selection is persisted, so the
  // per-page overlay re-derives its rects even when the geometry change did
  // not flow through the `scale` prop (e.g. a relayout that resizes pages).
  const [, setSelectionOverlayNonce] = useState(0);
  const [fallbackPageSize, setFallbackPageSize] = useState<{ width: number; height: number } | null>(null);
  // Bumped by the ResizeObserver so fit-width/fit-page recomputes per-page scale.
  const resizeNonceRef = useRef(0);
  const [, setResizeNonce] = useState(0);

  const notifyTextLayersChange = useCallback(() => {
    onTextLayerRootsChange?.([...textLayerRootsRef.current], scrollContainerRef.current);
  }, [onTextLayerRootsChange]);

  // ── PdfPageViewWrapper lifecycle callbacks ──────────────────────────────
  // These bridge the imperative pdf.js page views into the refs that the rest
  // of this component (selection, scroll math, search/TTS, OCR) depends on.
  //
  // `applyTextLayerHighlights` and `recomputePageOffsets` are defined further
  // down this component; we hold them in forward refs so the page-view
  // callbacks (declared here, before those functions) can invoke them without
  // reordering the whole file.
  const applyTextLayerHighlightsRef = useRef<((pageIndex: number) => void) | null>(null);
  const recomputePageOffsetsRef = useRef<(() => void) | null>(null);

  const handleSlotRef = useCallback((idx: number, slot: HTMLDivElement | null) => {
    pageContainerRefs.current[idx] = slot;
  }, []);

  const handleViewportChange = useCallback((idx: number, viewport: import("pdfjs-dist").PageViewport) => {
    pageViewportRefs.current[idx] = viewport;
    pageScaleRefs.current[idx] = viewport.scale;
    recomputePageOffsetsRef.current?.();
    vimRuntimeListenersRef.current.forEach((listener) => listener({ kind: "geometry", pageNumber: idx + 1 }));
    // Re-derive persisted-selection overlay rects when page geometry changes
    // (zoom / relayout) even if the change did not flow through the `scale`
    // prop — the overlay converts from PDF-space rects at render time.
    if (persistedSelectionRef.current) {
      setSelectionOverlayNonce((n) => n + 1);
    }
  }, []);

  const handleCanvasRef = useCallback((idx: number, canvas: HTMLCanvasElement | null) => {
    canvasRefs.current[idx] = canvas;
  }, []);

  const handleTextLayerReady = useCallback((idx: number, textLayerDiv: HTMLDivElement | null) => {
    textLayerRootsRef.current[idx] = textLayerDiv;
    notifyTextLayersChange();
    // Re-apply search / TTS / jump-highlight marks now that the text layer is fresh.
    applyTextLayerHighlightsRef.current?.(idx);
    vimRuntimeListenersRef.current.forEach((listener) => listener({ kind: "content", pageNumber: idx + 1 }));
  }, [notifyTextLayersChange]);

  // Update parent with text layer roots and scroll container on load/mount
  useEffect(() => {
    if (scrollContainerRef.current) {
      notifyTextLayersChange();
    }
  }, [pdf, notifyTextLayersChange]);
  const [textSelectionCapability, setTextSelectionCapability] = useState<PdfTextSelectionCapability>(() =>
    derivePdfTextSelectionCapability(pageTextSelectionAvailabilityRef.current, 0, pageNumber),
  );
  // Lazy loading: track which pages should be rendered
  const [renderedPageRange, setRenderedPageRange] = useState<{ start: number; end: number }>({ start: 1, end: 1 });
  const renderedPageRangeRef = useRef({ start: 1, end: 1 });
  const pendingNavRef = useRef<{ token: number; pageNumber: number; destArray: any[] | null } | null>(null);
  const navModeRef = useRef<NavigationMode>("idle");
  const userScrollLockoutUntilRef = useRef(0);
  const navTokenCounterRef = useRef(0);
  const activeNavTokenRef = useRef<number | null>(null);
  const latestTocRequestTokenRef = useRef<number | null>(null);
  const navSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navSettleStableSinceRef = useRef<number | null>(null);
  const navSettleTargetRef = useRef<{ token: number; targetTop: number; pageNumber: number } | null>(null);
  const pdfNavStabilityEnabledRef = useRef(true);
  const pdfNavStabilityDebugRef = useRef(false);
  const isTauriRuntime = isTauri();
  // Host element of the floating selection popup. Clicks on it must not be
  // treated as "outside any PDF page" clears.
  const selectionPopupHostRef = useRef<HTMLDivElement | null>(null);

  // Position persistence refs
  const docIdRef = useRef<string>("");
  const lastSavedPositionRef = useRef<DocumentPosition | null>(null);
  const lastPositionRef = useRef<DocumentPosition | null>(null);
  const positionSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRestoringPositionRef = useRef(false);

  // Central clear path for the persisted selection (spec: explicit clear
  // semantics). `clearNative` is false only for the in-page-drag trigger, where
  // the browser is about to start a new selection gesture and must keep its own
  // range intact — the committed overlay/text still reset.
  const clearPersistedSelection = useCallback(
    (reason: SelectionClearReason, clearNative = true) => {
      dispatchPersistence({ type: "clear", reason });
      lastSelectionWasPdfRef.current = false;
      if (clearNative) {
        window.getSelection()?.removeAllRanges();
      }
      onSelectionChange?.("", null);
    },
    [onSelectionChange],
  );

  // Hide the floating popup without clearing the persisted overlay (scroll,
  // re-layout, or an action like "Add note" that does not consume the
  // selection).
  const hideSelectionPopup = useCallback(() => {
    dispatchPersistence({ type: "hide-popup" });
  }, []);

  // Clear selection helper (used by popup actions that consume the selection).
  const clearSelection = useCallback(() => {
    clearPersistedSelection("action-complete");
  }, [clearPersistedSelection]);

  // Handle highlight creation from popup
  const handleHighlight = useCallback(
    (color: HighlightColor) => {
      const { selection, selectedText } = persistedSelection;
      if (!canUsePdfSelectionAction({ selectedText, selectionContext: selection })) return;
      onHighlightSelection?.(color, selectedText.trim(), selection);

      // Clear selection after highlighting
      clearSelection();
    },
    [onHighlightSelection, persistedSelection.selection, persistedSelection.selectedText, clearSelection]
  );

  const handleHighlightWithDialog = useCallback(
    (color: HighlightColor) => {
      const { selection, selectedText } = persistedSelection;
      if (!canUsePdfSelectionAction({ selectedText, selectionContext: selection })) return;
      onHighlightSelectionWithDialog?.(color, selectedText.trim(), selection);

      clearSelection();
    },
    [onHighlightSelectionWithDialog, persistedSelection.selection, persistedSelection.selectedText, clearSelection]
  );

  // Handle copy action from popup
  const handleCopy = useCallback(() => {
    // Copy is handled inside SelectionPopup component
    clearSelection();
  }, [clearSelection]);

  // Handle add note from popup
  const handleAddNote = useCallback(() => {
    // TODO: Implement note modal
    console.log("Add note for selection:", persistedSelection.selection);
    hideSelectionPopup();
  }, [persistedSelection.selection, hideSelectionPopup]);

  // Handle popup dismiss
  const handlePopupDismiss = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // Pan state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const scrollPositionRef = useRef({ x: 0, y: 0 });
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const fixedColumnIndexRef = useRef(0);

  const highlightConfigRef = useRef<{ query: string; pageNumber: number; textQuote?: string; resolved: boolean } | null>(null);
  useEffect(() => {
    if (highlightQuery && highlightPageNumber) {
      highlightConfigRef.current = {
        query: highlightQuery,
        pageNumber: highlightPageNumber,
        textQuote: highlightTextQuote?.trim() || undefined,
        resolved: false,
      };
    } else {
      highlightConfigRef.current = null;
    }
  }, [highlightQuery, highlightPageNumber, highlightTextQuote]);

  const zoomButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        
        const currentScale = scale;
        const zoomStep = 0.05;
        const delta = e.deltaY < 0 ? zoomStep : -zoomStep;
        const newScale = Math.min(3.0, Math.max(0.5, currentScale + delta));
        
        if (newScale !== currentScale) {
          onZoomModeChange?.("custom");
          setZoomMode("custom");
          onScaleChange?.(newScale);
        }
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [scale, onScaleChange, onZoomModeChange]);

  useEffect(() => {
    const btn = zoomButtonRef.current;
    if (!btn) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const currentScale = scale;
      const zoomStep = 0.05;
      const delta = e.deltaY < 0 ? zoomStep : -zoomStep;
      const newScale = Math.min(3.0, Math.max(0.5, currentScale + delta));
      
      if (newScale !== currentScale) {
        onZoomModeChange?.("custom");
        setZoomMode("custom");
        onScaleChange?.(newScale);
      }
    };

    btn.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      btn.removeEventListener("wheel", handleWheel);
    };
  }, [scale, onScaleChange, onZoomModeChange]);

  const publishSearchResults = useCallback(
    (overrides?: Partial<{
      query: string;
      totalMatches: number;
      activeMatchIndex: number;
      isSearchable: boolean;
      status: "idle" | "searching" | "ready" | "unavailable";
    }>) => {
      onSearchResultsChange?.({
        query: overrides?.query ?? searchQueryRef.current,
        totalMatches: overrides?.totalMatches ?? searchResultsRef.current.length,
        activeMatchIndex: overrides?.activeMatchIndex ?? activeSearchMatchIndexRef.current,
        isSearchable: overrides?.isSearchable ?? isSearchableRef.current,
        status: overrides?.status ?? searchStatusRef.current,
      });
    },
    [onSearchResultsChange],
  );

  const extractPdfPageText = useCallback(
    async (pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number) => {
      if (textCacheRef.current.has(pageNum)) {
        return textCacheRef.current.get(pageNum) ?? "";
      }
      try {
        const page = await pdfDoc.getPage(pageNum);
        const content = await page.getTextContent();
        const text = content.items
          .map((item: any) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        textCacheRef.current.set(pageNum, text);
        return text;
      } catch (err) {
        console.warn("Failed to extract PDF text for page", pageNum, err);
        textCacheRef.current.set(pageNum, "");
        return "";
      }
    },
    [],
  );

  const getSearchHighlightPattern = useCallback((query: string) => {
    const normalized = query.trim().replace(/\s+/g, " ");
    if (!normalized) return null;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped.replace(/\s+/g, "\\s+"), "gi");
  }, []);

  const applyTextLayerHighlights = useCallback((pageIndex: number) => {
    const root = textLayerRootsRef.current[pageIndex];
    if (!root) return;

    const spans = Array.from(root.querySelectorAll("span"));
    for (const span of spans) {
      const el = span as HTMLElement;
      if (!el.dataset.origHtml) {
        el.dataset.origHtml = el.innerHTML;
      } else {
        el.innerHTML = el.dataset.origHtml;
      }
      delete el.dataset.searchMarkCount;
    }

    if (ttsHighlightEnabled && ttsQuery && pageIndex === pageNumberRef.current - 1) {
      let fullText = "";
      const charMaps: { spanIndex: number; charIndex: number }[] = [];

      spans.forEach((span, spanIdx) => {
        const text = span.textContent || "";
        for (let i = 0; i < text.length; i++) {
          fullText += text[i];
          charMaps.push({ spanIndex: spanIdx, charIndex: i });
        }
        fullText += " ";
        charMaps.push({ spanIndex: -1, charIndex: -1 });
      });

      const cleanQuery = ttsQuery.trim().replace(/\s+/g, " ");
      const escapedQuery = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regexStr = escapedQuery.replace(/ /g, "\\s+");
      const regex = new RegExp(regexStr, "gi");

      const match = regex.exec(fullText);
      if (match) {
        const startIdx = match.index;
        const endIdx = startIdx + match[0].length;

        const spansToHighlight = new Map<number, { start: number; end: number }>();
        for (let i = startIdx; i < endIdx; i++) {
          const map = charMaps[i];
          if (map && map.spanIndex !== -1) {
            if (!spansToHighlight.has(map.spanIndex)) {
              spansToHighlight.set(map.spanIndex, { start: map.charIndex, end: map.charIndex + 1 });
            } else {
              const range = spansToHighlight.get(map.spanIndex)!;
              range.end = Math.max(range.end, map.charIndex + 1);
            }
          }
        }

        spansToHighlight.forEach((range, spanIdx) => {
          const span = spans[spanIdx];
          const text = span.textContent || "";
          const before = text.slice(0, range.start);
          const middle = text.slice(range.start, range.end);
          const after = text.slice(range.end);
          span.innerHTML = `${before}<mark class="pdf-tts-highlight">${middle}</mark>${after}`;
        });

        if (lastScrolledTtsQueryRef.current !== ttsQuery) {
          lastScrolledTtsQueryRef.current = ttsQuery;
          const firstSpanIdx = Array.from(spansToHighlight.keys())[0];
          if (typeof firstSpanIdx === "number") {
            const firstSpan = spans[firstSpanIdx];
            if (firstSpan) {
              requestAnimationFrame(() => {
                firstSpan.scrollIntoView({ behavior: "smooth", block: "center" });
              });
            }
          }
        }
        return;
      }
    }

    const normalizedSearchQuery = searchQueryRef.current.trim();
    const searchRe = normalizedSearchQuery ? getSearchHighlightPattern(normalizedSearchQuery) : null;
    if (searchRe) {
      const pageMatches = pageSearchMatchesRef.current.get(pageIndex + 1) ?? [];
      let pageSearchMarkCount = 0;
      for (const span of spans) {
        const el = span as HTMLElement;
        const text = el.textContent ?? "";
        if (!text) continue;
        if (!searchRe.test(text)) {
          searchRe.lastIndex = 0;
          continue;
        }
        searchRe.lastIndex = 0;
        let localMatchCount = 0;
        el.innerHTML = text.replace(searchRe, (match) => {
          localMatchCount += 1;
          const pageOrder = pageSearchMarkCount;
          pageSearchMarkCount += 1;
          return `<mark class="pdf-search-highlight" data-search-match="true" data-search-match-page-order="${pageOrder}">${match}</mark>`;
        });
        if (localMatchCount > 0) {
          el.dataset.searchMarkCount = String(localMatchCount);
        }
      }

      const activeMatch = searchResultsRef.current[activeSearchMatchIndexRef.current];
      const activePageOrder =
        activeMatch && activeMatch.pageNumber === pageIndex + 1 ? activeMatch.pageMatchIndex : -1;
      const marks = Array.from(root.querySelectorAll("mark[data-search-match='true']")) as HTMLElement[];
      const activeMark = activePageOrder >= 0 ? marks[activePageOrder] : null;
      if (activeMark) {
        activeMark.classList.add("pdf-search-highlight-target");
        if (pendingSearchScrollRef.current === activeSearchMatchIndexRef.current) {
          requestAnimationFrame(() => {
            activeMark.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
            pendingSearchScrollRef.current = null;
          });
        }
      } else if (pageMatches.length === 0 && pendingSearchScrollRef.current === activeSearchMatchIndexRef.current) {
        pendingSearchScrollRef.current = null;
      }
      return;
    }

    const cfg = highlightConfigRef.current;
    if (!cfg) return;
    // Search a window of pages around the estimated page to handle page estimation errors
    if (cfg.resolved && cfg.pageNumber - 1 !== pageIndex) return;
    const pageDelta = Math.abs(pageIndex - (cfg.pageNumber - 1));
    if (pageDelta > 3) return;

    const query = cfg.query.trim();
    if (!query) return;
    const terms = Array.from(new Set(query.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2))).slice(0, 8);
    if (terms.length === 0) return;

    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`(${escaped.join("|")})`, "gi");

    for (const span of spans) {
      const el = span as HTMLElement;
      const text = el.textContent ?? "";
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      el.innerHTML = text.replace(re, `<mark class="pdf-search-highlight">$1</mark>`);
    }

    const marks = Array.from(root.querySelectorAll("mark.pdf-search-highlight")) as HTMLElement[];
    const normalizedQuote = cfg.textQuote?.toLowerCase();
    const targetMark =
      (normalizedQuote
        ? marks.find((mark) => (mark.textContent ?? "").trim().toLowerCase() === normalizedQuote) ??
          marks.find((mark) => (mark.textContent ?? "").trim().toLowerCase().includes(normalizedQuote))
        : undefined) ??
      marks[0];

    if (!targetMark) return;

    // Mark as resolved so other pages don't also try to highlight
    cfg.resolved = true;
    cfg.pageNumber = pageIndex + 1;

    targetMark.classList.add("pdf-search-highlight-target");
    requestAnimationFrame(() => {
      targetMark.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    });
  }, [getSearchHighlightPattern]);
  // Wire the forward ref so PdfPageViewWrapper's onTextLayerReady can re-apply
  // search/TTS/jump marks onto a freshly rendered text layer.
  applyTextLayerHighlightsRef.current = applyTextLayerHighlights;

  const reapplyVisibleTextLayerHighlights = useCallback(() => {
    textLayerRootsRef.current.forEach((root, pageIndex) => {
      if (root) {
        applyTextLayerHighlights(pageIndex);
      }
    });
  }, [applyTextLayerHighlights]);

  const focusSearchMatch = useCallback(
    (requestedIndex: number, options?: { scroll?: boolean }) => {
      if (searchResultsRef.current.length === 0) {
        activeSearchMatchIndexRef.current = -1;
        publishSearchResults({ activeMatchIndex: -1 });
        return;
      }

      const clampedIndex = Math.max(0, Math.min(requestedIndex, searchResultsRef.current.length - 1));
      activeSearchMatchIndexRef.current = clampedIndex;
      if (options?.scroll !== false) {
        pendingSearchScrollRef.current = clampedIndex;
      }
      publishSearchResults({ activeMatchIndex: clampedIndex });
      reapplyVisibleTextLayerHighlights();

      const target = searchResultsRef.current[clampedIndex];
      if (!target) return;

      if (pageNumber !== target.pageNumber) {
        const token = ++navTokenCounterRef.current;
        activeNavTokenRef.current = token;
        pendingNavRef.current = { token, pageNumber: target.pageNumber, destArray: null };
        isProgrammaticScrollRef.current = true;
        onPageChange?.(target.pageNumber);
        return;
      }

      requestAnimationFrame(() => {
        applyTextLayerHighlights(target.pageNumber - 1);
      });
    },
    [applyTextLayerHighlights, onPageChange, pageNumber, publishSearchResults, reapplyVisibleTextLayerHighlights],
  );

  useEffect(() => {
    reapplyVisibleTextLayerHighlights();
  }, [highlightPageNumber, highlightQuery, highlightTextQuote, reapplyVisibleTextLayerHighlights]);

  useEffect(() => {
    reapplyVisibleTextLayerHighlights();
  }, [ttsQuery, ttsHighlightEnabled, reapplyVisibleTextLayerHighlights]);

  useEffect(() => {
    if (!highlightPageNumber) return;
    restoredPageRef.current = highlightPageNumber;
    restorationWindowRef.current = Date.now() + 2500;
  }, [highlightPageNumber, highlightQuery, highlightTextQuote]);

  const publishTextSelectionCapability = useCallback(
    (availability: ReadonlyMap<number, boolean>, totalPagesOverride?: number) => {
      const capability = derivePdfTextSelectionCapability(
        availability,
        totalPagesOverride ?? numPages,
        pageNumber,
      );
      setTextSelectionCapability(capability);
      onTextSelectionCapabilityChange?.(capability);
    },
    [numPages, onTextSelectionCapabilityChange, pageNumber],
  );

  const setPageTextSelectionAvailability = useCallback(
    (pageNum: number, hasSelectableText: boolean) => {
      const current = pageTextSelectionAvailabilityRef.current;
      if (current.get(pageNum) === hasSelectableText) return;
      const next = new Map(current);
      next.set(pageNum, hasSelectableText);
      pageTextSelectionAvailabilityRef.current = next;
      publishTextSelectionCapability(next);
    },
    [publishTextSelectionCapability],
  );

  // Update zoom mode when external prop changes
  useEffect(() => {
    if (externalZoomMode) {
      setZoomMode(externalZoomMode);
    }
  }, [externalZoomMode]);

  useEffect(() => {
    try {
      const value = localStorage.getItem(PDF_NAV_STABILITY_FLAG_KEY);
      if (value === "0" || value === "false") {
        pdfNavStabilityEnabledRef.current = false;
      } else if (value === "1" || value === "true") {
        pdfNavStabilityEnabledRef.current = true;
      }
    } catch {
      pdfNavStabilityEnabledRef.current = true;
    }
    try {
      const debugValue = localStorage.getItem(PDF_NAV_STABILITY_DEBUG_KEY);
      pdfNavStabilityDebugRef.current = debugValue === "1" || debugValue === "true";
    } catch {
      pdfNavStabilityDebugRef.current = false;
    }
  }, []);

  // Disable browser-native scroll restoration to prevent "bouncing" during PDF load.
  // Without this, the browser tries to restore scroll position before the PDF has rendered,
  // causing the viewport to bounce between browser-attempted and app-controlled positions.
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    if (pdfNavStabilityDebugRef.current) {
      console.debug("[PDFViewer] Disabled browser scroll restoration (was:", previous, ")");
    }
    return () => {
      history.scrollRestoration = (previous as ScrollRestoration) || 'auto';
    };
  }, []);

  const logNav = useCallback((event: string, details?: Record<string, unknown>) => {
    if (!pdfNavStabilityEnabledRef.current || !pdfNavStabilityDebugRef.current) return;
    console.debug("[PDFViewer][nav]", event, details ?? {});
  }, []);

  const setNavigationMode = useCallback((mode: NavigationMode, reason: string) => {
    if (!pdfNavStabilityEnabledRef.current) return;
    if (navModeRef.current === mode) return;
    const previous = navModeRef.current;
    navModeRef.current = mode;
    logNav("mode-transition", { from: previous, to: mode, reason });
  }, [logNav]);

  const markUserScrollOwnership = useCallback((reason: string) => {
    if (!pdfNavStabilityEnabledRef.current) return;
    userScrollLockoutUntilRef.current = Date.now() + USER_SCROLL_LOCKOUT_MS;
    setNavigationMode("user-scroll", reason);
    logNav("lockout-armed", { until: userScrollLockoutUntilRef.current, reason });
  }, [logNav, setNavigationMode]);

  const clearNavigationSettleTimeout = useCallback(() => {
    if (navSettleTimeoutRef.current) {
      clearTimeout(navSettleTimeoutRef.current);
      navSettleTimeoutRef.current = null;
    }
    navSettleStableSinceRef.current = null;
    navSettleTargetRef.current = null;
  }, []);

  useEffect(() => {
    let mounted = true;
    const nativeTransports: NativePdfRangeTransport[] = [];
    // Owns the pdf.js loading task / document for THIS effect instance, so a
    // document change destroys the old document and an unmount destroys the
    // last one (task 5.1).
    const pdfDocumentHolder = createPdfDocumentHolder();

    const loadPDF = async () => {
      setIsLoading(true);
      setError(null);
      setPdf(null);
      setPdfSourceIdentity(null);
      setReflowDocument(null);
      setMobilePdfMode("fixed");
      reflowSchedulerRef.current?.cancel();
      setReaderState(reducePdfReaderState(initialPdfReaderState, { type: "OPEN" }));
      setPasswordValue("");
      passwordSubmitRef.current = null;

      // Task 6.3: a whole-file load in the Tauri runtime is an explicit
      // fallback and must be observable — a silent regression to whole-file
      // loading would otherwise be invisible until the memory benchmark moves.
      if (!useNativeRange && fileData && isTauriRuntime) {
        const flagOn = shouldUseNativePdfRangeSource({ isTauriRuntime: true, fileType: "pdf" });
        diagnosticsRef.current.recordFallback(
          flagOn ? "range-source-unavailable" : "range-source-disabled",
        );
      }

      try {
        const loadDocument = async () => {
          // Embedded fonts must be enabled for accurate text layer positioning and selection.
          // Previously disabled on WebKitGTK/Tauri to avoid glyph parsing issues, but this
          // broke text selectability on PDFs that work fine in native Linux readers.
          const shouldDisableFontFace = false;
          const awaitLoadingTask = async (
            loadingTask: pdfjsLib.PDFDocumentLoadingTask,
            sourceFailure?: Promise<never>,
          ) => {
            loadingTask.onPassword = (updatePassword, reason) => {
              if (!mounted) return;
              const incorrect = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
              passwordSubmitRef.current = updatePassword;
              setPasswordValue("");
              setReaderState((state) => reducePdfReaderState(state, { type: "REQUEST_PASSWORD", incorrect }));
            };
            return sourceFailure
              ? await Promise.race([loadingTask.promise, sourceFailure])
              : await loadingTask.promise;
          };
          if (useNativeRange) {
            const loadNative = async () => {
              const native = await createNativePdfRangeSource(documentId);
              nativeTransports.push(native.transport);
              diagnosticsRef.current = native.diagnostics;
              setPdfSourceIdentity({ identity: native.info.identity, fingerprint: native.info.fingerprint });
              const loadingTask = pdfjsLib.getDocument({
                range: native.transport,
                length: native.info.size,
                verbosity: 0,
                disableStream: true,
                disableAutoFetch: false,
                disableFontFace: shouldDisableFontFace,
              } as any);
              pdfDocumentHolder.setLoadingTask(loadingTask);
              return await awaitLoadingTask(loadingTask, native.failure);
            };

            try {
              return await loadNative();
            } catch (nativeError) {
              const normalized = normalizePdfError(nativeError);
              if (!shouldRetryPdfWorker(normalized)) throw normalized;
              // A readable native source can still hit a worker bootstrap bug.
              // Recreate both worker and range transport for the retry; source
              // failures never enter this branch.
              try { pdfjsLib.GlobalWorkerOptions.workerPort?.terminate(); } catch {}
              pdfjsLib.GlobalWorkerOptions.workerPort = null;
              pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
              await ensureFakeWorkerModuleLoaded();
              return await loadNative();
            }
          }

          const sources = createPdfLoadSourceFactories({
            fileUrl,
            fileData,
            disableFontFace: shouldDisableFontFace,
          });

          if (sources.length === 0) {
            throw new Error("No PDF source available.");
          }

          let lastError: unknown = null;
          for (const sourceFactory of sources) {
            try {
              const source = sourceFactory.create();
              const loadingTask = pdfjsLib.getDocument(source as any);
              pdfDocumentHolder.setLoadingTask(loadingTask);
              return await awaitLoadingTask(loadingTask);
            } catch (workerError) {
              // Some packaged runtimes fail to initialize the PDF worker.
              // Retry without a worker so PDFs still render. Create a fresh source:
              // PDF.js may detach data buffers while trying to transfer them to its worker.
              try {
                console.warn("[PDFViewer] Worker/source load failed, retrying with workerPort cleared:", workerError);
                // Drop the worker port so PDF.js falls back to its inline fake
                // (same-thread) worker. Clearing workerPort (not workerSrc) is
                // the correct reset path now that we configure via workerPort.
                try { pdfjsLib.GlobalWorkerOptions.workerPort?.terminate(); } catch {}
                pdfjsLib.GlobalWorkerOptions.workerPort = null;
                pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
                await ensureFakeWorkerModuleLoaded();
                const source = sourceFactory.create();
                const fallbackTask = pdfjsLib.getDocument(source as any);
                pdfDocumentHolder.setLoadingTask(fallbackTask);
                return await awaitLoadingTask(fallbackTask);
              } catch (fallbackError) {
                lastError = fallbackError;
              }
            }
          }
          throw lastError ?? new Error("Failed to load PDF from all sources.");
        };

        const pdfDoc = await loadDocument();

        if (!mounted) return;

        pageTextSelectionAvailabilityRef.current = new Map();
        const initialCapability = derivePdfTextSelectionCapability(
          pageTextSelectionAvailabilityRef.current,
          pdfDoc.numPages,
          1,
        );
        setTextSelectionCapability(initialCapability);
        onTextSelectionCapabilityChange?.(initialCapability);
        setPdf(pdfDoc);
        pdfDocumentHolder.setDocument(pdfDoc);
        if (!useNativeRange) {
          const fingerprint = (pdfDoc as any).fingerprints?.[0] ?? (pdfDoc as any).fingerprint ?? documentId;
          setPdfSourceIdentity({ identity: String(fingerprint), fingerprint: String(fingerprint) });
        }
        setReaderState((state) => reducePdfReaderState(state, { type: "READY" }));
        onPdfInfo?.({ fingerprint: (pdfDoc as any).fingerprint ?? null });
        textCacheRef.current.clear();
        pageOffsetsRef.current = [];
        setNumPages(pdfDoc.numPages);
        try {
          const first = await pdfDoc.getPage(1);
          const vp = first.getViewport({ scale: 1 });
          setFallbackPageSize({ width: vp.width, height: vp.height });
        } catch {
          setFallbackPageSize(null);
        }
        // Clear and initialize rendered pages tracking
        renderedPagesRef.current.clear();
        // Windowed rendering: start with a small range around the initial page.
        const initialBuffer = 2;
        const startPage = metadata?.chunkStartPage ?? 1;
        const endPage = metadata?.chunkEndPage ?? pdfDoc.numPages;
        const start = Math.max(startPage, pageNumber - initialBuffer);
        const end = Math.min(endPage, pageNumber + initialBuffer);
        setRenderedPageRange({ start, end });
        renderedPageRangeRef.current = { start, end };
        onLoad?.(pdfDoc.numPages, []);

        // Get outline (table of contents)
        const outlineData = await pdfDoc.getOutline();
        if (outlineData) {
          setOutline(outlineData);
          if (documentId) {
            try {
              useDocumentOutlineStore.getState().setOutline(documentId, { pdfOutline: outlineData });
            } catch {}
          }
        }

      } catch (err) {
        if (!mounted) return;
        const normalized = normalizePdfError(err);
        diagnosticsRef.current.update({ errorCategory: normalized.category });
        setError(normalized);
        setReaderState((state) => reducePdfReaderState(state, { type: "FAIL", error: normalized }));
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadPDF();

    return () => {
      mounted = false;
      // Task 5.1: destroy the pdf.js document and its loading task (this also
      // aborts an in-flight load). Runs on unmount AND on document change.
      pdfDocumentHolder.reset();
      for (const transport of nativeTransports) transport.abort();
      passwordSubmitRef.current = null;
      // Task 5.2: release per-page rendering state held by the viewer.
      textCacheRef.current.clear();
      renderedPagesRef.current.clear();
      pageOffsetsRef.current = [];
      reflowSchedulerRef.current?.cancel();
      reflowOcrRef.current?.cancel();
      // Task 5.5: drop reader-owned listeners even if the vim adapter's
      // unsubscribe chain (onVimRuntimeChange(null) -> adapter.dispose) has
      // not run yet — the Set must not outlive the reader.
      vimRuntimeListenersRef.current.clear();
      canvasRefs.current = [];
      textLayerRootsRef.current = [];
      pageViewportRefs.current = [];
    };
    // Note: onLoad is intentionally excluded from deps - it's a callback that
    // shouldn't trigger reloading the PDF source.
  }, [documentId, fileData, fileUrl, isTauriRuntime, onTextSelectionCapabilityChange, retryNonce, useNativeRange]);

  useEffect(() => {
    if (!pdf || !pdfSourceIdentity || !isPhone || !isPdfFeatureEnabled("semanticReflow")) {
      reflowSchedulerRef.current?.cancel();
      return;
    }
    let disposed = false;
    const cache = reflowCacheRef.current;
    const base = createPdfReflowDocument({
      documentId,
      sourceIdentity: pdfSourceIdentity.identity,
      fingerprint: pdfSourceIdentity.fingerprint,
      pageCount: pdf.numPages,
      language: metadata?.language,
    });
    const start = async () => {
      const cached = await cache.get(pdfReflowCacheKey(base));
      const initial = cached ?? base;
      if (disposed) return;
      setReflowDocument(initial);
      setReaderState((state) => reducePdfReaderState(state, { type: "ANALYZE" }));
      const scheduler = new PdfReflowScheduler(pdf, initial, cache, (page, document) => {
        if (disposed) return;
        const readyPages = Object.values(document.pages).filter((candidate) => candidate.state === "ready");
        const confidence = readyPages.length
          ? readyPages.reduce((sum, candidate) => sum + candidate.confidence, 0) / readyPages.length
          : 0;
        const classification = page.classification;
        const next = { ...document, confidence, classification };
        setReflowDocument(next);
        diagnosticsRef.current.update({ classification });
        setReaderState((state) => reducePdfReaderState(state, { type: "PARTIAL_REFLOW" }));
        const preferred = mobilePreferences.preferredMobileMode;
        if (!modeOverriddenRef.current && page.pageNumber === pageNumber
          && (preferred === "reflow" || (preferred === "auto" && classification === "semantic"))) {
          setMobilePdfMode("reflow");
        }
      });
      reflowSchedulerRef.current = scheduler;
      await scheduler.start(pageNumber);
      if (!disposed) setReaderState((state) => reducePdfReaderState(state, { type: "READY" }));
    };
    void start();
    return () => {
      disposed = true;
      reflowSchedulerRef.current?.cancel();
    };
  }, [documentId, isPhone, metadata?.language, mobilePreferences.preferredMobileMode, pdf, pdfSourceIdentity]);

  useEffect(() => {
    if (reflowSchedulerRef.current) void reflowSchedulerRef.current.start(pageNumber);
  }, [pageNumber]);

  const handleReflowScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-reflow-page]"));
    let current = pageNumber;
    for (const section of sections) {
      if (section.offsetTop <= container.scrollTop + 96) current = Number(section.dataset.pdfReflowPage ?? current);
      else break;
    }
    if (current !== pageNumber) onPageChange?.(current);
    const currentBlockElement = container.querySelector<HTMLElement>(`[data-pdf-reflow-page="${current}"] [data-pdf-reflow-block]`);
    const blockId = currentBlockElement?.dataset.pdfReflowBlock;
    const block = reflowDocument?.pages[current]?.blocks.find((candidate) => candidate.id === blockId);
    const denominator = Math.max(1, container.scrollHeight - container.clientHeight);
    onScrollPositionChange?.({
      pageNumber: current,
      scrollTop: container.scrollTop,
      scrollLeft: 0,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      scrollPercent: (container.scrollTop / denominator) * 100,
      pdfAnchor: block ? anchorFromReflowBlock(block, pdfSourceIdentity?.fingerprint) : { pageNumber: current, fingerprint: pdfSourceIdentity?.fingerprint },
    });
  }, [onPageChange, onScrollPositionChange, pageNumber, pdfSourceIdentity?.fingerprint, reflowDocument]);

  const handleReflowSelection = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!text || !selection?.rangeCount || !reflowDocument) {
      onSelectionChange?.("", null);
      return;
    }
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const baseElement = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const element = baseElement?.closest<HTMLElement>("[data-pdf-reflow-block]");
    const blockId = element?.dataset.pdfReflowBlock;
    const block = Object.values(reflowDocument.pages).flatMap((page) => page.blocks).find((candidate) => candidate.id === blockId);
    if (!block) return;
    onSelectionChange?.(text, {
      type: "pdf",
      documentId,
      fingerprint: pdfSourceIdentity?.fingerprint,
      source: "native",
      pages: [{
        pageNumber: block.source.pageNumber,
        viewportRects: [],
        pdfRects: block.source.rects.map((rect) => ({ x1: rect.x, y1: rect.y, x2: rect.x + rect.width, y2: rect.y + rect.height })),
      }],
      tokenData: block.source.tokenIds.length ? {
        startTokenId: block.source.tokenIds[0],
        endTokenId: block.source.tokenIds.at(-1)!,
        tokenIds: block.source.tokenIds,
      } : undefined,
      reflowBlockIds: [block.id],
      mappingConfidence: block.source.confidence,
    });
  }, [documentId, onSelectionChange, pdfSourceIdentity?.fingerprint, reflowDocument]);

  const handleMobileSurfaceClick = useCallback((event: React.MouseEvent) => {
    if (!isPhone || event.target instanceof Element && event.target.closest("button,a,input,select,textarea,[role=dialog]")) return;
    if (window.getSelection()?.toString().trim()) return;
    setMobileChromeVisible((visible) => !visible);
  }, [isPhone]);

  const handleViewOriginalBlock = useCallback((block: PdfReflowBlock) => {
    modeOverriddenRef.current = true;
    setMobilePdfMode("fixed");
    onPageChange?.(block.source.pageNumber);
  }, [onPageChange]);

  const scrollReflowToPage = useCallback((targetPage: number, behavior: ScrollBehavior = "smooth") => {
    const container = scrollContainerRef.current;
    const section = container?.querySelector<HTMLElement>(`[data-pdf-reflow-page="${targetPage}"]`);
    if (!section) return false;
    section.scrollIntoView({ block: "start", behavior });
    onPageChange?.(targetPage);
    return true;
  }, [onPageChange]);

  useEffect(() => {
    if (mobilePdfMode !== "reflow" || !reflowDocument || !restoreState) return;
    const block = restoreState.pdfAnchor ? resolveReflowBlock(reflowDocument, restoreState.pdfAnchor) : null;
    const frame = requestAnimationFrame(() => {
      if (block) {
        document.getElementById(block.id)?.scrollIntoView({ block: "start", behavior: "auto" });
      } else {
        scrollReflowToPage(restoreState.pageNumber, "auto");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [mobilePdfMode, reflowDocument, restoreState, scrollReflowToPage]);

  useEffect(() => {
    if (mobilePdfMode !== "reflow" || !highlightPageNumber) return;
    const quote = (highlightTextQuote || highlightQuery || "").trim().toLocaleLowerCase();
    const block = quote
      ? reflowDocument?.pages[highlightPageNumber]?.blocks.find((candidate) => candidate.text.toLocaleLowerCase().includes(quote))
      : undefined;
    if (block) {
      setReflowSearchBlockId(block.id);
      requestAnimationFrame(() => document.getElementById(block.id)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    } else {
      scrollReflowToPage(highlightPageNumber);
    }
  }, [highlightPageNumber, highlightQuery, highlightTextQuote, mobilePdfMode, reflowDocument, scrollReflowToPage]);

  useEffect(() => {
    if (mobilePdfMode !== "reflow" || !reflowDocument || !searchQuery?.trim()) {
      setReflowSearchBlockId(null);
      return;
    }
    const query = searchQuery.trim().toLocaleLowerCase();
    const matches = Object.values(reflowDocument.pages)
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .flatMap((page) => page.blocks.filter((block) => block.text.toLocaleLowerCase().includes(query)));
    const targetIndex = Math.max(0, Math.min(matches.length - 1, searchNavigationRequest?.targetIndex ?? 0));
    const target = matches[targetIndex];
    setReflowSearchBlockId(target?.id ?? null);
    onSearchResultsChange?.({
      query: searchQuery,
      totalMatches: matches.length,
      activeMatchIndex: target ? targetIndex : -1,
      isSearchable: true,
      status: "ready",
    });
    if (target) requestAnimationFrame(() => document.getElementById(target.id)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [mobilePdfMode, onSearchResultsChange, reflowDocument, searchNavigationRequest?.requestId, searchNavigationRequest?.targetIndex, searchQuery]);

  const handleRequestPageOcr = useCallback(async (reflowPage: import("./pdfReflowTypes").PdfReflowPage) => {
    if (!pdf || !reflowDocument) return;
    setReaderState((state) => reducePdfReaderState(state, { type: "START_OCR" }));
    const pageProxy = await pdf.getPage(reflowPage.pageNumber);
    const recognized = await reflowOcrRef.current.recognize(
      pageProxy,
      reflowPage.pageNumber,
      useSettingsStore.getState().settings.documents.ocr.language || "eng",
      (update) => {
        setPageOcrUpdate(update);
        diagnosticsRef.current.update({ ocrState: update.state === "low-confidence" ? "ready" : update.state });
      },
    );
    if (recognized) {
      const next = await reflowCacheRef.current.putPage(reflowDocument, recognized);
      setReflowDocument(next);
      setReaderState((state) => reducePdfReaderState(state, { type: "PARTIAL_REFLOW" }));
    } else {
      setReaderState((state) => reducePdfReaderState(state, { type: "READY" }));
    }
  }, [pdf, reflowDocument]);

  useEffect(() => {
    publishTextSelectionCapability(pageTextSelectionAvailabilityRef.current);
  }, [numPages, pageNumber, publishTextSelectionCapability]);

  // Update rendered page window around the current page.
  useEffect(() => {
    if (!pdf || numPages <= 0) return;
    const buffer = 2;
    const startPage = metadata?.chunkStartPage ?? 1;
    const endPage = metadata?.chunkEndPage ?? numPages;
    const start = Math.max(startPage, pageNumber - buffer);
    const end = Math.min(endPage, pageNumber + buffer);
    const current = renderedPageRangeRef.current;
    if (current.start === start && current.end === end) return;
    setRenderedPageRange({ start, end });
  }, [pdf, numPages, pageNumber, metadata]);

  // Store documentId in ref for use in callbacks
  useEffect(() => {
    docIdRef.current = documentId;
  }, [documentId]);

  // Save reading position to localStorage and backend
  const saveReadingPosition = useCallback(async (position: DocumentPosition) => {
    const docId = docIdRef.current;
    if (!docId) return;

    // Avoid redundant saves
    const lastSaved = lastSavedPositionRef.current;
    if (lastSaved && JSON.stringify(lastSaved) === JSON.stringify(position)) {
      return;
    }

    // The harness treats an in-flight position persistence as non-quiescent
    // (memoryScenario/activity.ts); a runtime-gated no-op otherwise.
    markBusy(true);
    try {
      console.log("[PDFViewer] Saving reading position:", { docId, position });

      // Save to localStorage as backup
      localStorage.setItem(`pdf-position-${docId}`, JSON.stringify(position));

      // Save to backend
      try {
        await saveDocumentPosition(docId, position);
        
        // Also update document progress if it's a page position
        if (position.type === 'page') {
          await updateDocumentProgressAuto(docId, position.page, null, null);
        }
        
        lastSavedPositionRef.current = position;
      } catch (err) {
        console.warn("[PDFViewer] Failed to save position to backend:", err);
      }
    } finally {
      markBusy(false);
    }
  }, []);

  // Debounced save for scroll events
  const debouncedSavePosition = useCallback((position: DocumentPosition) => {
    lastPositionRef.current = position;
    if (positionSaveTimeoutRef.current) {
      clearTimeout(positionSaveTimeoutRef.current);
    }
    positionSaveTimeoutRef.current = setTimeout(() => {
      saveReadingPosition(position);
    }, 500);
  }, [saveReadingPosition]);

  // Load reading position from backend or localStorage
  const loadReadingPosition = useCallback(async (): Promise<DocumentPosition | null> => {
    const docId = docIdRef.current;
    if (!docId) return null;

    // Try backend first
    try {
      const remotePosition = await getDocumentPosition(docId);
      if (remotePosition) {
        console.log("[PDFViewer] Loaded position from backend:", remotePosition);
        return remotePosition;
      }
    } catch (err) {
      console.warn("[PDFViewer] Failed to load position from backend:", err);
    }

    // Fall back to localStorage
    const localData = localStorage.getItem(`pdf-position-${docId}`);
    if (localData) {
      try {
        const position = JSON.parse(localData) as DocumentPosition;
        console.log("[PDFViewer] Loaded position from localStorage:", position);
        return position;
      } catch (e) {
        console.warn("[PDFViewer] Failed to parse localStorage position:", e);
      }
    }

    // Try legacy format (just page number stored in document)
    try {
      const doc = await getDocumentAuto(docId);
      if (doc?.current_page && doc.current_page > 1) {
        console.log("[PDFViewer] Using legacy current_page from document:", doc.current_page);
        return pagePosition(doc.current_page);
      }
    } catch (err) {
      console.warn("[PDFViewer] Failed to load document data:", err);
    }

    return null;
  }, []);

  // Restore position when PDF loads (fallback when no explicit restoreState)
  useEffect(() => {
    if (!pdf || numPages === 0) return;
    if (restoreState) return;

    const restorePosition = async () => {
      isRestoringPositionRef.current = true;

      const position = await loadReadingPosition();
      if (!position) {
        isRestoringPositionRef.current = false;
        return;
      }

      console.log("[PDFViewer] Restoring position:", position);

      const attemptRestore = (attempt: number) => {
        const container = scrollContainerRef.current;
        if (!container) {
          isRestoringPositionRef.current = false;
          return;
        }

        let targetPage = 1;
        let targetScrollTop = 0;
        let ready = true;

        if (position.type === 'page') {
          targetPage = Math.max(1, Math.min(position.page, numPages));
          const pageIndex = targetPage - 1;
          const pageEl = pageContainerRefs.current[pageIndex];
          if (!pageEl || pageEl.offsetHeight === 0) {
            ready = false;
          } else if (position.offset !== undefined && position.offset > 0) {
            targetScrollTop = pageEl.offsetTop + (pageEl.offsetHeight * position.offset);
          } else {
            targetScrollTop = Math.max(0, pageEl.offsetTop - 16);
          }
        } else if (position.type === 'scroll') {
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          if (maxScroll <= 0) {
            ready = false;
          } else {
            targetScrollTop = (position.percent / 100) * maxScroll;
          }

          if (ready) {
            for (let i = 0; i < pageContainerRefs.current.length; i++) {
              const pageEl = pageContainerRefs.current[i];
              if (!pageEl || pageEl.offsetHeight === 0) {
                ready = false;
                break;
              }
              if (pageEl.offsetTop - 24 <= targetScrollTop) {
                targetPage = i + 1;
              } else {
                break;
              }
            }
          }
        }

        if (!ready) {
          if (attempt < 15) {
            setTimeout(() => attemptRestore(attempt + 1), 200);
          } else {
            isRestoringPositionRef.current = false;
          }
          return;
        }

        restoredPageRef.current = targetPage;
        restorationWindowRef.current = Date.now() + 2000;

        if (targetPage !== pageNumber) {
          onPageChange?.(targetPage);
        }

        setTimeout(() => {
          const activeContainer = scrollContainerRef.current;
          if (activeContainer) {
            if (shouldSuppressProgrammaticScroll({
              enabled: pdfNavStabilityEnabledRef.current,
              source: "restore",
              now: Date.now(),
              lockoutUntil: userScrollLockoutUntilRef.current,
              activeToken: activeNavTokenRef.current,
            })) {
              logNav("initial-restore-suppressed-by-user-lockout", {
                targetPage,
                lockoutUntil: userScrollLockoutUntilRef.current,
              });
              isRestoringPositionRef.current = false;
              return;
            }
            if (pdfNavStabilityEnabledRef.current) {
              setNavigationMode("programmatic-nav", "initial-restore");
            }
            isProgrammaticScrollRef.current = true;
            activeContainer.scrollTop = targetScrollTop;
            console.log("[PDFViewer] Scrolled to position:", {
              targetPage,
              targetScrollTop,
              scrollRestoration: history.scrollRestoration,
              containerReady: activeContainer.scrollHeight > 0,
            });

            setTimeout(() => {
              isProgrammaticScrollRef.current = false;
              if (pdfNavStabilityEnabledRef.current && activeNavTokenRef.current === null) {
                if (Date.now() >= userScrollLockoutUntilRef.current) {
                  setNavigationMode("idle", "initial-restore-complete");
                }
              }
              isRestoringPositionRef.current = false;
            }, 300);
          } else {
            isRestoringPositionRef.current = false;
          }
        }, 100);
      };

      attemptRestore(0);
    };

    const timeout = setTimeout(restorePosition, 500);
    return () => clearTimeout(timeout);
  }, [
    loadReadingPosition,
    logNav,
    numPages,
    onPageChange,
    pageNumber,
    pdf,
    restoreState,
    setNavigationMode,
  ]);

  // Cleanup on unmount: cancel all render tasks, text layers, highlights, and timeouts.
  useEffect(() => {
    return () => {
      if (positionSaveTimeoutRef.current) {
        clearTimeout(positionSaveTimeoutRef.current);
        if (lastPositionRef.current) {
          void saveReadingPosition(lastPositionRef.current);
        }
      }
      clearNavigationSettleTimeout();
      // Note: per-page PDFPageView teardown (canvas + text layer cancel/destroy)
      // is handled by each PdfPageViewWrapper's own effect cleanup when React
      // unmounts it. No manual cancel loop is needed here.
    };
  }, [clearNavigationSettleTimeout, saveReadingPosition]);

  useEffect(() => {
    if (!pdf || numPages <= 0) return;
    // Any zoom change invalidates previous renders (especially fit-width/page).
    renderedPagesRef.current.clear();
    recomputePageOffsets();
  }, [scale, zoomMode, numPages, pdf]);

  // ── Rendered-page tracking ──────────────────────────────────────────────
  // Pages are now rendered declaratively by PdfPageViewWrapper components in
  // the JSX below (keyed by page number, mounted for the current rendered
  // range). This effect just syncs the range ref and signals onPagesRendered
  // once the window is covered.
  useEffect(() => {
    if (!pdf || numPages <= 0) return;
    renderedPageRangeRef.current = renderedPageRange;
    onPagesRendered?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, numPages, renderedPageRange, scale, zoomMode]);

  useEffect(() => {
    if (!pdf || !onTextWindowChange) return;

    const start = Math.max(1, pageNumber - contextPageWindow);
    const end = Math.min(pdf.numPages, pageNumber + contextPageWindow);
    textWindowRef.current = { start, end };

    const updateWindow = () => {
      const { start: windowStart, end: windowEnd } = textWindowRef.current;
      const chunks: string[] = [];
      for (let page = windowStart; page <= windowEnd; page += 1) {
        const cached = textCacheRef.current.get(page);
        if (cached !== undefined) {
          chunks.push(`<page number="${page}"/>${cached}`);
        }
      }
      if (chunks.length > 0) {
        onTextWindowChange(chunks.join("\n\n"));
      }
    };

    const extractPageText = async (pageNum: number) => {
      const text = await extractPdfPageText(pdf, pageNum);
      if (text) {
        updateWindow();
      }
    };

    updateWindow();
    for (let page = start; page <= end; page += 1) {
      void extractPageText(page);
    }
    // Note: onTextWindowChange is intentionally excluded from deps - callbacks
    // shouldn't trigger effect re-runs, only data changes should
  }, [contextPageWindow, extractPdfPageText, onTextWindowChange, pageNumber, pdf]);

  useEffect(() => {
    searchQueryRef.current = searchQuery?.trim() ?? "";
    const requestToken = ++searchRequestTokenRef.current;

    if (!pdf || numPages <= 0) {
      searchResultsRef.current = [];
      pageSearchMatchesRef.current = new Map();
      activeSearchMatchIndexRef.current = -1;
      pendingSearchScrollRef.current = null;
      searchStatusRef.current = "idle";
      isSearchableRef.current = true;
      publishSearchResults({
        query: searchQueryRef.current,
        totalMatches: 0,
        activeMatchIndex: -1,
        isSearchable: true,
        status: "idle",
      });
      reapplyVisibleTextLayerHighlights();
      return;
    }

    if (!searchQueryRef.current) {
      searchResultsRef.current = [];
      pageSearchMatchesRef.current = new Map();
      activeSearchMatchIndexRef.current = -1;
      pendingSearchScrollRef.current = null;
      searchStatusRef.current = "idle";
      isSearchableRef.current = true;
      publishSearchResults({
        query: "",
        totalMatches: 0,
        activeMatchIndex: -1,
        isSearchable: true,
        status: "idle",
      });
      reapplyVisibleTextLayerHighlights();
      return;
    }

    const queryPattern = getSearchHighlightPattern(searchQueryRef.current);
    searchStatusRef.current = "searching";
    publishSearchResults({
      query: searchQueryRef.current,
      totalMatches: searchResultsRef.current.length,
      activeMatchIndex: activeSearchMatchIndexRef.current,
      isSearchable: isSearchableRef.current,
      status: "searching",
    });

    const run = async () => {
      const nextResults: PdfSearchMatch[] = [];
      const matchesByPage = new Map<number, PdfSearchMatch[]>();
      let anySearchableText = false;

      for (let page = effectiveStartPage; page <= effectiveEndPage; page += 1) {
        const text = await extractPdfPageText(pdf, page);
        if (requestToken !== searchRequestTokenRef.current) {
          return;
        }
        if (text) {
          anySearchableText = true;
        }
        if (!text || !queryPattern) {
          continue;
        }

        const pageMatches: PdfSearchMatch[] = [];
        let match: RegExpExecArray | null;
        while ((match = queryPattern.exec(text)) !== null) {
          const result: PdfSearchMatch = {
            pageNumber: page,
            pageMatchIndex: pageMatches.length,
            globalIndex: nextResults.length,
          };
          pageMatches.push(result);
          nextResults.push(result);
          if (match[0].length === 0) {
            queryPattern.lastIndex += 1;
          }
        }
        queryPattern.lastIndex = 0;
        if (pageMatches.length > 0) {
          matchesByPage.set(page, pageMatches);
        }
      }

      if (requestToken !== searchRequestTokenRef.current) {
        return;
      }

      searchResultsRef.current = nextResults;
      pageSearchMatchesRef.current = matchesByPage;
      isSearchableRef.current = anySearchableText;
      searchStatusRef.current = anySearchableText ? "ready" : "unavailable";

      const nextActiveIndex = nextResults.length > 0 ? 0 : -1;
      activeSearchMatchIndexRef.current = nextActiveIndex;
      pendingSearchScrollRef.current = nextActiveIndex >= 0 ? nextActiveIndex : null;

      publishSearchResults({
        query: searchQueryRef.current,
        totalMatches: nextResults.length,
        activeMatchIndex: nextActiveIndex,
        isSearchable: anySearchableText,
        status: searchStatusRef.current,
      });
      reapplyVisibleTextLayerHighlights();

      if (nextActiveIndex >= 0) {
        focusSearchMatch(nextActiveIndex);
      }
    };

    void run();
  }, [
    extractPdfPageText,
    focusSearchMatch,
    getSearchHighlightPattern,
    numPages,
    pdf,
    publishSearchResults,
    reapplyVisibleTextLayerHighlights,
    searchQuery,
    effectiveStartPage,
    effectiveEndPage,
  ]);

  useEffect(() => {
    if (!searchNavigationRequest) return;
    if (lastProcessedSearchNavRequestRef.current === searchNavigationRequest.requestId) return;
    lastProcessedSearchNavRequestRef.current = searchNavigationRequest.requestId;

    if (searchResultsRef.current.length === 0) {
      publishSearchResults({ activeMatchIndex: -1 });
      return;
    }

    const currentIndex = activeSearchMatchIndexRef.current >= 0 ? activeSearchMatchIndexRef.current : 0;
    if (typeof searchNavigationRequest.targetIndex === "number") {
      focusSearchMatch(searchNavigationRequest.targetIndex);
      return;
    }

    if (searchNavigationRequest.direction === "previous") {
      focusSearchMatch((currentIndex - 1 + searchResultsRef.current.length) % searchResultsRef.current.length);
      return;
    }

    focusSearchMatch((currentIndex + 1) % searchResultsRef.current.length);
  }, [focusSearchMatch, publishSearchResults, searchNavigationRequest]);

  // ResizeObserver to handle container resize (e.g., when assistant panel is resized)
  useEffect(() => {
    if (!pdf || !scrollContainerRef.current) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    let animationFrameId: number | null = null;

    const resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to avoid "loop completed with undelivered notifications" error
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      
      animationFrameId = requestAnimationFrame(() => {
        // Debounce resize calls to avoid excessive re-renders
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }
        resizeTimeout = setTimeout(async () => {
          const container = scrollContainerRef.current;
          if (!container) return;

          // Skip resize handling while scroll position restoration is in progress
          // suppressAutoScroll is controlled by DocumentViewer and stays true until restoration completes
          if (suppressAutoScroll) {
            return;
          }

          // Also skip during protection windows
          const now = Date.now();
          const isInInitialLoadWindow = now < initialLoadWindowRef.current;
          const isInRestorationWindow = now < restorationWindowRef.current;
          if (isInInitialLoadWindow || isInRestorationWindow) {
            return;
          }

          if (pdf && (zoomMode === "fit-width" || zoomMode === "fit-page")) {
            // Save current scroll position before the re-render that the scale
            // change will trigger.
            const scrollTop = container.scrollTop;
            const scrollHeight = container.scrollHeight;
            const scrollPercent = scrollHeight > 0 ? scrollTop / scrollHeight : 0;

            // Bump a nonce so the per-page scale recomputes from the new
            // container dimensions; PdfPageViewWrapper then re-draws on its own.
            resizeNonceRef.current += 1;
            setResizeNonce(resizeNonceRef.current);

            // Restore scroll position after the re-render settles (percentage-based).
            if (scrollPercent > 0) {
              window.requestAnimationFrame(() => {
                if (container.scrollHeight <= 0) return;
                if (shouldSuppressProgrammaticScroll({
                  enabled: pdfNavStabilityEnabledRef.current,
                  source: "resize",
                  now: Date.now(),
                  lockoutUntil: userScrollLockoutUntilRef.current,
                  activeToken: activeNavTokenRef.current,
                })) {
                  logNav("resize-scroll-restore-suppressed", {
                    scrollPercent,
                    lockoutUntil: userScrollLockoutUntilRef.current,
                  });
                  return;
                }
                const newScrollTop = scrollPercent * container.scrollHeight;
                if (pdfNavStabilityEnabledRef.current) {
                  setNavigationMode("programmatic-nav", "resize-restore");
                }
                container.scrollTop = newScrollTop;
                if (pdfNavStabilityEnabledRef.current) {
                  isProgrammaticScrollRef.current = true;
                  window.setTimeout(() => {
                    if (activeNavTokenRef.current === null) {
                      isProgrammaticScrollRef.current = false;
                      if (Date.now() >= userScrollLockoutUntilRef.current) {
                        setNavigationMode("idle", "resize-restore-complete");
                      }
                    }
                  }, 200);
                }
              });
            }
          }
        }, 100);
      });
    });

    resizeObserver.observe(scrollContainerRef.current);
    // Also observe outer container to catch width changes from assistant panel show/hide
    if (outerContainerRef.current) {
      resizeObserver.observe(outerContainerRef.current);
    }

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      resizeObserver.disconnect();
    };
  }, [pdf, zoomMode, suppressAutoScroll]);

  const buildPdfSelectionContext = useCallback((): PdfSelectionContext | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    const textLayers = textLayerRootsRef.current.filter(Boolean) as HTMLDivElement[];
    if (textLayers.length === 0) return null;
    if (!selectionAnchorsInTextLayers(selection, textLayers)) return null;
    if (!selectionIntersectsTextLayers(selection, textLayers)) return null;

    const text = selection.toString().trim();
    if (!text) return null;

    const range = selection.getRangeAt(0);
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0);

    if (rects.length === 0) return null;

    const pages = new Map<number, { pageNumber: number; viewportRects: ViewportRect[]; pdfRects: PdfRect[] }>();

    rects.forEach((rect) => {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      for (let i = 0; i < pageContainerRefs.current.length; i += 1) {
        const pageEl = pageContainerRefs.current[i];
        const viewport = pageViewportRefs.current[i];
        if (!pageEl || !viewport) continue;
        const bounds = pageEl.getBoundingClientRect();
        if (centerX < bounds.left || centerX > bounds.right || centerY < bounds.top || centerY > bounds.bottom) {
          continue;
        }

        const viewportRect = {
          left: rect.left - bounds.left,
          top: rect.top - bounds.top,
          width: rect.width,
          height: rect.height,
        };
        const [x1, y1] = viewport.convertToPdfPoint(viewportRect.left, viewportRect.top);
        const [x2, y2] = viewport.convertToPdfPoint(
          viewportRect.left + viewportRect.width,
          viewportRect.top + viewportRect.height
        );
        const pdfRect = { x1, y1, x2, y2 };

        const pageNumber = i + 1;
        if (!pages.has(pageNumber)) {
          pages.set(pageNumber, { pageNumber, viewportRects: [], pdfRects: [] });
        }
        pages.get(pageNumber)?.viewportRects.push(viewportRect);
        pages.get(pageNumber)?.pdfRects.push(pdfRect);
        break;
      }
    });

    if (pages.size === 0) return null;

    return {
      type: "pdf",
      documentId,
      fingerprint: (pdf as any)?.fingerprint ?? null,
      source: "native",
      pages: Array.from(pages.values()).sort((a, b) => a.pageNumber - b.pageNumber),
    };
  }, [documentId, pdf]);

  useEffect(() => {
    if (!pdf || numPages <= 0) { onVimRuntimeChangeRef.current?.(null); return; }
    const runtime: PdfVimRuntime = {
      documentId,
      pageCount: numPages,
      currentPageNumber: () => pageNumberRef.current,
      loadPageText: async (targetPage, signal) => {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const page = await pdf.getPage(targetPage);
        const content = await page.getTextContent();
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return content.items.filter((item) => "str" in item).map((raw) => {
          const item = raw as any;
          return ({
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
          hasEOL: item.hasEOL,
          });
        });
      },
      revealPage: async (targetPage, signal) => {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        setRenderedPageRange((range) => ({ start: Math.min(range.start, targetPage), end: Math.max(range.end, targetPage) }));
        onPageChangeRef.current?.(targetPage);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          const pageElement = pageContainerRefs.current[targetPage - 1];
          if (pageElement) { pageElement.scrollIntoView({ block: "center", behavior: "instant" }); return; }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      },
      textLayer: (targetPage) => textLayerRootsRef.current[targetPage - 1],
      pageSelectionContext: (targetPage, range) => {
        const pageElement = pageContainerRefs.current[targetPage - 1];
        const viewport = pageViewportRefs.current[targetPage - 1];
        if (!pageElement || !viewport) return null;
        const bounds = pageElement.getBoundingClientRect();
        const viewportRects: ViewportRect[] = [];
        const pdfRects: PdfRect[] = [];
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          const local = { left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height };
          const [x1, y1] = viewport.convertToPdfPoint(local.left, local.top);
          const [x2, y2] = viewport.convertToPdfPoint(local.left + local.width, local.top + local.height);
          viewportRects.push(local); pdfRects.push({ x1, y1, x2, y2 });
        }
        return { pageNumber: targetPage, viewportRects, pdfRects };
      },
      subscribe: (listener) => { vimRuntimeListenersRef.current.add(listener); return () => vimRuntimeListenersRef.current.delete(listener); },
    };
    onVimRuntimeChangeRef.current?.(runtime);
    return () => { onVimRuntimeChangeRef.current?.(null); };
  }, [documentId, numPages, pdf]);

  // Selection persistence (native DOM selection + committed overlay).
  //
  // Design: the browser's own native highlight paints the selection while the
  // user drags, so we commit NOTHING to React state during the drag. The range
  // is captured ONCE on mouseup (after letting the browser finalize it) and
  // stored through the persistence reducer as the source of truth for the
  // per-page overlay. Once committed, the overlay no longer depends on the
  // live native selection: WKWebView drops the document selection whenever
  // focus moves (popup, assistant panel, other controls), and a dropped native
  // selection is deliberately NOT a clear signal — there is no selectionchange
  // handler that clears state. Clearing happens only through the explicit
  // triggers wired below (see reducePdfSelectionPersistence).
  useEffect(() => {
    if (!onSelectionChange) return;

    // Commit the current native selection (if any, and if it lives inside a
    // PDF text layer) to persisted state and surface the popup. Returns true
    // when a valid PDF selection was committed. The reducer ignores invalid
    // selections (collapsed / non-PDF / empty text) and leaves the persisted
    // state untouched.
    const commitSelection = (): boolean => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;

      const textLayers = textLayerRootsRef.current.filter(Boolean) as HTMLDivElement[];
      if (
        textLayers.length === 0 ||
        !selectionAnchorsInTextLayers(selection, textLayers) ||
        !selectionIntersectsTextLayers(selection, textLayers)
      ) {
        return false;
      }

      const context = buildPdfSelectionContext();
      if (!context) return false;

      const text = selection.toString().trim();
      if (!text) return false;

      lastSelectionWasPdfRef.current = true;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      dispatchPersistence({ type: "commit", selection: context, text, rect });
      onSelectionChange(text, context);
      return true;
    };

    // Handle mouse up to capture the finalized selection. WKWebView in
    // particular can report a stale/collapsed selection at the instant mouseup
    // fires; a short delay lets the browser settle the range first.
    const handleMouseUp = (e: MouseEvent) => {
      // A mouseup on the selection popup (focus moved to a popup control) can
      // drop the native selection in WKWebView. That is a focus move, NOT a
      // dismissal — the popup's own click handler decides what happens to the
      // selection — so never run the empty-selection clear path for it.
      const releasedOnPopup =
        e.target instanceof Node && selectionPopupHostRef.current?.contains(e.target) === true;
      setTimeout(() => {
        const committed = commitSelection();
        if (!releasedOnPopup && !committed && lastSelectionWasPdfRef.current) {
          // mouseup landed on an empty/non-PDF selection — drop the old one.
          clearPersistedSelection("outside-page-click");
        }
      }, 0);
    };

    // Explicit clear semantics (single path via clearPersistedSelection):
    //  - pointer-down inside a text layer (incl. inter-line whitespace, which
    //    is delegated to PDF.js's endOfContent handling) starts a new in-page
    //    selection → clear, but leave the browser's own range untouched so the
    //    new drag proceeds normally.
    //  - pointer-down inside the reading surface but outside any text layer
    //    (page margin, gaps between pages) with no native selection → clear.
    // Clicks on the floating selection popup are handled by the popup itself
    // and must NOT clear — focus legitimately moves there. Clicks OUTSIDE the
    // reading surface (assistant panel, dialogs, other panels) are focus moves
    // and must NOT clear either: that is exactly the WKWebView focus-loss case
    // the committed overlay exists to survive.
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!(target instanceof Node)) return;
      if (selectionPopupHostRef.current?.contains(target)) return;

      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer || !scrollContainer.contains(target)) return;

      const clickedTextLayer = textLayerRootsRef.current.some(
        (layer) => layer && (layer === target || layer.contains(target)),
      );
      if (clickedTextLayer && persistedSelectionRef.current) {
        clearPersistedSelection("new-in-page-drag", /* clearNative */ false);
        return;
      }
      const hasNativeSelection = Boolean(window.getSelection()?.toString().trim());
      if (!hasNativeSelection) {
        clearPersistedSelection("outside-page-click");
      }
    };

    // Escape clears a persisted selection (overlay, popup, downstream state).
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!persistedSelectionRef.current) return;
      clearPersistedSelection("escape");
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onSelectionChange, buildPdfSelectionContext, clearPersistedSelection]);

  // A new document (or a fresh pdf.js proxy) invalidates the persisted
  // selection's geometry and page context — clear it. `clearPersistedSelection`
  // is intentionally excluded from the deps: its only dependency is the parent
  // callback, whose identity may change on unrelated re-renders.
  useEffect(() => {
    if (persistedSelectionRef.current) {
      clearPersistedSelection("document-change");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, pdf]);

  // OCR region selection is a new in-page pointer gesture — clear any persisted
  // selection when OCR becomes active so the two never overlap.
  useEffect(() => {
    if (ocr.flowState !== "idle") {
      clearPersistedSelection("new-in-page-drag");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocr.flowState]);

  // Per-page PDF-space rects of the persisted selection, for the overlay.
  // Pages without rects (or no committed selection) are simply not painted;
  // committed state survives so scrolling back re-paints them.
  const selectionPdfRectsByPage = useMemo(() => {
    const selection = persistedSelection.selection;
    if (!selection) return null;
    const map = new Map<number, PdfRect[]>();
    for (const page of selection.pages) {
      if (page.pdfRects.length > 0) map.set(page.pageNumber, page.pdfRects);
    }
    return map;
  }, [persistedSelection.selection]);

  // Resolve the per-page display scale from the current zoom mode.
  // fit-width / fit-page need the scroll container width/height, so this must
  // run at render time (not in renderPage, which no longer exists). The result
  // is passed as the `scale` prop to each PdfPageViewWrapper.
  const computeActualScale = useCallback(
    (baseViewportWidth: number, baseViewportHeight: number): number => {
      if (zoomMode === "fit-width") {
        const scrollContainer = scrollContainerRef.current;
        const containerWidth = (scrollContainer?.clientWidth ?? baseViewportWidth) - 32;
        if (containerWidth > 0) return containerWidth / baseViewportWidth;
        return scale;
      }
      if (zoomMode === "fit-page") {
        const scrollContainer = scrollContainerRef.current;
        const containerWidth = (scrollContainer?.clientWidth ?? baseViewportWidth) - 32;
        const containerHeight = (scrollContainer?.clientHeight ?? baseViewportHeight) - 32;
        if (containerWidth > 0 && containerHeight > 0) {
          return Math.min(containerWidth / baseViewportWidth, containerHeight / baseViewportHeight);
        }
        return scale;
      }
      return scale;
    },
    [zoomMode, scale],
  );

  // Resolve the display scale for every page from the current zoom mode + the
  // base page size (page 1's scale-1 viewport). Most PDFs have uniform page
  // sizes, so this is a single value applied to all pages. For mixed-size PDFs
  // this is approximate per-page but matches the previous behavior closely
  // enough; PdfPageViewWrapper re-draws each page at its own true viewport.
  // `resizeNonce` is bumped by the ResizeObserver so fit-width/fit-page
  // recomputes when the container resizes (e.g. assistant panel drag).
  const resolvedScale = useMemo(() => {
    // Read resizeNonce to recompute on container resize.
    void resizeNonceRef.current;
    const base = fallbackPageSize;
    if (!base) return scale;
    return computeActualScale(base.width, base.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackPageSize, scale, zoomMode, computeActualScale, resizeNonceRef.current]);
  // pageScales is a sparse array mirroring pageViewportRefs indexing; every
  // entry resolves to resolvedScale (uniform). Kept as an array so the JSX can
  // read `pageScales[index]` uniformly in case per-page scaling is added later.
  const pageScales = useMemo<(number)[]>(() => {
    const arr = new Array(Math.max(0, numPages)).fill(resolvedScale);
    return arr;
  }, [numPages, resolvedScale]);


  const getCurrentPageFromScrollTop = useCallback((scrollTop: number) => {
    return deriveCurrentPageFromOffsets(pageOffsetsRef.current, numPages, pageNumber, scrollTop, 24);
  }, [numPages, pageNumber]);

  const completeProgrammaticNavigation = useCallback((token: number, reason: string) => {
    if (!pdfNavStabilityEnabledRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }
    if (activeNavTokenRef.current !== token) return;
    activeNavTokenRef.current = null;
    isProgrammaticScrollRef.current = false;
    clearNavigationSettleTimeout();
    if (Date.now() >= userScrollLockoutUntilRef.current) {
      setNavigationMode("idle", reason);
    }
    logNav("programmatic-nav-complete", { token, reason });
  }, [clearNavigationSettleTimeout, logNav, setNavigationMode]);

  const startNavigationSettleCheck = useCallback((token: number, targetTop: number, targetPageNumber: number) => {
    if (!pdfNavStabilityEnabledRef.current) return;
    clearNavigationSettleTimeout();
    navSettleTargetRef.current = { token, targetTop, pageNumber: targetPageNumber };
    const deadline = Date.now() + NAV_SETTLE_TIMEOUT_MS;

    const check = () => {
      if (activeNavTokenRef.current !== token) return;
      const container = scrollContainerRef.current;
      if (!container) {
        completeProgrammaticNavigation(token, "container-missing");
        return;
      }

      const currentTop = container.scrollTop;
      const currentPageFromOffsets = getCurrentPageFromScrollTop(currentTop);
      const delta = Math.abs(currentTop - targetTop);
      const onTargetPage = currentPageFromOffsets === targetPageNumber;
      const settled = isNavigationSettled(delta, onTargetPage, NAV_SETTLE_THRESHOLD_PX);
      const now = Date.now();

      if (settled) {
        if (!navSettleStableSinceRef.current) {
          navSettleStableSinceRef.current = now;
        }
        if (now - navSettleStableSinceRef.current >= NAV_SETTLE_STABLE_MS) {
          completeProgrammaticNavigation(token, "settled");
          return;
        }
      } else {
        navSettleStableSinceRef.current = null;
      }

      if (now >= deadline) {
        completeProgrammaticNavigation(token, "settle-timeout");
        return;
      }

      navSettleTimeoutRef.current = setTimeout(check, 80);
    };

    navSettleTimeoutRef.current = setTimeout(check, 80);
  }, [
    clearNavigationSettleTimeout,
    completeProgrammaticNavigation,
    getCurrentPageFromScrollTop,
  ]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const pageContainer = pageContainerRefs.current[pageNumber - 1];
    if (!container || !pageContainer) return;

    // If the pageNumber update came from scroll syncing, avoid auto-scrolling
    // (it feels like the viewer is "snapping back" while scrolling).
    if (pageUpdateFromScrollRef.current) {
      pageUpdateFromScrollRef.current = false;
      return;
    }

    if (suppressAutoScroll) {
      skipAutoScrollOnceRef.current = true;
      // Track the restored page to prevent scroll events from resetting it backwards
      restoredPageRef.current = pageNumber;
      // Set a protection window - ignore ALL auto-scrolls for 2 seconds after restoration
      restorationWindowRef.current = Date.now() + 2000;
      return;
    }

    // Check if we're still in the restoration protection window
    const now = Date.now();
    const isInRestorationWindow = now < restorationWindowRef.current;

    if (skipAutoScrollOnceRef.current) {
      skipAutoScrollOnceRef.current = false;
      // Don't scroll during restoration window
      if (isInRestorationWindow) {
        console.log("[PDFViewer] Skipping auto-scroll during restoration window", { pageNumber, restoredPage: restoredPageRef.current });
        return;
      }
    }

    // Block any auto-scroll that would take us to a different page during restoration window
    if (isInRestorationWindow && restoredPageRef.current !== null && pageNumber !== restoredPageRef.current) {
      console.log("[PDFViewer] Blocking auto-scroll to different page during restoration:", { pageNumber, restoredPage: restoredPageRef.current });
      return;
    }

    const pending = pendingNavRef.current;
    if (pending && pending.pageNumber === pageNumber) {
      if (pdfNavStabilityEnabledRef.current && isStaleNavigationToken(activeNavTokenRef.current, pending.token)) {
        logNav("stale-pending-nav-ignored", {
          pendingToken: pending.token,
          activeToken: activeNavTokenRef.current,
          pageNumber,
        });
        pendingNavRef.current = null;
        return;
      }

      const pageIndex = pageNumber - 1;
      const viewport = pageViewportRefs.current[pageIndex];
      const destArray = pending.destArray;

      let targetTop = Math.max(0, pageContainer.offsetTop - 16);
      let targetLeft = container.scrollLeft;

      if (destArray && viewport) {
        const kindRaw = destArray[1];
        const kind =
          (kindRaw && typeof kindRaw === "object" && typeof (kindRaw as any).name === "string"
            ? (kindRaw as any).name
            : typeof kindRaw === "string"
              ? kindRaw
              : null) as string | null;

        try {
          if (kind === "XYZ") {
            const leftPdf = typeof destArray[2] === "number" ? destArray[2] : 0;
            const topPdf = typeof destArray[3] === "number" ? destArray[3] : null;
            if (topPdf !== null) {
              const [vx, vy] = viewport.convertToViewportPoint(leftPdf, topPdf);
              if (Number.isFinite(vy)) targetTop = Math.max(0, pageContainer.offsetTop + vy - 16);
              if (Number.isFinite(vx)) targetLeft = Math.max(0, vx);
            }
          } else if (kind === "FitH" || kind === "FitBH") {
            const topPdf = typeof destArray[2] === "number" ? destArray[2] : null;
            if (topPdf !== null) {
              const [, vy] = viewport.convertToViewportPoint(0, topPdf);
              if (Number.isFinite(vy)) targetTop = Math.max(0, pageContainer.offsetTop + vy - 16);
            }
          }
        } catch {
          // Ignore dest parsing issues and fall back to top-of-page scroll.
        }
      }

      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      targetTop = Math.min(Math.max(0, targetTop), maxScrollTop);
      targetLeft = Math.min(Math.max(0, targetLeft), maxScrollLeft);

      pendingNavRef.current = null;
      if (pdfNavStabilityEnabledRef.current) {
        setNavigationMode("programmatic-nav", "toc-pending-nav");
        isProgrammaticScrollRef.current = true;
      }
      isProgrammaticScrollRef.current = true;
      container.scrollTo({ top: targetTop, left: targetLeft, behavior: "auto" });

      if (pdfNavStabilityEnabledRef.current) {
        startNavigationSettleCheck(pending.token, targetTop, pageNumber);
      } else {
        const timeout = setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 300);
        return () => {
          clearTimeout(timeout);
        };
      }
      return;
    }

    // Do not auto-scroll on generic pageNumber prop changes. Programmatic
    // navigation must go through pendingNavRef to avoid snap-back loops.
    return;
  }, [
    logNav,
    pageNumber,
    numPages,
    suppressAutoScroll,
    startNavigationSettleCheck,
  ]);

  // Track the last restoreRequestId we've processed to detect new restore attempts
  const lastProcessedRestoreIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!restoreState || restoreRequestId === undefined) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    // Only reset user scroll tracking when this is a genuinely NEW restore attempt
    // (i.e., restoreRequestId changed for the first time, not just re-triggered by verification)
    const isNewRestore = lastProcessedRestoreIdRef.current === null ||
                         restoreRequestId < (lastProcessedRestoreIdRef.current ?? 0);
    if (isNewRestore) {
      userScrolledDuringRestoreRef.current = false;
      userScrollSignaledRef.current = false;
    }
    lastProcessedRestoreIdRef.current = restoreRequestId;
    const start = Date.now();
    const deadline = start + 8000;
    let canceled = false;
    let settleTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const attempt = () => {
      if (canceled) return;
      if (userScrolledDuringRestoreRef.current) return;
      const activeContainer = scrollContainerRef.current;
      if (!activeContainer) return;

      const clampedPageNumber = Math.max(effectiveStartPage, Math.min(restoreState.pageNumber, Math.max(effectiveStartPage, effectiveEndPage || 1)));
      const pageIndex = clampedPageNumber - 1;
      const pageEl = pageContainerRefs.current[pageIndex];
      const viewport = pageViewportRefs.current[pageIndex];

      let targetScrollTop: number | null = null;
      let targetScrollLeft: number | null = null;
      const maxScroll = Math.max(0, activeContainer.scrollHeight - activeContainer.clientHeight);

      if (restoreState.dest && pageEl && viewport && pageEl.offsetHeight > 0) {
        const left = restoreState.dest.left ?? 0;
        const top = restoreState.dest.top ?? 0;
        const [viewportX, viewportY] = viewport.convertToViewportPoint(left, top);
        if (Number.isFinite(viewportY)) {
          targetScrollTop = pageEl.offsetTop + viewportY;
        }
        if (Number.isFinite(viewportX)) {
          targetScrollLeft = viewportX;
        }
      } else if (
        typeof restoreState.scrollTop === "number"
        || typeof restoreState.scrollPercent === "number"
      ) {
        const scrollLeft = typeof restoreState.scrollLeft === "number" ? restoreState.scrollLeft : null;
        if (typeof restoreState.scrollPercent === "number" && maxScroll > 0) {
          const percentScrollTop = (restoreState.scrollPercent / 100) * maxScroll;
          if (typeof restoreState.scrollTop === "number") {
            const delta = Math.abs(restoreState.scrollTop - percentScrollTop);
            const threshold = Math.max(200, maxScroll * 0.05);
            targetScrollTop = delta > threshold ? percentScrollTop : restoreState.scrollTop;
          } else {
            targetScrollTop = percentScrollTop;
          }
        } else if (typeof restoreState.scrollTop === "number") {
          targetScrollTop = restoreState.scrollTop;
        }
        targetScrollLeft = scrollLeft;
      } else if (pageEl && pageEl.offsetTop !== undefined) {
        targetScrollTop = pageEl.offsetTop;
      }

      const hasEnoughLayout =
        maxScroll > 0 ||
        (!!pageEl && pageEl.offsetHeight > 0) ||
        (activeContainer.scrollHeight > 0 && activeContainer.clientHeight > 0);

      if (targetScrollTop === null || !hasEnoughLayout) {
        if (!userScrolledDuringRestoreRef.current && Date.now() < deadline) {
          retryTimeout = setTimeout(attempt, 120);
        }
        return;
      }

      const clamped = Math.min(Math.max(0, targetScrollTop), maxScroll > 0 ? maxScroll : targetScrollTop);
      if (shouldSuppressProgrammaticScroll({
        enabled: pdfNavStabilityEnabledRef.current,
        source: "restore",
        now: Date.now(),
        lockoutUntil: userScrollLockoutUntilRef.current,
        activeToken: activeNavTokenRef.current,
      })) {
        logNav("restore-scroll-suppressed-by-user-lockout", {
          page: clampedPageNumber,
          lockoutUntil: userScrollLockoutUntilRef.current,
        });
        return;
      }
      restoredPageRef.current = clampedPageNumber;
      restorationWindowRef.current = Date.now() + 2000;
      if (pdfNavStabilityEnabledRef.current) {
        setNavigationMode("programmatic-nav", "restore-request");
      }
      isProgrammaticScrollRef.current = true;
      activeContainer.scrollTop = clamped;

      if (targetScrollLeft !== null) {
        const maxScrollLeft = Math.max(0, activeContainer.scrollWidth - activeContainer.clientWidth);
        activeContainer.scrollLeft = Math.min(Math.max(0, targetScrollLeft), maxScrollLeft);
      }

      if (settleTimeout) clearTimeout(settleTimeout);
      settleTimeout = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        if (pdfNavStabilityEnabledRef.current && activeNavTokenRef.current === null) {
          if (Date.now() >= userScrollLockoutUntilRef.current) {
            setNavigationMode("idle", "restore-request-complete");
          }
        }
      }, 300);
    };

    attempt();

    return () => {
      canceled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      if (settleTimeout) clearTimeout(settleTimeout);
    };
  }, [logNav, numPages, restoreRequestId, restoreState, setNavigationMode]);

  // Reset restore tracking when restoreState becomes null (restoration complete/cancelled)
  useEffect(() => {
    if (!restoreState) {
      lastProcessedRestoreIdRef.current = null;
    }
  }, [restoreState]);


  const columnScrollLeft = (index: number, container: HTMLDivElement) => {
    const logicalIndex = mobilePreferences.fixedColumnDirection === "rtl"
      ? Math.max(0, mobilePreferences.fixedColumns - 1 - index)
      : index;
    return logicalIndex * (container.clientWidth * (1 - mobilePreferences.fixedColumnOverlap));
  };

  const handlePrevPage = () => {
    if (mobilePdfMode === "fixed" && mobilePreferences.fixedMobileMode === "columns" && fixedColumnIndexRef.current > 0) {
      fixedColumnIndexRef.current -= 1;
      const container = scrollContainerRef.current;
      if (container) container.scrollTo({ left: columnScrollLeft(fixedColumnIndexRef.current, container), behavior: "smooth" });
      return;
    }
    if (pageNumber > effectiveStartPage) {
      const nextPageNumber = pageNumber - 1;
      if (mobilePdfMode === "reflow") {
        if (scrollReflowToPage(nextPageNumber)) return;
        setMobilePdfMode("fixed");
      }
      const token = ++navTokenCounterRef.current;
      activeNavTokenRef.current = token;
      pendingNavRef.current = { token, pageNumber: nextPageNumber, destArray: null };
      if (pdfNavStabilityEnabledRef.current) {
        setNavigationMode("programmatic-nav", "prev-page");
        isProgrammaticScrollRef.current = true;
      }
      onPageChange?.(nextPageNumber);
    }
  };

  const handleNextPage = () => {
    if (mobilePdfMode === "fixed" && mobilePreferences.fixedMobileMode === "columns" && fixedColumnIndexRef.current < mobilePreferences.fixedColumns - 1) {
      fixedColumnIndexRef.current += 1;
      const container = scrollContainerRef.current;
      if (container) container.scrollTo({ left: columnScrollLeft(fixedColumnIndexRef.current, container), behavior: "smooth" });
      return;
    }
    if (pageNumber < effectiveEndPage) {
      fixedColumnIndexRef.current = 0;
      const nextPageNumber = pageNumber + 1;
      if (mobilePdfMode === "reflow") {
        if (scrollReflowToPage(nextPageNumber)) return;
        setMobilePdfMode("fixed");
      }
      const token = ++navTokenCounterRef.current;
      activeNavTokenRef.current = token;
      pendingNavRef.current = { token, pageNumber: nextPageNumber, destArray: null };
      if (pdfNavStabilityEnabledRef.current) {
        setNavigationMode("programmatic-nav", "next-page");
        isProgrammaticScrollRef.current = true;
      }
      onPageChange?.(nextPageNumber);
    }
  };

  useReaderVolumeNavigation({
    onNextPage: handleNextPage,
    onPrevPage: handlePrevPage,
  });

  // Programmatic jump to an arbitrary page. Mirrors handlePrevPage/NextPage's
  // token + pendingNav dance so the navigation-stability guards treat this as
  // an authoritative programmatic nav (no snap-back). Silently clamps to the
  // effective chunk bounds.
  const handleGoToPage = (targetPage: number) => {
    if (!Number.isFinite(targetPage)) return;
    const clamped = Math.max(effectiveStartPage, Math.min(effectiveEndPage, targetPage));
    if (clamped === pageNumber) return;
    if (mobilePdfMode === "reflow") {
      if (scrollReflowToPage(clamped)) return;
      setMobilePdfMode("fixed");
    }
    const token = ++navTokenCounterRef.current;
    activeNavTokenRef.current = token;
    pendingNavRef.current = { token, pageNumber: clamped, destArray: null };
    if (pdfNavStabilityEnabledRef.current) {
      setNavigationMode("programmatic-nav", "go-to-page");
      isProgrammaticScrollRef.current = true;
    }
    onPageChange?.(clamped);
  };

  const resolveOutlineDest = useCallback(async (dest: any) => {
    if (!pdf) return null;

    // Some PDFs/creators return a direct page index (0-based). Keep supporting it.
    if (typeof dest === "number" && Number.isFinite(dest)) {
      const pageIndex = Math.max(0, Math.min(Math.max(0, numPages - 1), dest));
      return { pageIndex, destArray: null as any[] | null };
    }

    let destArray: any[] | null = null;
    if (typeof dest === "string") {
      try {
        destArray = (await pdf.getDestination(dest)) as any[] | null;
      } catch {
        destArray = null;
      }
    } else if (Array.isArray(dest)) {
      destArray = dest as any[];
    }

    if (!destArray || !Array.isArray(destArray) || destArray.length === 0) return null;

    const pageRef = destArray[0];
    try {
      if (typeof pageRef === "number" && Number.isFinite(pageRef)) {
        const pageIndex = Math.max(0, Math.min(Math.max(0, numPages - 1), pageRef));
        return { pageIndex, destArray };
      }

      // PDF.js uses a Ref object for the page reference in explicit destinations.
      const pageIndex = await pdf.getPageIndex(pageRef as any);
      if (!Number.isFinite(pageIndex)) return null;
      return { pageIndex, destArray };
    } catch {
      return null;
    }
  }, [pdf, numPages]);

  const handleTocClick = useCallback(async (dest: any) => {
    const requestToken = ++navTokenCounterRef.current;
    latestTocRequestTokenRef.current = requestToken;
    const resolved = await resolveOutlineDest(dest);
    if (!resolved) {
      if (pdfNavStabilityEnabledRef.current && latestTocRequestTokenRef.current !== requestToken) {
        logNav("stale-toc-resolve-ignored", { requestToken, reason: "no-resolved-destination" });
      }
      return;
    }
    if (pdfNavStabilityEnabledRef.current && latestTocRequestTokenRef.current !== requestToken) {
      logNav("stale-toc-resolve-ignored", {
        requestToken,
        latestToken: latestTocRequestTokenRef.current,
      });
      return;
    }

    const nextPageNumber = resolved.pageIndex + 1;
    if (nextPageNumber < effectiveStartPage || nextPageNumber > effectiveEndPage) {
      console.warn("TOC click is out of bounds for the current chunk:", nextPageNumber);
      return;
    }

    activeNavTokenRef.current = requestToken;
    pendingNavRef.current = { token: requestToken, pageNumber: nextPageNumber, destArray: resolved.destArray };
    if (pdfNavStabilityEnabledRef.current) {
      setNavigationMode("programmatic-nav", "toc-click");
      isProgrammaticScrollRef.current = true;
    }
    setShowTOC(false);
    if (mobilePdfMode === "reflow") {
      if (scrollReflowToPage(nextPageNumber)) return;
      setMobilePdfMode("fixed");
    }
    onPageChange?.(nextPageNumber);
  }, [logNav, mobilePdfMode, onPageChange, resolveOutlineDest, scrollReflowToPage, setNavigationMode, effectiveStartPage, effectiveEndPage]);

  const handleZoomModeChange = (mode: ZoomMode) => {
    setZoomMode(mode);
    onZoomModeChange?.(mode);
  };

  const applyFixedMobileMode = (mode: typeof mobilePreferences.fixedMobileMode) => {
    updateMobilePreferences({ fixedMobileMode: mode });
    fixedColumnIndexRef.current = 0;
    if (mode === "fit-width") return handleZoomModeChange("fit-width");
    if (mode === "fit-page") return handleZoomModeChange("fit-page");
    const container = scrollContainerRef.current;
    const pageSize = fallbackPageSize;
    if (!container || !pageSize) return handleZoomModeChange("fit-width");
    if (mode === "columns") {
      const columnWidth = pageSize.width / Math.max(1, mobilePreferences.fixedColumns);
      const nextScale = Math.max(0.5, Math.min(4, (container.clientWidth - 32) / columnWidth));
      setZoomMode("custom");
      onZoomModeChange?.("custom");
      onScaleChange?.(nextScale);
      requestAnimationFrame(() => container.scrollTo({ left: columnScrollLeft(0, container), behavior: "smooth" }));
      return;
    }
    const sourceRects = reflowDocument?.pages[pageNumber]?.blocks.flatMap((block) => block.source.rects) ?? [];
    if (sourceRects.length === 0) return handleZoomModeChange("fit-width");
    const left = Math.min(...sourceRects.map((rect) => rect.x));
    const right = Math.max(...sourceRects.map((rect) => rect.x + rect.width));
    const nextScale = Math.max(0.5, Math.min(4, (container.clientWidth - 24) / Math.max(1, right - left)));
    setZoomMode("custom");
    onZoomModeChange?.("custom");
    onScaleChange?.(nextScale);
    requestAnimationFrame(() => container.scrollTo({ left: Math.max(0, left * nextScale - 12), behavior: "smooth" }));
  };

  const renderOutline = (items: any[], depth = 0): React.ReactElement[] => {
    return items.map((item, index) => (
      <div key={index}>
        <button
          onClick={() => {
            if (item.dest) handleTocClick(item.dest);
          }}
          className={cn(
            "block w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md transition-colors",
            depth > 0 && "pl-6"
          )}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          {item.title}
        </button>
        {item.items && renderOutline(item.items, depth + 1)}
      </div>
    ));
  };

  // Pre-resolve outline destinations to flat sorted page numbers
  useEffect(() => {
    if (!pdf || outline.length === 0) {
      setFlatOutline([]);
      return;
    }

    let active = true;
    const resolveFlatOutline = async () => {
      const flat: { title: string; dest: any; pageNumber: number }[] = [];
      
      const traverse = async (items: any[]) => {
        for (const item of items) {
          if (!active) return;
          if (item.dest) {
            try {
              const resolved = await resolveOutlineDest(item.dest);
              if (resolved) {
                flat.push({
                  title: item.title,
                  dest: item.dest,
                  pageNumber: resolved.pageIndex + 1,
                });
              }
            } catch (err) {
              console.warn("Failed to resolve outline item dest:", err);
            }
          }
          if (item.items && item.items.length > 0) {
            await traverse(item.items);
          }
        }
      };

      await traverse(outline);
      
      if (active) {
        // Sort by page number to make linear traversal correct
        flat.sort((a, b) => a.pageNumber - b.pageNumber);
        setFlatOutline(flat);
      }
    };

    void resolveFlatOutline();
    return () => {
      active = false;
    };
  }, [pdf, outline, resolveOutlineDest]);

  const handlePrevToc = useCallback(() => {
    if (flatOutline.length === 0) return;
    
    let targetIndex = -1;
    for (let i = 0; i < flatOutline.length; i++) {
      if (flatOutline[i].pageNumber < pageNumber) {
        targetIndex = i;
      } else {
        break;
      }
    }
    
    if (targetIndex !== -1) {
      void handleTocClick(flatOutline[targetIndex].dest);
    }
  }, [flatOutline, pageNumber, handleTocClick]);

  const handleNextToc = useCallback(() => {
    if (flatOutline.length === 0) return;
    
    let targetIndex = -1;
    for (let i = 0; i < flatOutline.length; i++) {
      if (flatOutline[i].pageNumber > pageNumber) {
        targetIndex = i;
        break;
      }
    }
    
    if (targetIndex !== -1) {
      void handleTocClick(flatOutline[targetIndex].dest);
    }
  }, [flatOutline, pageNumber, handleTocClick]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "TEXTAREA" ||
        (e.target as HTMLElement).isContentEditable) {
      return;
    }

    const lowerKey = e.key.toLowerCase();

    if (lowerKey === "j") {
      if (useVimModeStore.getState().mode === "inactive") {
        e.preventDefault();
        const container = scrollContainerRef.current;
        if (container) {
          container.scrollBy({ top: 120, behavior: "smooth" });
        }
      }
    } else if (lowerKey === "k") {
      if (useVimModeStore.getState().mode === "inactive") {
        e.preventDefault();
        const container = scrollContainerRef.current;
        if (container) {
          container.scrollBy({ top: -120, behavior: "smooth" });
        }
      }
    } else if (lowerKey === "h" || e.key === "ArrowLeft") {
      if (useVimModeStore.getState().mode === "inactive") {
        e.preventDefault();
        handlePrevToc();
      }
    } else if (lowerKey === "l" || e.key === "ArrowRight") {
      if (useVimModeStore.getState().mode === "inactive") {
        e.preventDefault();
        handleNextToc();
      }
    } else if (e.key === "ArrowUp") {
      handlePrevPage();
    } else if (e.key === "ArrowDown") {
      handleNextPage();
    } else if (e.key === "Home") {
      e.preventDefault();
      const token = ++navTokenCounterRef.current;
      activeNavTokenRef.current = token;
      pendingNavRef.current = { token, pageNumber: effectiveStartPage, destArray: null };
      if (pdfNavStabilityEnabledRef.current) {
        setNavigationMode("programmatic-nav", "home-key");
        isProgrammaticScrollRef.current = true;
      }
      onPageChange?.(effectiveStartPage);
    } else if (e.key === "End") {
      e.preventDefault();
      const token = ++navTokenCounterRef.current;
      activeNavTokenRef.current = token;
      pendingNavRef.current = { token, pageNumber: effectiveEndPage, destArray: null };
      if (pdfNavStabilityEnabledRef.current) {
        setNavigationMode("programmatic-nav", "end-key");
        isProgrammaticScrollRef.current = true;
      }
      onPageChange?.(effectiveEndPage);
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      if (ocr.flowState === "idle") {
        ocr.enterOcrMode();
      } else {
        ocr.exitOcrMode();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
      e.preventDefault();
      const el = pageInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  };

  // Autofocus the outer container on mount to enable immediate keyboard navigation
  useEffect(() => {
    if (outerContainerRef.current) {
      outerContainerRef.current.focus();
    }
  }, []);

  // Pan/drag handlers for zoomed content
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only enable drag when:
    // 1. Zoomed in significantly (scale > 1.2) or in custom zoom mode
    // 2. Not clicking on the text layer (to allow text selection)
    // 3. Middle mouse button or holding space (for pan mode)
    const isMiddleButton = e.button === 1;
    const isZoomedIn = scale > 1.2 || zoomMode === "custom";
    
    if (isZoomedIn || isMiddleButton) {
      const targetNode = e.target as Node;
      
      // Don't drag if clicking on text layer (allow text selection)
      const isClickingText = textLayerRootsRef.current.some((layer) => 
        layer && (layer === targetNode || layer.contains(targetNode))
      );
      
      if (isClickingText) {
        // Allow text selection to proceed
        return;
      }
      
      // Start dragging
      setIsDragging(true);
      const sp = scrollPositionRef.current;
      setDragStart({ x: e.clientX - sp.x, y: e.clientY - sp.y });
      
      // Prevent default to avoid text selection during drag
      if (isMiddleButton) {
        e.preventDefault();
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const container = scrollContainerRef.current;
    if (container) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      container.scrollLeft = -newX;
      container.scrollTop = -newY;
      scrollPositionRef.current = { x: newX, y: newY };
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (event: React.TouchEvent) => {
    if (mobilePdfMode !== "fixed" || event.touches.length !== 2) return;
    const [first, second] = Array.from(event.touches);
    pinchRef.current = {
      distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
      scale,
    };
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (!pinchRef.current || event.touches.length !== 2) return;
    event.preventDefault();
    const [first, second] = Array.from(event.touches);
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    const next = Math.max(0.5, Math.min(4, pinchRef.current.scale * distance / Math.max(1, pinchRef.current.distance)));
    setZoomMode("custom");
    onZoomModeChange?.("custom");
    onScaleChange?.(next);
  };

  const handleTouchEnd = () => {
    pinchRef.current = null;
  };

  const selectionStatusLabel = useMemo(() => {
    if (textSelectionCapability.analyzedPages === 0) {
      return "Detecting selectable text...";
    }
    if (!textSelectionCapability.hasSelectableText) {
      return "No selectable text layer detected";
    }
    if (textSelectionCapability.currentPageHasSelectableText === false) {
      return "This page has no selectable text";
    }
    return "Text selection available";
  }, [textSelectionCapability]);

  // Track which pages have been rendered
  const renderedPagesRef = useRef<Set<number>>(new Set());
  const pageOffsetsRef = useRef<number[]>([]);
  const offsetsUpdateRafRef = useRef<number | null>(null);
  const shouldVirtualize = (ENABLE_PDF_VIRTUALIZATION && numPages > VIRTUALIZATION_THRESHOLD_PAGES) || effectiveStartPage > 1 || effectiveEndPage < numPages;
  const virtualStartPage = shouldVirtualize ? Math.max(effectiveStartPage, pageNumber - VIRTUAL_WINDOW_PAGES) : effectiveStartPage;
  const virtualEndPage = shouldVirtualize ? Math.min(effectiveEndPage, pageNumber + VIRTUAL_WINDOW_PAGES) : effectiveEndPage;
  const currentScaleEstimate = pageScaleRefs.current[Math.max(0, pageNumber - 1)] ?? scale;
  const estimatedPageHeight = Math.max(400, (fallbackPageSize?.height ?? 1100) * currentScaleEstimate);
  const estimatedPageStride = estimatedPageHeight + PAGE_GAP_PX;
  const topSpacerHeight = shouldVirtualize ? (virtualStartPage - 1) * estimatedPageStride : 0;
  const bottomSpacerHeight = shouldVirtualize ? (numPages - virtualEndPage) * estimatedPageStride : 0;

  const recomputePageOffsets = useCallback(() => {
    if (offsetsUpdateRafRef.current !== null) return;
    offsetsUpdateRafRef.current = requestAnimationFrame(() => {
      offsetsUpdateRafRef.current = null;
      const offsets: number[] = new Array(numPages).fill(0);
      let runningOffset = 0;
      for (let i = 0; i < numPages; i += 1) {
        const el = pageContainerRefs.current[i];
        if (el) {
          runningOffset = el.offsetTop;
          offsets[i] = runningOffset;
        } else if (i > 0) {
          runningOffset = offsets[i - 1] + estimatedPageStride;
          offsets[i] = runningOffset;
        }
      }
      pageOffsetsRef.current = offsets;
    });
  }, [estimatedPageStride, numPages]);
  // Wire the forward ref so PdfPageViewWrapper's onViewportChange can trigger
  // a page-offset recompute (scroll math depends on rendered page sizes).
  recomputePageOffsetsRef.current = recomputePageOffsets;

  // When the virtual window moves, pages outside it unmount via React (the JSX
  // below only renders pages in [virtualStartPage, virtualEndPage]); each
  // PdfPageViewWrapper's own cleanup destroys its PDFPageView. Null out the
  // stale refs here as a safety net so scroll/offset math doesn't read dangling
  // entries before garbage collection reclaims them.
  useEffect(() => {
    if (!shouldVirtualize) return;
    for (let i = 0; i < numPages; i += 1) {
      if (i < virtualStartPage - 1 || i > virtualEndPage - 1) {
        pageContainerRefs.current[i] = null;
        canvasRefs.current[i] = null;
        textLayerRootsRef.current[i] = null;
        pageViewportRefs.current[i] = null;
        pageScaleRefs.current[i] = null;
      }
    }
    notifyTextLayersChange();
  }, [numPages, shouldVirtualize, virtualEndPage, virtualStartPage, notifyTextLayersChange]);

  useEffect(() => {
    if (numPages <= 0) return;
    recomputePageOffsets();
    // Recompute again shortly to catch late layout (fonts, text layer, etc).
    const t = setTimeout(() => recomputePageOffsets(), 150);
    return () => clearTimeout(t);
  }, [numPages]);

  // Sync scroll position
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (container) scrollPositionRef.current = { x: -container.scrollLeft, y: -container.scrollTop };

    // Dismiss selection popup on scroll to prevent floating overlapping menus.
    // The persisted overlay stays — the committed selection survives scrolling.
    if (persistedSelection.popupVisible) {
      hideSelectionPopup();
    }

    if (!container || scrollRafRef.current !== null) return;

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (isProgrammaticScrollRef.current) return;
      markUserScrollOwnership("user-scroll");

      // User scrolled. If we're still trying to restore, don't snap them back later.
      if (restoreState && restoreRequestId !== undefined) {
        userScrolledDuringRestoreRef.current = true;
        if (!userScrollSignaledRef.current) {
          userScrollSignaledRef.current = true;
          onUserScrollDuringRestore?.();
        }
      }

      const scrollTop = container.scrollTop;
      let currentPage = getCurrentPageFromScrollTop(scrollTop);

      if (currentPage !== pageNumber && !suppressAutoScroll) {
        // Check if we're in a restoration protection window
        const now = Date.now();
        const isInRestorationWindow = now < restorationWindowRef.current;
        const restoredPage = restoredPageRef.current;

        // Block backward page changes during restoration window to prevent reset to page 1
        if (isInRestorationWindow && restoredPage !== null && currentPage < restoredPage) {
          // Ignore transient "current page" changes while restoring.
          currentPage = restoredPage;
        } else {
          // Clear restoration tracking if we've moved past the window or forward
          if (!isInRestorationWindow) {
            restoredPageRef.current = null;
          }
          pageUpdateFromScrollRef.current = true;
          onPageChange?.(currentPage);
        }
      }

      let dest: PdfDest | null = null;
      const pageIndex = currentPage - 1;
      const pageEl = pageContainerRefs.current[pageIndex];
      const viewport = pageViewportRefs.current[pageIndex];
      const pageScale = pageScaleRefs.current[pageIndex] ?? scale;
      if (pageEl && viewport) {
        const relativeTop = Math.max(0, scrollTop - pageEl.offsetTop);
        const relativeLeft = Math.max(0, container.scrollLeft);
        const [pdfX, pdfY] = viewport.convertToPdfPoint(relativeLeft, relativeTop);
        dest = {
          kind: "XYZ",
          left: Number.isFinite(pdfX) ? pdfX : null,
          top: Number.isFinite(pdfY) ? pdfY : null,
          zoom: Number.isFinite(pageScale) ? pageScale : null,
        };
      }

      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const scrollPercent = maxScroll > 0 ? (scrollTop / maxScroll) * 100 : 0;
      const scrollLeft = container.scrollLeft;
      onScrollPositionChange?.({
        pageNumber: currentPage,
        scrollTop,
        scrollLeft,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        scrollPercent,
        scale: pageScaleRefs.current[pageIndex] ?? scale,
        dest,
      });

      // Save position on scroll (debounced)
      if (!isRestoringPositionRef.current) {
        const pageEl = pageContainerRefs.current[pageIndex];
        let position: DocumentPosition;
        
        if (pageEl && scrollTop >= pageEl.offsetTop) {
          // Calculate offset within current page (0-1)
          const offset = (scrollTop - pageEl.offsetTop) / pageEl.offsetHeight;
          position = pagePosition(currentPage, Math.min(1, Math.max(0, offset)));
        } else {
          // Use scroll percentage as fallback
          position = createScrollPosition(scrollPercent);
        }
        
        debouncedSavePosition(position);
      }
    });
  };

  return (
    <div
      ref={outerContainerRef}
      className="flex flex-col h-full min-h-0 bg-background"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {readerState.phase === "password-required" && (
        <form
          className="m-4 rounded-lg border border-border bg-card p-4 text-foreground"
          onSubmit={(event) => {
            event.preventDefault();
            if (!passwordValue || !passwordSubmitRef.current) return;
            setReaderState((state) => reducePdfReaderState(state, { type: "OPEN" }));
            passwordSubmitRef.current(passwordValue);
            setPasswordValue("");
          }}
        >
          <p className="font-medium">
            {readerState.incorrectPassword ? "That password did not unlock the PDF." : "This PDF is password protected."}
          </p>
          <div className="mt-3 flex gap-2">
            <input
              autoFocus
              type="password"
              autoComplete="off"
              value={passwordValue}
              onChange={(event) => setPasswordValue(event.target.value)}
              aria-label="PDF password"
              className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3"
            />
            <button type="submit" className="min-h-11 rounded-md bg-primary px-4 text-primary-foreground">
              Unlock
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive text-destructive rounded-lg m-4">
          <p className="font-medium">{pdfErrorUserMessage(error)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pdfRecoveryActionsFor(error, { hasSyncedFile: Boolean(doc?.fileId), hasLocalFile: Boolean(doc?.filePath) }).includes("retry") && (
              <button
                type="button"
                className="min-h-11 rounded-md border border-destructive/40 px-4 text-sm font-medium"
                onClick={() => setRetryNonce((value) => value + 1)}
              >
                Try again
              </button>
            )}
            {doc?.filePath && pdfRecoveryActionsFor(error, { hasSyncedFile: Boolean(doc.fileId), hasLocalFile: true }).includes("open-original") && (
              <button
                type="button"
                className="min-h-11 rounded-md border border-destructive/40 px-4 text-sm"
                onClick={() => void import("@tauri-apps/plugin-opener").then(({ openPath }) => openPath(doc.filePath))}
              >
                Open original
              </button>
            )}
            {pdfRecoveryActionsFor(error, { hasSyncedFile: Boolean(doc?.fileId), hasLocalFile: Boolean(doc?.filePath) }).includes("copy-diagnostics") && <button
              type="button"
              className="min-h-11 rounded-md border border-destructive/40 px-4 text-sm"
              onClick={() => void navigator.clipboard?.writeText(diagnosticsRef.current.toSafeText())}
            >
              Copy diagnostics
            </button>}
          </div>
          {doc && pdfRecoveryActionsFor(error, { hasSyncedFile: Boolean(doc.fileId), hasLocalFile: Boolean(doc.filePath) }).includes("download") && <ReaderFileDownload doc={doc} />}
          {pdfRecoveryActionsFor(error, { hasSyncedFile: Boolean(doc?.fileId), hasLocalFile: Boolean(doc?.filePath) }).includes("locate") && (
            <p className="mt-2 text-sm">Re-import or locate the original PDF from the document menu.</p>
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">
        {/* Table of Contents Sidebar - Overlay on mobile, inline on desktop */}
        {showTOC && (
          <>
            {/* Mobile overlay backdrop */}
            <div
              className="md:hidden fixed inset-0 bg-black/50 z-40"
              onClick={() => setShowTOC(false)}
            />
            {/* TOC Panel */}
            <div className="fixed md:relative inset-y-0 left-0 md:left-auto w-[280px] md:w-64 border-r border-border bg-card overflow-y-auto flex-shrink-0 z-50">
              <div className="p-3 md:p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-foreground text-sm md:text-base">Table of Contents</h3>
                <button
                  onClick={() => setShowTOC(false)}
                  className="p-2 hover:bg-muted rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
              <nav className="p-2">
                {outline.length > 0 ? (
                  renderOutline(outline)
                ) : (
                  <p className="text-sm text-muted-foreground px-3 py-2">
                    No table of contents available
                  </p>
                )}
              </nav>
            </div>
          </>
        )}

        {/* Main Viewer Area */}
        <div className="flex-1 flex flex-col">
          {/* Viewer Toolbar */}
          <div className={cn(
            "pdf-reader-toolbar flex items-center justify-between p-1 md:p-2 border-b border-border bg-card gap-2 overflow-x-auto transition-all duration-200",
            isPhone && !mobileChromeVisible && "pointer-events-none absolute inset-x-0 top-0 z-30 -translate-y-full opacity-0",
          )}>
            <div className="flex flex-shrink-0 items-center gap-0.5 md:gap-1">
              {isPhone && reflowDocument && (
                <button
                  type="button"
                  className="min-h-11 rounded-md border border-border px-3 text-xs font-medium"
                  onClick={() => {
                    modeOverriddenRef.current = true;
                    setMobilePdfMode((mode) => {
                      const next = mode === "fixed" ? "reflow" : "fixed";
                      updateMobilePreferences({ preferredMobileMode: next });
                      return next;
                    });
                  }}
                >
                  {mobilePdfMode === "fixed" ? "Reflow" : "Original"}
                </button>
              )}
              {isPhone && (
                <button
                  type="button"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground"
                  onClick={() => setShowMobileSettings(true)}
                  aria-label="PDF reading settings"
                >
                  <SlidersHorizontal className="h-5 w-5" />
                </button>
              )}
              <button
                onClick={() => setShowTOC(!showTOC)}
                className={cn(
                  "p-2 rounded-md transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center",
                  showTOC ? "bg-muted text-foreground" : "hover:bg-muted text-muted-foreground"
                )}
                title={t("viewer.toggleToc")}
              >
                <List className="w-4 h-4 md:w-4 md:h-4" />
              </button>

              <button
                onClick={() => {
                  if (ocr.flowState === "idle") ocr.enterOcrMode();
                  else ocr.exitOcrMode();
                }}
                className={cn(
                  "p-2 rounded-md transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center",
                  ocr.flowState !== "idle" ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400" : "hover:bg-muted text-muted-foreground"
                )}
                title="OCR Select (Ctrl+Shift+O)"
              >
                <Scan className="w-4 h-4 md:w-4 md:h-4" />
              </button>

              <div className="hidden md:block h-6 w-px bg-border mx-2" />

              <button
                onClick={handlePrevPage}
                disabled={pageNumber <= effectiveStartPage}
                className="p-2 rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[36px] min-h-[36px] flex items-center justify-center"
                title={t("viewer.previousPage")}
              >
                <CaretLeft className="w-4 h-4" />
              </button>

              <PdfPageIndicator
                inputRef={pageInputRef}
                pageNumber={pageNumber}
                numPages={numPages}
                effectiveStartPage={effectiveStartPage}
                effectiveEndPage={effectiveEndPage}
                totalEffectivePages={totalEffectivePages}
                isChunked={metadata?.chunkIndex !== undefined}
                onJump={handleGoToPage}
              />

              <button
                onClick={handleNextPage}
                disabled={pageNumber >= effectiveEndPage}
                className="p-2 rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[36px] min-h-[36px] flex items-center justify-center"
                title={t("viewer.nextPage")}
              >
                <CaretRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-shrink-0 items-center gap-0.5 md:gap-1">
              {/* Zoom Mode Buttons - Hide some on mobile */}
              <button
                onClick={() => handleZoomModeChange("fit-page")}
                className={cn(
                  "hidden md:flex p-2 rounded-md transition-colors min-w-[36px] min-h-[36px] items-center justify-center",
                  zoomMode === "fit-page" ? "bg-muted text-foreground" : "hover:bg-muted text-muted-foreground"
                )}
                title={t("viewer.fitToPage")}
              >
                <CornersOut className="w-4 h-4" />
              </button>

              <button
                onClick={() => handleZoomModeChange("fit-width")}
                className={cn(
                  "p-2 rounded-md transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center",
                  zoomMode === "fit-width" ? "bg-muted text-foreground" : "hover:bg-muted text-muted-foreground"
                )}
                title={t("viewer.fitToWidth")}
              >
                <CornersIn className="w-4 h-4" />
              </button>

              <div className="h-6 w-px bg-border mx-2" />

              <button
                ref={zoomButtonRef}
                onClick={() => handleZoomModeChange("custom")}
                className={cn(
                  "p-2 rounded-md transition-colors",
                  zoomMode === "custom" ? "bg-muted text-foreground" : "hover:bg-muted text-muted-foreground"
                )}
                title={t("viewer.customZoom")}
              >
                <span className="text-xs font-medium">
                  {Math.round(scale * 100)}%
                </span>
              </button>
            </div>
          </div>

          {/* Canvas Container */}
          <ReaderTapZones
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
            onToggleChrome={() => setMobileChromeVisible((v) => !v)}
            className="flex-1 min-h-0 flex flex-col"
          >
          <div
            ref={scrollContainerRef}
            onScroll={mobilePdfMode === "reflow" ? handleReflowScroll : handleScroll}
            className={cn(
              "flex-1 min-h-0 overflow-auto",
              mobilePdfMode === "fixed" ? "bg-muted/30 p-4 [contain:strict]" : "bg-background px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5",
              isDragging && "cursor-grabbing",
              !isDragging && ocr.flowState === "idle" && (scale > 1 || zoomMode === "custom") && "cursor-grab",
              ocr.flowState !== "idle" && !isDragging && "cursor-crosshair"
            )}
            onMouseDown={mobilePdfMode === "fixed" ? handleMouseDown : undefined}
            onMouseMove={mobilePdfMode === "fixed" ? handleMouseMove : undefined}
            onMouseUp={mobilePdfMode === "fixed" ? handleMouseUp : handleReflowSelection}
            onMouseLeave={mobilePdfMode === "fixed" ? handleMouseLeave : undefined}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            data-document-scroll-container
            onClick={handleMobileSurfaceClick}
          >
            {mobilePdfMode === "reflow" && reflowDocument ? (
              <div
                className="pdf-mobile-reflow mx-auto w-full max-w-[42rem]"
                dir={mobilePreferences.reflowDirection}
                data-image-scaling={mobilePreferences.reflowImageScaling}
                data-reader-theme={mobilePreferences.reflowTheme}
                style={{
                  paddingInline: `${mobilePreferences.reflowMargin}px`,
                  colorScheme: mobilePreferences.reflowTheme === "system" ? undefined : mobilePreferences.reflowTheme,
                  backgroundColor: mobilePreferences.reflowTheme === "light" ? "#fffdf8" : mobilePreferences.reflowTheme === "dark" ? "#171717" : undefined,
                  color: mobilePreferences.reflowTheme === "light" ? "#24211d" : mobilePreferences.reflowTheme === "dark" ? "#f3f0e8" : undefined,
                  "--pdf-reflow-font-size": `${mobilePreferences.reflowFontSize}px`,
                  "--pdf-reflow-line-height": mobilePreferences.reflowLineHeight,
                  "--pdf-reflow-font-family": mobilePreferences.reflowFontFamily === "serif"
                    ? "Georgia, 'Times New Roman', serif"
                    : mobilePreferences.reflowFontFamily === "monospace"
                      ? "ui-monospace, SFMono-Regular, monospace"
                      : "ui-sans-serif, system-ui, sans-serif",
                } as CSSProperties}
              >
                <PdfReflowRenderer
                  pages={Object.values(reflowDocument.pages).sort((a, b) => a.pageNumber - b.pageNumber)}
                  onViewOriginal={handleViewOriginalBlock}
                  onRequestOcr={(page) => void handleRequestPageOcr(page)}
                  highlights={persistedHighlights}
                  activeSearchBlockId={reflowSearchBlockId}
                />
                {pageOcrUpdate && pageOcrUpdate.state !== "ready" && (
                  <div className="sticky bottom-3 mt-4 rounded-xl border border-border bg-card/95 p-3 text-sm shadow-lg backdrop-blur" role="status">
                    <div className="flex items-center justify-between gap-3">
                      <span>{pageOcrUpdate.message ?? `Recognizing page ${pageOcrUpdate.pageNumber}`}</span>
                      {(pageOcrUpdate.state === "queued" || pageOcrUpdate.state === "processing") && (
                        <button type="button" className="min-h-11 px-3" onClick={() => { reflowOcrRef.current.cancel(); setPageOcrUpdate({ ...pageOcrUpdate, state: "cancelled" }); }}>Cancel</button>
                      )}
                    </div>
                    <progress className="mt-2 w-full" max="100" value={pageOcrUpdate.progress} />
                  </div>
                )}
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-muted-foreground">{t("viewer.loadingPdf")}</div>
              </div>
            ) : (
              <div className="mx-auto flex flex-col items-center gap-6 w-full">
                {shouldVirtualize && topSpacerHeight > 0 && (
                  <div
                    aria-hidden="true"
                    style={{ height: `${Math.max(0, Math.round(topSpacerHeight))}px` }}
                    className="w-full"
                  />
                )}
                {Array.from({ length: Math.max(0, virtualEndPage - virtualStartPage + 1) }, (_, offset) => {
                  const pageNum = virtualStartPage + offset;
                  const index = pageNum - 1;
                  return (
                    <PdfPageViewWrapper
                      key={pageNum}
                      pdf={pdf}
                      pageIndex={index}
                      scale={pageScales[index] ?? scale}
                      eventBus={eventBusRef.current!}
                      highlights={getHighlightsForPage(pageNum)}
                      selectionPdfRects={selectionPdfRectsByPage?.get(pageNum) ?? null}
                      ocrActive={ocr.flowState !== "idle" && pageNum === pageNumber}
                      onTextLayerReady={handleTextLayerReady}
                      onViewportChange={handleViewportChange}
                      onSlotRef={handleSlotRef}
                      onCanvasRef={handleCanvasRef}
                      onTextSelectionAvailability={setPageTextSelectionAvailability}
                      style={
                        fallbackPageSize
                          ? {
                              minWidth: `${Math.round(fallbackPageSize.width)}px`,
                              minHeight: `${Math.round(fallbackPageSize.height)}px`,
                            }
                          : undefined
                      }
                    >
                      {/* OCR region selection and overlays - only on current page */}
                      {ocr.flowState !== "idle" && pageNum === pageNumber && (
                        <>
                          {ocr.flowState === "selecting" && (
                            <OcrRegionSelector
                              canvasRef={{ current: canvasRefs.current[index] }}
                              isActive={true}
                              onRegionSelected={(rect) => {
                                const canvas = canvasRefs.current[index];
                                if (canvas) ocr.handleRegionSelected(rect, canvas);
                              }}
                              onCancel={ocr.exitOcrMode}
                            />
                          )}
                          {(ocr.flowState === "processing" || ocr.flowState === "previewing" || ocr.flowState === "error") && ocr.selectedRect && (() => {
                            const canvas = canvasRefs.current[index];
                            if (!canvas) return null;
                            const cssScale = canvas.getBoundingClientRect().width / canvas.width;
                            return (
                              <>
                                {ocr.flowState === "processing" && (
                                  <OcrProgressOverlay
                                    selectionRect={ocr.selectedRect}
                                    cssScale={cssScale}
                                    progress={0}
                                    status="Processing..."
                                  />
                                )}
                                {(ocr.flowState === "previewing" || ocr.flowState === "error") && (
                                  <OcrTextPreview
                                    ocrResult={ocr.ocrResult}
                                    editedText={ocr.editedText}
                                    language={ocr.language}
                                    isLoading={false}
                                    error={ocr.error}
                                    selectionRect={ocr.selectedRect}
                                    cssScale={cssScale}
                                    canvasRect={canvas.getBoundingClientRect()}
                                    onTextChange={ocr.setEditedText}
                                    onLanguageChange={ocr.setLanguage}
                                    onCreateExtract={() => {
                                      const text = ocr.editedText.trim();
                                      if (text && onOcrExtractText) {
                                        onOcrExtractText(text, pageNumber);
                                        ocr.exitOcrMode();
                                      }
                                    }}
                                    onRetry={() => ocr.retryOcr()}
                                    onCancel={ocr.exitOcrMode}
                                  />
                                )}
                              </>
                            );
                          })()}
                        </>
                      )}
                    </PdfPageViewWrapper>
                  );
                })}
                {shouldVirtualize && bottomSpacerHeight > 0 && (
                  <div
                    aria-hidden="true"
                    style={{ height: `${Math.max(0, Math.round(bottomSpacerHeight))}px` }}
                    className="w-full"
                  />
                )}
              </div>
            )}
          </div>
          </ReaderTapZones>

          {showMobileSettings && isPhone && (
            <div className="fixed inset-0 z-[80] flex items-end bg-black/45" onClick={() => setShowMobileSettings(false)}>
              <div
                className="w-full rounded-t-2xl bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-foreground shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="PDF reading settings"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-semibold">Reading settings</h2>
                  <button type="button" className="flex min-h-11 min-w-11 items-center justify-center" onClick={() => setShowMobileSettings(false)} aria-label="Close settings">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <label className="mb-4 block text-sm">
                  Text size <span className="float-right tabular-nums">{mobilePreferences.reflowFontSize}px</span>
                  <input className="mt-2 w-full" type="range" min="15" max="30" value={mobilePreferences.reflowFontSize} onChange={(event) => updateMobilePreferences({ reflowFontSize: Number(event.target.value) })} />
                </label>
                <label className="mb-4 block text-sm">
                  Line spacing <span className="float-right tabular-nums">{mobilePreferences.reflowLineHeight.toFixed(2)}</span>
                  <input className="mt-2 w-full" type="range" min="1.3" max="2.2" step="0.05" value={mobilePreferences.reflowLineHeight} onChange={(event) => updateMobilePreferences({ reflowLineHeight: Number(event.target.value) })} />
                </label>
                <label className="mb-4 block text-sm">
                  Page margins <span className="float-right tabular-nums">{mobilePreferences.reflowMargin}px</span>
                  <input className="mt-2 w-full" type="range" min="0" max="36" value={mobilePreferences.reflowMargin} onChange={(event) => updateMobilePreferences({ reflowMargin: Number(event.target.value) })} />
                </label>
                <div className="mb-4 grid grid-cols-3 gap-2" aria-label="Font family">
                  {(["serif", "sans-serif", "monospace"] as const).map((font) => (
                    <button key={font} type="button" className={cn("min-h-11 rounded-md border px-2 text-sm", mobilePreferences.reflowFontFamily === font && "border-primary bg-primary/10")} onClick={() => updateMobilePreferences({ reflowFontFamily: font })}>{font}</button>
                  ))}
                </div>
                <div className="mb-4 grid grid-cols-3 gap-2" aria-label="Text direction">
                  {(["auto", "ltr", "rtl"] as const).map((direction) => (
                    <button key={direction} type="button" className={cn("min-h-11 rounded-md border px-2 uppercase", mobilePreferences.reflowDirection === direction && "border-primary bg-primary/10")} onClick={() => updateMobilePreferences({ reflowDirection: direction })}>{direction}</button>
                  ))}
                </div>
                <div className="mb-4 grid grid-cols-3 gap-2" aria-label="Reader theme">
                  {(["system", "light", "dark"] as const).map((theme) => (
                    <button key={theme} type="button" className={cn("min-h-11 rounded-md border px-2", mobilePreferences.reflowTheme === theme && "border-primary bg-primary/10")} onClick={() => updateMobilePreferences({ reflowTheme: theme })}>{theme}</button>
                  ))}
                </div>
                <div className="mb-4 grid grid-cols-3 gap-2" aria-label="Image scaling">
                  {(["fit", "original", "hide"] as const).map((imageScaling) => (
                    <button key={imageScaling} type="button" className={cn("min-h-11 rounded-md border px-2", mobilePreferences.reflowImageScaling === imageScaling && "border-primary bg-primary/10")} onClick={() => updateMobilePreferences({ reflowImageScaling: imageScaling })}>{imageScaling}</button>
                  ))}
                </div>
                <div className="mb-4 grid grid-cols-2 gap-2" aria-label="Original page layout">
                  {(["fit-width", "fit-page", "crop", "columns"] as const).map((mode) => (
                    <button key={mode} type="button" className={cn("min-h-11 rounded-md border px-2 text-sm", mobilePreferences.fixedMobileMode === mode && "border-primary bg-primary/10")} onClick={() => applyFixedMobileMode(mode)}>{mode.replace("-", " ")}</button>
                  ))}
                </div>
                {mobilePreferences.fixedMobileMode === "columns" && (
                  <label className="mb-4 block text-sm">
                    Document columns
                    <select className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3" value={mobilePreferences.fixedColumns} onChange={(event) => updateMobilePreferences({ fixedColumns: Number(event.target.value) })}>
                      <option value={1}>1 column</option>
                      <option value={2}>2 columns</option>
                      <option value={3}>3 columns</option>
                    </select>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(["ltr", "rtl"] as const).map((direction) => <button key={direction} type="button" className={cn("min-h-11 rounded-md border uppercase", mobilePreferences.fixedColumnDirection === direction && "border-primary bg-primary/10")} onClick={() => updateMobilePreferences({ fixedColumnDirection: direction })}>{direction}</button>)}
                    </div>
                    <span className="mt-3 block">Panel overlap {Math.round(mobilePreferences.fixedColumnOverlap * 100)}%</span>
                    <input className="mt-1 w-full" type="range" min="0" max="0.25" step="0.01" value={mobilePreferences.fixedColumnOverlap} onChange={(event) => updateMobilePreferences({ fixedColumnOverlap: Number(event.target.value) })} />
                  </label>
                )}
                <button
                  type="button"
                  className="min-h-11 w-full rounded-md border border-border text-sm font-medium"
                  onClick={() => updateSettingsCategory("documents", { pdfSettings: { ...pdfSettings, ...mobilePreferences } })}
                >
                  Use these defaults for new PDFs
                </button>
              </div>
            </div>
          )}

          {/* Page Navigation Footer */}
          {numPages > 0 && !isLoading && (!isPhone || mobileChromeVisible) && (
            <div className="flex items-center justify-center gap-4 p-3 border-t border-border bg-card text-xs text-muted-foreground">
              <span>Use arrow keys to navigate</span>
              <span>•</span>
              <span>{selectionStatusLabel}</span>
              <span>•</span>
              <button
                onClick={() => setShowTOC(!showTOC)}
                className="hover:text-foreground transition-colors"
              >
                Toggle TOC
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Selection Popup - Floating context menu for text selection. Wrapped so
          mousedowns on the popup can be distinguished from clicks outside any
          PDF page (which clear the persisted selection). */}
      <div ref={selectionPopupHostRef}>
        <SelectionPopup
          visible={persistedSelection.popupVisible}
          selectionRect={persistedSelection.popupRect}
          selectedText={persistedSelection.selectedText}
          onHighlight={handleHighlight}
          onHighlightWithDialog={handleHighlightWithDialog}
          onCopy={handleCopy}
          onAddNote={handleAddNote}
          onDismiss={handlePopupDismiss}
        />
      </div>
    </div>
  );
}
