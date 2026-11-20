import { invokeCommand, isNativeMobile, isTauri } from "../../tauri";

const CACHE_KEY = "assistant-panel-conversations-v1";
const LARGE_CACHE_CHARS = 256 * 1024;

// Keep the synchronous panel reads working when SQLite holds the desktop history.
let desktopSnapshot: string | null = null;
let nativeLoad: Promise<string | null> | undefined;

function usesDesktopStorage(): boolean {
  return isTauri() && !isNativeMobile();
}

function readLocalSnapshot(): string | null {
  try {
    return localStorage.getItem(CACHE_KEY);
  } catch {
    return null;
  }
}

export function readAssistantPanelSnapshot(): string | null {
  return desktopSnapshot ?? readLocalSnapshot();
}

export function writeAssistantPanelSnapshot(payload: string): void {
  if (usesDesktopStorage() && desktopSnapshot !== null) {
    desktopSnapshot = payload;
    return;
  }
  try {
    localStorage.setItem(CACHE_KEY, payload);
  } catch (error) {
    if (!usesDesktopStorage() || !(error instanceof DOMException) || error.name !== "QuotaExceededError") {
      throw error;
    }
    // The caller still queues a SQLite write. Keep the current draft available
    // to this window even if Local Storage cannot accept a second copy.
    desktopSnapshot = payload;
  }
}

export function needsAssistantPanelSnapshotHydration(): boolean {
  return usesDesktopStorage() && readAssistantPanelSnapshot() === null;
}

/** Release only a large cache that matches a confirmed SQLite record. */
export function releaseRedundantAssistantPanelSnapshot(durablePayload: string): void {
  if (
    !usesDesktopStorage() ||
    durablePayload.length < LARGE_CACHE_CHARS ||
    readLocalSnapshot() !== durablePayload
  ) return;
  desktopSnapshot ??= durablePayload;
  localStorage.removeItem(CACHE_KEY);
}

export function loadNativeAssistantPanelSnapshot(): Promise<string | null> {
  if (!isTauri()) return Promise.resolve(null);
  nativeLoad ??= invokeCommand<string | null>("assistant_panel_conversations_get").then((payload) => {
    if (typeof payload === "string" && usesDesktopStorage()) {
      if (readLocalSnapshot() === null) desktopSnapshot ??= payload;
      else releaseRedundantAssistantPanelSnapshot(payload);
    }
    return payload;
  }).finally(() => {
    nativeLoad = undefined;
  });
  return nativeLoad;
}

/** Run before the panel is opened so a legacy duplicate cannot crowd out preferences. */
export async function compactNativeAssistantPanelCache(): Promise<void> {
  if (usesDesktopStorage() && (readLocalSnapshot()?.length ?? 0) >= LARGE_CACHE_CHARS) {
    await loadNativeAssistantPanelSnapshot();
  }
}
