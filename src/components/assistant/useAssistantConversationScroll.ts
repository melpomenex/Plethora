import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

type ScrollPosition = { follow: boolean; top: number; anchorId?: string; anchorOffset?: number; followingIds?: string[] };
const positions = new Map<string, ScrollPosition>();
const FOLLOW_DISTANCE = 48;
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

function restorePosition(container: HTMLElement, position: ScrollPosition) {
  if (position.follow) {
    if (container.scrollHeight > container.clientHeight) {
      container.scrollTop = container.scrollHeight;
    }
    return;
  }
  const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-assistant-message-id]"));
  const anchor = elements.find((element) => element.dataset.assistantMessageId === position.anchorId);
  const successor = !anchor && position.followingIds?.map((id) => elements.find((element) => element.dataset.assistantMessageId === id)).find(Boolean);
  const target = anchor ?? successor;
  if (target && position.anchorOffset !== undefined) {
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (targetRect.height > 0 && containerRect.height > 0) {
      container.scrollTop += targetRect.top - containerRect.top - (anchor ? position.anchorOffset : 0);
    } else {
      container.scrollTop = position.top;
    }
  } else {
    container.scrollTop = position.top;
  }
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
  const userInteractionRef = useRef(false);
  const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markUserInteraction = useCallback(() => {
    userInteractionRef.current = true;
    if (interactionTimerRef.current !== null) {
      clearTimeout(interactionTimerRef.current);
    }
    interactionTimerRef.current = setTimeout(() => {
      userInteractionRef.current = false;
      interactionTimerRef.current = null;
    }, 250);
  }, []);

  const onScroll = useCallback(() => {
    if (!hydrated || !containerRef.current) return;
    const container = containerRef.current;
    if (expectedScroll.current !== null && Math.abs(container.scrollTop - expectedScroll.current) < 1) {
      expectedScroll.current = null;
      return;
    }

    // Do not capture position during unmeasured or collapsed layout (scrollHeight <= clientHeight)
    const isScrollable = container.scrollHeight > container.clientHeight;
    if (!isScrollable) {
      expectedScroll.current = null;
      return;
    }

    const currentSaved = readPosition(effectiveKey);
    // If follow mode was active and container suddenly dropped to scrollTop === 0 without user interaction
    // (e.g. transient layout collapse or component re-render), preserve follow mode and restore to bottom.
    if (currentSaved?.follow && container.scrollTop === 0 && !userInteractionRef.current) {
      container.scrollTop = container.scrollHeight;
      expectedScroll.current = container.scrollTop;
      return;
    }

    expectedScroll.current = null;
    const position = capturePosition(container);
    savePosition(effectiveKey, position);
    setShowLatest(!position.follow);
  }, [containerRef, effectiveKey, hydrated]);

  const showNewest = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    expectedScroll.current = container.scrollTop;
    savePosition(effectiveKey, { follow: true, top: container.scrollTop });
    setShowLatest(false);
  }, [containerRef, effectiveKey]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!hydrated || !container) return;
    // A cleared conversation is a new reading state, even if its storage key is reused.
    const position = messages.length === 0 ? { follow: true, top: 0 } : readPosition(effectiveKey) ?? { follow: true, top: 0 };
    savePosition(effectiveKey, position);
    restorePosition(container, position);
    if (position.follow) {
      if (container.scrollHeight > container.clientHeight) {
        expectedScroll.current = container.scrollTop;
      }
    } else {
      expectedScroll.current = container.scrollTop;
    }
    setShowLatest(!position.follow);

    const handleInteraction = () => markUserInteraction();
    container.addEventListener("wheel", handleInteraction, { passive: true });
    container.addEventListener("touchstart", handleInteraction, { passive: true });
    container.addEventListener("pointerdown", handleInteraction, { passive: true });
    container.addEventListener("keydown", handleInteraction, { passive: true });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        container.removeEventListener("wheel", handleInteraction);
        container.removeEventListener("touchstart", handleInteraction);
        container.removeEventListener("pointerdown", handleInteraction);
        container.removeEventListener("keydown", handleInteraction);
        if (interactionTimerRef.current !== null) {
          clearTimeout(interactionTimerRef.current);
        }
      };
    }
    const observer = new ResizeObserver(() => {
      const current = readPosition(effectiveKey);
      if (current) {
        restorePosition(container, current);
        if (current.follow) {
          if (container.scrollHeight > container.clientHeight) {
            expectedScroll.current = container.scrollTop;
          }
        } else {
          expectedScroll.current = container.scrollTop;
        }
      }
    });
    observer.observe(container);
    for (const child of Array.from(container.children)) observer.observe(child);
    return () => {
      observer.disconnect();
      container.removeEventListener("wheel", handleInteraction);
      container.removeEventListener("touchstart", handleInteraction);
      container.removeEventListener("pointerdown", handleInteraction);
      container.removeEventListener("keydown", handleInteraction);
      if (interactionTimerRef.current !== null) {
        clearTimeout(interactionTimerRef.current);
      }
    };
  }, [containerRef, effectiveKey, hydrated, markUserInteraction, messages]);

  return { onScroll, showLatest: hydrated && showLatest, showNewest };
}
