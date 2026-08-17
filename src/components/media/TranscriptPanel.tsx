import { useEffect, useRef, useState } from "react";
import { useTranscriptionStore } from "../../stores/useTranscriptionStore";
import {
  CircleNotch,
  MagnifyingGlass,
  PlayCircle,
  Scroll,
} from "@phosphor-icons/react";
import { cn } from "../../utils";
import { useMobileShell } from "../../hooks/useMobileShell";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  SelectionActionsSheet,
  passageAroundSelection,
  type SelectionAiAction,
} from "../viewer/SelectionActionsSheet";
import { useSelectionInteraction } from "../viewer/selectionInteraction/useSelectionInteraction";
import {
  SelectionActionBar,
  type SelectionBarAction,
} from "../viewer/selectionInteraction/SelectionActionBar";

const PROGRAMMATIC_SCROLL_LOCK_MS = 500;

interface TranscriptPanelProps {
  bookId: string;
  chapterId: string;
  currentTimeMs: number;
  onSeek: (ms: number) => void;
  isTranscribing?: boolean;
}

export function TranscriptPanel({
  bookId,
  chapterId,
  currentTimeMs,
  onSeek,
  isTranscribing,
}: TranscriptPanelProps) {
  const { activeSegments, loadTranscript } = useTranscriptionStore();
  // Shared preference with TranscriptSync so auto-follow is consistent across viewers.
  const [autoScroll, setAutoScroll] = useState<boolean>(() => {
    const saved = localStorage.getItem("transcript-autoscroll");
    return saved !== "false";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [followPausedByUser, setFollowPausedByUser] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);
  // Debounce timer for coalescing rapid segment transitions.
  const followDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Suppress redundant scrolls for the same active index.
  const lastCenteredKeyRef = useRef<string>("");
  const lastCenteredAtRef = useRef<number>(0);
  // User-scroll detection.
  const userScrollingRef = useRef<boolean>(false);
  const programmaticScrollRef = useRef<boolean>(false);
  const lastProgrammaticScrollAtRef = useRef<number>(0);
  const programmaticScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userTouchActiveRef = useRef<boolean>(false);
  const activeWasOutsideViewportRef = useRef<boolean>(false);

  useEffect(() => {
    loadTranscript(bookId, chapterId);
  }, [bookId, chapterId, loadTranscript]);

  // Mobile: a transcript selection opens the same actions sheet the reader
  // surfaces use. There is no transcript extract path, so the sheet shows copy
  // plus the AI actions.
  const isMobile = useMobileShell();
  const [mobileSelection, setMobileSelection] = useState({ text: "", passage: "", open: false });
  const sheetOpenRef = useRef(false);
  useEffect(() => {
    sheetOpenRef.current = mobileSelection.open;
  }, [mobileSelection.open]);

  // V2 (overhaul-reader-selection-ux task 6.1): the shared controller owns the
  // selection lifecycle — stability-gated bar instead of the sheet popping on
  // the first selectionchange, and AI runs that survive selection collapse.
  // The legacy listeners below stay for the flag-off rollback path.
  const selectionV2 = useSettingsStore((s) => s.settings.features.selectionInteractionV2) && isMobile;
  const [selectionBarOverflowOpen, setSelectionBarOverflowOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    action: SelectionAiAction;
    text: string;
    passage: string;
  } | null>(null);
  const controller = useSelectionInteraction({
    surface: "transcript",
    documentId: `${bookId}:${chapterId}`,
    enabled: selectionV2,
    onInvalidate: () => {
      setPendingAction(null);
      setSelectionBarOverflowOpen(false);
    },
  });
  useEffect(() => {
    if (!selectionV2 || !scrollRef.current) return;
    return controller.registerContentRoot(scrollRef.current);
  }, [selectionV2, controller]);

  useEffect(() => {
    if (selectionV2 || !isMobile) return;

    const handleSelectionChange = () => {
      if (sheetOpenRef.current) return;
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      const node = selection?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      if (!text || !element || !scrollRef.current?.contains(element)) {
        setMobileSelection(prev => (prev.open ? { ...prev, open: false } : prev));
        return;
      }
      setMobileSelection({ text, passage: passageAroundSelection(selection, text), open: true });
    };

    const handleTouchEnd = () => setTimeout(handleSelectionChange, 100);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("touchend", handleTouchEnd);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isMobile, selectionV2]);

  const handleBarAction = (action: SelectionBarAction) => {
    if (action === "extract") return; // transcripts have no extract path
    const snapshot = controller.captureForAction();
    if (!snapshot) return;
    setPendingAction({ action, text: snapshot.text, passage: snapshot.passage });
  };

  // Comfort-offset + debounced + user-scroll-aware auto-scroll. Mirrors the
  // algorithm in TranscriptSync.tsx so both viewers behave the same way.
  useEffect(() => {
    if (!autoScroll || followPausedByUser) return;
    if (!activeSegmentRef.current || !scrollRef.current) return;

    const now = Date.now();
    const activeKey = `${bookId}:${chapterId}:${currentTimeMs}`;
    // Guard against re-centering on the same instant (currentTime wobble).
    if (activeKey === lastCenteredKeyRef.current && now - lastCenteredAtRef.current < 400) {
      return;
    }

    if (followDebounceRef.current) clearTimeout(followDebounceRef.current);
    const container = scrollRef.current;
    const element = activeSegmentRef.current;
    followDebounceRef.current = setTimeout(() => {
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
      const elementHeight = elementRect.height;
      const containerHeight = containerRect.height;
      // Position the active line near the top quarter of the visible region.
      const targetScrollTop = relativeTop - containerHeight * 0.28 + elementHeight / 2;

      // Skip if already within the comfort band.
      const comfortTop = containerRect.top + containerHeight * 0.28;
      const comfortBottom = containerRect.bottom - containerHeight * 0.15;
      if (elementRect.top >= comfortTop && elementRect.bottom <= comfortBottom) {
        return;
      }

      lastCenteredKeyRef.current = activeKey;
      lastCenteredAtRef.current = Date.now();
      programmaticScrollRef.current = true;
      lastProgrammaticScrollAtRef.current = Date.now();
      container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
      if (programmaticScrollTimeoutRef.current) {
        clearTimeout(programmaticScrollTimeoutRef.current);
      }
      programmaticScrollTimeoutRef.current = setTimeout(() => {
        programmaticScrollRef.current = false;
        programmaticScrollTimeoutRef.current = null;
      }, PROGRAMMATIC_SCROLL_LOCK_MS);
    }, 150);

    return () => {
      if (followDebounceRef.current) {
        clearTimeout(followDebounceRef.current);
        followDebounceRef.current = null;
      }
    };
  }, [currentTimeMs, autoScroll, followPausedByUser, bookId, chapterId]);

  // Auto-resume when the active segment re-enters the visible region.
  useEffect(() => {
    if (!followPausedByUser) return;
    const container = scrollRef.current;
    const element = activeSegmentRef.current;
    if (!container || !element) return;
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const isVisible = elementRect.bottom > containerRect.top && elementRect.top < containerRect.bottom;
    if (!isVisible) {
      activeWasOutsideViewportRef.current = true;
    } else if (activeWasOutsideViewportRef.current) {
      activeWasOutsideViewportRef.current = false;
      setFollowPausedByUser(false);
    }
  }, [currentTimeMs, followPausedByUser]);

  // Detect manual scrolling and pause follow.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (userTouchActiveRef.current) {
        programmaticScrollRef.current = false;
      } else {
        if (programmaticScrollRef.current) return;
        if (Date.now() - lastProgrammaticScrollAtRef.current < 120) return;
      }
      userScrollingRef.current = true;
      if (autoScroll && !followPausedByUser) setFollowPausedByUser(true);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [autoScroll, followPausedByUser]);

  useEffect(() => {
    return () => {
      if (programmaticScrollTimeoutRef.current) {
        clearTimeout(programmaticScrollTimeoutRef.current);
      }
    };
  }, []);

  const toggleAutoScroll = (checked: boolean) => {
    setAutoScroll(checked);
    localStorage.setItem("transcript-autoscroll", String(checked));
    userScrollingRef.current = false;
    setFollowPausedByUser(false);
  };

  const handleTouchStart = () => {
    userTouchActiveRef.current = true;
    programmaticScrollRef.current = false;
    lastProgrammaticScrollAtRef.current = 0;
  };

  const handleTouchEnd = () => {
    requestAnimationFrame(() => {
      userTouchActiveRef.current = false;
    });
  };

  const filteredSegments = activeSegments.filter((s) =>
    s.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-background border-l border-border">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scroll className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground">Transcript</h3>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => toggleAutoScroll(e.target.checked)}
              className="rounded border-border"
            />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* MagnifyingGlass */}
      <div className="p-2 border-b border-border relative">
        <MagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search transcript..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-1.5 bg-muted/50 border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Content */}
      <div 
        ref={scrollRef}
        className="flex-1 transcript-scroll-container overflow-y-auto overscroll-contain p-4 space-y-4 custom-scrollbar"
        style={{ touchAction: "pan-y", overscrollBehaviorY: "contain" }}
        data-transcript-scroll="true"
        onTouchStartCapture={handleTouchStart}
        onTouchEndCapture={handleTouchEnd}
        onTouchCancelCapture={handleTouchEnd}
      >
        {isTranscribing && (
          <div className="flex items-center justify-center p-4 bg-primary/5 rounded-lg border border-primary/20">
            <CircleNotch className="w-4 h-4 text-primary animate-spin mr-2" />
            <span className="text-sm text-primary font-medium">Transcribing in background...</span>
          </div>
        )}

        {filteredSegments.length === 0 && !isTranscribing && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Scroll className="w-12 h-12 text-muted-foreground mb-4 opacity-20" />
            <p className="text-sm text-muted-foreground">No transcript available for this chapter.</p>
          </div>
        )}

        {filteredSegments.map((segment, index) => {
          const isActive = currentTimeMs >= segment.start_ms && currentTimeMs < segment.end_ms;
          
          return (
            <div
              key={index}
              ref={isActive ? activeSegmentRef : null}
              role="button"
              tabIndex={0}
              onClick={() => {
                // Seeking is explicit navigation: resume auto-follow.
                userScrollingRef.current = false;
                setFollowPausedByUser(false);
                onSeek(segment.start_ms);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  userScrollingRef.current = false;
                  setFollowPausedByUser(false);
                  onSeek(segment.start_ms);
                }
              }}
              className={cn(
                "group p-3 rounded-lg transition-all cursor-pointer border border-transparent hover:border-border",
                isActive ? "bg-primary/10 border-primary/20 shadow-sm" : "hover:bg-muted/50"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={cn(
                  "text-[10px] font-mono",
                  isActive ? "text-primary font-bold" : "text-muted-foreground"
                )}>
                  {formatMs(segment.start_ms)}
                </span>
                <PlayCircle className={cn(
                  "w-3 h-3 transition-opacity",
                  isActive ? "text-primary opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100"
                )} />
              </div>
              <p className={cn(
                "text-sm leading-relaxed",
                isActive ? "text-foreground font-medium" : "text-muted-foreground"
              )}>
                {segment.text}
              </p>
            </div>
          );
        })}
      </div>

      {selectionV2 && (
        <SelectionActionBar
          placement={controller.phase === "ready" ? controller.placement : null}
          onAction={handleBarAction}
          onOverflow={() => setSelectionBarOverflowOpen(true)}
          onDismiss={() => controller.dismiss({ suppressCurrentText: true })}
          canExtract={false}
          onMeasure={controller.registerBarSize}
        />
      )}

      <SelectionActionsSheet
        open={
          selectionV2
            ? selectionBarOverflowOpen ||
              controller.phase === "actionRunning" ||
              controller.phase === "resultVisible"
            : isMobile && mobileSelection.open
        }
        text={pendingAction?.text || (selectionV2 ? controller.readySelection?.text : mobileSelection.text) || mobileSelection.text}
        passage={pendingAction?.passage || (selectionV2 ? controller.readySelection?.passage : mobileSelection.passage)}
        initialAction={pendingAction?.action}
        operationId={selectionV2 ? controller.capturedAction?.operationId : undefined}
        onSettled={
          selectionV2
            ? (operationId, outcome) => controller.notifyActionSettled(operationId, outcome)
            : undefined
        }
        onClose={() => {
          if (selectionV2) {
            setPendingAction(null);
            setSelectionBarOverflowOpen(false);
            controller.dismiss({ suppressCurrentText: true });
            return;
          }
          setMobileSelection(prev => ({ ...prev, open: false }));
          window.getSelection()?.removeAllRanges();
        }}
      />
    </div>
  );
}

function formatMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
