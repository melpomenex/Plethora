import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reader auto-follow controller for the spoken word — ports TranscriptSync's
 * follow semantics to the document scroll container:
 *
 * - The active word's rect is pinned at a comfort offset above the vertical
 *   center (0.28 desktop / 0.18 compact), debounced (150ms), skipped when the
 *   word is already inside the comfort band.
 * - User-scroll detection is arrival-based: programmatic scrolls record their
 *   clamped target; a scroll event that arrives within ±2px of it belongs to
 *   our animation. Real input (wheel/pointer/key/touch) always wins and pauses
 *   follow while playback and highlighting continue.
 * - Re-center returns the viewport to the spoken word and resumes following.
 * - Reduced motion / e-ink scroll instantly; follow is suspended while stopped
 *   or hidden.
 */

const FOLLOW_OFFSET_RATIO_DESKTOP = 0.28;
const FOLLOW_OFFSET_RATIO_COMPACT = 0.18;
const FOLLOW_DEBOUNCE_MS = 150;
const FOLLOW_SAME_WORD_MIN_MS = 400;
const USER_SCROLL_GRACE_MS = 120;
const PROGRAMMATIC_SCROLL_MAX_MS = 2000;
const SCROLL_ARRIVAL_EPSILON_PX = 2;
const ACTIVE_SPAN_SELECTOR = ".tts-word-highlight, .tts-chunk-highlight";

export interface UseSpokenWordFollowOptions {
  /** The persisted follow preference. */
  enabled: boolean;
  /** Whether TTS playback is active (playing or paused mid-utterance). */
  active: boolean;
  compact?: boolean;
  /** Instant positioning (reduced motion / e-ink). */
  reducedMotion?: boolean;
  /** Changes whenever the spoken word changes (e.g. `${chunk}:${word}`). */
  wordKey: string;
  /** Containers to search for the active highlight span (main + iframes). */
  containers: Array<HTMLElement | null | undefined>;
}

export interface SpokenWordFollowController {
  pausedByUser: boolean;
  /** Return the viewport to the spoken word and resume following. */
  reCenter: () => void;
}

function findScrollableContainer(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = el;
  // Cross the iframe boundary first when the element lives inside one.
  for (let depth = 0; current && depth < 6; depth += 1) {
    const doc = current.ownerDocument;
    const win = doc?.defaultView ?? null;
    if (win && win !== window) {
      let iframe: HTMLIFrameElement | null = null;
      try {
        for (const frame of Array.from(document.querySelectorAll("iframe"))) {
          if (frame.contentWindow === win) {
            iframe = frame;
            break;
          }
        }
      } catch {
        iframe = null;
      }
      if (!iframe) return null;
      current = iframe;
      continue;
    }
    break;
  }

  while (current) {
    if (
      current.hasAttribute("data-document-scroll-container") ||
      current.getAttribute("data-epub-viewer") === "true"
    ) {
      return current;
    }
    const style = current.ownerDocument?.defaultView?.getComputedStyle(current);
    const overflowY = style?.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function useSpokenWordFollow(options: UseSpokenWordFollowOptions): SpokenWordFollowController {
  const { enabled, active, compact = false, reducedMotion = false, wordKey, containers } = options;
  const [pausedByUser, setPausedByUser] = useState(false);

  const userScrollingRef = useRef(false);
  const userTouchActiveRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const programmaticTargetRef = useRef<number | null>(null);
  const programmaticScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProgrammaticScrollAtRef = useRef(0);
  const lastCenteredWordRef = useRef<string | null>(null);
  const lastCenteredAtRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endProgrammaticScroll = useCallback(() => {
    programmaticScrollRef.current = false;
    programmaticTargetRef.current = null;
    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
      programmaticScrollTimeoutRef.current = null;
    }
  }, []);

  /** Locate the active highlight span and its scroll container. */
  const findActiveTarget = useCallback((): { span: HTMLElement; container: HTMLElement } | null => {
    for (const container of containers) {
      if (!container) continue;
      const span = container.querySelector(ACTIVE_SPAN_SELECTOR) as HTMLElement | null;
      if (span) {
        const scroll = findScrollableContainer(span);
        if (scroll) return { span, container: scroll };
      }
    }
    return null;
  }, [containers]);

  const scrollToWord = useCallback(
    (force: boolean) => {
      const target = findActiveTarget();
      if (!target) return;
      const { span, container } = target;
      const containerRect = container.getBoundingClientRect();
      const spanRect = span.getBoundingClientRect();

      const ratio = compact ? FOLLOW_OFFSET_RATIO_COMPACT : FOLLOW_OFFSET_RATIO_DESKTOP;
      const relativeTop = spanRect.top - containerRect.top + container.scrollTop;
      const targetScrollTop = relativeTop - container.clientHeight * ratio + spanRect.height / 2;

      const comfortTop = containerRect.top + container.clientHeight * ratio;
      const comfortBottom = containerRect.bottom - container.clientHeight * 0.15;
      if (!force && spanRect.top >= comfortTop && spanRect.bottom <= comfortBottom) {
        return;
      }

      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      programmaticTargetRef.current = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
      programmaticScrollRef.current = true;
      lastProgrammaticScrollAtRef.current = Date.now();
      container.scrollTo({ top: targetScrollTop, behavior: reducedMotion ? "auto" : "smooth" });
      if (programmaticScrollTimeoutRef.current) clearTimeout(programmaticScrollTimeoutRef.current);
      programmaticScrollTimeoutRef.current = setTimeout(endProgrammaticScroll, PROGRAMMATIC_SCROLL_MAX_MS);
    },
    [compact, endProgrammaticScroll, findActiveTarget, reducedMotion],
  );

  // Follow the active word on change: debounced, comfort-band skip, suspended
  // while stopped/hidden or paused by user scroll.
  useEffect(() => {
    if (!enabled || !active || !wordKey || pausedByUser) return;
    if (document.hidden) return;

    const now = Date.now();
    if (wordKey === lastCenteredWordRef.current && now - lastCenteredAtRef.current < FOLLOW_SAME_WORD_MIN_MS) {
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastCenteredWordRef.current = wordKey;
      lastCenteredAtRef.current = Date.now();
      scrollToWord(false);
    }, FOLLOW_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [wordKey, enabled, active, pausedByUser, scrollToWord]);

  // Scroll container listeners: arrival-based user detection with real-input
  // override, consistent with TranscriptSync.
  useEffect(() => {
    if (!enabled || !active) return;
    const target = findActiveTarget();
    const container = target?.container ?? (containers.find(Boolean) as HTMLElement | undefined);
    if (!container) return;

    const handleScroll = () => {
      if (userTouchActiveRef.current) {
        endProgrammaticScroll();
      } else if (programmaticScrollRef.current) {
        const targetTop = programmaticTargetRef.current;
        if (
          targetTop !== null &&
          Math.abs(container.scrollTop - targetTop) <= SCROLL_ARRIVAL_EPSILON_PX
        ) {
          endProgrammaticScroll();
          lastProgrammaticScrollAtRef.current = Date.now();
        }
        return;
      }
      if (Date.now() - lastProgrammaticScrollAtRef.current < USER_SCROLL_GRACE_MS) return;
      userScrollingRef.current = true;
      setPausedByUser(true);
    };
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
  }, [enabled, active, wordKey, containers, findActiveTarget, endProgrammaticScroll]);

  // Reset the pause when playback stops/restarts (new session).
  useEffect(() => {
    if (!active) {
      setPausedByUser(false);
      userScrollingRef.current = false;
      endProgrammaticScroll();
    }
  }, [active, endProgrammaticScroll]);

  const reCenter = useCallback(() => {
    userScrollingRef.current = false;
    endProgrammaticScroll();
    setPausedByUser(false);
    scrollToWord(true);
  }, [endProgrammaticScroll, scrollToWord]);

  return { pausedByUser, reCenter };
}
