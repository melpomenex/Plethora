import { useLayoutEffect, type RefObject } from 'react';
/** Anchor to More itself, even when the composer scrolls at large text. */
export function useAssistantActionMenuBounds(open: boolean, menuRef: RefObject<HTMLDivElement | null>, triggerRef: RefObject<HTMLButtonElement | null>, panelRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const menu = menuRef.current, trigger = triggerRef.current, panel = panelRef.current;
    if (!open || !menu || !trigger || !panel) return;
    const measure = () => {
      const bounds = panel.getBoundingClientRect();
      const anchor = trigger.getBoundingClientRect();
      const scale = bounds.width / panel.offsetWidth || 1;
      const top = Math.max(bounds.top, 0);
      const bottom = Math.min(anchor.top, bounds.bottom, window.innerHeight);
      menu.style.bottom = `${(bounds.bottom - bottom) / scale + 4 - panel.scrollTop}px`;
      menu.style.maxHeight = `${Math.max(48, (bottom - top) / scale - 12)}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel); observer.observe(trigger);
    const composer = panel.querySelector('[data-assistant-composer]');
    composer?.addEventListener('scroll', measure);
    panel.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); composer?.removeEventListener('scroll', measure); panel.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [open, menuRef, triggerRef, panelRef]);
}
