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
    container.scrollTop = container.scrollHeight;
    return;
  }
  const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-assistant-message-id]"));
  const anchor = elements.find((element) => element.dataset.assistantMessageId === position.anchorId);
  const successor = !anchor && position.followingIds?.map((id) => elements.find((element) => element.dataset.assistantMessageId === id)).find(Boolean);
  const target = anchor ?? successor;
  if (target && position.anchorOffset !== undefined) {
    container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - (anchor ? position.anchorOffset : 0);
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
) {
  const [showLatest, setShowLatest] = useState(false);
  const expectedScroll = useRef<number | null>(null);

  const onScroll = useCallback(() => {
    if (!hydrated || !containerRef.current) return;
    if (expectedScroll.current !== null && Math.abs(containerRef.current.scrollTop - expectedScroll.current) < 1) {
      expectedScroll.current = null;
      return;
    }
    expectedScroll.current = null;
    const position = capturePosition(containerRef.current);
    savePosition(key, position);
    setShowLatest(!position.follow);
  }, [containerRef, hydrated, key]);

  const showNewest = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    expectedScroll.current = container.scrollTop;
    savePosition(key, { follow: true, top: container.scrollTop });
    setShowLatest(false);
  }, [containerRef, key]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!hydrated || !container) return;
    // A cleared conversation is a new reading state, even if its storage key is reused.
    const position = messages.length === 0 ? { follow: true, top: 0 } : readPosition(key) ?? { follow: true, top: 0 };
    savePosition(key, position);
    restorePosition(container, position);
    expectedScroll.current = container.scrollTop;
    setShowLatest(!position.follow);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const current = readPosition(key);
      if (current) {
        restorePosition(container, current);
        expectedScroll.current = container.scrollTop;
      }
    });
    observer.observe(container);
    for (const child of Array.from(container.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [containerRef, hydrated, key, messages]);

  return { onScroll, showLatest: hydrated && showLatest, showNewest };
}
