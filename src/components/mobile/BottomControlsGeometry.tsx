import { createContext, useContext, useLayoutEffect, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import type { AssistantViewport } from "../assistant/mobile/viewport";

export interface BottomControlsGeometry {
  viewportTop: number;
  viewportHeight: number;
  safeBottom: number;
  occupiedTop?: number;
  blocked: boolean;
}

const Geometry = createContext<BottomControlsGeometry | null>(null);
const Publish = createContext<Dispatch<SetStateAction<BottomControlsGeometry | null>> | null>(null);

export function BottomControlsGeometryProvider({ children }: { children: ReactNode }) {
  const [geometry, publish] = useState<BottomControlsGeometry | null>(null);
  return <Publish.Provider value={publish}><Geometry.Provider value={geometry}>{children}</Geometry.Provider></Publish.Provider>;
}

export function useBottomControlsGeometry() { return useContext(Geometry); }

/** DOM rectangles and the published boundary use layout-viewport coordinates. */
export function visibleControlTop(element: HTMLElement | null, top: number, bottom: number): number | undefined {
  if (!element || element.hidden || element.classList.contains("hidden") || element.getAttribute("aria-hidden") === "true") return;
  const css = getComputedStyle(element);
  if (css.display === "none" || css.visibility === "hidden") return;
  const rect = element.getBoundingClientRect();
  if (rect.height <= 0 || rect.bottom <= top || rect.top >= bottom) return;
  return Math.max(top, rect.top);
}

/** Owners publish only their own controls; the dock never moves those controls. */
export function usePublishBottomControls({ viewport, navRef, pillRef, pillVisible, blocked, fullscreen }: {
  viewport: AssistantViewport;
  navRef: RefObject<HTMLElement | null>;
  pillRef: RefObject<HTMLButtonElement | null>;
  pillVisible: boolean;
  blocked: boolean;
  fullscreen: boolean;
}) {
  const publish = useContext(Publish);
  useLayoutEffect(() => {
    if (!publish) return;
    const read = () => {
      const bottom = viewport.top + viewport.height;
      const navTop = fullscreen ? undefined : visibleControlTop(navRef.current, viewport.top, bottom);
      const pillTop = pillVisible ? visibleControlTop(pillRef.current, viewport.top, bottom) : undefined;
      const occupiedTop = Math.min(navTop ?? bottom, pillTop ?? bottom);
      const next: BottomControlsGeometry = { viewportTop: viewport.top, viewportHeight: viewport.height,
        safeBottom: viewport.safeBottom, occupiedTop: occupiedTop < bottom ? occupiedTop : undefined, blocked };
      publish(old => old && Object.keys(next).every(key => old[key as keyof BottomControlsGeometry] === next[key as keyof BottomControlsGeometry]) ? old : next);
    };
    read();
    const resize = new ResizeObserver(read);
    const attributes = new MutationObserver(read);
    const elements = [navRef.current, pillRef.current];
    for (const element of elements) {
      if (!element) continue;
      resize.observe(element);
      attributes.observe(element, { attributes: true, attributeFilter: ["hidden", "class", "style", "aria-hidden"] });
      element.addEventListener("transitionend", read);
    }
    return () => {
      resize.disconnect(); attributes.disconnect();
      for (const element of elements) element?.removeEventListener("transitionend", read);
    };
  }, [publish, viewport, navRef, pillRef, pillVisible, blocked, fullscreen]);
  useLayoutEffect(() => () => { publish?.(null); }, [publish]);
}

export function bottomDockClearance(geometry: BottomControlsGeometry): number {
  return geometry.occupiedTop === undefined ? geometry.safeBottom + 12
    : geometry.viewportTop + geometry.viewportHeight - geometry.occupiedTop + 8;
}
