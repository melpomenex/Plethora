import { create } from "zustand";

export const DASHBOARD_LAYOUT_STORAGE_KEY = "plethora_dashboard_layout_v1";

export const DEFAULT_DASHBOARD_SECTION_ORDER = [
  "focus",
  "quick-actions",
  "continue-reading",
  "capture-activity",
  "todays-horizon",
  "study-plans",
  "progress",
  "quick-tip",
  "quick-review",
] as const;

export type DashboardSectionId = (typeof DEFAULT_DASHBOARD_SECTION_ORDER)[number];

export const DEFAULT_QUICK_ACTION_ORDER = [
  "continue-reading",
  "queue",
  "review",
  "documents",
  "rss",
  "audiobooks",
  "analytics",
  "settings",
] as const;

export type DashboardQuickActionId = (typeof DEFAULT_QUICK_ACTION_ORDER)[number];

export interface DashboardLayoutConfig {
  sectionOrder: DashboardSectionId[];
  hiddenSections: DashboardSectionId[];
  quickActionOrder: DashboardQuickActionId[];
  hiddenQuickActions: DashboardQuickActionId[];
}

export function createDefaultDashboardLayout(): DashboardLayoutConfig {
  return {
    sectionOrder: [...DEFAULT_DASHBOARD_SECTION_ORDER],
    hiddenSections: [],
    quickActionOrder: [...DEFAULT_QUICK_ACTION_ORDER],
    hiddenQuickActions: [],
  };
}

function normalizeOrderedIds<T extends string>(
  candidate: unknown,
  allowed: readonly T[],
): T[] {
  const allowedSet = new Set<string>(allowed);
  const seen = new Set<T>();
  const result: T[] = [];

  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      if (typeof item === "string" && allowedSet.has(item) && !seen.has(item as T)) {
        const typed = item as T;
        seen.add(typed);
        result.push(typed);
      }
    }
  }

  for (const fallback of allowed) {
    if (!seen.has(fallback)) {
      result.push(fallback);
    }
  }

  return result;
}

function normalizeHiddenIds<T extends string>(
  candidate: unknown,
  allowed: readonly T[],
): T[] {
  const allowedSet = new Set<string>(allowed);
  const seen = new Set<T>();
  const result: T[] = [];

  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      if (typeof item === "string" && allowedSet.has(item) && !seen.has(item as T)) {
        const typed = item as T;
        seen.add(typed);
        result.push(typed);
      }
    }
  }

  return result;
}

export function normalizeDashboardLayout(raw: unknown): DashboardLayoutConfig {
  if (!raw || typeof raw !== "object") {
    return createDefaultDashboardLayout();
  }
  const obj = raw as Record<string, unknown>;
  return {
    sectionOrder: normalizeOrderedIds(obj.sectionOrder, DEFAULT_DASHBOARD_SECTION_ORDER),
    hiddenSections: normalizeHiddenIds(obj.hiddenSections, DEFAULT_DASHBOARD_SECTION_ORDER),
    quickActionOrder: normalizeOrderedIds(obj.quickActionOrder, DEFAULT_QUICK_ACTION_ORDER),
    hiddenQuickActions: normalizeHiddenIds(obj.hiddenQuickActions, DEFAULT_QUICK_ACTION_ORDER),
  };
}

export function isDefaultDashboardLayout(config: DashboardLayoutConfig): boolean {
  if (config.hiddenSections.length > 0 || config.hiddenQuickActions.length > 0) {
    return false;
  }
  if (
    config.sectionOrder.length !== DEFAULT_DASHBOARD_SECTION_ORDER.length ||
    config.quickActionOrder.length !== DEFAULT_QUICK_ACTION_ORDER.length
  ) {
    return false;
  }
  return (
    config.sectionOrder.every((id, idx) => id === DEFAULT_DASHBOARD_SECTION_ORDER[idx]) &&
    config.quickActionOrder.every((id, idx) => id === DEFAULT_QUICK_ACTION_ORDER[idx])
  );
}

function readPersistedLayout(): DashboardLayoutConfig {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return createDefaultDashboardLayout();
    }
    const raw = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return createDefaultDashboardLayout();
    }
    return normalizeDashboardLayout(JSON.parse(raw));
  } catch {
    return createDefaultDashboardLayout();
  }
}

function writePersistedLayout(config: DashboardLayoutConfig): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(config));
    }
  } catch {
    // Ignore storage quota/access errors
  }
}

function moveItemByOffset<T>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length || target === index) {
    return [...list];
  }
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function moveItemToIndex<T>(list: readonly T[], fromId: T, toIndex: number): T[] {
  const fromIndex = list.indexOf(fromId);
  if (fromIndex === -1) return [...list];
  const clamped = Math.max(0, Math.min(list.length - 1, toIndex));
  if (clamped === fromIndex) return [...list];
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.splice(clamped, 0, item);
  return next;
}

export interface DashboardLayoutState extends DashboardLayoutConfig {
  moveSection: (id: DashboardSectionId, direction: "up" | "down") => void;
  reorderSection: (fromId: DashboardSectionId, toIndex: number) => void;
  setSectionVisible: (id: DashboardSectionId, visible: boolean) => void;
  toggleSectionVisibility: (id: DashboardSectionId) => void;
  moveQuickAction: (id: DashboardQuickActionId, direction: "left" | "right") => void;
  reorderQuickAction: (fromId: DashboardQuickActionId, toIndex: number) => void;
  setQuickActionVisible: (id: DashboardQuickActionId, visible: boolean) => void;
  toggleQuickActionVisibility: (id: DashboardQuickActionId) => void;
  resetToDefault: () => void;
  reloadFromStorage: () => void;
}

function pickConfig(state: DashboardLayoutConfig): DashboardLayoutConfig {
  return {
    sectionOrder: state.sectionOrder,
    hiddenSections: state.hiddenSections,
    quickActionOrder: state.quickActionOrder,
    hiddenQuickActions: state.hiddenQuickActions,
  };
}

export const useDashboardLayoutStore = create<DashboardLayoutState>((set, get) => {
  const initial = readPersistedLayout();

  const commit = (partial: Partial<DashboardLayoutConfig>) => {
    const current = pickConfig(get());
    const next: DashboardLayoutConfig = {
      ...current,
      ...partial,
    };
    writePersistedLayout(next);
    set(next);
  };

  return {
    ...initial,

    moveSection: (id, direction) => {
      const { sectionOrder } = get();
      const idx = sectionOrder.indexOf(id);
      if (idx === -1) return;
      const nextOrder = moveItemByOffset(sectionOrder, idx, direction === "up" ? -1 : 1);
      if (nextOrder.every((item, i) => item === sectionOrder[i])) return;
      commit({ sectionOrder: nextOrder });
    },

    reorderSection: (fromId, toIndex) => {
      const { sectionOrder } = get();
      const nextOrder = moveItemToIndex(sectionOrder, fromId, toIndex);
      if (nextOrder.every((item, i) => item === sectionOrder[i])) return;
      commit({ sectionOrder: nextOrder });
    },

    setSectionVisible: (id, visible) => {
      const { hiddenSections } = get();
      const isHidden = hiddenSections.includes(id);
      if (visible && !isHidden) return;
      if (!visible && isHidden) return;
      const nextHidden = visible
        ? hiddenSections.filter((item) => item !== id)
        : [...hiddenSections, id];
      commit({ hiddenSections: nextHidden });
    },

    toggleSectionVisibility: (id) => {
      const { hiddenSections, setSectionVisible } = get();
      setSectionVisible(id, hiddenSections.includes(id));
    },

    moveQuickAction: (id, direction) => {
      const { quickActionOrder } = get();
      const idx = quickActionOrder.indexOf(id);
      if (idx === -1) return;
      const nextOrder = moveItemByOffset(quickActionOrder, idx, direction === "left" ? -1 : 1);
      if (nextOrder.every((item, i) => item === quickActionOrder[i])) return;
      commit({ quickActionOrder: nextOrder });
    },

    reorderQuickAction: (fromId, toIndex) => {
      const { quickActionOrder } = get();
      const nextOrder = moveItemToIndex(quickActionOrder, fromId, toIndex);
      if (nextOrder.every((item, i) => item === quickActionOrder[i])) return;
      commit({ quickActionOrder: nextOrder });
    },

    setQuickActionVisible: (id, visible) => {
      const { hiddenQuickActions } = get();
      const isHidden = hiddenQuickActions.includes(id);
      if (visible && !isHidden) return;
      if (!visible && isHidden) return;
      const nextHidden = visible
        ? hiddenQuickActions.filter((item) => item !== id)
        : [...hiddenQuickActions, id];
      commit({ hiddenQuickActions: nextHidden });
    },

    toggleQuickActionVisibility: (id) => {
      const { hiddenQuickActions, setQuickActionVisible } = get();
      setQuickActionVisible(id, hiddenQuickActions.includes(id));
    },

    resetToDefault: () => {
      const defaults = createDefaultDashboardLayout();
      writePersistedLayout(defaults);
      set(defaults);
    },

    reloadFromStorage: () => {
      set(readPersistedLayout());
    },
  };
});

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === DASHBOARD_LAYOUT_STORAGE_KEY) {
      useDashboardLayoutStore.getState().reloadFromStorage();
    }
  });
}
