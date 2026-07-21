import { useEffect, useRef } from "react";

/**
 * Trap keyboard focus inside a container while it is mounted, and restore
 * focus to the previously-focused element on unmount.
 *
 * Behaviour (spec: "Focus is trapped in the coach mark" + "Focus restoration"):
 * - On mount, the previously-focused element (`document.activeElement`) is
 *   captured so it can be restored on unmount.
 * - Focus moves into the container immediately.
 * - `Tab` and `Shift+Tab` cycle only among the container's tabbable
 *   descendants; focus never escapes to the dimmed app behind it.
 * - On unmount, focus returns to the captured element (if still present).
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean): React.RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined") return;

    previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;

    const container = containerRef.current;
    if (!container) return;

    // Move focus into the container.
    const initial = firstTabbable(container) ?? container;
    initial.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const tabbables = tabbableWithin(root);
      if (tabbables.length === 0) {
        // Keep focus on the container itself.
        e.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === "function") {
        // Only restore if still connected; otherwise focus is left to the UA.
        if (prev.isConnected) prev.focus({ preventScroll: true });
      }
      previouslyFocusedRef.current = null;
    };
  }, [active]);

  return containerRef;
}

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
]
  .map((s) => `${s}:not([disabled])`)
  .join(",");

function tabbableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
}

function firstTabbable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(TABBABLE_SELECTOR);
}
