/**
 * Virtual List Component
 * Efficiently renders large lists by only mounting visible items
 */

import { useRef, useEffect, useState, useCallback, useMemo, ReactNode } from "react";

interface VirtualListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  itemHeight: number;
  overscan?: number;
  className?: string;
  onEndReached?: () => void;
  endReachedThreshold?: number;
  emptyState?: ReactNode;
  loading?: boolean;
  loadingComponent?: ReactNode;
}

export function VirtualList<T>({
  items,
  renderItem,
  itemHeight,
  overscan = 5,
  className = "",
  onEndReached,
  endReachedThreshold = 200,
  emptyState,
  loading,
  loadingComponent,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Calculate visible range
  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(containerHeight / itemHeight) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  const visibleItems = items.slice(startIndex, endIndex);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => {
      setContainerHeight(container.clientHeight);
    };

    updateHeight();

    let rafId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateHeight);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const newScrollTop = e.currentTarget.scrollTop;
      setScrollTop(newScrollTop);

      // Trigger end reached callback
      if (onEndReached) {
        const scrollBottom = newScrollTop + containerHeight;
        const threshold = totalHeight - endReachedThreshold;
        if (scrollBottom >= threshold) {
          onEndReached();
        }
      }
    },
    [containerHeight, totalHeight, onEndReached, endReachedThreshold]
  );

  if (items.length === 0 && emptyState) {
    return (
      <div ref={containerRef} className={`overflow-auto ${className}`}>
        {emptyState}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`}
      onScroll={handleScroll}
      style={{ willChange: "transform" }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {visibleItems.map((item, index) => {
          const actualIndex = startIndex + index;
          const offset = actualIndex * itemHeight;

          return (
            <div
              key={actualIndex}
              style={{
                position: "absolute",
                top: offset,
                height: itemHeight,
                left: 0,
                right: 0,
              }}
            >
              {renderItem(item, actualIndex)}
            </div>
          );
        })}
      </div>
      {loading && loadingComponent && (
        <div className="py-4">{loadingComponent}</div>
      )}
    </div>
  );
}

// Hook for using virtual list logic in custom implementations
export function useVirtualList<T>({
  items,
  itemHeight,
  overscan = 5,
}: {
  items: T[];
  itemHeight: number;
  overscan?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => {
      setContainerHeight(container.clientHeight);
    };

    updateHeight();

    let rafId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateHeight);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(containerHeight / itemHeight) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);

  const virtualItems = items.slice(startIndex, endIndex).map((item, index) => ({
    item,
    index: startIndex + index,
    style: {
      position: "absolute" as const,
      top: (startIndex + index) * itemHeight,
      height: itemHeight,
      left: 0,
      right: 0,
    },
  }));

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return {
    containerRef,
    virtualItems,
    totalHeight,
    handleScroll,
    startIndex,
    endIndex,
  };
}

/** Nearest ancestor that actually scrolls, or null if nothing above us does. */
function findScrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      return node;
    }
  }
  return null;
}

/**
 * Dynamic Virtual List Component
 * For items with variable/dynamic heights
 * Uses a default item height and adjusts as content renders
 */

interface DynamicVirtualListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  /** Stable identity used for height measurements. Falls back to item.id/key. */
  itemKey?: (item: T, index: number) => string;
  defaultItemHeight?: number;
  estimateSize?: number; // Alias for defaultItemHeight
  overscan?: number;
  className?: string;
  /**
   * Additional ref to the scroll container element. Lets callers that need
   * direct access to the scroller (scroll save/restore, pull-to-refresh
   * detection) use this component AS their scroll container instead of
   * nesting a second scrollable div inside their own.
   */
  scrollRef?: React.Ref<HTMLDivElement>;
  /** Extra attributes spread onto the scroll container (e.g. data-* markers). */
  containerProps?: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
  /**
   * Called on every scroll of the container, composed with the internal
   * windowing handler. Lets callers persist scroll position without binding
   * their own listener to the container element (which is fragile when the
   * scroll container swaps in/out of virtualization).
   */
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

export function DynamicVirtualList<T>({
  items,
  renderItem,
  itemKey,
  defaultItemHeight = 100,
  estimateSize,
  overscan = 3,
  className = "",
  scrollRef,
  containerProps,
  onScroll,
}: DynamicVirtualListProps<T>) {
  const itemHeight = estimateSize || defaultItemHeight;
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the internal ref and the caller-provided scrollRef pointing at the
  // same element.
  const setContainerEl = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      if (typeof scrollRef === "function") {
        scrollRef(el);
      } else if (scrollRef && typeof scrollRef === "object") {
        (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }
    },
    [scrollRef]
  );
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const itemHeightsRef = useRef<Map<string, number>>(new Map());
  const itemObserversRef = useRef<Map<string, ResizeObserver>>(new Map());
  const refCallbacksRef = useRef<Map<string, (element: HTMLElement | null) => void>>(new Map());
  const pendingMeasurementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const measurementScheduledRef = useRef(false);
  const isMountedRef = useRef(true);
  const measureItemRef = useRef<(key: string, element: HTMLElement | null) => boolean>(() => false);
  const scheduleItemMeasurementRef = useRef<(key: string, element: HTMLElement) => void>(() => {});
  const lastListSignatureRef = useRef("");
  const heightRevisionRef = useRef(0);
  const prefixCacheRef = useRef<{ signature: string; revision: number; estimate: number; values: number[] } | null>(null);
  const [_, forceUpdate] = useState({});

  const getItemKey = useCallback(
    (item: T, index: number): string => {
      if (itemKey) return itemKey(item, index);
      if (item && typeof item === "object") {
        const value = item as unknown as { id?: unknown; key?: unknown; _id?: unknown };
        const candidate = value.id ?? value.key ?? value._id;
        if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
      }
      return String(index);
    },
    [itemKey],
  );

  const { itemKeys, listSignature } = useMemo(() => {
    const keys = items.map(getItemKey);
    return { itemKeys: keys, listSignature: keys.join("\u001f") };
  }, [items, getItemKey]);

  if (lastListSignatureRef.current !== listSignature) {
    // Keep id-keyed heights for items that remain in the list.
    lastListSignatureRef.current = listSignature;
    const liveKeys = new Set(itemKeys);
    for (const key of itemHeightsRef.current.keys()) {
      if (!liveKeys.has(key)) itemHeightsRef.current.delete(key);
    }
    for (const key of refCallbacksRef.current.keys()) {
      if (!liveKeys.has(key)) refCallbacksRef.current.delete(key);
    }
    for (const [key, observer] of itemObserversRef.current) {
      if (!liveKeys.has(key)) {
        observer.disconnect();
        itemObserversRef.current.delete(key);
      }
    }
    heightRevisionRef.current += 1;
  }

  // Which element actually clips this list. It is the container itself only
  // when the caller gave the container a bounded height (MobileQueueView passes
  // `h-full min-h-0 overflow-y-auto`). Every other call site drops it into the
  // page's own scroller with NO height, so the container grows to fit its
  // content: `clientHeight === totalHeight`, `findEndIndex` never crosses the
  // viewport bound and returns `items.length`, and the "virtual" list mounts
  // EVERY row — 1400+ queue cards laid out at once. That is what froze the
  // queue for ~20s (and visibly reflowed every card into a new offset) on the
  // way back from Scroll Mode / an Optimal Session. Measure against the nearest
  // scrolling ancestor instead, translating its scrollTop into this list's
  // coordinate space — the same correction DocumentsView makes via
  // `useScrollMargin` for @tanstack/react-virtual.
  useEffect(() => {
    if (!containerRef.current) return;

    let frame = 0;
    let bound: HTMLElement | null = null;
    let detach: (() => void) | null = null;

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

    function sync() {
      frame = 0;
      const el = containerRef.current;
      if (!el) return;

      const viewport = el.scrollHeight > el.clientHeight + 1 ? el : findScrollParent(el);
      if (viewport !== bound) {
        detach?.();
        bound = viewport;
        detach = null;
        if (viewport) {
          viewport.addEventListener("scroll", schedule, { passive: true });
          detach = () => viewport.removeEventListener("scroll", schedule);
        }
      }
      if (!viewport) {
        setContainerHeight(el.clientHeight);
        setScrollTop(0);
        return;
      }

      const listTop =
        viewport === el
          ? 0
          : el.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top +
            viewport.scrollTop;
      setContainerHeight(viewport.clientHeight);
      setScrollTop(Math.max(0, viewport.scrollTop - listTop));
    }

    sync();
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(containerRef.current);
    window.addEventListener("resize", schedule);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", schedule);
      detach?.();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const getItemHeight = (index: number): number => {
    const key = itemKeys[index];
    const measured = itemHeightsRef.current.get(key);
    return measured === undefined && !itemHeightsRef.current.has(key) ? itemHeight : measured as number;
  };

  // Prefix sums turn every offset lookup into O(1). Rebuild only after the
  // item list or a measured height changes.
  const cachedPrefix = prefixCacheRef.current;
  if (!cachedPrefix || cachedPrefix.signature !== listSignature || cachedPrefix.revision !== heightRevisionRef.current || cachedPrefix.estimate !== itemHeight) {
    const values = new Array<number>(items.length + 1);
    values[0] = 0;
    for (let i = 0; i < items.length; i += 1) values[i + 1] = values[i] + getItemHeight(i);
    prefixCacheRef.current = { signature: listSignature, revision: heightRevisionRef.current, estimate: itemHeight, values };
  }
  const prefixSums = prefixCacheRef.current.values;
  const getItemOffset = (index: number) => prefixSums[Math.max(0, Math.min(index, items.length))];
  const totalHeight = prefixSums[items.length];

  // Find start index based on scroll position
  const findStartIndex = () => {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (prefixSums[middle + 1] <= scrollTop) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - overscan);
  };

  // Find end index based on container height
  const findEndIndex = (startIdx: number) => {
    let offset = getItemOffset(startIdx);
    for (let i = startIdx; i < items.length; i++) {
      if (offset > scrollTop + containerHeight + overscan * itemHeight) {
        return Math.min(items.length, i + overscan);
      }
      offset += getItemHeight(i);
    }
    return items.length;
  };

  const startIndex = findStartIndex();
  const endIndex = findEndIndex(startIndex);
  const visibleItems = items.slice(startIndex, endIndex);

  measureItemRef.current = (key, element) => {
    if (!element) return false;
    const height = element.getBoundingClientRect().height;
    // An inactive tab is `display: none`, so every row in it measures 0 and
    // fires its ResizeObserver on the way out. Caching those zeros collapses
    // totalHeight, the browser clamps the scroller's scrollTop to 0, and the
    // queue comes back sitting on item #1 no matter where the user had been.
    // A rendered row is never 0px tall — treat it as "not measurable yet".
    if (height === 0) return false;
    const hasCachedHeight = itemHeightsRef.current.has(key);
    const cachedHeight = itemHeightsRef.current.get(key) ?? itemHeight;
    const delta = Math.abs(height - cachedHeight);
    if (!hasCachedHeight) {
      itemHeightsRef.current.set(key, height);
      heightRevisionRef.current += 1;
      return true;
    }
    if (delta <= 0.5) return false;
    itemHeightsRef.current.set(key, height);
    heightRevisionRef.current += 1;
    return true;
  };

  // Callback refs run during React's commit phase. Updating state directly
  // from one ref attachment per visible row can recurse through enough commits
  // to hit React's maximum-update-depth guard on a large queue. Collect all
  // initial/ResizeObserver measurements into one microtask and render once.
  scheduleItemMeasurementRef.current = (key, element) => {
    pendingMeasurementsRef.current.set(key, element);
    if (measurementScheduledRef.current) return;
    measurementScheduledRef.current = true;

    queueMicrotask(() => {
      measurementScheduledRef.current = false;
      if (!isMountedRef.current) {
        pendingMeasurementsRef.current.clear();
        return;
      }

      const pending = Array.from(pendingMeasurementsRef.current.entries());
      pendingMeasurementsRef.current.clear();
      let changed = false;
      for (const [pendingKey, pendingElement] of pending) {
        if (!pendingElement.isConnected) continue;
        changed = measureItemRef.current(pendingKey, pendingElement) || changed;
      }
      if (changed) forceUpdate({});
    });
  };

  const getMeasureRef = useCallback((key: string) => {
    let callback = refCallbacksRef.current.get(key);
    if (!callback) {
      callback = (element: HTMLElement | null) => {
        itemObserversRef.current.get(key)?.disconnect();
        itemObserversRef.current.delete(key);
        if (!element) {
          pendingMeasurementsRef.current.delete(key);
          return;
        }

        scheduleItemMeasurementRef.current(key, element);
        const observer = new ResizeObserver(() => {
          scheduleItemMeasurementRef.current(key, element);
        });
        observer.observe(element);
        itemObserversRef.current.set(key, observer);
      };
      refCallbacksRef.current.set(key, callback);
    }
    return callback;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      pendingMeasurementsRef.current.clear();
      itemObserversRef.current.forEach((observer) => observer.disconnect());
      itemObserversRef.current.clear();
    };
  }, []);

  // Windowing state comes from the viewport effect above (which listens on
  // whichever element actually scrolls); this only forwards to the caller.
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      onScroll?.(e);
    },
    [onScroll]
  );

  return (
    <div
      {...containerProps}
      ref={setContainerEl}
      className={`overflow-auto ${className}`}
      onScroll={handleScroll}
      style={{ willChange: "transform" }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {visibleItems.map((item, index) => {
          const actualIndex = startIndex + index;
          const offset = getItemOffset(actualIndex);

          return (
            <div
              key={itemKeys[actualIndex]}
              ref={getMeasureRef(itemKeys[actualIndex])}
              style={{
                position: "absolute",
                top: offset,
                left: 0,
                right: 0,
              }}
            >
              {renderItem(item, actualIndex)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualList;
