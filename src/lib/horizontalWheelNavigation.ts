/**
 * Helpers for horizontal wheel / Logitech MX Master thumb-wheel navigation.
 *
 * Horizontal wheel events (`deltaX !== 0`) should pan horizontally-overflowing
 * content natively when possible, and turn pages when the viewer has no
 * remaining horizontal scroll to consume.
 */

export interface HorizontalWheelPageTurnerOptions {
  onPrev: () => void;
  onNext: () => void;
  threshold?: number;
  cooldownMs?: number;
  canConsumeNativeScroll?: (event: WheelEvent) => boolean;
  now?: () => number;
}

const SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);

function canScrollHorizontallyInDirection(el: Element, deltaX: number): boolean {
  if (el.scrollWidth <= el.clientWidth + 1) return false;
  if (deltaX > 0) {
    return el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
  }
  return el.scrollLeft > 1;
}

/**
 * Returns true if `target` or any horizontally-scrollable ancestor up to
 * `stopAt` (inclusive) can still scroll horizontally in the direction of
 * `deltaX`.
 */
export function canElementScrollHorizontally(
  target: EventTarget | null,
  deltaX: number,
  stopAt?: Element | null,
): boolean {
  if (!target || deltaX === 0) return false;
  let current: Element | null =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

  while (current) {
    const isBoundary = stopAt ? current === stopAt : false;
    const style = typeof window !== "undefined" ? window.getComputedStyle(current) : null;
    const isScrollableStyle = style ? SCROLLABLE_OVERFLOW_VALUES.has(style.overflowX) : false;

    if ((isBoundary || isScrollableStyle) && canScrollHorizontallyInDirection(current, deltaX)) {
      return true;
    }

    if (isBoundary) break;
    current = current.parentElement;
  }

  return false;
}

/**
 * Creates a `wheel` event handler that turns pages on horizontal wheel input
 * (such as the Logitech MX Master side scroll wheel) when native horizontal
 * scrolling cannot consume the event.
 */
export function createHorizontalWheelPageTurner(
  options: HorizontalWheelPageTurnerOptions,
): (event: WheelEvent) => void {
  const threshold = options.threshold ?? 50;
  const cooldownMs = options.cooldownMs ?? 250;
  const now = options.now ?? (() => Date.now());

  let accumulated = 0;
  let lastTurnAt = -Infinity;

  return (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.deltaX === 0 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

    if (options.canConsumeNativeScroll?.(event)) {
      accumulated = 0;
      return;
    }

    event.preventDefault();

    const currentTime = now();
    if (currentTime - lastTurnAt < cooldownMs) {
      return;
    }

    if (accumulated !== 0 && Math.sign(event.deltaX) !== Math.sign(accumulated)) {
      accumulated = 0;
    }

    accumulated += event.deltaX;
    if (Math.abs(accumulated) < threshold) {
      return;
    }

    const direction = Math.sign(accumulated);
    accumulated = 0;
    lastTurnAt = currentTime;

    if (direction > 0) {
      options.onNext();
    } else {
      options.onPrev();
    }
  };
}
