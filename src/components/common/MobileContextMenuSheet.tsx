/**
 * MobileContextMenuSheet
 *
 * Shared bottom-sheet presentation for context menus on mobile (native Android
 * pattern). A dimmed full-screen scrim catches the first dismissive tap — so
 * tapping *anywhere* outside the sheet closes it, which is the fix for the
 * "accidental long-press opens a menu that won't go away" UX problem.
 *
 * Why this exists: the legacy floating menus relied on document-level
 * `click`/`mousedown` listeners, which on touch devices fire *after* the menu's
 * own opening logic — so the first tap-away was swallowed. A full-screen scrim
 * that absorbs the tap is the robust fix, and the bottom-sheet form is the
 * native Android idiom (thumb-reachable, generous touch targets).
 *
 * Responsibilities:
 *  - Render a `fixed inset-0` scrim (tap to close).
 *  - Render the sheet pinned to the bottom with safe-area + slide-up animation.
 *  - Lock body scroll while open; restore on close.
 *  - Close on Escape.
 *
 * The actual menu items are passed as children so each menu can render its own
 * rows/submenus. Callers MUST stopPropagation on the sheet body so taps on items
 * don't bubble to the scrim.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface MobileContextMenuSheetProps {
  open: boolean;
  onClose: () => void;
  /** Optional heading rendered above the items (e.g. the card/deck name). */
  title?: ReactNode;
  children: ReactNode;
}

export function MobileContextMenuSheet({
  open,
  onClose,
  title,
  children,
}: MobileContextMenuSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const prevOverflowRef = useRef<string>("");

  // Mount/unmount with an enter transition on open.
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Defer to next frame so the initial (off-screen) state paints first.
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    // Closing: play the exit transition; finishExit unmounts when it ends.
    if (mounted) {
      setVisible(false);
    }
  }, [open, mounted]);

  // Lock body scroll while the sheet is on screen.
  useEffect(() => {
    if (!mounted) return;
    prevOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflowRef.current;
    };
  }, [mounted]);

  // Escape to close.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mounted, onClose]);

  const finishExit = () => {
    if (!visible) setMounted(false);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
    >
      {/* Scrim: tap anywhere to dismiss. */}
      <div
        className={
          "absolute inset-0 bg-black/50 transition-opacity duration-200 " +
          (visible ? "opacity-100" : "opacity-0")
        }
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className={
          "mobile-context-menu-sheet relative w-full bg-card border-t border-border rounded-t-2xl shadow-2xl " +
          "transition-transform duration-200 ease-out " +
          (visible ? "translate-y-0" : "translate-y-full")
        }
        onTransitionEnd={finishExit}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        {title && (
          <div className="px-4 pb-2 pt-1 text-sm font-medium text-foreground truncate">
            {title}
          </div>
        )}

        <div className="mobile-context-menu-items max-h-[70vh] overflow-y-auto overscroll-contain">
          {children}
        </div>

        {/* Safe-area padding at the bottom of the sheet. */}
        <div style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }} />
      </div>
    </div>,
    document.body,
  );
}

/**
 * Shared row styling for sheet items. Menus render their own <button>s but
 * should use this className so touch targets are consistent.
 */
export const mobileSheetItemClass =
  "w-full px-4 py-3 text-left text-[15px] text-foreground active:bg-muted flex items-center gap-3 min-h-[48px]";
