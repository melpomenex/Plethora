import { useLayoutEffect, type RefObject } from "react";

export interface FloatingLayerRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface FloatingLayerViewport {
  width: number;
  height: number;
}

export interface FloatingLayerBounds {
  placement: "above" | "below";
  left: number;
  width: number;
  maxHeight: number;
  /** Distance from the viewport bottom when placed above the anchor. */
  bottom?: number;
  /** Distance from the viewport top when placed below the anchor. */
  top?: number;
}

export interface ComputeFloatingLayerBoundsOptions {
  anchor: FloatingLayerRect;
  host?: FloatingLayerRect;
  viewport: FloatingLayerViewport;
  gutter?: number;
  preferredMaxHeight?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Below this much room above the anchor, the layer flips below. */
  flipThreshold?: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(value, maximum));

/**
 * Pure placement math for the section picker. Kept separate from the DOM so
 * the clamping/flip rules can be unit tested without a real layout.
 */
export function computeFloatingLayerBounds({
  anchor,
  host,
  viewport,
  gutter = 8,
  preferredMaxHeight = 320,
  minWidth = 280,
  maxWidth = 420,
  flipThreshold = 160,
}: ComputeFloatingLayerBoundsOptions): FloatingLayerBounds {
  const hostLeft = host ? Math.max(gutter, host.left + gutter) : gutter;
  const hostRight = host
    ? Math.min(viewport.width - gutter, host.right - gutter)
    : viewport.width - gutter;
  const hostTop = host ? Math.max(gutter, host.top + gutter) : gutter;
  const hostBottom = host
    ? Math.min(viewport.height - gutter, host.bottom - gutter)
    : viewport.height - gutter;

  const availableWidth = Math.max(1, hostRight - hostLeft);
  const width = Math.min(
    availableWidth,
    Math.max(minWidth, Math.min(maxWidth, anchor.width)),
  );
  const left = clamp(
    anchor.left,
    hostLeft,
    Math.max(hostLeft, hostRight - width),
  );

  const spaceAbove = Math.max(0, anchor.top - hostTop - gutter);
  const spaceBelow = Math.max(0, hostBottom - anchor.bottom - gutter);
  const placeAbove =
    spaceAbove >= Math.min(flipThreshold, preferredMaxHeight) ||
    spaceAbove >= spaceBelow;

  if (placeAbove) {
    const maxHeight = Math.max(0, Math.min(preferredMaxHeight, spaceAbove));
    return {
      placement: "above",
      left,
      width,
      maxHeight,
      bottom: viewport.height - anchor.top + gutter,
    };
  }

  const maxHeight = Math.max(0, Math.min(preferredMaxHeight, spaceBelow));
  return {
    placement: "below",
    left,
    width,
    maxHeight,
    top: anchor.bottom + gutter,
  };
}

const toRect = (element: Element): FloatingLayerRect => {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
};

export interface UseAnchoredFloatingLayerOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  layerRef: RefObject<HTMLElement | null>;
  hostRef?: RefObject<HTMLElement | null>;
  preferredMaxHeight?: number;
}

/**
 * Positions a portaled floating layer above (or below) the text input using
 * viewport coordinates. Rendering in a portal is what makes this immune to
 * the composer's own `overflow-y-auto` ancestors; the measurements keep the
 * layer inside the hosting panel and the visible viewport.
 */
export function useAnchoredFloatingLayer({
  open,
  anchorRef,
  layerRef,
  hostRef,
  preferredMaxHeight,
}: UseAnchoredFloatingLayerOptions): void {
  useLayoutEffect(() => {
    if (!open) return;
    const layer = layerRef.current;
    const anchor = anchorRef.current;
    if (!layer || !anchor) return;

    layer.style.position = "fixed";
    layer.style.visibility = "hidden";

    const apply = () => {
      const anchorElement = anchorRef.current;
      const layerElement = layerRef.current;
      if (!anchorElement || !layerElement) return;
      const bounds = computeFloatingLayerBounds({
        anchor: toRect(anchorElement),
        host: hostRef?.current ? toRect(hostRef.current) : undefined,
        viewport: {
          width: window.innerWidth || document.documentElement.clientWidth,
          height: window.innerHeight || document.documentElement.clientHeight,
        },
        preferredMaxHeight,
      });

      layerElement.style.left = `${Math.round(bounds.left)}px`;
      layerElement.style.width = `${Math.round(bounds.width)}px`;
      layerElement.style.maxHeight = `${Math.round(bounds.maxHeight)}px`;
      if (bounds.placement === "above") {
        layerElement.style.bottom = `${Math.round(bounds.bottom ?? 0)}px`;
        layerElement.style.top = "auto";
      } else {
        layerElement.style.top = `${Math.round(bounds.top ?? 0)}px`;
        layerElement.style.bottom = "auto";
      }
      layerElement.style.visibility = "visible";
    };

    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(anchor);
    if (hostRef?.current) observer.observe(hostRef.current);
    // The composer can grow or shrink without resizing the textarea itself
    // (attachment chips, selected-section cards, the action strip). Observe
    // it so the layer keeps its distance above the input.
    const composer = anchor.closest(
      "[data-assistant-composer], .qa-composer-wrap, [role='dialog']",
    );
    if (composer) observer.observe(composer);

    window.addEventListener("resize", apply);
    window.addEventListener("scroll", apply, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
      window.removeEventListener("scroll", apply, true);
    };
  }, [anchorRef, hostRef, layerRef, open, preferredMaxHeight]);
}
