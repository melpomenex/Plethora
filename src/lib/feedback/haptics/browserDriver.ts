import type { HapticCapabilities, HapticEffect, NativeHapticResult } from "./types";
import type { HapticsDriver } from "./noopDriver";

const DURATION_MS: Record<HapticEffect, number> = {
  selection: 8,
  activation: 10,
  threshold: 10,
  commit: 12,
  success: 14,
  warning: 14,
  error: 16,
  completion: 14,
  celebration: 16,
};

export class BrowserHapticsDriver implements HapticsDriver {
  async getCapabilities(): Promise<HapticCapabilities> {
    const available = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
    return {
      protocolVersion: 1,
      driver: "browser",
      driverSessionId: "browser-session",
      configurationRevision: 0,
      hardware: available ? "available" : "unavailable",
      systemPreference: "unknown",
      intensityControl: "fixed",
    };
  }

  async configure(): Promise<boolean> { return true; }

  async perform(effect: HapticEffect, _interactionId: string, ttlMs: number): Promise<NativeHapticResult> {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
      return { status: "skipped", reason: "unsupported" };
    }
    if (ttlMs < 1 || ttlMs > 150) return { status: "skipped", reason: "stale" };
    try {
      return navigator.vibrate(Math.min(DURATION_MS[effect], 20))
        ? { status: "submitted" }
        : { status: "skipped", reason: "system-suppressed" };
    } catch {
      return { status: "skipped", reason: "system-suppressed" };
    }
  }
}
