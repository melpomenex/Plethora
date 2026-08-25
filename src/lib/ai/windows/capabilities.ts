import { isTauri, nativePlatform } from "../../tauri";
import { invokeWindows } from "./plugin";
import {
  unsupportedWindowsSnapshot,
  type WindowsIntelligenceSnapshot,
} from "./types";

const TTL_MS = 10_000;
let cached: WindowsIntelligenceSnapshot | null = null;
let cachedAt = 0;

export function isWindowsDesktop(): boolean {
  if (!isTauri()) return false;
  try {
    const platform = nativePlatform();
    return platform === "windows";
  } catch {
    return false;
  }
}

/** Alias used by settings UI and routing helpers. */
export const isWindowsDesktopPlatform = isWindowsDesktop;

export function resetWindowsIntelligenceCache(): void {
  cached = null;
  cachedAt = 0;
}

export async function getWindowsIntelligenceSnapshot(): Promise<WindowsIntelligenceSnapshot> {
  if (!isWindowsDesktop()) {
    return unsupportedWindowsSnapshot(Date.now());
  }
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS && !isDownloading(cached)) {
    return cached;
  }
  try {
    const snap = await invokeWindows<WindowsIntelligenceSnapshot>("windows_capabilities");
    cached = snap;
    cachedAt = now;
    return snap;
  } catch {
    const snap = unsupportedWindowsSnapshot(now);
    cached = snap;
    cachedAt = now;
    return snap;
  }
}

function isDownloading(snap: WindowsIntelligenceSnapshot): boolean {
  return (
    snap.languageModel.status === "downloading" ||
    snap.ocr.status === "downloading" ||
    snap.imageDescription.status === "downloading" ||
    snap.embeddings.status === "downloading"
  );
}
