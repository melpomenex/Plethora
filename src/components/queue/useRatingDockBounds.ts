import { useLayoutEffect, type RefObject } from "react";
import { bottomDockClearance, type BottomControlsGeometry } from "../mobile/BottomControlsGeometry";

/** Use the overlay's own box to convert viewport rectangles into local CSS offsets. */
export function useRatingDockBounds(frame: RefObject<HTMLDivElement | null>, header: RefObject<HTMLDivElement | null>,
  footer: RefObject<HTMLDivElement | null>, geometry: BottomControlsGeometry | null, enabled: boolean) {
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element || !enabled) return;
    const read = () => {
      const box = element.getBoundingClientRect();
      const start = Math.max(box.top + 112, (header.current?.getBoundingClientRect().bottom ?? box.top) + 8);
      const end = geometry ? geometry.viewportTop + geometry.viewportHeight - bottomDockClearance(geometry)
        : Math.min(box.bottom - 12, (footer.current?.getBoundingClientRect().top ?? box.bottom) - 8);
      element.style.setProperty("--rating-dock-bottom", `${Math.max(0, box.bottom - end)}px`);
      element.style.setProperty("--rating-dock-start", `${start - box.top}px`);
      element.style.setProperty("--rating-dock-center", `${(start + end) / 2 - box.top}px`);
      element.style.setProperty("--rating-dock-max-height", `${Math.max(44, end - start)}px`);
    };
    read();
    const observer = new ResizeObserver(read);
    for (const target of [element, header.current, footer.current]) if (target) observer.observe(target);
    window.addEventListener("resize", read);
    return () => { observer.disconnect(); window.removeEventListener("resize", read); };
  }, [frame, header, footer, geometry, enabled]);
}
