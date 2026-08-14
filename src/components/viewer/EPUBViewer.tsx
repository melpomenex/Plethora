import { useEffect, useRef, useState, useCallback, type MouseEvent } from "react";
import type { EpubSelectionContext, SelectionContext } from "../../types/selection";
import type { DocumentMetadata, Document } from "../../types/document";
import ePub from "epubjs";
import { cn } from "../../utils";
import { useTheme } from "../../contexts/ThemeContext";
import { useSettingsStore } from "../../stores/settingsStore";
import { useVimModeStore } from "../../stores/vimModeStore";
import { useMobileShell } from "../../hooks/useMobileShell";
import { getDocumentAuto, updateDocumentProgressAuto } from "../../api/documents";
import { saveDocumentPosition, cfiPosition } from "../../api/position";
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Gear,
  List,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { normalizeHighlightColor } from "../../utils/highlightColors";
import { useDocumentOutlineStore } from "../../stores/documentOutlineStore";
import { buildSegmentCfiMap, findActiveSegment, type SyncSegment } from "../../utils/epubSync";
import { dispatchCommandPaletteOpen, isCommandPaletteOpenShortcut } from "../../utils/commandPaletteShortcut";
import { getShortcutCombo, eventMatchesCombo } from "../common/KeyboardShortcuts";
import { tolerantPhraseRegex, collectSectionCfiMatches } from "../../utils/epubQuoteSearch";
import { ReaderFileDownload } from "../sync/ReaderFileDownload";
import { handleVolumeRockerNavigation } from "../../utils/volumeRockerNavigation";
import type { EpubVimRuntime } from "../../utils/vim/readerRuntimes";

// Define outside component to keep a stable reference across renders
const FONT_FAMILY_MAP: Record<string, string> = {
  serif: "\"Iowan Old Style\", \"Charter\", \"Source Serif 4\", \"Palatino Linotype\", Palatino, Georgia, \"Times New Roman\", serif",
  "sans-serif": "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  monospace: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

function findEpubTextPoint(element: Element, requestedOffset: number): { node: Text; offset: number } {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, requestedOffset);
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    last = node;
    const length = node.data.length;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    node = walker.nextNode() as Text | null;
  }
  if (last) return { node: last, offset: last.data.length };
  const fallback = element.ownerDocument.createTextNode("");
  element.appendChild(fallback);
  return { node: fallback, offset: 0 };
}

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreQuoteCandidate(candidateText: string, quote: string): number {
  const candidate = normalizeSearchText(candidateText);
  const normalizedQuote = normalizeSearchText(quote);
  if (!candidate || !normalizedQuote) return 0;
  if (candidate.includes(normalizedQuote) || normalizedQuote.includes(candidate)) return 1000;

  const quoteWords = Array.from(new Set(normalizedQuote.split(/\s+/).filter((word) => word.length >= 4)));
  if (quoteWords.length === 0) return 0;

  return quoteWords.reduce((score, word) => score + (candidate.includes(word) ? 1 : 0), 0);
}

function chooseSearchResultIndex(results: any[], fallbackIndex?: number | null, quote?: string): number {
  if (results.length === 0) return -1;

  const normalizedFallback =
    typeof fallbackIndex === "number" && Number.isFinite(fallbackIndex)
      ? ((Math.trunc(fallbackIndex) % results.length) + results.length) % results.length
      : 0;

  if (!quote?.trim()) return normalizedFallback;

  let bestIndex = normalizedFallback;
  let bestScore = 0;
  results.forEach((result, index) => {
    const candidateText = [
      result?.excerpt,
      result?.text,
      result?.chapter?.label,
      result?.href,
    ]
      .filter((value) => typeof value === "string")
      .join(" ");
    const score = scoreQuoteCandidate(candidateText, quote);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

const resolveSpineIndex = (book: any, href: string): number | null => {
  if (!book || !book.spine) return null;
  const normalizeHref = (value: string) =>
    value.replace(/^\.?\//, "").split("#")[0];
  const normalizedPath = normalizeHref(href);
  const spine = book.spine;
  const spineItem = spine.get ? spine.get(normalizedPath) : null;
  if (spineItem && typeof spineItem.index === 'number') {
    return spineItem.index;
  }
  if (spine.items) {
    for (const item of spine.items) {
      const itemHref = normalizeHref(item.href || "");
      if (itemHref === normalizedPath || itemHref?.endsWith?.(normalizedPath)) {
        if (typeof item.index === 'number') return item.index;
      }
    }
  }
  return null;
};

const filterTocItems = (items: any[], book: any, start: number | undefined, end: number | undefined): any[] => {
  if (start === undefined && end === undefined) return items;
  
  return items
    .map(item => {
      const filteredSubitems = item.subitems ? filterTocItems(item.subitems, book, start, end) : undefined;
      
      const itemIndex = resolveSpineIndex(book, item.href);
      let isVisible = true;
      
      if (itemIndex !== null) {
        if (start !== undefined && itemIndex < start) isVisible = false;
        if (end !== undefined && itemIndex > end) isVisible = false;
      } else if (filteredSubitems && filteredSubitems.length > 0) {
        isVisible = true;
      } else {
        isVisible = false;
      }
      
      if (isVisible) {
        return {
          ...item,
          subitems: filteredSubitems,
        };
      }
      return null;
    })
    .filter(Boolean) as any[];
};

interface EPUBViewerProps {
  fileData?: Uint8Array | null;
  fileUrl?: string | null;
  fileName: string;
  documentId?: string;
  /** Full document, for offering a download when the local file is missing
   *  (e.g. a synced EPUB whose bytes haven't transferred yet). Optional. */
  doc?: Document;
  onLoad?: (toc: any[]) => void;
  onSelectionChange?: (text: string, context?: SelectionContext | null) => void;
  /** Callback when user right-clicks on selected text */
  onContextMenu?: (event: { x: number; y: number; selectedText: string; selectionContext?: SelectionContext | null }) => void;
  onContextTextChange?: (text: string) => void;
  initialCfi?: string;
  initialSearchMatchIndex?: number;
  initialSearchTextQuote?: string;
  highlightQuery?: string;
  searchQuery?: string;
  searchMatchIndex?: number | null;
  onSearchResultsChange?: (results: {
    query: string;
    total: number;
    activeIndex: number;
    activeCfi: string | null;
  }) => void;
  onProgressChange?: (progressPercent: number) => void;
  persistedHighlights?: Array<{ id: string; cfiRange: string; color?: string | null; text: string }>;
  /** Increment to trigger rendition.next() for TTS chapter auto-advance */
  advanceChapterSignal?: number;
  /** Transcript segments for audiobook sync */
  syncSegments?: SyncSegment[];
  /** Current audio playback time in seconds */
  syncCurrentTime?: number;
  /** Callback when sync state changes */
  onSyncStateChange?: (state: { status: "idle" | "building" | "ready" | "error"; mappedCount: number; totalSegments: number }) => void;
  /** Increment to force sync highlight + scroll to current audio position */
  syncJumpSignal?: number;
  metadata?: DocumentMetadata;
  onIframeWindowReady?: (iframeWindow: Window) => void;
  onBack?: () => void;
  embedded?: boolean;
  onVimRuntimeChange?: (runtime: EpubVimRuntime | null) => void;
}

export function EPUBViewer({
  fileData,
  fileUrl,
  fileName,
  documentId,
  doc,
  onLoad,
  onSelectionChange,
  onContextMenu,
  onContextTextChange,
  initialCfi,
  initialSearchMatchIndex,
  initialSearchTextQuote,
  highlightQuery,
  searchQuery,
  searchMatchIndex,
  onSearchResultsChange,
  onProgressChange,
  persistedHighlights = [],
  advanceChapterSignal,
  syncSegments,
  syncCurrentTime,
  onSyncStateChange,
  syncJumpSignal,
  metadata,
  onIframeWindowReady,
  onBack,
  embedded = false,
  onVimRuntimeChange,
}: EPUBViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rendition, setRendition] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const [toc, setToc] = useState<any[]>([]);
  const tocRef = useRef<any[]>([]);
  const [showFontSizeControl, setShowFontSizeControl] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [showTocDrawer, setShowTocDrawer] = useState(false);
  const [showDesktopToc, setShowDesktopToc] = useState(true);
  const [containerHasSize, setContainerHasSize] = useState(false);

  useEffect(() => {
    if (!embedded) return;
    const openToc = () => setShowTocDrawer(true);
    const openSettings = () => setShowSettingsSheet(true);
    window.addEventListener("incrementum-epub-open-toc", openToc);
    window.addEventListener("incrementum-epub-open-settings", openSettings);
    return () => {
      window.removeEventListener("incrementum-epub-open-toc", openToc);
      window.removeEventListener("incrementum-epub-open-settings", openSettings);
    };
  }, [embedded]);

  // ResizeObserver to track container visibility/dimensions
  useEffect(() => {
    if (!viewerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerHasSize(true);
        }
      }
    });
    observer.observe(viewerRef.current);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleOpenToc = () => {
      setShowTocDrawer(true);
    };
    const handleOpenSettings = () => {
      setShowSettingsSheet(true);
    };

    window.addEventListener("open-epub-toc", handleOpenToc);
    window.addEventListener("open-epub-settings", handleOpenSettings);

    return () => {
      window.removeEventListener("open-epub-toc", handleOpenToc);
      window.removeEventListener("open-epub-settings", handleOpenSettings);
    };
  }, []);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentChapter, setCurrentChapter] = useState("");
  const selectionActiveRef = useRef(false);
  const lastEpubSelectionContextRef = useRef<EpubSelectionContext | null>(null);
  const initialDisplayCompleteRef = useRef(false);
  // Tracks recent user interaction (touch/scroll/wheel). While active, the
  // ResizeObserver must NOT trigger rendition.resize(): epub.js re-displays
  // this.location.start.cfi on resize, which in continuous-scrolled mode snaps
  // the view back to the start of the section the user navigated to (e.g. a
  // TOC jump) instead of staying at their current scroll position. Mobile
  // browsers fire viewport resizes constantly (address bar show/hide, keyboard),
  // so without this guard every such resize yanks the reader back.
  const interactingRef = useRef(false);
  const interactingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSearchHighlightsRef = useRef<string[]>([]);
  const liveSearchHighlightsRef = useRef<string[]>([]);
  const liveSearchResultsRef = useRef<string[]>([]);
  const liveSearchVersionRef = useRef(0);
  const activeLiveSearchCfiRef = useRef<string | null>(null);
  const activePersistedHighlightsRef = useRef<string[]>([]);
  const handleEPUBKeyDownRef = useRef<any>(null);

  // Sync state
  const syncSegmentsRef = useRef<SyncSegment[]>([]);
  const syncMapRef = useRef<Map<number, string>>(new Map());
  const syncCurrentChapterRef = useRef<string | null>(null);
  const activeSyncHighlightRef = useRef<string | null>(null);
  const syncNavigatingRef = useRef(false);

  const { theme } = useTheme();
  const themeRef = useRef(theme);
  const { t } = useI18n();
  const { settings, updateSettings } = useSettingsStore();
  const isMobile = useMobileShell();
  const epubSettings = settings.documents.epubSettings;
  const fontSizeRef = useRef(epubSettings.fontSize);
  const fontFamilyRef = useRef(epubSettings.fontFamily);
  const lineHeightRef = useRef(epubSettings.lineHeight);

  // Use refs for callback props so the main loading effect doesn't re-run when they change
  const onContextTextChangeRef = useRef(onContextTextChange);
  onContextTextChangeRef.current = onContextTextChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onContextMenuRef = useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;
  const onProgressChangeRef = useRef(onProgressChange);
  onProgressChangeRef.current = onProgressChange;
  const onSearchResultsChangeRef = useRef(onSearchResultsChange);
  onSearchResultsChangeRef.current = onSearchResultsChange;
  const onIframeWindowReadyRef = useRef(onIframeWindowReady);
  onIframeWindowReadyRef.current = onIframeWindowReady;
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  // Keep fontSizeRef in sync with fontSize
  useEffect(() => {
    fontSizeRef.current = epubSettings.fontSize;
    fontFamilyRef.current = epubSettings.fontFamily;
    lineHeightRef.current = epubSettings.lineHeight;
  }, [epubSettings.fontSize, epubSettings.fontFamily, epubSettings.lineHeight]);

  const saveReadingPosition = useCallback(async (cfi: string) => {
    if (!documentId || !cfi) return;

    // Always save to localStorage first (works in both Tauri and web mode)
    localStorage.setItem(`epub-position-${documentId}`, cfi);

    // Then try to save to backend (may fail in web mode if endpoint doesn't exist)
    try {
      await updateDocumentProgressAuto(documentId, null, null, cfi);
    } catch (error) {
      // Fail gracefully - localStorage already has the position saved
      console.warn("EPUBViewer: Failed to save position to backend (localStorage saved):", error);
    }

    // Also save unified position
    try {
      await saveDocumentPosition(documentId, cfiPosition(cfi));
    } catch (error) {
      console.warn("EPUBViewer: Failed to save unified position:", error);
    }
  }, [documentId]);

  const loadReadingPosition = useCallback(async (): Promise<string | null> => {
    if (!documentId) return null;

    // First check localStorage (always available, fast)
    const localCfi = localStorage.getItem(`epub-position-${documentId}`);

    try {
      const doc = await getDocumentAuto(documentId);
      const remoteCfi = doc?.current_cfi || doc?.currentCfi;

      // Prefer remote if available and newer, otherwise use local
      if (remoteCfi) {
        return remoteCfi;
      }
      if (localCfi) {
        return localCfi;
      }
    } catch {
      // API failed - use localStorage as fallback
      console.warn("EPUBViewer: Failed to load position from backend, using localStorage");
      if (localCfi) {
        return localCfi;
      }
    }
    return null;
  }, [documentId]);

  const loadReadingPositionRef = useRef(loadReadingPosition);
  loadReadingPositionRef.current = loadReadingPosition;
  const saveReadingPositionRef = useRef(saveReadingPosition);
  saveReadingPositionRef.current = saveReadingPosition;
  const initialCfiRef = useRef(initialCfi);
  initialCfiRef.current = initialCfi;
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  const updateEpubSettings = useCallback((updates: Partial<typeof epubSettings>) => {
    updateSettings({
      documents: {
        ...settings.documents,
        epubSettings: { ...settings.documents.epubSettings, ...updates },
      },
    });
  }, [settings.documents, updateSettings]);

  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;

  const applyContentOverrides = useCallback((contents: any) => {
    const textColor = themeRef.current.colors.onBackground || themeRef.current.colors.text;
    const rawBgColor = themeRef.current.colors.background;
    const fontFamily = FONT_FAMILY_MAP[fontFamilyRef.current] || FONT_FAMILY_MAP.serif;
    const contentPadding = isMobileRef.current ? "1.25rem 1rem 4.5rem" : "2rem 3rem";
    const contentMaxWidth = isMobileRef.current ? "40rem" : "100%";
    const contentMargin = isMobileRef.current ? "0 auto" : "0";

    const isTransparentTheme = rawBgColor === "transparent" || !rawBgColor;
    
    const makeColorOpaque = (colorStr: string, fallback: string): string => {
      const trimmed = colorStr.trim();
      if (trimmed.startsWith("rgba(")) {
        const match = trimmed.match(/rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (match) {
          return `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
        }
      }
      return trimmed === "transparent" ? fallback : trimmed;
    };

    // For transparent/glass themes, use a dark opaque background inside the iframe
    // to ensure text readability. The host-side frosted glass provides the visual effect.
    const bgColor = isTransparentTheme
      ? makeColorOpaque(themeRef.current.colors.toolbar || themeRef.current.colors.surface || "rgba(15, 23, 42, 0.55)", "rgb(15, 23, 42)")
      : rawBgColor;

    const existing = contents.document.getElementById("epub-override-styles");
    if (existing) {
      existing.remove();
    }

    const style = contents.document.createElement("style");
    style.id = "epub-override-styles";
    style.textContent = `
      * {
        box-sizing: border-box !important;
        font-family: ${fontFamily} !important;
      }
      html {
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        height: auto !important;
        min-height: 100% !important;
        background: ${bgColor} !important;
        color: ${textColor} !important;
        overflow-x: hidden !important;
        overflow-y: visible !important;
      }
      body {
        margin: ${contentMargin} !important;
        padding: ${contentPadding} !important;
        width: 100% !important;
        max-width: ${contentMaxWidth} !important;
        height: auto !important;
        min-height: 100% !important;
        line-height: ${lineHeightRef.current} !important;
        color: ${textColor} !important;
        background: ${bgColor} !important;
        font-size: ${fontSizeRef.current}px !important;
        padding-bottom: 80px !important;
        overflow-x: hidden !important;
        overflow-y: visible !important;
        -webkit-overflow-scrolling: touch !important;
      }
      body *:not(.epub-persisted-highlight):not(.epub-search-highlight):not(.epub-search-highlight-active):not(.epub-sync-highlight) {
        color: ${textColor} !important;
        background-color: transparent !important;
      }
      .epub-persisted-highlight {
        border-radius: 0.12rem !important;
      }
      .epub-sync-highlight {
        background: rgba(59, 130, 246, 0.3) !important;
        border-radius: 2px !important;
      }
      p {
        line-height: ${lineHeightRef.current} !important;
        margin: 1em 0 !important;
        font-size: inherit !important;
        max-width: 100% !important;
        color: ${textColor} !important;
      }
      h1, h2, h3, h4, h5, h6 {
        line-height: 1.3 !important;
        margin: 1.5em 0 0.5em 0 !important;
        font-weight: 600 !important;
        font-size: inherit !important;
        max-width: 100% !important;
        color: ${textColor} !important;
      }
      div, section, article, nav, aside, main, header, footer {
        line-height: inherit !important;
        margin: 0 !important;
        padding: 0 !important;
        max-width: 100% !important;
        color: ${textColor} !important;
        background: transparent !important;
      }
      span {
        line-height: inherit !important;
        margin: 0 !important;
        padding: 0 !important;
        color: ${textColor} !important;
      }
      img {
        max-width: 100% !important;
        height: auto !important;
        display: block !important;
        margin: 1em auto !important;
      }
      table {
        max-width: 100% !important;
        border-collapse: collapse !important;
        margin: 1em 0 !important;
      }
      td, th {
        padding: 0.5em !important;
        border: 1px solid ${textColor} !important;
        color: ${textColor} !important;
      }
      ul, ol {
        margin: 1em 0 !important;
        padding-left: 2em !important;
      }
      li {
        margin: 0.5em 0 !important;
        color: ${textColor} !important;
      }
      a {
        color: ${themeRef.current.colors.primary} !important;
        text-decoration: underline !important;
        background-color: transparent !important;
      }
      .epub-search-highlight {
        background: rgba(245, 158, 11, 0.35) !important;
        border-radius: 2px !important;
        padding: 0 2px !important;
      }
      .epub-search-highlight-active {
        background: rgba(249, 115, 22, 0.55) !important;
        outline: 2px solid rgba(194, 65, 12, 0.45) !important;
        border-radius: 3px !important;
        padding: 0 2px !important;
      }
      * {
        text-rendering: optimizeLegibility !important;
        -webkit-font-smoothing: antialiased !important;
        -moz-osx-font-smoothing: grayscale !important;
      }
      ${isTransparentTheme ? `
      body *:not(.epub-persisted-highlight):not(.epub-search-highlight):not(.epub-search-highlight-active):not(.epub-sync-highlight) {
        background-color: transparent !important;
        background-image: none !important;
      }
      ` : ""}
    `;
    contents.document.head.appendChild(style);
  }, []);

  const applyRenditionTheme = useCallback(() => {
    if (!rendition) return;

    const textColor = themeRef.current.colors.onBackground || themeRef.current.colors.text;
    const fontFamily = FONT_FAMILY_MAP[fontFamilyRef.current] || FONT_FAMILY_MAP.serif;
    const rawBg = themeRef.current.colors.background;
    const isTransparent = rawBg === "transparent" || !rawBg;
    const bg = isTransparent
      ? (themeRef.current.colors.toolbar || themeRef.current.colors.surface || "rgba(15, 23, 42, 0.55)")
      : rawBg;
    rendition.themes.default({
      body: {
        "font-size": `${fontSizeRef.current}px !important`,
        "line-height": `${lineHeightRef.current} !important`,
        "margin": "0 !important",
        "padding": "0 !important",
        "color": `${textColor} !important`,
        "background": `${bg} !important`,
        ...(isTransparent
          ? {
              "background-image": "none !important",
            }
          : {}),
        "font-family": `${fontFamily} !important`,
      },
      p: {
        "line-height": `${lineHeightRef.current} !important`,
        "margin": "1em 0 !important",
        "color": `${textColor} !important`,
      },
      "*": {
        "color": `${textColor} !important`,
        "background-color": "transparent !important",
        "box-sizing": "border-box !important",
        "max-width": "100% !important",
      },
    });
    rendition.themes.select("default");

    try {
      rendition.getContents().forEach((contents: any) => {
        applyContentOverrides(contents);
      });
    } catch {
      // Ignore if contents are not ready yet
    }
  }, [applyContentOverrides, rendition]);

  const updateFontSize = useCallback((newSize: number) => {
    const clampedSize = Math.max(12, Math.min(32, newSize));
    updateEpubSettings({ fontSize: clampedSize });
  }, [updateEpubSettings]);

  const updateLineHeight = useCallback((newHeight: number) => {
    const clampedHeight = Math.max(1.2, Math.min(2.2, newHeight));
    updateEpubSettings({ lineHeight: parseFloat(clampedHeight.toFixed(2)) });
  }, [updateEpubSettings]);

  const updateFontFamily = useCallback((fontFamily: "serif" | "sans-serif" | "monospace") => {
    updateEpubSettings({ fontFamily });
  }, [updateEpubSettings]);

  // Increase font size
  const increaseFontSize = useCallback(() => {
    updateFontSize(epubSettings.fontSize + 1);
  }, [epubSettings.fontSize, updateFontSize]);

  // Decrease font size
  const decreaseFontSize = useCallback(() => {
    updateFontSize(epubSettings.fontSize - 1);
  }, [epubSettings.fontSize, updateFontSize]);

  // Reset font size
  const resetFontSize = useCallback(() => {
    updateFontSize(16);
  }, [updateFontSize]);

  // ResizeObserver to handle container resize (e.g., when assistant panel is resized)
  useEffect(() => {
    if (!rendition || !viewerRef.current) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    let animationFrameId: number | null = null;

    const resizeObserver = new ResizeObserver(() => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = requestAnimationFrame(() => {
        if (!initialDisplayCompleteRef.current) {
          return;
        }
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }
        resizeTimeout = setTimeout(() => {
          if (!rendition) return;
          // Skip the resize while the user is actively scrolling/touching.
          // A pending resize stays armed via the observer firing again once
          // interaction ends (mobile address-bar resizes are continuous).
          if (interactingRef.current) return;
          try {
            // Pass the live current location so epub.js re-displays where the
            // reader actually is, not a stale this.location.start.cfi that
            // would snap back to the last navigated section start.
            const liveCfi = (rendition as any).currentLocation?.()?.start?.cfi;
            rendition.resize(undefined, undefined, liveCfi);
          } catch {
            // Rendition may be destroyed during unmount while a resize is pending
          }
        }, 150);
      });
    });

    resizeObserver.observe(viewerRef.current);

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      resizeObserver.disconnect();
    };
  }, [rendition]);

  // Mark the user as actively interacting so the ResizeObserver above defers
  // rendition.resize() (which would snap the view back). Bumped by direct
  // touch/pointer/wheel on the viewer and by every epub.js `relocated` (i.e.
  // any scroll-driven location change). After a quiet period we re-arm a
  // resize so the layout still corrects itself once scrolling stops.
  useEffect(() => {
    if (!rendition || !viewerRef.current) return;
    const el = viewerRef.current;

    const markInteracting = () => {
      interactingRef.current = true;
      if (interactingTimerRef.current) clearTimeout(interactingTimerRef.current);
      interactingTimerRef.current = setTimeout(() => {
        interactingRef.current = false;
        // Re-run a layout correction now that the user has stopped, using the
        // live location so it never snaps to a stale section-start CFI.
        try {
          const liveCfi = (rendition as any).currentLocation?.()?.start?.cfi;
          rendition.resize(undefined, undefined, liveCfi);
        } catch {
          /* rendition may be torn down */
        }
      }, 600);
    };

    el.addEventListener("touchstart", markInteracting, { passive: true });
    el.addEventListener("touchmove", markInteracting, { passive: true });
    el.addEventListener("pointerdown", markInteracting, { passive: true });
    el.addEventListener("wheel", markInteracting, { passive: true });
    // epub.js fires `relocated` on scroll in continuous mode — treat it as
    // active interaction so a viewport resize mid-scroll can't preempt it.
    rendition.on("relocated", markInteracting);

    return () => {
      el.removeEventListener("touchstart", markInteracting);
      el.removeEventListener("touchmove", markInteracting);
      el.removeEventListener("pointerdown", markInteracting);
      el.removeEventListener("wheel", markInteracting);
      rendition.off("relocated", markInteracting);
      if (interactingTimerRef.current) clearTimeout(interactingTimerRef.current);
      interactingRef.current = false;
    };
  }, [rendition]);

  useEffect(() => {
    if (!containerHasSize || (!fileUrl && !fileData)) return;

    let mounted = true;
    let bookInstance: any = null;
    let renditionInstance: any = null;
    let bookReadySettled = false;
    let destroyBookWhenReady = false;
    let bookDestroyed = false;
    let locationsSettled = true; // tracks whether background locations.generate() has settled
    let destroyBookWhenLocationsSettled = false;
    let savePositionTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    const maxRetries = 10;

    const destroyBookInstance = () => {
      if (!bookInstance || bookDestroyed) return;
      bookDestroyed = true;
      try { bookInstance.destroy(); } catch { /* ignore */ }
    };

    const loadEPUB = async () => {
      setIsLoading(true);
      setError(null);

      try {
        if (!fileUrl && !fileData) {
          throw new Error("No EPUB source available.");
        }
        if (fileUrl) {
        } else {
        }

        // Prefer URL source in Tauri to avoid heavy base64 decode on the renderer thread.
        // Fall back to in-memory bytes when URL is unavailable.
        // Force loopback URL sources to open as archived EPUBs. epub.js's URL
        // type inference treats our query-backed stream URL as a directory on
        // Android and otherwise requests `/epub/META-INF/container.xml`
        // instead of fetching the ZIP bytes from `/epub/book.epub`.
        const epubBook = fileUrl
          ? ePub(fileUrl, { openAs: "epub" })
          : ePub(fileData!.slice().buffer);
        bookInstance = epubBook;
        setBook(epubBook);

        // epub.js mutates `loading` to undefined in Book.destroy(). Destroying
        // while its asynchronous unpack/navigation work is still pending makes
        // that work reject at `this.loading.navigation`. Defer destruction until
        // `ready` settles when the viewer unmounts during startup.
        try {
          await epubBook.ready;
        } finally {
          bookReadySettled = true;
          if (destroyBookWhenReady && locationsSettled) destroyBookInstance();
        }

        if (!mounted) return;

        // Safe monkey-patch for epubjs Section.prototype.destroy race condition:
        // When a rendition is destroyed during a pending section fetch/load, epubjs
        // unloads the section and nulls out Section.prototype.hooks. Any pending section
        // load promises that resolve after this will throw "TypeError: undefined is not
        // an object (evaluating 'this.hooks.content')". We prevent this by keeping
        // hooks reference valid even after destruction.
        try {
          const spine = epubBook.spine as any;
          if (spine && spine.spineItems && spine.spineItems.length > 0) {
            const SectionClass = spine.spineItems[0].constructor as any;
            if (SectionClass && SectionClass.prototype && !SectionClass.prototype.__patchedForDestroy) {
              SectionClass.prototype.__patchedForDestroy = true;
              const originalDestroy = SectionClass.prototype.destroy;
              SectionClass.prototype.destroy = function() {
                const hooks = this.hooks;
                originalDestroy.apply(this, arguments);
                this.hooks = hooks; // Restore hooks reference so trigger() does not throw
              };
            }
          }
        } catch (e) {
          console.warn("EPUBViewer: Failed to apply Section.destroy patch", e);
        }

        // Patch epubjs Queue.prototype.dequeue for the teardown race that throws
        // "TypeError: undefined is not an object (evaluating 'e.deferred.resolve')".
        // Rendition.destroy() comments out `this.q.clear()` upstream, and q.stop()
        // only flips paused/running flags — it does not cancel a tick already
        // scheduled via requestAnimationFrame. A job dequeued on that final tick can
        // be a promise-only item (no `task`, hence no `deferred`), or hit the
        // function-branch after the rendition's internals are torn down. Guard both
        // branches so the queue drains harmlessly during teardown instead of throwing.
        try {
          const QueueProto = (epubBook.spine as any)?.q?.constructor?.prototype as any;
          if (QueueProto && !QueueProto.__patchedForDeferredGuard) {
            QueueProto.__patchedForDeferredGuard = true;
            const originalDequeue = QueueProto.dequeue;
            QueueProto.dequeue = function () {
              if (!this._q.length || this.paused) return originalDequeue.apply(this, arguments);
              const inwait = this._q[0];
              // Promise-only item (no task) — shift and resolve as a no-op so the
              // RAF loop in run() terminates cleanly.
              if (inwait && !inwait.task) {
                this._q.shift();
                return inwait.promise ?? Promise.resolve();
              }
              // Task item missing its deferred (shouldn't happen, but guard the
              // crash site directly) — shift and skip the resolve/reject call.
              if (inwait && !inwait.deferred) {
                this._q.shift();
                try {
                  const result = typeof inwait.task === "function" ? inwait.task.apply(this.context, inwait.args) : undefined;
                  return result && typeof result.then === "function" ? result : Promise.resolve(result);
                } catch {
                  return Promise.resolve();
                }
              }
              return originalDequeue.apply(this, arguments);
            };
          }
        } catch (e) {
          console.warn("EPUBViewer: Failed to apply Queue.dequeue patch", e);
        }

        const tocData = await epubBook.loaded.navigation;
        
        let filteredToc = tocData.toc;
        const startIdx = metadataRef.current?.chunkStartSpineIndex;
        const endIdx = metadataRef.current?.chunkEndSpineIndex;
        if (startIdx !== undefined || endIdx !== undefined) {
          try {
            await epubBook.loaded.spine;
            filteredToc = filterTocItems(tocData.toc, epubBook, startIdx, endIdx);
          } catch (e) {
            console.warn("EPUBViewer: Failed to filter TOC items:", e);
          }
        }

        setToc(filteredToc);
        tocRef.current = filteredToc;
        onLoadRef.current?.(filteredToc);
        if (documentId) {
          try {
            useDocumentOutlineStore.getState().setOutline(documentId, { epubToc: filteredToc });
          } catch {}
        }

        const initializeRendition = async (): Promise<boolean> => {
          if (!mounted) return false;

          if (!viewerRef.current) {
            if (retryCount < maxRetries) {
              retryCount++;
              await new Promise(resolve => setTimeout(resolve, 100));
              return initializeRendition();
            } else {
              console.error("EPUBViewer: viewerRef never became available");
              throw new Error("Failed to initialize EPUB viewer - container not available. Please try reopening the document.");
            }
          }

          // Check if container has dimensions (required for epubjs)
          const containerRect = viewerRef.current.getBoundingClientRect();
          if (containerRect.width === 0 || containerRect.height === 0) {
            if (retryCount < maxRetries) {
              retryCount++;
              await new Promise(resolve => setTimeout(resolve, 100));
              return initializeRendition();
            } else {
              console.error("EPUBViewer: Container never got dimensions");
              throw new Error("Failed to initialize EPUB viewer - container has no size. Please try resizing the window.");
            }
          }

          const rendition = epubBook.renderTo(viewerRef.current, {
            width: "100%",
            height: "100%",
            spread: "none",
            flow: "scrolled",
            allowScriptedContent: true,
            manager: "continuous",
          });

          renditionInstance = rendition;
          setRendition(rendition);

          const vimRuntimeListeners = new Set<(event: { kind: "content" | "geometry" | "destroyed"; spineIndex?: number }) => void>();
          const spineItems = Array.from((epubBook.spine as any)?.spineItems ?? []) as any[];
          const vimRuntime: EpubVimRuntime = {
            documentId: documentId ?? "",
            sections: spineItems.map((section: any) => ({
              spineIndex: section.index,
              href: section.href,
              load: async (signal?: AbortSignal) => {
                if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
                await section.load(epubBook.load.bind(epubBook));
                if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
                return section.document as globalThis.Document;
              },
              cfiForElement: (element: Element, edge: "start" | "end") => {
                const range = element.ownerDocument.createRange();
                range.selectNodeContents(element);
                range.collapse(edge === "start");
                return section.cfiFromRange(range);
              },
              cfiForTextOffset: (element: Element, offset: number, edge: "start" | "end") => {
                const point = findEpubTextPoint(element, offset);
                const range = element.ownerDocument.createRange();
                range.setStart(point.node, point.offset);
                range.setEnd(point.node, point.offset);
                range.collapse(edge === "start");
                return section.cfiFromRange(range);
              },
              cfiForRange: async (startOffset: number, endOffset: number) => {
                await section.load(epubBook.load.bind(epubBook));
                const root = section.document.body ?? section.document.documentElement;
                const start = findEpubTextPoint(root, startOffset);
                const end = findEpubTextPoint(root, endOffset);
                const range = section.document.createRange();
                range.setStart(start.node, start.offset);
                range.setEnd(end.node, end.offset);
                return section.cfiFromRange(range);
              },
            })),
            currentSpineIndex: () => Number((rendition.currentLocation?.() as any)?.start?.index ?? 0),
            currentCfi: () => String((rendition.currentLocation?.() as any)?.start?.cfi ?? "") || null,
            currentWindow: () => (rendition.getContents?.() as any)?.[0]?.window ?? null,
            reveal: async (cfi: string, signal?: AbortSignal) => {
              if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
              await rendition.display(cfi);
              if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            },
            rangeFromCfi: (cfi: string) => {
              try { return rendition.getRange?.(cfi) ?? null; } catch { return null; }
            },
            cfiFromRange: (range: Range) => {
              const contents = (rendition.getContents?.() as unknown as any[])?.find((item: any) => item.document === range.startContainer.ownerDocument);
              return contents?.cfiFromRange?.(range) ?? "";
            },
            subscribe: (listener) => { vimRuntimeListeners.add(listener); return () => vimRuntimeListeners.delete(listener); },
          };
          onVimRuntimeChange?.(vimRuntime);

          // Register hooks BEFORE displaying content
          // Try multiple hook types to ensure styles are applied
          rendition.hooks.render.register((_contents: any) => {
            // This fires when each section is rendered
          });

          // Inject global styles to override EPUB internal styles
          rendition.hooks.content.register((contents: any) => {
            vimRuntimeListeners.forEach((listener) => listener({ kind: "content", spineIndex: contents.section?.index }));

            // Disable all EPUB stylesheets by setting them to disabled
            const links = contents.document.querySelectorAll('link[rel="stylesheet"]');
            links.forEach((link: any) => {
              link.disabled = true;
              link.remove(); // Completely remove the stylesheet element
            });

            const styleTags = contents.document.querySelectorAll('style:not(#epub-override-styles)');
            styleTags.forEach((tag: any) => {
              tag.remove();
            });

            // More targeted inline style cleanup - only fix specific problematic elements
            // instead of iterating through ALL elements
            const problematicTags = contents.document.querySelectorAll('div[style], p[style], span[style]');
            problematicTags.forEach((el: any) => {
              if (el.style && el.style.overflow) {
                // Preserve overflow for scrolling
                const overflow = el.style.overflow;
                el.style.overflow = overflow;
              }
            });

            // Now inject our consistent styling
            applyContentOverrides(contents);
            const selectionHandler = () => handleSelectionChange(contents);
            contents.document.addEventListener("selectionchange", selectionHandler);
            contents.document.addEventListener("mouseup", selectionHandler);
            contents.document.addEventListener("touchend", selectionHandler);

            // Vertical swipe paging inside the EPUB iframe.
            // Touches inside epub.js's iframe are isolated from the parent window,
            // so the queue's TikTok-style swipe handler can't see them. Handle
            // vertical swipes here instead: swipe up turns to the next page (like a
            // Kindle), swipe down to the previous page. When already on the last /
            // first page, dispatch "incrementum-queue-swipe" so the parent
            // QueueScrollPage advances to the next/previous queue item — that's how
            // a long EPUB bridges into the queue without forcing the reader to
            // "scroll to the bottom" of the whole book.
            let epubTouchStartX = 0;
            let epubTouchStartY = 0;
            let epubTouchStartT = 0;
            let epubLongPressTimer: ReturnType<typeof setTimeout> | null = null;
            let epubLongPressTriggered = false;
            const EPUB_SWIPE_MIN_DIST = 45;
            const EPUB_SWIPE_MIN_VEL = 0.35;
            const dispatchQueueSwipe = (direction: "next" | "prev") => {
              try {
                contents.window.parent.dispatchEvent(
                  new CustomEvent("incrementum-queue-swipe", { detail: { direction } })
                );
              } catch {
                /* parent unreachable (standalone reader) — ignore */
              }
            };
            contents.document.addEventListener("touchstart", (e: TouchEvent) => {
              if (e.touches.length !== 1) return;
              epubTouchStartX = e.touches[0].clientX;
              epubTouchStartY = e.touches[0].clientY;
              epubTouchStartT = Date.now();
              epubLongPressTriggered = false;
              if (epubLongPressTimer) clearTimeout(epubLongPressTimer);
              if (embedded && !(e.target as Element | null)?.closest("button, input, textarea, select, a")) {
                epubLongPressTimer = setTimeout(() => {
                  const selection = contents.window.getSelection();
                  if (selection && !selection.isCollapsed && selection.toString().trim()) return;
                  epubLongPressTriggered = true;
                  try {
                    contents.window.parent.dispatchEvent(new CustomEvent("incrementum-queue-long-press"));
                  } catch {
                    /* parent unreachable — ignore */
                  }
                }, 550);
              }
            }, { passive: true });
            contents.document.addEventListener("touchmove", (e: TouchEvent) => {
              if (e.touches.length !== 1 || !epubLongPressTimer) return;
              const dx = e.touches[0].clientX - epubTouchStartX;
              const dy = e.touches[0].clientY - epubTouchStartY;
              if (Math.hypot(dx, dy) > 12) {
                clearTimeout(epubLongPressTimer);
                epubLongPressTimer = null;
              }
            }, { passive: true });
            contents.document.addEventListener("touchend", (e: TouchEvent) => {
              if (epubLongPressTimer) clearTimeout(epubLongPressTimer);
              epubLongPressTimer = null;
              if (epubLongPressTriggered) {
                epubLongPressTriggered = false;
                return;
              }
              if (e.changedTouches.length !== 1) return;
              const endX = e.changedTouches[0].clientX;
              const endY = e.changedTouches[0].clientY;
              const dx = endX - epubTouchStartX;
              const dy = endY - epubTouchStartY;
              const dt = Date.now() - epubTouchStartT;
              const adx = Math.abs(dx);
              const ady = Math.abs(dy);
              const vel = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
              // Horizontal swipes are left to epub.js's own handling / selection.
              if (adx > ady) return;
              if (ady < EPUB_SWIPE_MIN_DIST && vel < EPUB_SWIPE_MIN_VEL) return;

              const r = renditionInstance;
              if (!r) return;
              // epub.js exposes atStart/atEnd on its Location object (set after each
              // navigation). currentLocation() returns only a DisplayedLocation slice,
              // so read the booleans off rendition.location instead. Guard heavily:
              // some builds surface them as methods, others as plain properties.
              const atEdge = (dir: "next" | "prev"): boolean => {
                try {
                  const loc = r.location;
                  const flag = dir === "next" ? loc?.atEnd : loc?.atStart;
                  return typeof flag === "function" ? !!flag() : Boolean(flag);
                } catch {
                  return false;
                }
              };
              try {
                if (dy < 0) {
                  // Swipe up → next page, or advance the queue at the last page.
                  if (!atEdge("next")) {
                    r.next();
                  } else {
                    dispatchQueueSwipe("next");
                  }
                } else if (dy > 0) {
                  // Swipe down → previous page, or previous queue item at first page.
                  if (!atEdge("prev")) {
                    r.prev();
                  } else {
                    dispatchQueueSwipe("prev");
                  }
                }
              } catch {
                /* ignore paging errors */
              }
            }, { passive: true });

            const handleEpubMouseOver = (e: MouseEvent) => {
              const target = e.target as HTMLElement;
              if (target && target.tagName === "IMG") {
                const img = target as HTMLImageElement;
                const rect = img.getBoundingClientRect();
                const iframe = (contents.window?.frameElement || viewerRef.current?.querySelector("iframe")) as HTMLIFrameElement | null;
                const iframeRect = iframe?.getBoundingClientRect();
                if (iframeRect) {
                  window.dispatchEvent(
                    new CustomEvent("image-hover", {
                      detail: {
                        src: img.src,
                        documentId,
                        rect: {
                          left: rect.left + iframeRect.left,
                          top: rect.top + iframeRect.top,
                          width: rect.width,
                          height: rect.height,
                        },
                      },
                    })
                  );
                }
              }
            };

            const handleEpubMouseOut = (e: MouseEvent) => {
              const target = e.target as HTMLElement;
              if (target && target.tagName === "IMG") {
                window.dispatchEvent(new CustomEvent("image-leave"));
              }
            };

            contents.document.addEventListener("mouseover", handleEpubMouseOver);
            contents.document.addEventListener("mouseout", handleEpubMouseOut);

            // Right-click context menu for selected text inside the EPUB iframe
            contents.document.addEventListener("contextmenu", (e: Event) => {
              const selection = contents.window.getSelection();
              const text = selection?.toString().trim();
              if (!text) return;
              e.preventDefault();
              const mouseEvent = e as unknown as MouseEvent;
              const iframe = (contents.window?.frameElement || viewerRef.current?.querySelector("iframe")) as HTMLIFrameElement | null;
              if (iframe) {
                const iframeRect = iframe.getBoundingClientRect();
                onContextMenuRef.current?.({
                  x: iframeRect.left + mouseEvent.clientX,
                  y: iframeRect.top + mouseEvent.clientY,
                  selectedText: text,
                  selectionContext: lastEpubSelectionContextRef.current,
                });
              }
            });

            // Forward click events from EPUB iframe to parent window for overlay toggle
            contents.document.addEventListener("click", (e: MouseEvent) => {
              if ((e.target as HTMLElement).closest('a, button, input, select, textarea, .interactive')) {
                return;
              }
              const parentEvent = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: e.clientX,
                clientY: e.clientY,
                screenX: e.screenX,
                screenY: e.screenY,
              });
              viewerRef.current?.dispatchEvent(parentEvent);
            });

            // Key events inside the EPUB iframe don't reliably reach the parent window.
            // Bind Cmd/Ctrl+K here so the command palette always opens while reading.
            contents.window.addEventListener("keydown", handleCommandPaletteHotkey, true);
            contents.window.addEventListener("keydown", handleExtractTextHotkey, true);
            contents.window.addEventListener("keydown", handlePriorityHotkey, true);
            contents.window.addEventListener("keydown", (e: KeyboardEvent) => {
              if (handleEPUBKeyDownRef.current) {
                handleEPUBKeyDownRef.current(e);
              }
            }, true);
            
            // Auto-focus the iframe window to enable immediate keyboard navigation.
            //
            // Never steal focus from a field the user is typing in: showing the
            // on-screen keyboard resizes the viewport, which makes epub.js
            // re-render and re-run this — so without the guard, tapping any
            // input layered over the reader (the selection sheet's question box,
            // search, a dialog) focused it, opened the keyboard, and then had
            // focus yanked back 150ms later, closing the keyboard again.
            try {
              setTimeout(() => {
                const active = document.activeElement as HTMLElement | null;
                if (
                  active &&
                  (active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    active.isContentEditable)
                ) {
                  return;
                }
                contents.window.focus();
              }, 150);
            } catch { /* ignore */ }

            if (contents.window) {
              onIframeWindowReadyRef.current?.(contents.window);
            }
          });

          rendition.themes.register("default", {});
          applyRenditionTheme();

          // Display the book at saved position or start
          const savedPosition = await loadReadingPositionRef.current();
          const startIdx = metadataRef.current?.chunkStartSpineIndex;

          let displayTarget: any = null;
          if (initialCfiRef.current) {
            displayTarget = initialCfiRef.current;
          } else if (savedPosition) {
            displayTarget = savedPosition;
          } else if (startIdx !== undefined) {
            const spine = epubBook.spine;
            if (spine) {
              const item = spine.get(startIdx);
              if (item) {
                displayTarget = (item as any).cfi || item.href;
              }
            }
          }

          if (displayTarget) {
            lastDisplayedCfiRef.current = displayTarget;
            await rendition.display(displayTarget);
          } else {
            await rendition.display();
          }

          if (onContextTextChangeRef.current) {
            // Extract text from current chapter only (not entire book).
            // NOTE: in epub.js continuous-scrolled mode, `relocated` fires on
            // every section boundary crossed during scrolling, and this reads
            // body.textContent of ALL mounted iframes (continuous manager keeps
            // several sections live) — doing that per-relocate during a long
            // scroll is a big main-thread cost (measured ~17-21% JS during epub
            // scroll). Debounce so it runs once after scrolling settles, not on
            // every section transition.
            let chapterTextTimer: ReturnType<typeof setTimeout> | null = null;
            const DEBOUNCE_MS = 350;
            const extractCurrentChapterText = () => {
              try {
                const contents = rendition?.getContents?.() as unknown as any[] | undefined;
                if (contents && contents.length > 0) {
                  const text = contents
                    .map((content: any) => content?.document?.body?.textContent?.trim())
                    .filter(Boolean)
                    .join("\n\n");
                  if (text && mounted) {
                    onContextTextChangeRef.current?.(text);
                  }
                }
              } catch (err) {
                console.warn("EPUBViewer: Failed to extract current chapter text:", err);
              }
            };

            const scheduleExtract = () => {
              if (chapterTextTimer) clearTimeout(chapterTextTimer);
              chapterTextTimer = setTimeout(extractCurrentChapterText, DEBOUNCE_MS);
            };

            // Initial extraction (debounced so initial render work settles first).
            scheduleExtract();

            rendition.on("relocated", scheduleExtract);
            rendition.on("destroy", () => {
              if (chapterTextTimer) clearTimeout(chapterTextTimer);
            });
          }

          // Mark initial display as complete after a delay to allow content to render
          // This prevents resize events from causing blank page issues
          setTimeout(() => {
            if (mounted) {
              initialDisplayCompleteRef.current = true;
              // Force a resize to ensure proper rendering after content is stable
              if (rendition) {
                try { rendition.resize(undefined, undefined); } catch { /* ignore */ }
              }
            }
          }, 500);

          if (!mounted) return true;

          // Generate locations in the background to avoid blocking initial render.
          // Tracked so the viewer does not destroy the book (which nulls
          // Locations internals) while generation is still in flight — otherwise
          // a queued `process()` job resolves and reads `this._locations.concat()`
          // against undefined, throwing the epub-vendor "concat" TypeError that
          // surfaces when the document is rated "read" mid-load on mobile.
          const locationChunkSize = isMobile ? 800 : 1200;
          locationsSettled = false;
          void epubBook.locations.generate(locationChunkSize).then(
            () => {
              locationsSettled = true;
              if (destroyBookWhenLocationsSettled) destroyBookInstance();
            },
            (err: unknown) => {
              locationsSettled = true;
              if (destroyBookWhenLocationsSettled) destroyBookInstance();
              console.warn("EPUBViewer: Failed to generate locations:", err);
            },
          );

          const updateProgress = (location: any) => {
            if (!location || !location.start || !epubBook.locations) return;
            try {
              const percent = epubBook.locations.percentageFromCfi(location.start.cfi);
              if (typeof percent === "number" && !Number.isNaN(percent)) {
                const rounded = Math.round(percent * 100);
                setProgressPercent(rounded);
                onProgressChangeRef.current?.(rounded);
              }
            } catch {
              // Ignore progress calculation errors
            }
          };

          const resolveChapterLabel = (href: string | undefined) => {
            if (!href) return "";
            const searchToc = (items: any[]): string | null => {
              for (const item of items) {
                if (item.href === href || item.href?.endsWith?.(href)) {
                  return item.label;
                }
                if (item.subitems) {
                  const found = searchToc(item.subitems);
                  if (found) return found;
                }
              }
              return null;
            };
            return searchToc(tocRef.current) || "";
          };

          // Save position when location changes (debounced)
          const debouncedSavePosition = () => {
            if (savePositionTimer) {
              clearTimeout(savePositionTimer);
            }
            savePositionTimer = setTimeout(() => {
              try {
                const currentLocation = rendition.currentLocation() as any;
                if (currentLocation && currentLocation.start && mounted) {
                  saveReadingPositionRef.current(currentLocation.start.cfi);
                }
              } catch { /* ignore */ }
            }, 1000); // Save 1 second after last movement
          };

          // Track location changes to save reading position
          // The UI bits (progress %, chapter label) are debounced: in epub.js
          // continuous-scrolled mode, `relocated` fires on every section
          // boundary crossed during a scroll, and each setState here would
          // trigger a React re-render mid-scroll (measured as a chunk of the
          // ~17-21% main-thread cost during epub scrolling). Only the spine
          // boundary guard + position save run immediately.
          let uiUpdateTimer: ReturnType<typeof setTimeout> | null = null;
          rendition.on("relocated", (location: any) => {
            if (!mounted) return;
            vimRuntimeListeners.forEach((listener) => listener({ kind: "geometry", spineIndex: location.start?.index }));

            // Enforce spine boundaries (must be immediate — correctness)
            const currentSpineIndex = location.start?.index;
            if (typeof currentSpineIndex === 'number') {
              const startIdx = metadataRef.current?.chunkStartSpineIndex;
              const endIdx = metadataRef.current?.chunkEndSpineIndex;

              if (startIdx !== undefined && currentSpineIndex < startIdx) {
                const spine = epubBook.spine || (bookInstance ? bookInstance.spine : null);
                if (spine) {
                  const item = spine.get(startIdx);
                  if (item) {
                    rendition.display(item.cfi || item.href);
                    return;
                  }
                }
              }

              if (endIdx !== undefined && currentSpineIndex > endIdx) {
                const spine = epubBook.spine || (bookInstance ? bookInstance.spine : null);
                if (spine) {
                  const item = spine.get(endIdx);
                  if (item) {
                    rendition.display(item.cfi || item.href);
                    return;
                  }
                }
              }
            }

            debouncedSavePosition();

            // Debounce the UI updates so a long scroll doesn't re-render the
            // reader chrome on every section transition.
            if (uiUpdateTimer) clearTimeout(uiUpdateTimer);
            uiUpdateTimer = setTimeout(() => {
              if (!mounted) return;
              try { updateProgress(location); } catch { /* ignore */ }
              const chapter = resolveChapterLabel(location.start?.href || location.start?.page);
              if (chapter) {
                setCurrentChapter(chapter);
              }
              // Rebuild sync map when chapter changes
              const href = location.start?.href;
              if (href && href !== syncCurrentChapterRef.current && syncSegmentsRef.current.length > 0) {
                syncCurrentChapterRef.current = href;
                syncMapRef.current = new Map();
                setTimeout(() => buildSyncMapRef.current(), 300);
              }
            }, 250);
          });

          // Enable text selection
          rendition.on("selected", (cfiRange: any, contents: any) => {
            const selection = contents.window.getSelection();
            if (selection && selection.toString()) {
              selectionActiveRef.current = true;
              const ctx: EpubSelectionContext = {
                type: "epub",
                documentId: documentId ?? "",
                cfiRange: String(cfiRange),
                selectedText: selection.toString(),
              };
              lastEpubSelectionContextRef.current = ctx;
              onSelectionChangeRef.current?.(selection.toString(), ctx);
            }
          });

          rendition.on("destroy", () => {
            vimRuntimeListeners.forEach((listener) => listener({ kind: "destroyed" }));
            vimRuntimeListeners.clear();
            onVimRuntimeChange?.(null);
          });
          rendition.on("rendered", (section: any) => vimRuntimeListeners.forEach((listener) => listener({ kind: "geometry", spineIndex: section?.index })));
          rendition.on("resized", () => vimRuntimeListeners.forEach((listener) => listener({ kind: "geometry" })));

          return true;
        };

        await initializeRendition();
      } catch (err) {
        if (!mounted) return;
        console.error("EPUBViewer: Error loading EPUB:", err);
        setError(err instanceof Error ? err.message : "Failed to load EPUB");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadEPUB();

    return () => {
      mounted = false;
      if (savePositionTimer) {
        clearTimeout(savePositionTimer);
      }
      if (renditionInstance) {
        try {
          const location = renditionInstance.currentLocation?.();
          const cfi = location?.start?.cfi;
          if (cfi) {
            void saveReadingPositionRef.current(cfi);
          }
        } catch { /* ignore */ }
        // Stop the rendition's internal task queue BEFORE destroying it.
        // epubjs schedules `_display` / navigation jobs on requestAnimationFrame
        // and rendition.destroy() leaves that queue running (its `q.clear()` is
        // commented out upstream). A job that fires after the book's Locations
        // were torn down reads `this._locations.length` against undefined — the
        // "undefined is not an object (evaluating 'this._locations.length')"
        // crash seen when leaving an EPUB mid-render. Dropping pending jobs
        // here makes teardown safe regardless of in-flight display work.
        try { renditionInstance.q?.stop?.(); } catch { /* ignore */ }
        try { renditionInstance.destroy(); } catch { /* ignore */ }
      }
      onVimRuntimeChange?.(null);
      if (bookInstance) {
        // Defer destruction until both `ready` and background location
        // generation have settled — destroying mid-flight nulls epubjs internals
        // and trips "concat" TypeErrors inside the epub-vendor chunk.
        if (bookReadySettled && locationsSettled) {
          destroyBookInstance();
        } else {
          destroyBookWhenReady = true;
          if (!locationsSettled) destroyBookWhenLocationsSettled = true;
        }
      }
    };
    // Note: onLoad, onContextTextChange, onSelectionChange, and onProgressChange are
    // intentionally excluded from deps - they use refs to avoid destroying and
    // recreating the EPUB book when parent callbacks change.
  }, [fileData, fileUrl, documentId, containerHasSize]);

  const lastDisplayedCfiRef = useRef<string | null>(null);

  useEffect(() => {
    if (rendition && initialCfi && initialCfi !== lastDisplayedCfiRef.current) {
      lastDisplayedCfiRef.current = initialCfi;
      rendition.display(initialCfi);
    }
  }, [rendition, initialCfi]);

  // Re-apply styles when settings or theme change
  useEffect(() => {
    applyRenditionTheme();
  }, [applyRenditionTheme, epubSettings.fontFamily, epubSettings.fontSize, epubSettings.lineHeight, theme]);

  const removeSearchAnnotations = useCallback((cfis: string[]) => {
    if (!rendition || cfis.length === 0) return;
    for (const cfi of cfis) {
      try {
        rendition.annotations?.remove?.(cfi, "highlight");
      } catch {
        // ignore
      }
    }
  }, [rendition]);

  const reportLiveSearchResults = useCallback((query: string, results: string[], requestedIndex?: number | null) => {
    const total = results.length;
    const activeIndex = total === 0
      ? -1
      : typeof requestedIndex === "number" && Number.isFinite(requestedIndex)
        ? ((Math.trunc(requestedIndex) % total) + total) % total
        : 0;

    onSearchResultsChangeRef.current?.({
      query,
      total,
      activeIndex,
      activeCfi: total > 0 ? results[activeIndex] : null,
    });
  }, []);

  const searchVisibleContents = useCallback((query: string): string[] => {
    if (!rendition || !query.trim()) return [];

    const escapedQuery = escapeRegex(query.trim());
    // Match the full phrase, allowing flexible whitespace between words
    const flexibleRegex = escapedQuery.replace(/\\\s+/g, "\\s+");
    const regex = new RegExp(flexibleRegex, "gi");
    const cfis: string[] = [];
    const seen = new Set<string>();

    try {
      const contentsList = rendition.getContents?.() ?? [];
      for (const contents of contentsList) {
        const doc = contents?.document as globalThis.Document | undefined;
        const body = doc?.body;
        if (!body) continue;

        const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const value = node.nodeValue ?? "";
          if (!value.trim()) continue;

          let match: RegExpExecArray | null;
          regex.lastIndex = 0;
          while ((match = regex.exec(value)) !== null) {
            try {
              const range = doc.createRange();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              const cfi = contents.cfiFromRange?.(range);
              range.detach?.();
              if (cfi && !seen.has(cfi)) {
                seen.add(cfi);
                cfis.push(String(cfi));
              }
            } catch {
              // ignore individual range failures
            }

            if (match[0].length === 0) {
              regex.lastIndex += 1;
            }
          }
        }
      }
    } catch (error) {
      console.warn("EPUBViewer: visible-content search failed:", error);
    }

    return cfis;
  }, [rendition]);

  const renderLiveSearchHighlights = useCallback(async (
    results: string[],
    requestedIndex?: number | null,
    options?: { navigate?: boolean }
  ) => {
    if (!rendition) return;

    removeSearchAnnotations(liveSearchHighlightsRef.current);
    liveSearchHighlightsRef.current = [];
    activeLiveSearchCfiRef.current = null;

    if (results.length === 0) {
      reportLiveSearchResults(searchQuery?.trim() ?? "", [], requestedIndex);
      return;
    }

    const activeIndex = typeof requestedIndex === "number" && Number.isFinite(requestedIndex)
      ? ((Math.trunc(requestedIndex) % results.length) + results.length) % results.length
      : 0;
    const activeCfi = results[activeIndex] ?? null;

    for (let i = 0; i < results.length; i++) {
      const cfi = results[i];
      const className = i === activeIndex ? "epub-search-highlight-active" : "epub-search-highlight";
      try {
        rendition.annotations?.highlight?.(cfi, {}, undefined, className);
        liveSearchHighlightsRef.current.push(cfi);
      } catch {
        // ignore
      }
    }

    activeLiveSearchCfiRef.current = activeCfi;

    if (activeCfi && options?.navigate !== false) {
      try {
        await rendition.display(activeCfi);
      } catch {
        // ignore
      }
    }

    reportLiveSearchResults(searchQuery?.trim() ?? "", results, activeIndex);
  }, [removeSearchAnnotations, rendition, reportLiveSearchResults, searchQuery]);

  /**
   * Full-book passage search. epubjs has no `Book.search` in the bundled
   * version (only per-section exact `Section.search`), so a citation jump used
   * to fall through to the visible-content search — which only scans the
   * currently displayed section — and landed on the book's title page when the
   * passage was in another chapter. Load each linear spine section and match
   * with a tolerant phrase regex (flexible whitespace + typographic
   * punctuation), stopping at the first section that matches (spine order =
   * reading order).
   */
  const searchEntireBook = useCallback(
    async (query: string): Promise<string[]> => {
      if (!book || !query.trim()) return [];
      const spine = book.spine as { each?: (fn: (s: any) => void) => void; spineItems?: any[] } | undefined;
      const sections: any[] = [];
      if (spine?.each) {
        spine.each((section: any) => sections.push(section));
      } else if (Array.isArray(spine?.spineItems)) {
        sections.push(...spine.spineItems);
      }
      if (sections.length === 0) return [];

      const regex = tolerantPhraseRegex(query);
      const cfis: string[] = [];
      for (const section of sections) {
        if (section?.linear === false) continue;
        try {
          await section.load(book.load.bind(book));
        } catch {
          continue;
        }
        cfis.push(...collectSectionCfiMatches(section, regex));
        if (cfis.length > 0) break;
      }
      return cfis;
    },
    [book]
  );

  const applySearchHighlights = useCallback(async () => {
    if (!highlightQuery || !highlightQuery.trim()) return;
    if (!rendition || !book) return;

    try {
      for (const cfi of activeSearchHighlightsRef.current) {
        rendition.annotations?.remove?.(cfi, "highlight");
      }
    } catch {
      // ignore
    }
    activeSearchHighlightsRef.current = [];

    const query = highlightQuery.trim();
    let results: any[] = [];
    try {
      if (typeof (book as any).search === "function") {
        results = await (book as any).search(query);
      }
    } catch (error) {
      console.warn("EPUBViewer: book.search failed:", error);
      results = [];
    }

    const indexedResults = (results || [])
      .map((result: any) => ({
        cfi: result?.cfi ? String(result.cfi) : "",
        excerpt: typeof result?.excerpt === "string" ? result.excerpt : "",
        text: typeof result?.text === "string" ? result.text : "",
      }))
      .filter((result) => result.cfi)
      .slice(0, 30);

    let cfis = indexedResults
      .map((r) => r.cfi)
      .filter(Boolean)
      .map((cfi: any) => String(cfi));

    // Fall back to a tolerant full-book search when book.search (or its
    // absence — epubjs ships no Book.search) finds nothing: the passage can be
    // in any chapter, and only scanning the visible section left the viewer on
    // the title page.
    if (cfis.length === 0) {
      try {
        cfis = await searchEntireBook(query);
      } catch (error) {
        console.warn("EPUBViewer: full-book search failed:", error);
        cfis = [];
      }
    }

    // Last resort: search the currently visible content only.
    if (cfis.length === 0) {
      cfis = searchVisibleContents(query);
    }

    if (cfis.length > 0) {
      const targetIndex =
        indexedResults.length > 0
          ? chooseSearchResultIndex(indexedResults, initialSearchMatchIndex, initialSearchTextQuote)
          : typeof initialSearchMatchIndex === "number" && Number.isFinite(initialSearchMatchIndex)
            ? ((Math.trunc(initialSearchMatchIndex) % cfis.length) + cfis.length) % cfis.length
            : 0;
      const targetCfi = cfis[targetIndex] ?? cfis[0];

      if (!initialCfi && targetCfi) {
        try {
          await rendition.display(targetCfi);
        } catch {
          // ignore
        }
      }

      for (let i = 0; i < cfis.length; i++) {
        const cfi = cfis[i];
        try {
          rendition.annotations?.highlight?.(
            cfi,
            {},
            undefined,
            i === targetIndex ? "epub-search-highlight-active" : "epub-search-highlight"
          );
          activeSearchHighlightsRef.current.push(cfi);
        } catch {
          // ignore
        }
      }
    }
  }, [book, highlightQuery, initialCfi, initialSearchMatchIndex, initialSearchTextQuote, rendition, searchEntireBook, searchVisibleContents]);

  useEffect(() => {
    let cancelled = false;
    // Full-book passage searches can load many sections; give them room to
    // finish before declaring the jump failed.
    const timeout = setTimeout(() => {
      if (cancelled) return;
      console.warn("EPUBViewer: applySearchHighlights timed out, skipping exact navigation");
    }, 15000);
    applySearchHighlights().finally(() => {
      clearTimeout(timeout);
    });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      try {
        for (const cfi of activeSearchHighlightsRef.current) {
          rendition?.annotations?.remove?.(cfi, "highlight");
        }
      } catch {
        // ignore
      }
      activeSearchHighlightsRef.current = [];
    };
  }, [applySearchHighlights, rendition]);

  useEffect(() => {
    if (!rendition || !book) return;

    const trimmedQuery = searchQuery?.trim() ?? "";
    const searchVersion = ++liveSearchVersionRef.current;

    if (!trimmedQuery) {
      liveSearchResultsRef.current = [];
      activeLiveSearchCfiRef.current = null;
      removeSearchAnnotations(liveSearchHighlightsRef.current);
      liveSearchHighlightsRef.current = [];
      reportLiveSearchResults("", [], null);
      return;
    }

    // Debounce: only run the heavy search after user stops typing
    const debounceTimer = setTimeout(async () => {
      let results: any[] = [];
      let visibleCfis: string[] = [];
      try {
        if (typeof (book as any).search === "function") {
          results = await (book as any).search(trimmedQuery);
        }
      } catch (error) {
        console.warn("EPUBViewer: live search failed:", error);
        results = [];
      }

      visibleCfis = searchVisibleContents(trimmedQuery);

      if (liveSearchVersionRef.current !== searchVersion) {
        return;
      }

      const indexedResults = (results || [])
        .map((result: any) => ({
          cfi: result?.cfi ?? result?.cfiRange,
          excerpt: result?.excerpt,
          text: result?.text,
          chapter: result?.chapter,
          href: result?.href,
        }))
        .filter((result) => result.cfi)
        .map((result) => ({ ...result, cfi: String(result.cfi) }));
      const indexedCfis = indexedResults.map((result) => result.cfi);
      const cfis = Array.from(new Set([
        ...indexedCfis,
        ...visibleCfis,
      ]));

      liveSearchResultsRef.current = cfis;
      const targetIndex =
        indexedResults.length > 0
          ? chooseSearchResultIndex(indexedResults, searchMatchIndex, initialSearchTextQuote)
          : searchMatchIndex;

      await renderLiveSearchHighlights(cfis, targetIndex, {
        navigate: cfis.length > 0,
      });
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [book, initialSearchTextQuote, rendition, removeSearchAnnotations, renderLiveSearchHighlights, reportLiveSearchResults, searchMatchIndex, searchQuery, searchVisibleContents]);

  useEffect(() => {
    if (!rendition) return;
    if (!(searchQuery?.trim())) return;
    if (liveSearchResultsRef.current.length === 0) return;

    void renderLiveSearchHighlights(liveSearchResultsRef.current, searchMatchIndex, {
      navigate: true,
    });
  }, [rendition, renderLiveSearchHighlights, searchMatchIndex, searchQuery]);

  useEffect(() => {
    if (!rendition) return;

    try {
      for (const cfi of activePersistedHighlightsRef.current) {
        rendition.annotations?.remove?.(cfi, "highlight");
      }
    } catch {
      // ignore
    }
    activePersistedHighlightsRef.current = [];

    for (const highlight of persistedHighlights) {
      try {
        // epub.js renders highlights as SVG <rect> elements, not DOM spans.
        // The color must be passed as the SVG `fill` attribute (a CSS
        // `background-color` here is a no-op on SVG, which is why every color
        // previously collapsed to epub.js's default `fill="yellow"`).
        // Override fill-opacity to 1 so the rgba's own alpha is the only
        // alpha applied (epub.js defaults fill-opacity to 0.3, which would
        // multiply with the rgba alpha and wash the colors out).
        rendition.annotations?.highlight?.(
          highlight.cfiRange,
          {},
          undefined,
          "epub-persisted-highlight",
          {
            fill: normalizeHighlightColor(highlight.color),
            "fill-opacity": "1",
          }
        );
        activePersistedHighlightsRef.current.push(highlight.cfiRange);
      } catch (error) {
        console.warn("EPUBViewer: Failed to render persisted highlight", error);
      }
    }

    return () => {
      try {
        for (const cfi of activePersistedHighlightsRef.current) {
          rendition.annotations?.remove?.(cfi, "highlight");
        }
      } catch {
        // ignore
      }
      activePersistedHighlightsRef.current = [];
    };
  }, [persistedHighlights, removeSearchAnnotations, rendition]);

  useEffect(() => {
    return () => {
      removeSearchAnnotations(liveSearchHighlightsRef.current);
      liveSearchHighlightsRef.current = [];
      liveSearchResultsRef.current = [];
      activeLiveSearchCfiRef.current = null;
    };
  }, [removeSearchAnnotations]);

  const handlePrevPage = () => {
    if (rendition) {
      const startIdx = metadata?.chunkStartSpineIndex;
      if (startIdx !== undefined) {
        const location = rendition.currentLocation() as any;
        const currentSpineIndex = location?.start?.index;
        if (typeof currentSpineIndex === 'number' && currentSpineIndex <= startIdx) {
          return;
        }
      }
      rendition.prev();
    }
  };

  const handleNextPage = () => {
    if (rendition) {
      const endIdx = metadata?.chunkEndSpineIndex;
      if (endIdx !== undefined) {
        const location = rendition.currentLocation() as any;
        const currentSpineIndex = location?.start?.index;
        if (typeof currentSpineIndex === 'number' && currentSpineIndex >= endIdx) {
          return;
        }
      }
      rendition.next();
    }
  };

  useEffect(() => {
    if (!embedded) return;
    const previousPage = () => handlePrevPage();
    const nextPage = () => handleNextPage();
    window.addEventListener("incrementum-epub-previous-page", previousPage);
    window.addEventListener("incrementum-epub-next-page", nextPage);
    return () => {
      window.removeEventListener("incrementum-epub-previous-page", previousPage);
      window.removeEventListener("incrementum-epub-next-page", nextPage);
    };
  }, [embedded, rendition, metadata]);

  // Watch for TTS chapter advance signal
  const chapterSignalRef = useRef(advanceChapterSignal);
  useEffect(() => {
    if (advanceChapterSignal !== undefined && advanceChapterSignal !== chapterSignalRef.current) {
      chapterSignalRef.current = advanceChapterSignal;
      handleNextPage();
    }
  }, [advanceChapterSignal]);

  const buildSyncMapForChapter = useCallback(() => {
    if (!rendition || syncSegmentsRef.current.length === 0) return;

    const contentsList = rendition.getContents?.() ?? [];
    if (contentsList.length === 0) return;

    for (const contents of contentsList) {
      const map = buildSegmentCfiMap(contents, syncSegmentsRef.current);
      if (map.size > 0) {
        syncMapRef.current = map;
        onSyncStateChange?.({
          status: "ready",
          mappedCount: map.size,
          totalSegments: syncSegmentsRef.current.length,
        });
        return;
      }
    }

    onSyncStateChange?.({
      status: "error",
      mappedCount: 0,
      totalSegments: syncSegmentsRef.current.length,
    });
  }, [rendition, onSyncStateChange]);

  // Ref so the relocated handler can call the latest version
  const buildSyncMapRef = useRef(buildSyncMapForChapter);
  buildSyncMapRef.current = buildSyncMapForChapter;

  // Keep syncSegments ref up to date
  useEffect(() => {
    syncSegmentsRef.current = syncSegments ?? [];
    syncMapRef.current = new Map();
    syncCurrentChapterRef.current = null;
    if (syncSegments && syncSegments.length > 0) {
      onSyncStateChange?.({ status: "building", mappedCount: 0, totalSegments: syncSegments.length });
      const timer = setTimeout(() => buildSyncMapRef.current(), 300);
      return () => clearTimeout(timer);
    } else {
      onSyncStateChange?.({ status: "idle", mappedCount: 0, totalSegments: 0 });
    }
  }, [syncSegments, buildSyncMapForChapter, onSyncStateChange]);

  // Audiobook sync: highlight active segment
  const lastSyncSegmentIdxRef = useRef<number | null>(null);
  const syncJumpSignalRef = useRef(syncJumpSignal);
  useEffect(() => {
    // syncJumpSignal forces re-highlight of current segment
    if (syncJumpSignal !== undefined && syncJumpSignal !== syncJumpSignalRef.current) {
      syncJumpSignalRef.current = syncJumpSignal;
      lastSyncSegmentIdxRef.current = null; // force re-process
    }
  }, [syncJumpSignal]);

  useEffect(() => {
    if (!rendition || !syncSegments || syncSegments.length === 0) return;
    if (syncCurrentTime === undefined || syncCurrentTime === null) return;
    if (syncMapRef.current.size === 0) return;

    const active = findActiveSegment(syncSegments, syncCurrentTime);
    if (!active || active.index === lastSyncSegmentIdxRef.current) return;

    const cfi = syncMapRef.current.get(active.index);
    if (!cfi) return;

    lastSyncSegmentIdxRef.current = active.index;

    if (activeSyncHighlightRef.current) {
      try { rendition.annotations?.remove?.(activeSyncHighlightRef.current, "highlight"); } catch { /* ignore */ }
    }

    // Add new highlight
    try {
      rendition.annotations?.highlight?.(cfi, {}, undefined, "epub-sync-highlight");
      activeSyncHighlightRef.current = cfi;
    } catch { /* ignore */ }

    // Auto-scroll
    try {
      syncNavigatingRef.current = true;
      rendition.display(cfi);
      setTimeout(() => { syncNavigatingRef.current = false; }, 500);
    } catch { /* ignore */ }
  }, [rendition, syncSegments, syncCurrentTime, syncJumpSignal]);

  const handleTocClick = async (href: string) => {
    if (!rendition || !book) {
      console.warn("EPUBViewer: Cannot navigate - rendition or book not ready");
      return;
    }

    try {
      const normalizeHref = (value: string) =>
        value.replace(/^\.?\//, "").split("#")[0];
      const [rawPath, rawFragment] = href.split("#");
      const normalizedPath = normalizeHref(rawPath);

      const spine = await book.loaded.spine;

      // Try to find the spine item by href
      let spineItem = spine.get(normalizedPath);

      // If not found directly, try to find by searching the spine
      if (!spineItem) {
        // Search through spine items for a match
        for (const item of spine.items) {
          const itemHref = normalizeHref(item.href || "");
          if (itemHref === normalizedPath || itemHref?.endsWith?.(normalizedPath)) {
            spineItem = item;
            break;
          }
        }
      }

      // If we found the spine item, navigate to it
      if (spineItem) {
        const targetHref = rawFragment ? `${spineItem.href}#${rawFragment}` : spineItem.href;

        // Method 1: Use rendition.display with the full href (preserves anchor fragments)
        try {
          await rendition.display(targetHref);
          return;
        } catch (e) {
          console.error("EPUBViewer: rendition.display failed:", e);
        }

        // Method 2: Use spine.goto with index (ignores fragments, but works as fallback)
        try {
          if (typeof spineItem.index === 'number') {
            await spine.goto(spineItem.index);
            return;
          }
        } catch (e) {
          console.error("EPUBViewer: spine.goto with index failed:", e);
        }

        // Method 3: Try navigating to the URL directly
        try {
          await rendition.display(spineItem.url || targetHref);
          return;
        } catch (e) {
          console.error("EPUBViewer: URL navigation failed:", e);
        }

        console.warn("EPUBViewer: All navigation methods failed for href:", href);
        return;
      }

      // Fallback: Try to navigate to the href directly
      try {
        await rendition.display(rawFragment ? `${normalizedPath}#${rawFragment}` : normalizedPath);
        return;
      } catch (e) {
        console.error("EPUBViewer: Direct href navigation failed:", e);
      }

      // Try searching through TOC to find a matching item
      const searchToc = (items: any[]): any => {
        for (const item of items) {
          if (item.href === href || item.href?.endsWith?.(href)) {
            return item;
          }
          if (item.subitems) {
            const found = searchToc(item.subitems);
            if (found) return found;
          }
        }
        return null;
      };

      const tocItem = searchToc(toc);
      if (tocItem) {
        const tocPath = normalizeHref(tocItem.href || "");
        await rendition.display(tocPath || tocItem.href);
        return;
      }

      console.warn("EPUBViewer: Could not resolve TOC href:", href);
    } catch (error) {
      console.error("EPUBViewer: Error navigating to TOC item:", error);
    }
  };

  const scrollEpub = useCallback((direction: "up" | "down") => {
    const step = 120;
    const target = direction === "down" ? step : -step;

    const getScrollableElement = (root: HTMLElement): HTMLElement | null => {
      // Prevent traversing inside iframes to avoid getting hijacked by sub-documents
      if (root.tagName === "IFRAME") return null;

      if (root.scrollHeight > root.clientHeight) {
        const style = window.getComputedStyle(root);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          return root;
        }
      }
      for (let i = 0; i < root.children.length; i++) {
        const child = root.children[i] as HTMLElement;
        const found = getScrollableElement(child);
        if (found) return found;
      }
      return null;
    };

    const root = viewerRef.current;
    if (root) {
      const scrollable = getScrollableElement(root);
      if (scrollable) {
        scrollable.scrollBy({ top: target, behavior: "smooth" });
        return;
      }
    }

    const iframe = viewerRef.current?.querySelector("iframe");
    if (iframe?.contentWindow) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const el = doc.scrollingElement || doc.documentElement || doc.body;
        if (el) {
          el.scrollBy({ top: target, behavior: "smooth" });
        }
      } catch (e) {
        console.warn("EPUBViewer: Failed to scroll iframe:", e);
      }
    }
  }, []);

  const getFlatToc = useCallback(() => {
    const flat: any[] = [];
    const traverse = (items: any[]) => {
      for (const item of items) {
        flat.push(item);
        if (item.subitems && item.subitems.length > 0) {
          traverse(item.subitems);
        }
      }
    };
    traverse(tocRef.current || []);
    return flat;
  }, []);

  const getCurrentTocIndex = useCallback((flat: any[]) => {
    if (!rendition) return -1;
    try {
      const currentLocation = rendition.currentLocation() as any;
      const currentHref = currentLocation?.start?.href;
      if (!currentHref) return -1;

      const normalize = (h: string) => h.replace(/^\.?\//, "").split("#")[0];
      const normCurrent = normalize(currentHref);

      let index = flat.findIndex(item => item.href && normalize(item.href) === normCurrent);
      if (index !== -1) return index;

      index = flat.findIndex(item => item.href && (normalize(item.href).endsWith(normCurrent) || normCurrent.endsWith(normalize(item.href))));
      return index;
    } catch {
      return -1;
    }
  }, [rendition]);

  const handlePrevToc = useCallback(async () => {
    const flat = getFlatToc();
    if (flat.length === 0) return;
    const currentIndex = getCurrentTocIndex(flat);
    if (currentIndex > 0) {
      await handleTocClick(flat[currentIndex - 1].href);
    } else if (currentIndex === -1) {
      await handleTocClick(flat[0].href);
    }
  }, [getFlatToc, getCurrentTocIndex, handleTocClick]);

  const handleNextToc = useCallback(async () => {
    const flat = getFlatToc();
    if (flat.length === 0) return;
    const currentIndex = getCurrentTocIndex(flat);
    if (currentIndex !== -1 && currentIndex < flat.length - 1) {
      await handleTocClick(flat[currentIndex + 1].href);
    } else if (currentIndex === -1) {
      await handleTocClick(flat[0].href);
    }
  }, [getFlatToc, getCurrentTocIndex, handleTocClick]);

  const handleEPUBKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't trigger if typing in input
    if ((e.target as HTMLElement).tagName === "INPUT" ||
      (e.target as HTMLElement).tagName === "TEXTAREA" ||
      (e.target as HTMLElement).isContentEditable) {
      return;
    }

    // Volume rocker scrolling/paging
    if (handleVolumeRockerNavigation(
      e,
      settings.interface.volumeRockerScroll || "none",
      {
        pageUp: () => {
          if (isMobile) {
            try {
              window.dispatchEvent(new CustomEvent("incrementum-queue-hide-controls"));
            } catch { /* ignore */ }
          }
          handlePrevPage();
        },
        pageDown: () => {
          if (isMobile) {
            try {
              window.dispatchEvent(new CustomEvent("incrementum-queue-hide-controls"));
            } catch { /* ignore */ }
          }
          handleNextPage();
        },
        scrollUp: () => {
          if (isMobile) {
            try {
              window.dispatchEvent(new CustomEvent("incrementum-queue-hide-controls"));
            } catch { /* ignore */ }
          }
          scrollEpub("up");
        },
        scrollDown: () => {
          if (isMobile) {
            try {
              window.dispatchEvent(new CustomEvent("incrementum-queue-hide-controls"));
            } catch { /* ignore */ }
          }
          scrollEpub("down");
        },
      },
    )) return;

    const lowerKey = e.key.toLowerCase();

    // Ctrl/Cmd + Plus to increase font size
    if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      increaseFontSize();
    }
    // Ctrl/Cmd + Minus to decrease font size
    else if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      decreaseFontSize();
    }
    // Ctrl/Cmd + 0 to reset font size
    else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
      e.preventDefault();
      resetFontSize();
    }
    
    // J / K scroll navigation (suppressed when vim reading mode is active)
    else if (lowerKey === "j") {
      if (useVimModeStore.getState().mode === "inactive") {
        e.preventDefault();
        scrollEpub("down");
      }
    } else if (lowerKey === "k") {
      if (useVimModeStore.getState().mode === "inactive") {
        e.preventDefault();
        scrollEpub("up");
      }
    }

    // H / L and Arrow keys for TOC navigation (suppressed when vim mode is active)
    else if (lowerKey === "h" || e.key === "ArrowLeft") {
      if (useVimModeStore.getState().mode === "inactive") {
        e.preventDefault();
        void handlePrevToc();
      }
    } else if (lowerKey === "l" || e.key === "ArrowRight") {
      if (useVimModeStore.getState().mode === "inactive") {
        e.preventDefault();
        void handleNextToc();
      }
    }

    // Home / End boundaries
    else if (e.key === "Home") {
      e.preventDefault();
      const flat = getFlatToc();
      if (flat.length > 0) {
        void handleTocClick(flat[0].href);
      }
    } else if (e.key === "End") {
      e.preventDefault();
      const flat = getFlatToc();
      if (flat.length > 0) {
        void handleTocClick(flat[flat.length - 1].href);
      }
    }
  }, [decreaseFontSize, increaseFontSize, resetFontSize, scrollEpub, handlePrevToc, handleNextToc, getFlatToc, handleTocClick, handlePrevPage, handleNextPage, settings.interface.volumeRockerScroll]);

  // Keep ref up to date on every render
  useEffect(() => {
    handleEPUBKeyDownRef.current = handleEPUBKeyDown;
  }, [handleEPUBKeyDown]);

  useEffect(() => {
    if (isMobile && (!settings.interface.volumeRockerScroll || settings.interface.volumeRockerScroll === "none")) {
      return;
    }

    const handleWheel = (e: WheelEvent) => {
      // Ctrl/Cmd + Scroll to change font size
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          increaseFontSize();
        } else {
          decreaseFontSize();
        }
      }
    };

    window.addEventListener("keydown", handleEPUBKeyDown);
    const viewerElement = viewerRef.current;
    if (viewerElement) {
      viewerElement.addEventListener("wheel", handleWheel, { passive: false });
    }

    return () => {
      window.removeEventListener("keydown", handleEPUBKeyDown);
      if (viewerElement) {
        viewerElement.removeEventListener("wheel", handleWheel);
      }
    };
  }, [handleEPUBKeyDown, decreaseFontSize, increaseFontSize, isMobile, settings.interface.volumeRockerScroll]);

  const handleReaderTap = (event: MouseEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    if ((event.target as HTMLElement).closest('[data-chrome-control="true"]')) {
      return;
    }
    if (selectionActiveRef.current) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const zone = x / rect.width;

    if (zone < 0.33) {
      handlePrevPage();
      return;
    }
    if (zone > 0.66) {
      handleNextPage();
      return;
    }

    setChromeVisible((prev) => !prev);
  };

  const handleCommandPaletteHotkey = useCallback((e: KeyboardEvent) => {
    if (isCommandPaletteOpenShortcut(e)) {
      e.preventDefault();
      dispatchCommandPaletteOpen();
    }
  }, []);

  const handleExtractTextHotkey = useCallback((e: KeyboardEvent) => {
    const combo = getShortcutCombo("edit.extract-text");
    if (combo && eventMatchesCombo(e, combo)) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("extract-text"));
    }
  }, []);

  const handlePriorityHotkey = useCallback((e: KeyboardEvent) => {
    const combo = getShortcutCombo("doc.priority");
    if (combo && eventMatchesCombo(e, combo)) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("doc-priority-shortcut"));
    }
  }, []);

  const handleSelectionChange = useCallback((contents: any) => {
    const selection = contents.window.getSelection();
    const selectedText = selection?.toString().trim() || "";
    const hasSelection = selectedText.length > 0;
    selectionActiveRef.current = hasSelection;

    let ctx: EpubSelectionContext | null = null;
    if (hasSelection && selection && selection.rangeCount > 0) {
      try {
        const range = selection.getRangeAt(0);
        const cfiRange = contents.cfiFromRange?.(range);
        if (cfiRange) {
          ctx = {
            type: "epub",
            documentId: documentId ?? "",
            cfiRange: String(cfiRange),
            selectedText: selectedText,
          };
          lastEpubSelectionContextRef.current = ctx;
        }
      } catch (e) {
        console.warn("EPUBViewer: Failed to generate cfiRange for selection:", e);
      }
    }

    // Always notify parent of selection changes (both selection and clearing)
    onSelectionChange?.(selectedText, ctx);
  }, [onSelectionChange, documentId]);

  return (
    <div
      className="flex flex-col h-full bg-background relative overflow-hidden"
      style={{
        // The top safe-area inset is applied once at the .app-shell wrapper so the
        // reader clears the status bar. Don't re-apply it here — that compounds the
        // inset and wastes ~1/5 of the screen. Keep the bottom inset so the reader's
        // own bottom chrome clears the gesture/nav area.
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive text-destructive rounded-lg m-4">
          {t("viewer.failedToLoadEpub", { error })}
          {/* If this is a synced EPUB whose file hasn't transferred yet, offer
              a download instead of just showing a dead-end error. The doc's
              fileId links to the file manifest / transfer manager. */}
          {doc && <ReaderFileDownload doc={doc} />}
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-50">
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
            <div className="text-muted-foreground">{t("viewer.loadingEpub")}</div>
          </div>
        </div>
      )}

      {!isMobile && (
        <>
          {/* Font size control panel */}
          <div
            className={cn(
              "absolute top-4 right-16 z-30 bg-card border border-border rounded-lg shadow-lg transition-all",
              showFontSizeControl ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            <div className="p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground mb-2">{t("viewer.fontSize")}</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={decreaseFontSize}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  title={t("viewer.decreaseFontSize")}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
                <span className="text-sm font-medium min-w-[50px] text-center">{epubSettings.fontSize}px</span>
                <button
                  onClick={increaseFontSize}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  title={t("viewer.increaseFontSize")}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              <button
                onClick={resetFontSize}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("viewer.reset")}
              </button>
            </div>
          </div>

          {/* Floating font size toggle button */}
          <button
            onClick={() => setShowFontSizeControl(!showFontSizeControl)}
            className="absolute top-4 right-4 z-30 p-2 bg-card border border-border rounded-lg shadow-md hover:shadow-lg transition-all"
            title={t("viewer.fontSizeSettings")}
          >
            <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
        </>
      )}

      {isMobile && (
        <>
          {/* Tap area to toggle chrome - small trigger zones at edges, not full coverage */}
          {chromeVisible ? (
            // When visible, just a small tap area to hide (top bar area already handles this)
            <div
              className="absolute inset-x-0 bottom-0 h-20 z-30 pointer-events-auto"
              onClick={() => setChromeVisible(false)}
              aria-hidden="true"
            />
          ) : (
            // When hidden, small edge triggers to show
            <>
              <div
                className="absolute inset-x-0 top-0 h-16 z-30 pointer-events-auto"
                onClick={() => setChromeVisible(true)}
                aria-hidden="true"
              />
              <div
                className="absolute inset-x-0 bottom-0 h-16 z-30 pointer-events-auto"
                onClick={() => setChromeVisible(true)}
                aria-hidden="true"
              />
            </>
          )}

          {/* Mobile chrome - Top Bar */}
          <div
            className={cn(
              "absolute left-0 right-0 top-0 z-40 transition-all duration-300",
              chromeVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-full pointer-events-none"
            )}
          >
              <div className="mx-3 mt-3 rounded-2xl bg-background/95 backdrop-blur border border-border shadow-lg">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                    {onBack && !embedded && (
                      <button
                        type="button"
                        data-chrome-control="true"
                        onClick={onBack}
                        className="p-1.5 rounded-full border border-border bg-card text-foreground hover:bg-muted active:scale-95 transition-all min-w-[32px] min-h-[32px] flex items-center justify-center"
                        aria-label="Back"
                      >
                        <CaretLeft className="w-4 h-4" />
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground truncate">{fileName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {currentChapter || t("viewer.reading")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">{progressPercent}%</span>
                    <button
                      type="button"
                      data-chrome-control="true"
                      onClick={() => setShowTocDrawer(true)}
                      className="px-3 py-1.5 text-xs rounded-full border border-border bg-card text-foreground"
                    >
                      TOC
                    </button>
                    <button
                      type="button"
                      data-chrome-control="true"
                      onClick={() => setShowSettingsSheet(true)}
                      className="px-3 py-1.5 text-xs rounded-full border border-border bg-card text-foreground"
                    >
                      Aa
                    </button>
                    <button
                      type="button"
                      data-chrome-control="true"
                      onClick={handlePrevPage}
                      className="p-1.5 rounded-full border border-border bg-card text-foreground"
                      aria-label={t("viewer.prev")}
                    >
                      <CaretLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      data-chrome-control="true"
                      onClick={handleNextPage}
                      className="p-1.5 rounded-full border border-border bg-card text-foreground"
                      aria-label={t("viewer.next")}
                    >
                      <CaretRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      data-chrome-control="true"
                      onClick={() => setChromeVisible(false)}
                      className="p-1.5 rounded-full border border-border bg-card text-foreground"
                      aria-label={t("viewer.hideToolbar")}
                    >
                      <CaretUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

          {/* Floating Expand Buttons (when chrome is hidden) */}
          {!chromeVisible && (
            <>
              {/* Top-left: Show toolbar button */}
              <button
                type="button"
                onClick={() => setChromeVisible(true)}
                className="absolute top-4 left-4 z-40 p-2.5 rounded-full bg-background/95 backdrop-blur border border-border shadow-lg active:scale-95 transition-all"
                aria-label={t("viewer.showToolbar")}
              >
                <CaretDown className="w-5 h-5 text-foreground" />
              </button>

              {/* Top-right: TOC quick access */}
              <button
                type="button"
                onClick={() => setShowTocDrawer(true)}
                className="absolute top-4 right-16 z-40 p-2.5 rounded-full bg-background/95 backdrop-blur border border-border shadow-lg active:scale-95 transition-all"
                aria-label={t("viewer.openTableOfContents")}
              >
                <List className="w-5 h-5 text-foreground" />
              </button>

              {/* Top-right: Settings quick access */}
              <button
                type="button"
                onClick={() => setShowSettingsSheet(true)}
                className="absolute top-4 right-4 z-40 p-2.5 rounded-full bg-background/95 backdrop-blur border border-border shadow-lg active:scale-95 transition-all"
                aria-label={t("viewer.openSettings")}
              >
                <Gear className="w-5 h-5 text-foreground" />
              </button>

              {/* Bottom center: Show toolbar & progress */}
              <button
                type="button"
                onClick={() => setChromeVisible(true)}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-background/95 backdrop-blur border border-border shadow-lg active:scale-95 transition-all flex items-center gap-2"
                aria-label={t("viewer.showToolbar")}
              >
                <CaretUp className="w-4 h-4 text-foreground" />
                <span className="text-xs font-medium text-foreground">{progressPercent}%</span>
              </button>
            </>
          )}

          {/* Mobile TOC drawer */}
          {showTocDrawer && (
            <div className="fixed inset-0 z-[60] bg-background/60 backdrop-blur-sm" onClick={() => setShowTocDrawer(false)}>
              <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border border-border bg-card max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                  <div className="text-sm font-semibold text-foreground">{t("viewer.tableOfContents")}</div>
                  <button
                    type="button"
                    data-chrome-control="true"
                    onClick={() => setShowTocDrawer(false)}
                    className="text-sm text-muted-foreground px-3 py-2 min-h-[44px]"
                  >
                    {t("viewer.close")}
                  </button>
                </div>
                <div className="overflow-y-auto flex-1">
                  {toc.map((chapter, index) => (
                    <button
                      key={index}
                      data-chrome-control="true"
                      onClick={() => {
                        handleTocClick(chapter.href);
                        setShowTocDrawer(false);
                      }}
                      className="block w-full text-left px-4 py-3 text-sm text-foreground border-b border-border/40 hover:bg-muted transition-colors min-h-[48px]"
                    >
                      {chapter.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Mobile settings sheet */}
          {showSettingsSheet && (
            <div className="fixed inset-0 z-[60] bg-background/60 backdrop-blur-sm" onClick={() => setShowSettingsSheet(false)}>
              <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border border-border bg-card p-4 space-y-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-foreground">{t("viewer.readingSettings")}</div>
                  <button
                    type="button"
                    data-chrome-control="true"
                    onClick={() => setShowSettingsSheet(false)}
                    className="text-sm text-muted-foreground px-3 py-2 min-h-[44px]"
                  >
                    {t("viewer.close")}
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">{t("viewer.fontSize")}</div>
                  <div className="flex items-center justify-center gap-4">
                    <button
                      type="button"
                      data-chrome-control="true"
                      onClick={decreaseFontSize}
                      className="px-4 py-3 text-sm rounded-full border border-border bg-card text-foreground min-w-[60px] min-h-[44px] hover:bg-muted transition-colors"
                    >
                      A-
                    </button>
                    <div className="text-base font-medium text-foreground min-w-[60px] text-center">{epubSettings.fontSize}px</div>
                    <button
                      type="button"
                      data-chrome-control="true"
                      onClick={increaseFontSize}
                      className="px-4 py-3 text-sm rounded-full border border-border bg-card text-foreground min-w-[60px] min-h-[44px] hover:bg-muted transition-colors"
                    >
                      A+
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">{t("viewer.lineHeight")}</div>
                  <div className="flex items-center justify-center gap-4">
                    <button
                      type="button"
                      data-chrome-control="true"
                      onClick={() => updateLineHeight(epubSettings.lineHeight - 0.1)}
                      className="px-4 py-3 text-sm rounded-full border border-border bg-card text-foreground min-w-[60px] min-h-[44px] hover:bg-muted transition-colors"
                    >
                      -
                    </button>
                    <div className="text-base font-medium text-foreground min-w-[60px] text-center">{epubSettings.lineHeight.toFixed(2)}</div>
                    <button
                      type="button"
                      data-chrome-control="true"
                      onClick={() => updateLineHeight(epubSettings.lineHeight + 0.1)}
                      className="px-4 py-3 text-sm rounded-full border border-border bg-card text-foreground min-w-[60px] min-h-[44px] hover:bg-muted transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">{t("viewer.font")}</div>
                  <div className="flex items-center gap-2">
                    {(["serif", "sans-serif", "monospace"] as const).map((family) => (
                      <button
                        key={family}
                        type="button"
                        data-chrome-control="true"
                        onClick={() => updateFontFamily(family)}
                        className={cn(
                          "px-3 py-1.5 text-xs rounded-full border",
                          epubSettings.fontFamily === family
                            ? "border-primary text-primary"
                            : "border-border text-foreground"
                        )}
                      >
                        {family === "sans-serif" ? t("viewer.sans") : family === "serif" ? t("viewer.serif") : t("viewer.mono")}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Main content area with sidebar and viewer */}
      <div className="flex flex-1 overflow-hidden relative" onClick={handleReaderTap}>
        {/* Sidebar - Table of Contents (sibling to viewer) */}
        {!isMobile && toc.length > 0 && showDesktopToc && (
          <div className="w-64 border-r border-border bg-card overflow-y-auto z-10 flex-shrink-0">
            <div className="p-4 border-b border-border flex items-center justify-between gap-3">
              <h3 className="font-semibold text-foreground">{t("viewer.tableOfContents")}</h3>
              <button
                type="button"
                onClick={() => setShowDesktopToc(false)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label={t("viewer.close")}
                title={t("viewer.close")}
              >
                <List className="w-3.5 h-3.5" />
                <span>{t("viewer.close")}</span>
              </button>
            </div>
            <nav className="p-2">
              {toc.map((chapter, index) => (
                <button
                  key={index}
                  onClick={() => handleTocClick(chapter.href)}
                  className="block w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md transition-colors"
                >
                  {chapter.label}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* EPUB viewer container - epubjs renders directly into this */}
        <div className="flex-1 overflow-hidden relative">
          {!isMobile && toc.length > 0 && !showDesktopToc && (
            <button
              type="button"
              onClick={() => setShowDesktopToc(true)}
              className="absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-2 text-sm text-foreground shadow-lg backdrop-blur-sm hover:bg-muted transition-colors"
              aria-label={t("viewer.openTableOfContents")}
              title={t("viewer.openTableOfContents")}
            >
              <List className="w-4 h-4" />
              <span>{t("viewer.tableOfContents")}</span>
            </button>
          )}
          <div
            ref={viewerRef}
            className="absolute inset-0"
            data-epub-viewer="true"
            style={{ opacity: isLoading ? 0 : 1 }}
          />
        </div>
      </div>

      {/* Help tooltip */}
      {!isMobile && (
        <div className="absolute bottom-4 left-4 z-20 text-xs text-muted-foreground bg-background/95 backdrop-blur-sm px-2 py-1 rounded border border-border shadow-sm">
          Ctrl +/-/+ to resize • Ctrl+Scroll to resize • Ctrl+0 to reset
        </div>
      )}
    </div>
  );
}
