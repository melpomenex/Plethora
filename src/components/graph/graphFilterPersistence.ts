/**
 * Persisted open/closed preference for the docked Knowledge Graph filter
 * sidebar. The modal sheet used on phones is intentionally transient and does
 * not use this storage.
 */

import type { PresentationMode } from "../../lib/presentation";

export const GRAPH_FILTER_SIDEBAR_STORAGE_KEY =
  "plethora:knowledge-graph:sidebar-open:v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type SidebarPreferenceRecord = Partial<Record<PresentationMode, boolean>>;

function getStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Defaults: desktop keeps today's open sidebar; compact desktop starts collapsed. */
export function defaultGraphFilterSidebarOpen(mode: PresentationMode): boolean {
  return mode === "desktop";
}

/**
 * Read the persisted state for a docked presentation mode. Missing, malformed,
 * or non-object values fall back to the mode default instead of throwing.
 */
export function readGraphFilterSidebarOpen(
  mode: PresentationMode,
  storage: StorageLike | null = getStorage(),
): boolean {
  const fallback = defaultGraphFilterSidebarOpen(mode);
  if (!storage) return fallback;

  try {
    const raw = storage.getItem(GRAPH_FILTER_SIDEBAR_STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback;
    }

    const value = (parsed as SidebarPreferenceRecord)[mode];
    return typeof value === "boolean" ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Persist one docked mode without dropping the other modes' preferences. */
export function writeGraphFilterSidebarOpen(
  mode: PresentationMode,
  open: boolean,
  storage: StorageLike | null = getStorage(),
): void {
  if (!storage) return;

  try {
    const raw = storage.getItem(GRAPH_FILTER_SIDEBAR_STORAGE_KEY);
    let record: SidebarPreferenceRecord = {};
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        record = parsed as SidebarPreferenceRecord;
      }
    }
    record[mode] = open;
    storage.setItem(GRAPH_FILTER_SIDEBAR_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // A blocked/full localStorage must never break a filter toggle.
  }
}
