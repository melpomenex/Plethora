import { useState, useEffect, useRef } from "react";
import {
  Clock,
  Copy,
  Download,
  KeyReturn,
  MagnifyingGlass,
  Play,
  Lightning,
} from "@phosphor-icons/react";

/**
 * Auto-follow tuning constants.
 *
 * `followOffsetRatio` positions the active segment's top at this fraction of
 * the container height (the active line "leads" the eye, with upcoming lines
 * visible below it). A smaller ratio is used for the compact mobile layout.
 */
const FOLLOW_OFFSET_RATIO_DESKTOP = 0.28;
const FOLLOW_OFFSET_RATIO_COMPACT = 0.18;
/** Coalesce rapid segment transitions (fast speech) into one smooth scroll. */
const FOLLOW_DEBOUNCE_MS = 150;
/** Prevent re-centering the *same* index when `currentTime` wobbles inside it. */
const FOLLOW_SAME_INDEX_MIN_MS = 400;
/**
 * A scroll event arriving this long after our own programmatic `scrollTo` is
 * treated as user-initiated (trackpads/inertia settle well inside this window).
 */
const USER_SCROLL_GRACE_MS = 120;
const AUTOSCROLL_STORAGE_KEY = "transcript-autoscroll";

/**
 * Transcript segment
 */
export interface TranscriptSegment {
  id: string;
  start: number; // Start time in seconds
  end: number; // End time in seconds
  text: string;
  speaker?: string;
}

export interface TranscriptSearchState {
  available: boolean;
  query: string;
  totalMatches: number;
  activeMatchIndex: number;
  activeSegmentId: string | null;
}

interface TranscriptSyncProps {
  segments: TranscriptSegment[];
  currentTime: number;
  onSeek?: (time: number) => void;
  /**
   * @deprecated use the in-header auto-follow toggle instead. Only used as the
   * initial default when no preference is stored in localStorage; a stored
   * preference always wins.
   */
  autoScroll?: boolean;
  showTimestamps?: boolean;
  showSpeakers?: boolean;
  onExport?: () => void;
  onSelectionChange?: (text: string) => void;
  className?: string;
  /**
   * Whether to render the built-in header (title, copy/export, search input).
   * Defaults to true. Set to false when the parent supplies its own toolbar
   * (e.g. a find bar with prev/next navigation) to avoid duplicate search boxes.
   */
  showHeader?: boolean;
  /**
   * Highlights matching terms without filtering the transcript.
   * Intended for "jump to match" flows (e.g., command palette search).
   */
  highlightQuery?: string;
  /**
   * Parent-controlled transcript search query. When provided, the transcript
   * highlights and navigates matches for this query instead of using local-only state.
   */
  searchQuery?: string;
  /**
   * Called when the transcript search query is edited via the local UI.
   */
  onSearchQueryChange?: (query: string) => void;
  /**
   * Parent-controlled active match index within the current query's matches.
   */
  activeMatchIndex?: number;
  /**
   * Called whenever transcript search availability or match state changes.
   */
  onSearchStateChange?: (state: TranscriptSearchState) => void;
  /**
   * Optionally emphasize and scroll to a specific segment id.
   */
  highlightedSegmentId?: string;
  /**
   * Whether to show paragraph-level grouping for better readability
   */
  groupParagraphs?: boolean;
  /**
   * Render a denser touch layout for constrained mobile video/transcript splits.
   */
  compact?: boolean;
}

export function TranscriptSync({
  segments = [],
  currentTime,
  onSeek,
  autoScroll = true,
  showTimestamps = true,
  showSpeakers = true,
  onExport,
  onSelectionChange,
  className = "flex-1 min-h-0",
  showHeader = true,
  highlightQuery,
  searchQuery: controlledSearchQuery,
  onSearchQueryChange,
  activeMatchIndex: controlledActiveMatchIndex,
  onSearchStateChange,
  highlightedSegmentId,
  groupParagraphs: _groupParagraphs = true,
  compact = false,
}: TranscriptSyncProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  // Persistent auto-follow preference (default on). When off, the active
  // segment is still highlighted but the panel never auto-scrolls. A stored
  // value always wins; otherwise the legacy `autoScroll` prop seeds the default
  // so existing callers that pass `autoScroll={false}` keep working.
  const [autoFollow, setAutoFollow] = useState<boolean>(() => {
    const saved = localStorage.getItem(AUTOSCROLL_STORAGE_KEY);
    if (saved === "true") return true;
    if (saved === "false") return false;
    return autoScroll;
  });
  // Transient "follow paused because the user scrolled away" state. Distinct
  // from `autoFollow` (the explicit toggle) — this clears itself when playback
  // catches up or the user seeks.
  const [followPausedByUser, setFollowPausedByUser] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);
  const highlightedSegmentRef = useRef<HTMLDivElement>(null);
  const selectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Debounce timer for coalescing rapid segment transitions.
  const followDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the last index/time we centered, to suppress redundant scrolls.
  const lastCenteredIndexRef = useRef<number>(-1);
  const lastCenteredAtRef = useRef<number>(0);
  // User-scroll detection: set on genuine user scrolls, cleared around our own
  // programmatic `scrollTo` calls so the listener can ignore them.
  const userScrollingRef = useRef<boolean>(false);
  const programmaticScrollRef = useRef<boolean>(false);
  const lastProgrammaticScrollAtRef = useRef<number>(0);
  const lastDrivenMatchKeyRef = useRef<string | null>(null);

  const effectiveSearchQuery = controlledSearchQuery ?? searchQuery;
  const normalizedSearchQuery = effectiveSearchQuery.trim().toLowerCase();
  const hasSearchQuery = normalizedSearchQuery.length > 0;
  const safeSegments = segments || [];
  const matchedSegments = hasSearchQuery
    ? safeSegments.filter((seg) => seg.text.toLowerCase().includes(normalizedSearchQuery))
    : [];
  const filteredSegments = hasSearchQuery ? matchedSegments : safeSegments;
  const resolvedActiveMatchIndex = hasSearchQuery && matchedSegments.length > 0
    ? clampIndex(controlledActiveMatchIndex ?? 0, matchedSegments.length)
    : -1;
  const activeMatchSegment = resolvedActiveMatchIndex >= 0
    ? matchedSegments[resolvedActiveMatchIndex]
    : null;
  const effectiveHighlightQuery = (highlightQuery && highlightQuery.trim())
    ? highlightQuery
    : effectiveSearchQuery;
  const effectiveHighlightedSegmentId = highlightedSegmentId ?? activeMatchSegment?.id ?? undefined;

  useEffect(() => {
    onSearchStateChange?.({
      available: safeSegments.length > 0,
      query: effectiveSearchQuery,
      totalMatches: matchedSegments.length,
      activeMatchIndex: resolvedActiveMatchIndex,
      activeSegmentId: activeMatchSegment?.id ?? null,
    });
  }, [
    activeMatchSegment,
    effectiveSearchQuery,
    matchedSegments.length,
    onSearchStateChange,
    resolvedActiveMatchIndex,
    safeSegments.length,
  ]);

  // Find active segment based on current time.
  useEffect(() => {
    const index = safeSegments.findIndex(
      (seg) => currentTime >= seg.start && currentTime < seg.end
    );
    if (index !== -1 && index !== activeIndex) {
      setActiveIndex(index);
    }
  }, [currentTime, segments, activeIndex, autoFollow]);

  // Helper: scroll the active segment to the comfort reading offset.
  // Container-relative (never moves the outer page). The caller decides whether
  // to force (jump navigation) or respect the user-scroll pause (auto-follow).
  const scrollToSegment = (element: HTMLElement, force: boolean) => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
    const elementHeight = elementRect.height;
    const containerHeight = containerRect.height;

    // Position the active line's top at the configured offset from the top of
    // the visible region so upcoming lines fill the space below it.
    const ratio = compact ? FOLLOW_OFFSET_RATIO_COMPACT : FOLLOW_OFFSET_RATIO_DESKTOP;
    const targetScrollTop = relativeTop - containerHeight * ratio + elementHeight / 2;

    // Skip if the element is already within the comfort band (avoid jitter).
    const comfortTop = containerRect.top + containerHeight * ratio;
    const comfortBottom = containerRect.bottom - containerHeight * 0.15;
    if (!force && elementRect.top >= comfortTop && elementRect.bottom <= comfortBottom) {
      return;
    }

    programmaticScrollRef.current = true;
    lastProgrammaticScrollAtRef.current = Date.now();
    container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
  };

  // Auto-follow: scroll the active segment into the reading position when it
  // changes. Debounced to coalesce rapid transitions; guarded against
  // re-centering the same index on `currentTime` wobble; paused while the user
  // is manually reading elsewhere.
  useEffect(() => {
    if (!autoFollow || activeIndex < 0) return;
    if (!activeSegmentRef.current || !containerRef.current) return;

    // Respect the explicit toggle *and* the transient user-scroll pause.
    if (followPausedByUser) return;

    const now = Date.now();
    // Suppress re-centering the same index within the min-interval window.
    if (
      activeIndex === lastCenteredIndexRef.current &&
      now - lastCenteredAtRef.current < FOLLOW_SAME_INDEX_MIN_MS
    ) {
      return;
    }

    // Debounce: coalesce rapid back-to-back segment changes into one scroll.
    if (followDebounceRef.current) clearTimeout(followDebounceRef.current);
    const element = activeSegmentRef.current;
    followDebounceRef.current = setTimeout(() => {
      lastCenteredIndexRef.current = activeIndex;
      lastCenteredAtRef.current = Date.now();
      scrollToSegment(element, false);
    }, FOLLOW_DEBOUNCE_MS);

    return () => {
      if (followDebounceRef.current) {
        clearTimeout(followDebounceRef.current);
        followDebounceRef.current = null;
      }
    };
  }, [activeIndex, autoFollow, followPausedByUser, compact]);

  // Auto-resume: when the user has scrolled away but playback catches up and
  // the active segment re-enters the visible region, clear the pause so the
  // panel starts following again.
  useEffect(() => {
    if (!followPausedByUser || activeIndex < 0) return;
    const container = containerRef.current;
    const element = activeSegmentRef.current;
    if (!container || !element) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const isVisible =
      elementRect.bottom > containerRect.top && elementRect.top < containerRect.bottom;
    if (isVisible) {
      setFollowPausedByUser(false);
    }
  }, [activeIndex, followPausedByUser, currentTime]);

  // Detect manual (user-initiated) scrolling on the transcript container and
  // pause auto-follow until playback catches up or the user seeks. We ignore
  // scrolls that happen immediately after our own programmatic `scrollTo`.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Ignore scrolls we just triggered ourselves.
      if (programmaticScrollRef.current) return;
      const sinceProgrammatic = Date.now() - lastProgrammaticScrollAtRef.current;
      if (sinceProgrammatic < USER_SCROLL_GRACE_MS) return;

      if (!userScrollingRef.current) {
        userScrollingRef.current = true;
      }
      // Only enter the paused state if auto-follow is currently active.
      if (autoFollow && !followPausedByUser) {
        setFollowPausedByUser(true);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [autoFollow, followPausedByUser]);

  // Scroll to an externally highlighted segment (jump navigation, e.g. command
  // palette or share-link deep-link). Forces the scroll and bypasses the
  // user-scroll pause — this is an explicit navigation action.
  useEffect(() => {
    if (!effectiveHighlightedSegmentId) return;
    if (!highlightedSegmentRef.current) return;
    userScrollingRef.current = false;
    setFollowPausedByUser(false);
    scrollToSegment(highlightedSegmentRef.current, true);
  }, [effectiveHighlightedSegmentId]);

  useEffect(() => {
    if (!hasSearchQuery) {
      lastDrivenMatchKeyRef.current = null;
      return;
    }
    if (!activeMatchSegment || !onSeek) return;
    if (controlledSearchQuery === undefined && controlledActiveMatchIndex === undefined) return;

    const driveKey = `${normalizedSearchQuery}:${activeMatchSegment.id}:${resolvedActiveMatchIndex}`;
    if (lastDrivenMatchKeyRef.current === driveKey) return;
    lastDrivenMatchKeyRef.current = driveKey;
    onSeek(activeMatchSegment.start);
  }, [
    activeMatchSegment,
    controlledActiveMatchIndex,
    controlledSearchQuery,
    hasSearchQuery,
    normalizedSearchQuery,
    onSeek,
    resolvedActiveMatchIndex,
  ]);

  // Format time
  const formatTime = (time: number) => {
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = Math.floor(time % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleSegmentClick = (segment: TranscriptSegment) => {
    // Optimistically set the active index for instant visual feedback — the
    // active segment is normally derived from currentTime (which lags while the
    // new position buffers), so without this the tap looks like it did nothing.
    const idx = safeSegments.findIndex((s) => s.id === segment.id);
    if (idx !== -1) setActiveIndex(idx);
    // Seeking is an explicit navigation action: resume auto-follow immediately
    // so the panel tracks from the new position.
    userScrollingRef.current = false;
    setFollowPausedByUser(false);
    onSeek?.(segment.start);
  };

  const handleSelection = () => {
    if (!onSelectionChange) return;
    
    // Clear previous timeout
    if (selectionTimeoutRef.current) {
      clearTimeout(selectionTimeoutRef.current);
    }
    
    // Debounce selection to avoid spamming
    selectionTimeoutRef.current = setTimeout(() => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim()) {
        onSelectionChange(selection.toString().trim());
      }
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current);
      }
    };
  }, []);

  // Copy transcript text
  const handleCopy = () => {
    const text = segments
      .map((seg) => {
        const timestamp = `[${formatTime(seg.start)}]`;
        const speaker = seg.speaker ? `${seg.speaker}: ` : "";
        return `${timestamp} ${speaker}${seg.text}`;
      })
      .join("\n");
    navigator.clipboard.writeText(text);
  };

  // Export transcript
  const handleExport = () => {
    onExport?.();
  };

  // Toggle persistent auto-follow and clear any transient user-scroll pause.
  const toggleAutoFollow = () => {
    setAutoFollow((prev) => {
      const next = !prev;
      localStorage.setItem(AUTOSCROLL_STORAGE_KEY, String(next));
      return next;
    });
    userScrollingRef.current = false;
    setFollowPausedByUser(false);
  };

  // "Click to resume" from the paused chip.
  const resumeFollow = () => {
    userScrollingRef.current = false;
    setFollowPausedByUser(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && activeIndex !== -1 && onSeek) {
      e.preventDefault();
      onSeek(segments[activeIndex].start);
    }
  };

  const setSegmentRefs = (element: HTMLDivElement | null, isActive: boolean, isHighlighted: boolean) => {
    if (isActive) {
      activeSegmentRef.current = element;
    }
    if (isHighlighted) {
      highlightedSegmentRef.current = element;
    }
  };

  return (
    <div className={`flex flex-col h-full min-h-0 bg-card border border-border overflow-hidden ${compact ? "rounded-t-lg rounded-b-none border-b-0" : "rounded-lg"}`}>
      {/* Header — omitted when the parent supplies its own toolbar (showHeader={false}) */}
      {showHeader && (
      <div className={`flex-shrink-0 border-b border-border bg-card/50 backdrop-blur-sm ${compact ? "p-3" : "p-4"}`}>
        <div className={`flex items-center justify-between ${compact ? "mb-2" : "mb-3"}`}>
          <h3 className={`${compact ? "text-base" : "text-lg"} font-semibold text-foreground flex items-center gap-2`}>
            Transcript
            <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {filteredSegments.length} segments
            </span>
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleAutoFollow}
              className={`p-2 rounded-lg transition-colors ${
                autoFollow
                  ? "text-primary hover:bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title={autoFollow ? "Auto-follow on (click to turn off)" : "Auto-follow off (click to turn on)"}
              aria-pressed={autoFollow}
              aria-label="Toggle transcript auto-follow"
            >
              <Lightning className="w-4 h-4" weight={autoFollow ? "fill" : "regular"} />
            </button>
            <button
              onClick={handleCopy}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              title="Copy transcript"
            >
              <Copy className="w-4 h-4" />
            </button>
            {onExport && (
              <button
                onClick={handleExport}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                title="Export transcript"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* MagnifyingGlass */}
        <div className="relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={effectiveSearchQuery}
            onChange={(e) => {
              const nextQuery = e.target.value;
              setSearchQuery(nextQuery);
              onSearchQueryChange?.(nextQuery);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search transcript..."
            className={`w-full pl-9 pr-8 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all ${compact ? "py-1.5" : "py-2"}`}
          />
          {effectiveSearchQuery && (
            <button
              onClick={() => {
                setSearchQuery("");
                onSearchQueryChange?.("");
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded"
            >
              <KeyReturn className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      )}

      {/* Transcript segments */}
      <div className="relative flex-1 min-h-0">
        {followPausedByUser && autoFollow && !compact && (
          <button
            onClick={resumeFollow}
            className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/95 border border-border shadow-md text-xs font-medium text-foreground hover:bg-background hover:border-primary/40 transition-colors"
            title="Auto-follow is paused because you scrolled. Click to resume."
          >
            <Lightning className="w-3.5 h-3.5 text-muted-foreground" />
            Auto-follow paused — click to resume
          </button>
        )}
      <div
        ref={containerRef}
        className={`${className} overflow-y-auto overscroll-contain ${compact ? "p-2.5 pb-4" : "p-4"} space-y-1`}
        data-transcript-scroll="true"
        onMouseUp={handleSelection}
        onKeyUp={handleSelection}
        tabIndex={0}
        role="listbox"
        aria-label="Video transcript"
      >
        {filteredSegments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
            <MagnifyingGlass className="w-8 h-8 mb-3 opacity-50" />
            <p className="text-sm">No transcript segments found</p>
            {effectiveSearchQuery && (
              <p className="text-xs mt-1 opacity-70">Try a different search term</p>
            )}
          </div>
        ) : (
          filteredSegments.map((segment) => {
            const segmentIndex = (segments || []).indexOf(segment);
            const isActive = segmentIndex === activeIndex;
            const isHighlighted = effectiveHighlightQuery && segment.text.toLowerCase().includes(effectiveHighlightQuery.toLowerCase());
            const isExternallyHighlighted = effectiveHighlightedSegmentId && segment.id === effectiveHighlightedSegmentId;
            const isParagraphStart = (segment as any).isParagraphStart;

            return (
              <div
                key={segment.id}
                ref={(element) => setSegmentRefs(element, isActive, Boolean(isExternallyHighlighted))}
                onClick={() => handleSegmentClick(segment)}
                className={`group relative rounded-lg cursor-pointer transition-all duration-200 ${
                  isActive
                    ? "bg-primary/15 border-l-4 border-l-primary border-y border-r border-primary/20 shadow-sm"
                    : isExternallyHighlighted
                    ? "bg-amber-500/15 border-l-4 border-l-amber-500 border-y border-r border-amber-500/30 shadow-sm"
                    : isHighlighted
                    ? "bg-amber-500/10 border-l-4 border-l-amber-500 border-y border-r border-amber-500/20"
                    : "bg-transparent hover:bg-muted/40 border-l-4 border-l-transparent border-y border-r border-transparent"
                } ${isParagraphStart ? (compact ? "mt-3 first:mt-0" : "mt-4 first:mt-0") : ""}`}
                role="option"
                tabIndex={0}
                aria-selected={isActive}
              >
                <div className={`flex items-start ${compact ? "gap-2 p-2.5" : "gap-3 p-3"}`}>
                  {/* Timestamp with play button */}
                  {showTimestamps && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSegmentClick(segment);
                      }}
                      className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-medium transition-all ${
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground hover:text-primary"
                      }`}
                      title={`Jump to ${formatTime(segment.start)}`}
                    >
                      {isActive ? (
                        <Play className="w-3 h-3 fill-current" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                      <span className="tabular-nums">{formatTime(segment.start)}</span>
                    </button>
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0 leading-relaxed">
                    {/* Speaker */}
                    {showSpeakers && segment.speaker && (
                      <span className={`text-xs font-semibold mr-2 ${
                        isActive ? "text-primary" : "text-primary/80"
                      }`}>
                        {segment.speaker}
                      </span>
                    )}

                    {/* Text */}
                    <span className={`${compact ? "text-[15px] leading-6" : "text-sm"} ${
                      isActive 
                        ? "text-foreground font-medium" 
                        : "text-foreground/90"
                    }`}>
                      {highlightText(segment.text, effectiveHighlightQuery)}
                    </span>
                  </div>
                </div>

                {/* Active indicator dot */}
                {isActive && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary animate-pulse" />
                )}
              </div>
            );
          })
        )}
      </div>
      </div>

      {/* Footer with stats */}
      <div className={`flex-shrink-0 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center justify-between ${compact ? "px-3 py-2" : "px-4 py-2.5"}`}>
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {filteredSegments.length.toLocaleString()}
          </span>
          <span>segment{filteredSegments.length !== 1 ? "s" : ""}</span>
          {effectiveSearchQuery && (
            <span className="text-primary">
              ({segments.length - filteredSegments.length} filtered)
            </span>
          )}
        </div>
        {activeIndex !== -1 && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="tabular-nums font-medium text-foreground">
              {formatTime(currentTime)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Parse SRT format
 */
export function parseSRT(srtContent: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = srtContent.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;

    const id = lines[0].trim();
    const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);

    if (!timeMatch) continue;

    const start = parseSRTTime(timeMatch[1]);
    const end = parseSRTTime(timeMatch[2]);
    const text = lines.slice(2).join("\n").replace(/<[^>]+>/g, ""); // Remove HTML tags

    segments.push({
      id,
      start,
      end,
      text,
    });
  }

  return segments;
}

/**
 * Parse SRT timestamp to seconds
 */
function parseSRTTime(time: string): number {
  const [timePart, msPart] = time.split(",");
  const [hours, minutes, seconds] = timePart.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds + parseInt(msPart) / 1000;
}

/**
 * Parse WebVTT format
 */
export function parseWebVTT(vttContent: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = vttContent.split("\n");

  let i = 0;
  while (i < lines.length) {
    // Skip header and empty lines
    if (lines[i].includes("WEBVTT") || !lines[i].trim()) {
      i++;
      continue;
    }

    // Look for timestamp line
    const timeMatch = lines[i].match(
      /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/
    );

    if (!timeMatch) {
      i++;
      continue;
    }

    const start = parseVTTTime(timeMatch[1]);
    const end = parseVTTTime(timeMatch[2]);
    const id = `cue-${i}`;

    i++;
    let text = "";
    while (i < lines.length && lines[i].trim() && !lines[i].includes("-->")) {
      text += (text ? "\n" : "") + lines[i];
      i++;
    }

    segments.push({
      id,
      start,
      end,
      text: text.replace(/<[^>]+>/g, ""), // Remove HTML tags
    });
  }

  return segments;
}

/**
 * Parse VTT timestamp to seconds
 */
function parseVTTTime(time: string): number {
  const parts = time.split(":");
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts.map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }
  const [minutes, seconds] = parts.map(Number);
  return minutes * 60 + seconds;
}

/**
 * Export transcript to SRT format
 */
export function exportToSRT(segments: TranscriptSegment[]): string {
  return segments
    .map((seg, index) => {
      const startTime = formatSRTTime(seg.start);
      const endTime = formatSRTTime(seg.end);
      const speaker = seg.speaker ? `<v ${seg.speaker}>` : "";
      return `${index + 1}\n${startTime} --> ${endTime}\n${speaker}${seg.text}\n`;
    })
    .join("\n");
}

/**
 * Format time to SRT timestamp
 */
function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms
    .toString()
    .padStart(3, "0")}`;
}

/**
 * Export transcript to plain text
 */
export function exportToPlainText(segments: TranscriptSegment[]): string {
  return segments
    .map((seg) => {
      const timestamp = `[${formatSRTTime(seg.start)}]`;
      const speaker = seg.speaker ? `${seg.speaker}: ` : "";
      return `${timestamp} ${speaker}${seg.text}`;
    })
    .join("\n");
}

/**
 * Highlight search terms in text
 */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
  return parts.map((part, i) => 
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-amber-500/30 text-foreground rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(length - 1, index));
}
