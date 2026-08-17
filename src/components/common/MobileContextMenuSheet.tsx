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
import { X } from "@phosphor-icons/react";
import { useMobileShell } from "../../hooks/useMobileShell";

interface MobileContextMenuSheetProps {
  open: boolean;
  onClose: () => void;
  /** Optional heading rendered above the items (e.g. the card/deck name). */
  title?: ReactNode;
  /**
   * `menu` (default) renders children as context-menu rows, which strips
   * button borders/backgrounds so every row looks like a flat list item.
   * `content` renders arbitrary UI (forms, pickers, panels) and keeps each
   * child's own styling — required because `mobile.css` is unlayered, so its
   * button reset would otherwise override Tailwind's background/border
   * utilities on primary buttons and toggles.
   */
  variant?: "menu" | "content";
  /** Optional custom sizing/styling class for desktop dialog (e.g. max-w-2xl) */
  className?: string;
  children: ReactNode;
}

export function MobileContextMenuSheet({
  open,
  onClose,
  title,
  variant = "menu",
  className,
  children,
}: MobileContextMenuSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const prevOverflowRef = useRef<string>("");
  const isMobile = useMobileShell();

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
      className={
        "fixed inset-0 z-[9999] " +
        (isMobile
          ? "flex flex-col justify-end"
          : "flex items-center justify-center p-4 sm:p-6")
      }
      role="dialog"
      aria-modal="true"
    >
      {/* Scrim: tap anywhere to dismiss. */}
      <div
        className={
          "absolute inset-0 transition-opacity duration-200 " +
          (isMobile ? "bg-black/50 " : "bg-black/60 backdrop-blur-sm ") +
          (visible ? "opacity-100" : "opacity-0")
        }
        onClick={onClose}
      />

      {/* Sheet / Dialog panel */}
      <div
        className={
          "mobile-context-menu-sheet relative bg-card shadow-2xl " +
          (isMobile
            ? "w-full border-t border-border rounded-t-2xl transition-transform duration-200 ease-out " +
              (visible ? "translate-y-0" : "translate-y-full")
            : "w-full " +
              (className || (variant === "content" ? "max-w-xl md:max-w-2xl" : "max-w-md")) +
              " border border-border rounded-2xl overflow-hidden flex flex-col transition-all duration-200 ease-out " +
              (visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-2"))
        }
        onTransitionEnd={finishExit}
        onClick={(e) => e.stopPropagation()}
      >
        {isMobile ? (
          <>
            {/* Drag handle */}
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>

            {title && (
              <div className="px-4 pb-2 pt-1 text-sm font-medium text-foreground truncate">
                {title}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Desktop Header */}
            {title ? (
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/70 flex-shrink-0 bg-muted/20">
                <div className="text-base font-semibold text-foreground truncate min-w-0 pr-3">
                  {title}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 -mr-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="absolute top-3.5 right-3.5 z-10 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </>
        )}

        {/* Height is capped against visual viewport on mobile, and capped to dialog height on desktop */}
        <div
          className={
            (variant === "menu" ? "mobile-context-menu-items" : "mobile-sheet-content") +
            " overflow-y-auto overscroll-contain" +
            (isMobile ? "" : " max-h-[75vh] md:max-h-[80vh]")
          }
        >
          {children}
        </div>

        {/* Safe-area padding at the bottom of the sheet on mobile */}
        {isMobile && (
          <div style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }} />
        )}
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

