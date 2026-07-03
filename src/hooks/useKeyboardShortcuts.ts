import { useEffect, useCallback } from "react";
import { isTauri, listen } from "../lib/tauri";

export interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  description: string;
  handler: (event: KeyboardEvent) => void;
  disabled?: boolean;
}

export interface ShortcutGroup {
  name: string;
  shortcuts: KeyboardShortcut[];
}

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

export function formatShortcut(shortcut: Omit<KeyboardShortcut, "handler" | "description">): string {
  const parts: string[] = [];

  if (shortcut.ctrlKey) parts.push(isMac ? "⌃" : "Ctrl");
  if (shortcut.metaKey) parts.push(isMac ? "⌘" : "Ctrl");
  if (shortcut.shiftKey) parts.push(isMac ? "⇧" : "Shift");
  if (shortcut.altKey) parts.push(isMac ? "⌥" : "Alt");
  parts.push(shortcut.key.toUpperCase());

  return parts.join(isMac ? "" : "+");
}

export function useKeyboardShortcuts(shortcutGroups: ShortcutGroup[]) {
  // Serialize shortcut definitions to a stable string for dependency comparison
  // to avoid re-registering listeners on every render when the array reference changes.
  const groupsKey = shortcutGroups
    .map((g) => g.shortcuts.map((s) => `${s.key}:${s.ctrlKey}:${s.metaKey}:${s.shiftKey}:${s.altKey}`).join(","))
    .join(";");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contentEditable
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Find matching shortcut
      for (const group of shortcutGroups) {
        for (const shortcut of group.shortcuts) {
          if (shortcut.disabled) continue;

          const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
          // metaKey in a shortcut definition means "primary modifier" (Ctrl on Linux/Windows, Cmd on Mac)
          const primaryMod = event.metaKey || event.ctrlKey;
          const ctrlMatch = shortcut.ctrlKey ? event.ctrlKey === true : !shortcut.metaKey ? event.ctrlKey === false : true;
          const metaMatch = shortcut.metaKey ? primaryMod === true : event.metaKey === false;
          const shiftMatch = event.shiftKey === (shortcut.shiftKey || false);
          const altMatch = event.altKey === (shortcut.altKey || false);

          if (keyMatch && ctrlMatch && metaMatch && shiftMatch && altMatch) {
            event.preventDefault();
            event.stopPropagation();
            shortcut.handler(event);
            return;
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [groupsKey, shortcutGroups]);
}

export function useGlobalShortcuts() {
  // Navigation shortcuts
  const navigateToQueue = useCallback(() => {
    window.dispatchEvent(new CustomEvent("navigate", { detail: "/queue" }));
  }, []);

  const navigateToReview = useCallback(() => {
    window.dispatchEvent(new CustomEvent("navigate", { detail: "/review" }));
  }, []);

  const navigateToDocuments = useCallback(() => {
    window.dispatchEvent(new CustomEvent("navigate", { detail: "/documents" }));
  }, []);

  const navigateToAnalytics = useCallback(() => {
    window.dispatchEvent(new CustomEvent("navigate", { detail: "/analytics" }));
  }, []);

  const navigateToSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent("navigate", { detail: "/settings" }));
  }, []);

  // Command palette
  const openCommandPalette = useCallback(() => {
    window.dispatchEvent(new CustomEvent("command-palette-open"));
  }, []);

  const toggleSidebar = useCallback(() => {
    window.dispatchEvent(new CustomEvent("toggle-sidebar"));
  }, []);

  const extractText = useCallback(() => {
    window.dispatchEvent(new CustomEvent("extract-text"));
  }, []);

  const navigateToDashboard = useCallback(() => {
    window.dispatchEvent(new CustomEvent("navigate", { detail: "/dashboard" }));
  }, []);

  const navigateToPrevDocument = useCallback(() => {
    window.dispatchEvent(new CustomEvent("document-prev"));
  }, []);

  const navigateToNextDocument = useCallback(() => {
    window.dispatchEvent(new CustomEvent("document-next"));
  }, []);

  const importDocument = useCallback(() => {
    window.dispatchEvent(new CustomEvent("navigate", { detail: "/documents" }));
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("import-document"));
    }, 0);
  }, []);

  const shortcuts: ShortcutGroup[] = [
    {
      name: "Navigation",
      shortcuts: [
        {
          key: "1",
          metaKey: true,
          description: "Navigate to Queue",
          handler: navigateToQueue,
        },
        {
          key: "2",
          metaKey: true,
          description: "Navigate to Review",
          handler: navigateToReview,
        },
        {
          key: "3",
          metaKey: true,
          description: "Navigate to Documents",
          handler: navigateToDocuments,
        },
        {
          key: "4",
          metaKey: true,
          description: "Navigate to Analytics",
          handler: navigateToAnalytics,
        },
        {
          key: "d",
          metaKey: true,
          description: "Navigate to Dashboard",
          handler: navigateToDashboard,
        },
        {
          key: ",",
          metaKey: true,
          description: "Navigate to Settings",
          handler: navigateToSettings,
        },
        {
          key: "o",
          metaKey: true,
          description: "Import document",
          handler: importDocument,
        },
        {
          key: "n",
          metaKey: true,
          description: "Import document",
          handler: importDocument,
        },
      ],
    },
    {
      name: "Commands",
      shortcuts: [
        {
          key: "k",
          metaKey: true,
          description: "Open command palette",
          handler: openCommandPalette,
        },
        {
          key: "p",
          metaKey: true,
          shiftKey: true,
          description: "Open command palette",
          handler: openCommandPalette,
        },
        {
          key: "b",
          metaKey: true,
          description: "Toggle sidebar",
          handler: toggleSidebar,
        },
        {
          key: "e",
          metaKey: true,
          description: "Extract text",
          handler: extractText,
        },
        {
          key: "[",
          metaKey: true,
          description: "Previous document",
          handler: navigateToPrevDocument,
        },
        {
          key: "]",
          metaKey: true,
          description: "Next document",
          handler: navigateToNextDocument,
        },
      ],
    },
  ];

  useKeyboardShortcuts(shortcuts);

  // Bridge the macOS Edit menu accelerators (Cmd+K / Cmd+P) to the DOM.
  // These are app-local menu items and only fire when Incrementum is focused.
  useEffect(() => {
    if (!isTauri()) return;

    let unlistenPaletteOpen: (() => void) | null = null;

    const setupTauriShortcutListeners = async () => {
      try {
        unlistenPaletteOpen = await listen<string>("command-palette-open", () => {
          window.dispatchEvent(new CustomEvent("command-palette-open"));
        });
      } catch (err) {
        console.error("Failed to setup Tauri shortcut event listeners:", err);
      }
    };

    setupTauriShortcutListeners();

    return () => {
      if (unlistenPaletteOpen) unlistenPaletteOpen();
    };
  }, []);

  return { shortcuts };
}
