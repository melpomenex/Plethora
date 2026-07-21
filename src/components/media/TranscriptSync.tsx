import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Clock,
  Copy,
  Download,
  KeyReturn,
  MagnifyingGlass,
  Play,
  Lightning,
} from "@phosphor-icons/react";
import { KaraokeText } from "./KaraokeText";
import { synthesizeWordTimings, type WordTiming } from "../../utils/wordTimings";

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
/**
 * Backstop for classifying our own smooth scrolls. Normally the animation is
 * considered finished when it *arrives* at its target; this only covers an
 * animation that gets interrupted and never arrives, so it is deliberately
 * generous — a long smooth scroll can easily run past half a second.
 */
const PROGRAMMATIC_SCROLL_MAX_MS = 2000;
/** How close to the target counts as "arrived" (sub-pixel scroll positions). */
const SCROLL_ARRIVAL_EPSILON_PX = 2;
const AUTOSCROLL_STORAGE_KEY = "transcript-autoscroll";

/**
 * Karaoke clock tuning.
 *
 * Players report `currentTime` by polling (250ms for YouTube, 500ms on
 * WebKitGTK) — far too coarse for word-level highlighting, which would step in
 * visible jerks. Between samples we interpolate from the last one using the
 * wall clock, committing at most one update per `KARAOKE_MIN_STEP_S`.
 */
const KARAOKE_MIN_STEP_S = 0.05;
/**
 * Never interpolate more than this far past the last real sample. Bounds the
 * damage when polling stalls (buffering, a backgrounded window) — the highlight
 * pauses instead of running away from the audio.
 */
const KARAOKE_MAX_LEAD_S = 0.75;

/**
 * Transcript segment
 */
export interface TranscriptSegment {
  id: string;
  start: number; // Start time in seconds
  end: number; // End time in seconds
  text: string;
  speaker?: string;
  /**
   * MEASURED per-word timings, when the producer has them (YouTube ASR caption
   * tracks, Groq word-level transcription). Never synthesized upstream — the
   * panel estimates its own fallback and renders it differently.
   */
  wordTimings?: WordTiming[];
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
  /**
   * Whether media is currently playing. Only used to decide whether to
   * interpolate between `currentTime` samples for word-level highlighting;
   * when false the panel highlights the word at the paused position and runs
   * no animation loop.
   */
  isPlaying?: boolean;
  /** Playback speed, so the interpolated clock tracks 1.5x/2x listening. */
  playbackRate?: number;
}

/**
 * A smooth playback clock derived from coarse `currentTime` samples.
 *
 * Returns `currentTime` untouched unless we're actively playing a segment with
 * word-level highlighting on screen; in that case it runs a rAF loop that
 * advances the clock from the last sample using `performance.now()`, committing
 * a new value only when it has moved by `KARAOKE_MIN_STEP_S` (~20 renders/sec
 * worst case). rAF is suspended by the browser when the window is hidden, so an
 * unwatched tab costs nothing.
 */
function useKaraokeClock(
  currentTime: number,
  isPlaying: boolean,
  rate: number,
  enabled: boolean,
): number {
  const [clock, setClock] = useState(currentTime);
  const anchorTimeRef = useRef(currentTime);
  const anchorPerfRef = useRef(0);
  const emittedRef = useRef(currentTime);
  const active = enabled && isPlaying;

  // Re-anchor on every real sample. Resync the visible clock only when our
  // interpolation has drifted from the truth (or the user seeked) — otherwise
  // the sample is exactly what we already predicted and re-rendering is waste.
  useEffect(() => {
    anchorTimeRef.current = currentTime;
    anchorPerfRef.current = typeof performance !== "undefined" ? performance.now() : 0;
    if (Math.abs(currentTime - emittedRef.current) >= KARAOKE_MIN_STEP_S) {
      emittedRef.current = currentTime;
      setClock(currentTime);
    }
  }, [currentTime, isPlaying, rate]);

  useEffect(() => {
    if (!active || typeof requestAnimationFrame === "undefined") return;
    let frame = 0;
    const step = () => {
      frame = requestAnimationFrame(step);
      const elapsed = (performance.now() - anchorPerfRef.current) / 1000;
      const lead = Math.min(elapsed * rate, KARAOKE_MAX_LEAD_S);
      const next = anchorTimeRef.current + lead;
      if (Math.abs(next - emittedRef.current) >= KARAOKE_MIN_STEP_S) {
        emittedRef.current = next;
        setClock(next);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, rate]);

  return active ? clock : currentTime;
}

// Format time — module-level so the memoized row doesn't take it as a prop.
const formatTime = (time: number) => {
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time % 3600) / 60);
  const seconds = Math.floor(time % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

interface TranscriptRowProps {
  segment: TranscriptSegment;
  isActive: boolean;
  isExternallyHighlighted: boolean;
  isSearchHit: boolean;
  showTimestamps: boolean;
  showSpeakers: boolean;
  compact: boolean;
  highlightQuery: string;
  /**
   * Playback clock for word highlighting. Non-active rows are handed a constant
   * so `React.memo` short-circuits them — without that, every row would
   * re-render on every clock tick.
   */
  wordClock: number;
  onSelect: (segment: TranscriptSegment) => void;
  setRef: (element: HTMLDivElement | null, isActive: boolean, isHighlighted: boolean) => void;
}

const TranscriptRow = React.memo(function TranscriptRow({
  segment,
  isActive,
  isExternallyHighlighted,
  isSearchHit,
  showTimestamps,
  showSpeakers,
  compact,
  highlightQuery,
  wordClock,
  onSelect,
  setRef,
}: TranscriptRowProps) {
  const isParagraphStart = (segment as any).isParagraphStart;

  const handleRef = useCallback(
    (element: HTMLDivElement | null) => setRef(element, isActive, isExternallyHighlighted),
    [setRef, isActive, isExternallyHighlighted],
  );

  // Measured timings when the producer supplied them; otherwise estimate from
  // the segment's own span so human-authored caption tracks still get word
  // highlighting (rendered in the muted "approximate" style). Only the spoken
  // line needs this, and it's computed once per segment rather than per tick.
  const { timings, approximate } = useMemo(() => {
    if (!isActive) return { timings: undefined, approximate: false };
    if (segment.wordTimings?.length) {
      return { timings: segment.wordTimings, approximate: false };
    }
    return {
      timings: synthesizeWordTimings(segment.text, segment.start, segment.end),
      approximate: true,
    };
  }, [isActive, segment.wordTimings, segment.text, segment.start, segment.end]);

  const query = highlightQuery.trim();
  // A multi-word query can straddle a token boundary, which per-token marking
  // can't express. Search is a transient mode, so it wins for that segment.
  const karaokeOk = isActive && !/\s/.test(query);

  return (
    <div
      ref={handleRef}
      onClick={() => onSelect(segment)}
      className={`group relative rounded-lg cursor-pointer transition-all duration-200 ${
        isActive
          ? "bg-primary/15 border-l-4 border-l-primary border-y border-r border-primary/20 shadow-sm"
          : isExternallyHighlighted
          ? "bg-amber-500/15 border-l-4 border-l-amber-500 border-y border-r border-amber-500/30 shadow-sm"
          : isSearchHit
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
              onSelect(segment);
            }}
            className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-medium transition-all ${
              isActive ? "text-primary" : "text-muted-foreground hover:text-primary"
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
            <span
              className={`text-xs font-semibold mr-2 ${
                isActive ? "text-primary" : "text-primary/80"
              }`}
            >
              {segment.speaker}
            </span>
          )}

          {/* Text */}
          <span
            className={`${compact ? "text-[15px] leading-6" : "text-sm"} ${
              isActive ? "text-foreground font-medium" : "text-foreground/90"
            }`}
          >
            {karaokeOk ? (
              <KaraokeText
                text={segment.text}
                wordTimings={timings}
                currentTime={wordClock}
                isActive
                approximate={approximate}
                renderToken={(token) => highlightText(token, query)}
              />
            ) : (
              highlightText(segment.text, query)
            )}
          </span>
        </div>
      </div>

      {/* Active indicator dot */}
      {isActive && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary animate-pulse" />
      )}
    </div>
  );
});

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
  isPlaying = false,
  playbackRate = 1,
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
  const programmaticScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where our in-flight smooth scroll is headed; null when none is running.
  const programmaticTargetRef = useRef<number | null>(null);
  const userTouchActiveRef = useRef<boolean>(false);
  const activeWasOutsideViewportRef = useRef<boolean>(false);
  const lastDrivenMatchKeyRef = useRef<string | null>(null);

  const effectiveSearchQuery = controlledSearchQuery ?? searchQuery;
  const normalizedSearchQuery = effectiveSearchQuery.trim().toLowerCase();
  const hasSearchQuery = normalizedSearchQuery.length > 0;
  const safeSegments = useMemo(() => segments || [], [segments]);
  // id → index, so each row resolves its own index in O(1). The obvious
  // `segments.indexOf(segment)` is a linear scan *per row per render*, which on
  // a 1000-segment transcript is a million comparisons on every clock tick.
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    safeSegments.forEach((seg, i) => {
      if (!map.has(seg.id)) map.set(seg.id, i);
    });
    return map;
  }, [safeSegments]);
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
    if (index !== -1) {
      if (index !== activeIndex) setActiveIndex(index);
      return;
    }
    // Nothing covers `currentTime`. Gaps between cues are normal (silence), and
    // blanking the highlight there makes it blink, so the last segment stays
    // lit. But playing/seeking to *before* its start is a genuine move away —
    // holding the old line there would strand auto-follow on a stale segment.
    if (activeIndex >= 0 && currentTime < (safeSegments[activeIndex]?.start ?? 0)) {
      setActiveIndex(-1);
    }
  }, [currentTime, safeSegments, activeIndex]);

  // Word-level highlighting only makes sense while a segment is on screen and
  // the clock is a real playback position (PodcastManager passes -1 for its
  // static reading view).
  const karaokeEnabled = activeIndex >= 0 && currentTime >= 0;
  const karaokeTime = useKaraokeClock(currentTime, isPlaying, playbackRate, karaokeEnabled);

  /** Stop attributing incoming scroll events to our own animation. */
  const endProgrammaticScroll = useCallback(() => {
    programmaticScrollRef.current = false;
    programmaticTargetRef.current = null;
    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
      programmaticScrollTimeoutRef.current = null;
    }
  }, []);

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

    // Remember where the animation is headed, clamped the way the browser will
    // clamp it, so the scroll listener can tell "my own animation is still
    // running" from "the user grabbed the panel" by arrival rather than by a
    // stopwatch — a long smooth scroll easily outlives any fixed timeout, and
    // mistaking its tail for a user scroll silently kills auto-follow.
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    programmaticTargetRef.current = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
    programmaticScrollRef.current = true;
    lastProgrammaticScrollAtRef.current = Date.now();
    container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
    }
    // Backstop only: if the animation is interrupted and never reaches its
    // target, don't stay deaf to the user forever.
    programmaticScrollTimeoutRef.current = setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticTargetRef.current = null;
      programmaticScrollTimeoutRef.current = null;
    }, PROGRAMMATIC_SCROLL_MAX_MS);
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
    if (!isVisible) {
      activeWasOutsideViewportRef.current = true;
    } else if (activeWasOutsideViewportRef.current) {
      activeWasOutsideViewportRef.current = false;
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
      // A touch gesture takes priority over playback auto-follow, even when it
      // starts while a smooth programmatic scroll is still settling.
      if (userTouchActiveRef.current) {
        endProgrammaticScroll();
      } else if (programmaticScrollRef.current) {
        // Our own animation. It's finished once it reaches where we aimed —
        // timing it out instead would misread the tail of a long scroll as the
        // user taking over, which pauses auto-follow for good.
        const target = programmaticTargetRef.current;
        if (target !== null && Math.abs(container.scrollTop - target) <= SCROLL_ARRIVAL_EPSILON_PX) {
          endProgrammaticScroll();
          lastProgrammaticScrollAtRef.current = Date.now();
        }
        return;
      }
      const sinceProgrammatic = Date.now() - lastProgrammaticScrollAtRef.current;
      if (!userTouchActiveRef.current && sinceProgrammatic < USER_SCROLL_GRACE_MS) return;

      if (!userScrollingRef.current) {
        userScrollingRef.current = true;
      }
      // Only enter the paused state if auto-follow is currently active.
      if (autoFollow && !followPausedByUser) {
        setFollowPausedByUser(true);
      }
    };

    // Real input always wins: a programmatic animation emits no input events, so
    // seeing one means the user is genuinely driving the panel and we should
    // stop attributing scrolls to ourselves immediately.
    const handleUserGesture = () => endProgrammaticScroll();

    container.addEventListener("scroll", handleScroll, { passive: true });
    container.addEventListener("wheel", handleUserGesture, { passive: true });
    container.addEventListener("pointerdown", handleUserGesture, { passive: true });
    container.addEventListener("keydown", handleUserGesture);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", handleUserGesture);
      container.removeEventListener("pointerdown", handleUserGesture);
      container.removeEventListener("keydown", handleUserGesture);
    };
  }, [autoFollow, followPausedByUser, endProgrammaticScroll]);

  // Mark touch scrolling before the queue-level gesture listener sees the
  // event. This prevents playback follow from fighting a user's native
  // WebView scroll gesture.
  const handleTouchStart = () => {
    userTouchActiveRef.current = true;
    endProgrammaticScroll();
    lastProgrammaticScrollAtRef.current = 0;
  };

  const handleTouchEnd = () => {
    // Android may dispatch the final native scroll after touchend (momentum),
    // so keep the gesture active for one frame.
    requestAnimationFrame(() => {
      userTouchActiveRef.current = false;
    });
  };

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

  // Stable across renders so the memoized rows aren't invalidated every tick.
  const handleSegmentClick = useCallback((segment: TranscriptSegment) => {
    // Optimistically set the active index for instant visual feedback — the
    // active segment is normally derived from currentTime (which lags while the
    // new position buffers), so without this the tap looks like it did nothing.
    const idx = indexById.get(segment.id);
    if (idx !== undefined) setActiveIndex(idx);
    // Seeking is an explicit navigation action: resume auto-follow immediately
    // so the panel tracks from the new position.
    userScrollingRef.current = false;
    setFollowPausedByUser(false);
    onSeek?.(segment.start);
  }, [indexById, onSeek]);

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
      if (programmaticScrollTimeoutRef.current) {
        clearTimeout(programmaticScrollTimeoutRef.current);
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

  const setSegmentRefs = useCallback((
    element: HTMLDivElement | null,
    isActive: boolean,
    isHighlighted: boolean,
  ) => {
    if (isActive) {
      activeSegmentRef.current = element;
    }
    if (isHighlighted) {
      highlightedSegmentRef.current = element;
    }
  }, []);

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
      {/* Positioning context for the "auto-follow paused" chip. Must itself be a
          flex column: callers pass `flex-1 min-h-0` as the scroller's className,
          which only constrains height if this wrapper is a flex container.
          Without it the scroller grows to content height and never scrolls. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
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
        className={`${className} transcript-scroll-container overflow-y-auto overscroll-contain ${compact ? "p-2.5 pb-4" : "p-4"} space-y-1`}
        style={{ touchAction: "pan-y", overscrollBehaviorY: "contain" }}
        data-transcript-scroll="true"
        onTouchStartCapture={handleTouchStart}
        onTouchEndCapture={handleTouchEnd}
        onTouchCancelCapture={handleTouchEnd}
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
            const segmentIndex = indexById.get(segment.id) ?? -1;
            const isActive = segmentIndex === activeIndex;
            const isExternallyHighlighted = Boolean(
              effectiveHighlightedSegmentId && segment.id === effectiveHighlightedSegmentId
            );

            return (
              <TranscriptRow
                key={segment.id}
                segment={segment}
                isActive={isActive}
                isExternallyHighlighted={isExternallyHighlighted}
                isSearchHit={Boolean(
                  effectiveHighlightQuery &&
                    segment.text.toLowerCase().includes(effectiveHighlightQuery.toLowerCase())
                )}
                showTimestamps={showTimestamps}
                showSpeakers={showSpeakers}
                compact={compact}
                highlightQuery={effectiveHighlightQuery}
                // Inactive rows get a constant so React.memo can skip them —
                // only the spoken line re-renders as the clock advances.
                wordClock={isActive ? karaokeTime : 0}
                onSelect={handleSegmentClick}
                setRef={setSegmentRefs}
              />
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
