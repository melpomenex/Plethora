/**
 * Keyboard Shortcuts Store
 * Manages RSS keyboard navigation shortcuts and customization
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface KeyboardShortcut {
  id: string;
  action: string;
  keys: string; // e.g., "j" or "Shift+Enter"
  description: string;
  category: "navigation" | "article" | "feed" | "view" | "training" | "search";
}

export const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  // Navigation
  { id: "feed-next", action: "nextFeed", keys: "Shift+j", description: "Next feed", category: "navigation" },
  { id: "feed-prev", action: "prevFeed", keys: "Shift+k", description: "Previous feed", category: "navigation" },
  { id: "article-next", action: "nextArticle", keys: "j", description: "Next article", category: "navigation" },
  { id: "article-prev", action: "prevArticle", keys: "k", description: "Previous article", category: "navigation" },

  // Article actions
  { id: "mark-read", action: "markRead", keys: "m", description: "Mark article as read", category: "article" },
  { id: "mark-unread", action: "markUnread", keys: "u", description: "Mark article as unread", category: "article" },
  { id: "star", action: "star", keys: "s", description: "Star/save article", category: "article" },
  { id: "open-original", action: "openOriginal", keys: "o", description: "Open original URL", category: "article" },
  { id: "share", action: "share", keys: "Shift+s", description: "Share article", category: "article" },

  // Feed actions
  { id: "feed-refresh", action: "refreshFeed", keys: "r", description: "Refresh current feed", category: "feed" },
  { id: "feed-mark-all-read", action: "markAllRead", keys: "Shift+a", description: "Mark all as read", category: "feed" },

  // View
  { id: "view-text", action: "textView", keys: "Shift+Enter", description: "Temporary text view", category: "view" },
  { id: "view-next-mode", action: "nextViewMode", keys: "v", description: "Cycle view mode", category: "view" },
  { id: "toggle-sidebar", action: "toggleSidebar", keys: "b", description: "Toggle sidebar", category: "view" },
  // Note: document priority now lives in the primary shortcut store
  // (useShortcutStore, id "doc.priority") so it is honored in both the
  // Documents view and the reader. Do not re-add it here.

  // Training
  { id: "train-like", action: "trainLike", keys: "+", description: "Like (train intelligence)", category: "training" },
  { id: "train-dislike", action: "trainDislike", keys: "-", description: "Dislike (train intelligence)", category: "training" },

  // Search
  { id: "search-focus", action: "focusSearch", keys: "/", description: "Focus search bar", category: "search" },
  { id: "help", action: "showHelp", keys: "?", description: "Show keyboard shortcuts", category: "search" },
];

interface KeyboardShortcutsState {
  shortcuts: KeyboardShortcut[];
  isCustomized: boolean;

  loadDefaults: () => void;
  updateShortcut: (id: string, newKeys: string) => void;
  resetToDefaults: () => void;
  getShortcutKeys: (action: string) => string;
}

export const useKeyboardShortcutsStore = create<KeyboardShortcutsState>()(
  persist(
    (set, get) => ({
      shortcuts: DEFAULT_SHORTCUTS,
      isCustomized: false,

      loadDefaults: () => set({ shortcuts: DEFAULT_SHORTCUTS }),

      updateShortcut: (id, newKeys) => {
        const existing = get().shortcuts.find((s) => s.keys === newKeys && s.id !== id);
        if (existing) {
          console.warn(`Key conflict: "${newKeys}" is already used by "${existing.action}"`);
          return;
        }
        set((s) => ({
          shortcuts: s.shortcuts.map((sc) => (sc.id === id ? { ...sc, keys: newKeys } : sc)),
          isCustomized: true,
        }));
      },

      resetToDefaults: () => set({ shortcuts: DEFAULT_SHORTCUTS, isCustomized: false }),

      getShortcutKeys: (action) => {
        return get().shortcuts.find((s) => s.action === action)?.keys || "";
      },
    }),
    {
      name: "rss-keyboard-shortcuts",
      version: 1,
      // Deep-merge new DEFAULT_SHORTCUTS entries into persisted state instead of
      // wholesale replacing the in-memory defaults with a stale persisted list.
      // Without this, any newly added default shortcut is invisible to existing
      // users until they hit "Reset to defaults" — which is exactly why the
      // document-priority shortcut silently failed to fire. Keyed by `id` so a
      // user's custom binding for a known shortcut is preserved, and a removed
      // default (like the old increaseDocumentPriority entry) is dropped.
      merge: (persisted: unknown, current: KeyboardShortcutsState) => {
        const persistedState = persisted as Partial<KeyboardShortcutsState> | undefined;
        if (!persistedState?.shortcuts || !Array.isArray(persistedState.shortcuts)) {
          return current;
        }
        const persistedById = new Map(persistedState.shortcuts.map((s) => [s.id, s]));
        const mergedShortcuts = current.shortcuts.map((defaultShortcut) => {
          const persistedShortcut = persistedById.get(defaultShortcut.id);
          // Preserve a user-customized key binding; otherwise take the new default.
          return persistedShortcut?.keys
            ? { ...defaultShortcut, keys: persistedShortcut.keys }
            : defaultShortcut;
        });
        return {
          ...current,
          shortcuts: mergedShortcuts,
          isCustomized: persistedState.isCustomized ?? current.isCustomized,
        };
      },
    }
  )
);
