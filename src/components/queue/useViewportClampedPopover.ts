import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

export const POPOVER_VIEWPORT_MARGIN_PX = 16;

/**
 * Computes a horizontal `left` offset (relative to `anchorLeft`) for an
 * `absolute top-full` popover so it stays within `[margin, viewportWidth - margin]`.
 * Returns `null` when dimensions are unmeasured (e.g., SSR or jsdom).
 */
export function computeClampedPopoverLeft(
  anchorLeft: number,
  popoverWidth: number,
  viewportWidth: number,
  margin = POPOVER_VIEWPORT_MARGIN_PX
): number | null {
  if (popoverWidth <= 0 || viewportWidth <= 0) {
    return null;
  }
  const minLeft = margin;
  const maxLeft = Math.max(margin, viewportWidth - popoverWidth - margin);
  const clampedViewportLeft = Math.min(Math.max(anchorLeft, minLeft), maxLeft);
  return Math.round(clampedViewportLeft - anchorLeft);
}

export interface UseViewportClampedPopoverOptions {
  isOpen: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLElement | null>;
  margin?: number;
}

/**
 * Measures the anchor and popover rects when open (and on window resize)
 * to return a clamped `left` pixel offset relative to `anchorRef`.
 */
export function useViewportClampedPopover({
  isOpen,
  anchorRef,
  popoverRef,
  margin = POPOVER_VIEWPORT_MARGIN_PX,
}: UseViewportClampedPopoverOptions): number | null {
  const [offsetLeft, setOffsetLeft] = useState<number | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    setOffsetLeft(
      computeClampedPopoverLeft(anchorRect.left, popoverRect.width, viewportWidth, margin)
    );
  }, [anchorRef, popoverRef, margin]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setOffsetLeft(null);
      return;
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen, updatePosition]);

  return offsetLeft;
}
