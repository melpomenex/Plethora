import { useRef, useCallback, useEffect, useState, type RefCallback } from "react";

export interface SwipeActions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

export interface SwipeGestureOptions {
  threshold?: number; // Minimum distance in px to trigger action
  velocityThreshold?: number; // Minimum velocity in px/ms
  disabled?: boolean;
  preventDefaultOnSwipe?: boolean;
  /** Largest displacement the row may be dragged to, in px. */
  maxOffset?: number;
}

export interface SwipeGestureState {
  offsetX: number;
  offsetY: number;
  isDragging: boolean;
  direction: "left" | "right" | "up" | "down" | null;
  progress: number; // 0 to 1 for action reveal
}

const SWIPE_THRESHOLD = 80;
const VELOCITY_THRESHOLD = 0.3;
const SNAP_BACK_DURATION = 300;
/** Default displacement cap. Rows reveal actions up to ~160px, so dragging
 *  further than this only reveals empty background — and on a 360px phone a
 *  fast flick used to throw the row hundreds of pixels off-screen mid-drag. */
const SWIPE_MAX_OFFSET = 160;

const RESTING_STATE: SwipeGestureState = {
  offsetX: 0,
  offsetY: 0,
  isDragging: false,
  direction: null,
  progress: 0,
};

/**
 * Horizontal/vertical swipe gestures for list rows.
 *
 * Gesture state lives in a ref, not in the React state the handlers read. The
 * handlers are bound with `addEventListener` and must not change identity while
 * a drag is in flight:
 *
 *  - The snap-back animation calls `setState` every frame. If the handlers
 *    closed over that state, each frame would rebuild them, re-run the binding
 *    effect, and the effect cleanup would `cancelAnimationFrame` the very frame
 *    the previous one had just scheduled. The row froze at the full drag
 *    offset, mid-drag, with no way back.
 *  - `handleTouchMove` needed `isDragging` from state, so the listeners were
 *    rebuilt between `touchstart` and the first `touchmove` and that first move
 *    was dropped.
 *
 * So: refs hold the live gesture, `state` only drives rendering, and the effect
 * depends on nothing that changes during a drag.
 */
export function useSwipeGestures(
  actions: SwipeActions,
  options: SwipeGestureOptions = {}
) {
  const {
    threshold = SWIPE_THRESHOLD,
    velocityThreshold = VELOCITY_THRESHOLD,
    disabled = false,
    preventDefaultOnSwipe = true,
    maxOffset = SWIPE_MAX_OFFSET,
  } = options;

  const [state, setState] = useState<SwipeGestureState>(RESTING_STATE);

  // The element is held in state, not just a ref: React attaches a ref during
  // commit, and the listener-binding effect below must run *after* that. With a
  // plain ref the effect saw `null`, returned early, and — because its
  // dependencies never change — never re-ran, so no listener was ever attached.
  const [element, setElement] = useState<HTMLElement | null>(null);
  const elementRef: RefCallback<HTMLElement> = useCallback((node) => {
    setElement(node);
  }, []);

  // Live gesture mirror. Handlers read and write these, never `state`.
  const stateRef = useRef<SwipeGestureState>(RESTING_STATE);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const currentX = useRef(0);
  const currentY = useRef(0);
  const rafRef = useRef<number | null>(null);

  /** Publish a new gesture state to both the ref and the renderer. */
  const commit = useCallback((next: SwipeGestureState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Whether the handlers should act. Held in a ref so the effect does not need
  // to rebind whenever the option changes mid-gesture.
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const preventDefaultRef = useRef(preventDefaultOnSwipe);
  preventDefaultRef.current = preventDefaultOnSwipe;

  // Determine if swipe is horizontal or vertical based on primary direction
  const getSwipeDirection = useCallback((dx: number, dy: number) => {
    return Math.abs(dx) > Math.abs(dy)
      ? dx > 0 ? "right" : "left"
      : dy > 0 ? "down" : "up";
  }, []);

  // Trigger the appropriate action
  const triggerAction = useCallback(
    (direction: "left" | "right" | "up" | "down", velocity: number) => {
      if (velocity < velocityThreshold) {
        return false;
      }

      const current = actionsRef.current;
      switch (direction) {
        case "left":
          current.onSwipeLeft?.();
          return true;
        case "right":
          current.onSwipeRight?.();
          return true;
        case "up":
          current.onSwipeUp?.();
          return true;
        case "down":
          current.onSwipeDown?.();
          return true;
      }
      return false;
    },
    [velocityThreshold]
  );

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabledRef.current) return;

      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      currentX.current = touch.clientX;
      currentY.current = touch.clientY;
      startTime.current = Date.now();

      commit({ ...RESTING_STATE, isDragging: true });

      // Cancel any pending animation
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [commit]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!stateRef.current.isDragging || disabledRef.current) return;

      const touch = e.touches[0];
      const rawDx = touch.clientX - startX.current;
      const rawDy = touch.clientY - startY.current;
      const direction = getSwipeDirection(rawDx, rawDy);

      // Clamp the live offset: a fast flick must never paint the row off-screen
      // before the snap-back even runs.
      const dx = Math.max(-maxOffset, Math.min(maxOffset, rawDx));
      const dy = Math.max(-maxOffset, Math.min(maxOffset, rawDy));

      currentX.current = touch.clientX;
      currentY.current = touch.clientY;

      // Calculate progress (0 to 1) based on threshold
      const distance = direction === "left" || direction === "right"
        ? Math.abs(dx)
        : Math.abs(dy);
      const progress = Math.min(distance / threshold, 1);

      commit({
        offsetX: dx,
        offsetY: dy,
        isDragging: true,
        direction,
        progress,
      });

      // Prevent default scroll if needed and we're swiping horizontally
      if (preventDefaultRef.current && (direction === "left" || direction === "right")) {
        e.preventDefault();
      }
    },
    [commit, getSwipeDirection, maxOffset, threshold]
  );

  const handleTouchEnd = useCallback(
    () => {
      const live = stateRef.current;
      if (!live.isDragging || disabledRef.current) return;

      const endTime = Date.now();
      const dt = endTime - startTime.current;
      const dx = currentX.current - startX.current;
      const dy = currentY.current - startY.current;

      const distance = Math.sqrt(dx * dx + dy * dy);
      const velocity = distance / dt;
      const direction = getSwipeDirection(dx, dy);

      const actionTriggered = triggerAction(direction, velocity);

      if (actionTriggered) {
        commit(RESTING_STATE);
        return;
      }

      // Snap back animation. The rAF id lives in rafRef, which the binding
      // effect's cleanup owns — and that cleanup no longer runs mid-animation,
      // because nothing the handlers close over changes here.
      const startOffsetX = live.offsetX;
      const startOffsetY = live.offsetY;
      const startDirection = live.direction;
      const startProgress = live.progress;
      const began = performance.now();

      const animate = (now: number) => {
        const elapsed = now - began;
        const progress = Math.min(elapsed / SNAP_BACK_DURATION, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3); // Cubic ease out

        commit({
          offsetX: startOffsetX * (1 - easeOut),
          offsetY: startOffsetY * (1 - easeOut),
          isDragging: progress < 1,
          direction: startDirection,
          progress: startProgress * (1 - easeOut),
        });

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        } else {
          rafRef.current = null;
          commit(RESTING_STATE);
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    },
    [commit, getSwipeDirection, triggerAction]
  );

  // Attach event listeners to element.
  useEffect(() => {
    if (!element) return;

    element.addEventListener("touchstart", handleTouchStart, { passive: !preventDefaultOnSwipe });
    element.addEventListener("touchmove", handleTouchMove, { passive: !preventDefaultOnSwipe });
    element.addEventListener("touchend", handleTouchEnd);
    element.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchEnd);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // A row must never be left mid-drag after its element goes away.
      stateRef.current = RESTING_STATE;
    };
  }, [element, handleTouchStart, handleTouchMove, handleTouchEnd, preventDefaultOnSwipe]);

  const reset = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    commit(RESTING_STATE);
  }, [commit]);

  return {
    state,
    elementRef,
    reset,
  };
}
