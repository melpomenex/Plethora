/**
 * KeyboardShortcutProvider
 * Document-level keydown listener with action dispatch for RSS reader
 */

import { useEffect, useCallback, useRef } from "react";
import { useKeyboardShortcutsStore } from "../../stores/keyboardShortcutsStore";
import { useUIStore } from "../../stores/uiStore";

interface KeyboardShortcutProviderProps {
  onAction: (action: string) => void;
  enabled?: boolean;
}

export function KeyboardShortcutProvider({ onAction, enabled = true }: KeyboardShortcutProviderProps) {
  const { shortcuts } = useKeyboardShortcutsStore();
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't capture shortcuts when command palette is open
      if (useUIStore.getState().commandPaletteOpen) return;

      const target = e.target;
      const targetElement = target instanceof Element ? target : null;

      // Native controls inside a List card own unmodified Enter/Space (and the
      // anchor's native activation) even when the key has been remapped as an
      // article shortcut. This listener runs in capture phase, so descendant
      // stopPropagation cannot protect these controls on its own.
      const listCard = targetElement?.closest("[data-rss-list-card]");
      if (listCard) {
        const unmodified = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
        if (
          unmodified &&
          (e.key === "Enter" || e.key === " " || e.key === "Spacebar") &&
          targetElement.closest("button, a[href]")
        ) {
          return;
        }
        // Let the card's local disclosure handler dismiss an expanded card
        // before generic Escape shortcuts see the event.
        if (unmodified && e.key === "Escape" && listCard.getAttribute("data-expanded") === "true") {
          return;
        }
      }

      // Don't capture when typing in inputs
      if (
        targetElement &&
        (targetElement.tagName === "INPUT" ||
          targetElement.tagName === "TEXTAREA" ||
          targetElement.tagName === "SELECT" ||
          (targetElement as HTMLElement).isContentEditable)
      ) {
        // Allow Escape and specific shortcuts even in inputs
        if (e.key !== "Escape") return;
      }

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");
      if (!["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
        parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      }
      const combo = parts.join("+");

      // Find matching shortcut
      const shortcut = shortcuts.find((s) => s.keys === combo);
      if (shortcut) {
        e.preventDefault();
        e.stopPropagation();
        onActionRef.current(shortcut.action);
      } else if (combo === "ArrowDown" || combo === "j") {
        e.preventDefault();
        e.stopPropagation();
        onActionRef.current("nextArticle");
      } else if (combo === "ArrowUp" || combo === "k") {
        e.preventDefault();
        e.stopPropagation();
        onActionRef.current("prevArticle");
      } else if (combo === "Shift+?" || combo === "?") {
        e.preventDefault();
        e.stopPropagation();
        onActionRef.current("showHelp");
      }
    },
    [enabled, shortcuts]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  return null; // This is a provider component with no UI
}
