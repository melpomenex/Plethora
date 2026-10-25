import { useLayoutEffect, type RefObject } from "react";

/** Bound the anchored desktop menu in panel-local units, including CSS zoom. */
export function useAssistantModelMenuBounds(
  menuRef: RefObject<HTMLDivElement | null>,
  panelRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  side: "left" | "right",
) {
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const panel = panelRef.current;
    const anchor = menu?.parentElement;
    if (!open || !menu || !panel || !anchor) return;

    const measure = () => {
      const bounds = panel.getBoundingClientRect();
      const control = anchor.getBoundingClientRect();
      const scale = bounds.width / panel.offsetWidth || 1;
      const gutter = 8 * scale;
      const left = Math.max(bounds.left, 0) + gutter;
      const right = Math.min(bounds.right, document.documentElement.clientWidth) - gutter;
      menu.style.maxWidth = `${Math.max(0, right - left) / scale}px`;
      const width = menu.offsetWidth * scale;
      const preferred = side === "right" ? control.right - width : control.left;
      const start = Math.max(left, Math.min(preferred, right - width));
      menu.style.left = `${(start - control.left) / scale}px`;
      menu.style.maxHeight = `${Math.max(0, Math.min(bounds.bottom, window.innerHeight) - control.bottom - 2 * gutter) / scale}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const target of [panel, anchor, anchor.closest("[data-assistant-toolbar]")]) {
      if (target) observer.observe(target);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [menuRef, panelRef, open, side]);
}
