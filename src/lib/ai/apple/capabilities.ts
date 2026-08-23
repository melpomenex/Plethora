import { isTauri, nativePlatform } from "../../tauri";
import { invokeApple } from "./plugin";
import {
  unsupportedAppleSnapshot,
  type AppleIntelligenceSnapshot,
} from "./types";

const TTL_MS = 10_000;
let cached: AppleIntelligenceSnapshot | null = null;
let cachedAt = 0;

export function isAppleOsPlatform(): boolean {
  if (!isTauri()) return false;
  try {
    const platform = nativePlatform();
    return platform === "ios" || platform === "macos" || platform === "darwin";
  } catch {
    return false;
  }
}

export function resetAppleIntelligenceCache(): void {
  cached = null;
  cachedAt = 0;
}

export async function getAppleIntelligenceSnapshot(): Promise<AppleIntelligenceSnapshot> {
  if (!isAppleOsPlatform()) {
    return unsupportedAppleSnapshot(Date.now());
  }
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS && !isDownloading(cached)) {
    return cached;
  }
  try {
    const snap = await invokeApple<AppleIntelligenceSnapshot>("apple_capabilities");
    cached = snap;
    cachedAt = now;
    return snap;
  } catch {
    const snap = unsupportedAppleSnapshot(now);
    cached = snap;
    cachedAt = now;
    return snap;
  }
}

function isDownloading(snap: AppleIntelligenceSnapshot): boolean {
  return (
    snap.foundationModels.status === "downloading" ||
    snap.speech.status === "downloading" ||
    snap.coreAi.status === "downloading"
  );
}
