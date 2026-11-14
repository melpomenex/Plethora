import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

type ScrollPosition = { follow: boolean; top: number; anchorId?: string; anchorOffset?: number; followingIds?: string[] };
const positions = new Map<string, ScrollPosition>();
const FOLLOW_DISTANCE = 48;
const INTERACTION_GRACE_MS = 250;
const POINTER_HOLD_FALLBACK_MS = 2000;
const STORAGE_PREFIX = "assistant-scroll-v1:";

function readPosition(key: string): ScrollPosition | undefined {
  const cached = positions.get(key);
  if (cached) return cached;
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + key) ?? "null") as ScrollPosition | null;
    if (value && typeof value.follow === "boolean" && Number.isFinite(value.top)) return {
      follow: value.follow, top: value.top,
      anchorId: typeof value.anchorId === "string" ? value.anchorId : undefined,
      anchorOffset: Number.isFinite(value.anchorOffset) ? value.anchorOffset : undefined,
      followingIds: Array.isArray(value.followingIds) ? value.followingIds.filter((id): id is string => typeof id === "string").slice(0, 200) : [],
    };
  } catch { /* Storage may be unavailable or malformed. */ }
  return undefined;
}

function savePosition(key: string, position: ScrollPosition) {
  positions.set(key, position);
  try { sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(position)); } catch { /* In-memory state still works. */ }
}

function capturePosition(container: HTMLElement): ScrollPosition {
  const follow = container.scrollHeight - container.clientHeight - container.scrollTop <= FOLLOW_DISTANCE;
  const bounds = container.getBoundingClientRect();
  const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-assistant-message-id]"));
  const index = elements.findIndex((element) => element.getBoundingClientRect().bottom > bounds.top);
  const anchor = elements[index];
  return {
    follow, top: container.scrollTop,
    anchorId: anchor?.dataset.assistantMessageId,
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - bounds.top : undefined,
    followingIds: index < 0 ? [] : elements.slice(index + 1).map((element) => element.dataset.assistantMessageId).filter((id): id is string => Boolean(id)),
  };
}

function isContainerValidForRestore(container: HTMLElement, wasConnected: boolean): boolean {
  if (wasConnected && !container.isConnected) return false;
  return container.clientHeight > 0 && container.scrollHeight > container.clientHeight;
}

function restorePosition(container: HTMLElement, position: ScrollPosition, wasConnected: boolean): boolean {
  if (!isContainerValidForRestore(container, wasConnected)) {
    return false;
  }
  const previousTop = container.scrollTop;
  if (position.follow) {
    if (container.scrollTop !== container.scrollHeight) {
      container.scrollTop = container.scrollHeight;
    }
    return container.scrollTop !== previousTop;
  }
  const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-assistant-message-id]"));
  const anchor = elements.find((element) => element.dataset.assistantMessageId === position.anchorId);
  const successor = !anchor && position.followingIds?.map((id) => elements.find((element) => element.dataset.assistantMessageId === id)).find(Boolean);
  const target = anchor ?? successor;
  if (target && position.anchorOffset !== undefined) {
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (targetRect.height > 0 && containerRect.height > 0) {
      const delta = targetRect.top - containerRect.top - (anchor ? position.anchorOffset : 0);
      if (Math.abs(delta) >= 0.5) {
        container.scrollTop += delta;
      }
      return container.scrollTop !== previousTop;
    }
  }
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  const clampedTop = Math.max(0, Math.min(position.top, maxScroll));
  if (Math.abs(clampedTop - previousTop) >= 0.5) {
    container.scrollTop = clampedTop;
  }
  return container.scrollTop !== previousTop;
}

/** Preserve a reader-controlled position while messages stream or resize. */
export function useAssistantConversationScroll(
  containerRef: RefObject<HTMLDivElement | null>,
  key: string,
  hydrated: boolean,
  messages: readonly unknown[],
  conversationId?: string,
) {
  const effectiveKey = conversationId && !key.includes(conversationId)
    ? `${key}:${conversationId}`
    : key;
  const [showLatest, setShowLatest] = useState(false);
  const expectedScroll = useRef<number | null>(null);
  const recentInteractionRef = useRef(false);
  const pointerHeldRef = useRef(false);
  const touchHeldRef = useRef(false);
  const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasConnectedRef = useRef(false);
  const wasCollapsedRef = useRef(false);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedElementsRef = useRef<WeakSet<Element>>(new WeakSet());
  const lastRestoredKeyRef = useRef<string | null>(null);

  const clearInteractionTimers = useCallback(() => {
    if (interactionTimerRef.current !== null) {
      clearTimeout(interactionTimerRef.current);
      interactionTimerRef.current = null;
    }
    if (pointerHoldTimerRef.current !== null) {
      clearTimeout(pointerHoldTimerRef.current);
      pointerHoldTimerRef.current = null;
    }
  }, []);

  const schedulePointerHoldExpiry = useCallback(() => {
    if (pointerHoldTimerRef.current !== null) {
      clearTimeout(pointerHoldTimerRef.current);
    }
    // Fallback cap in case native scrollbar drag completes without delivering pointerup.
    pointerHoldTimerRef.current = setTimeout(() => {
      pointerHeldRef.current = false;
      pointerHoldTimerRef.current = null;
    }, POINTER_HOLD_FALLBACK_MS);
  }, []);

  const markUserInteraction = useCallback(() => {
    wasCollapsedRef.current = false;
    recentInteractionRef.current = true;
    if (interactionTimerRef.current !== null) {
      clearTimeout(interactionTimerRef.current);
    }
    interactionTimerRef.current = setTimeout(() => {
      recentInteractionRef.current = false;
      interactionTimerRef.current = null;
    }, INTERACTION_GRACE_MS);
  }, []);

  const isUserInteracting = useCallback(
    () => recentInteractionRef.current || pointerHeldRef.current || touchHeldRef.current,
    [],
  );

  const onScroll = useCallback(() => {
    if (!hydrated || !containerRef.current) return;
    const container = containerRef.current;
    if (container.isConnected) {
      wasConnectedRef.current = true;
    }

    if (expectedScroll.current !== null && Math.abs(container.scrollTop - expectedScroll.current) < 1) {
      expectedScroll.current = null;
      wasCollapsedRef.current = false;
      return;
    }

    // Do not capture position during unmeasured or collapsed layout (clientHeight <= 0 or scrollHeight <= clientHeight)
    const isScrollable = isContainerValidForRestore(container, wasConnectedRef.current);
    if (!isScrollable) {
      wasCollapsedRef.current = true;
      expectedScroll.current = null;
      return;
    }

    if (pointerHeldRef.current) {
      schedulePointerHoldExpiry();
    }

    const currentSaved = readPosition(effectiveKey);
    const userActive = isUserInteracting();
    // Protect both follow mode and non-follow manual positions from involuntary collapse/clamp scroll events.
    if (currentSaved) {
      const savedAwayFromTop = currentSaved.follow || currentSaved.top > 0;
      const collapsedClampReset = wasCollapsedRef.current && Math.abs(container.scrollTop - currentSaved.top) >= 1;
      const unexpectedTopJump = !userActive && container.scrollTop === 0 && savedAwayFromTop;
      if (collapsedClampReset || unexpectedTopJump) {
        wasCollapsedRef.current = false;
        const moved = restorePosition(container, currentSaved, wasConnectedRef.current);
        expectedScroll.current = moved ? container.scrollTop : null;
        setShowLatest(!currentSaved.follow);
        return;
      }
    }

    wasCollapsedRef.current = false;
    expectedScroll.current = null;
    const position = capturePosition(container);
    savePosition(effectiveKey, position);
    setShowLatest(!position.follow);
  }, [containerRef, effectiveKey, hydrated, isUserInteracting, schedulePointerHoldExpiry]);

  const showNewest = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const previousTop = container.scrollTop;
    if (container.scrollHeight > container.clientHeight) {
      container.scrollTop = container.scrollHeight;
    }
    wasCollapsedRef.current = false;
    expectedScroll.current = container.scrollTop !== previousTop ? container.scrollTop : null;
    savePosition(effectiveKey, { follow: true, top: container.scrollTop });
    setShowLatest(false);
  }, [containerRef, effectiveKey]);

  // Manage DOM interaction listeners and ResizeObserver per container/key/hydration lifecycle
  // so message updates do not tear down observers or strand interaction timers.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!hydrated || !container) return;
    if (container.isConnected) {
      wasConnectedRef.current = true;
    }
    wasCollapsedRef.current = false;
    expectedScroll.current = null;

    const handleDiscreteInteraction = () => markUserInteraction();
    const handlePointerUp = () => {
      if (!pointerHeldRef.current) return;
      pointerHeldRef.current = false;
      if (pointerHoldTimerRef.current !== null) {
        clearTimeout(pointerHoldTimerRef.current);
        pointerHoldTimerRef.current = null;
      }
      markUserInteraction();
    };
    const handlePointerDown = () => {
      pointerHeldRef.current = true;
      schedulePointerHoldExpiry();
      markUserInteraction();
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (pointerHeldRef.current && event.buttons === 0) {
        handlePointerUp();
      }
    };
    const handleTouchStart = () => {
      touchHeldRef.current = true;
      markUserInteraction();
    };
    const handleTouchEnd = () => {
      touchHeldRef.current = false;
      markUserInteraction();
    };

    const ownerWin = container.ownerDocument?.defaultView ?? (typeof window !== "undefined" ? window : undefined);
    container.addEventListener("wheel", handleDiscreteInteraction, { passive: true });
    container.addEventListener("keydown", handleDiscreteInteraction, { passive: true });
    container.addEventListener("pointerdown", handlePointerDown, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    ownerWin?.addEventListener("pointermove", handlePointerMove, { passive: true });
    ownerWin?.addEventListener("pointerup", handlePointerUp, { passive: true });
    ownerWin?.addEventListener("pointercancel", handlePointerUp, { passive: true });
    ownerWin?.addEventListener("blur", handlePointerUp, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observedElementsRef.current = new WeakSet();
      observer = new ResizeObserver(() => {
        if (pointerHeldRef.current || touchHeldRef.current) return;
        const current = readPosition(effectiveKey);
        if (!current) return;
        if (!isContainerValidForRestore(container, wasConnectedRef.current)) {
          wasCollapsedRef.current = true;
          return;
        }
        const moved = restorePosition(container, current, wasConnectedRef.current);
        if (moved) {
          expectedScroll.current = container.scrollTop;
        }
      });
      observer.observe(container);
      observedElementsRef.current.add(container);
      for (const child of Array.from(container.children)) {
        observer.observe(child);
        observedElementsRef.current.add(child);
      }
      observerRef.current = observer;
    }

    return () => {
      observer?.disconnect();
      observerRef.current = null;
      observedElementsRef.current = new WeakSet();
      container.removeEventListener("wheel", handleDiscreteInteraction);
      container.removeEventListener("keydown", handleDiscreteInteraction);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
      ownerWin?.removeEventListener("pointermove", handlePointerMove);
      ownerWin?.removeEventListener("pointerup", handlePointerUp);
      ownerWin?.removeEventListener("pointercancel", handlePointerUp);
      ownerWin?.removeEventListener("blur", handlePointerUp);
      clearInteractionTimers();
      recentInteractionRef.current = false;
      pointerHeldRef.current = false;
      touchHeldRef.current = false;
      wasCollapsedRef.current = false;
      expectedScroll.current = null;
    };
  }, [clearInteractionTimers, containerRef, effectiveKey, hydrated, markUserInteraction, schedulePointerHoldExpiry]);

  // Restore scroll position on hydration, key switch, or message changes, and observe new message nodes.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!hydrated || !container) return;
    if (container.isConnected) {
      wasConnectedRef.current = true;
    }

    const observer = observerRef.current;
    if (observer) {
      for (const child of Array.from(container.children)) {
        if (!observedElementsRef.current.has(child)) {
          observer.observe(child);
          observedElementsRef.current.add(child);
        }
      }
    }

    // A cleared conversation is a new reading state, even if its storage key is reused.
    if (messages.length === 0) {
      const initial: ScrollPosition = { follow: true, top: 0 };
      savePosition(effectiveKey, initial);
      expectedScroll.current = null;
      lastRestoredKeyRef.current = null;
      setShowLatest(false);
      return;
    }

    const existing = readPosition(effectiveKey);
    const position = existing ?? { follow: true, top: 0 };
    if (!existing) {
      savePosition(effectiveKey, position);
    }

    const sameKey = lastRestoredKeyRef.current === effectiveKey;
    lastRestoredKeyRef.current = effectiveKey;
    if (sameKey && !position.follow && (pointerHeldRef.current || touchHeldRef.current)) {
      setShowLatest(true);
      return;
    }

    if (!isContainerValidForRestore(container, wasConnectedRef.current)) {
      wasCollapsedRef.current = true;
      setShowLatest(!position.follow);
      return;
    }

    const moved = restorePosition(container, position, wasConnectedRef.current);
    if (moved) {
      expectedScroll.current = container.scrollTop;
    }
    setShowLatest(!position.follow);
  }, [containerRef, effectiveKey, hydrated, messages]);

  return { onScroll, showLatest: hydrated && showLatest, showNewest };
}
