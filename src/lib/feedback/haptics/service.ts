import { isNativeMobile, nativePlatform, isPWA, isTauri } from "../../tauri";
import { useSettingsStore } from "../../../stores/settingsStore";
import { BrowserHapticsDriver } from "./browserDriver";
import { NativeHapticsDriver } from "./nativeDriver";
import { NoopHapticsDriver, type HapticsDriver } from "./noopDriver";
import type { HapticCapabilities, HapticEffect, HapticIntensity, NativeHapticResult } from "./types";

export interface HapticsSnapshot {
  capabilities: HapticCapabilities;
  configured: boolean;
  enabled: boolean;
  intensity: HapticIntensity;
  busy: boolean;
}

const NOOP_CAPABILITIES: HapticCapabilities = {
  protocolVersion: 1,
  driver: "none",
  driverSessionId: "none",
  configurationRevision: 0,
  hardware: "unavailable",
  systemPreference: "unknown",
  intensityControl: "none",
};

function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return navigator.maxTouchPoints > 0 && /Android|iPhone|iPad|iPod/i.test(ua);
}

function selectDriver(): HapticsDriver {
  if (isTauri() && isNativeMobile()) {
    return new NativeHapticsDriver(nativePlatform()?.toLowerCase() === "android" ? "android-native" : "ios-native");
  }
  if (!isTauri() && (isPWA() || isMobileBrowser()) && isMobileBrowser()) return new BrowserHapticsDriver();
  return new NoopHapticsDriver();
}

let driver = selectDriver();
let snapshot: HapticsSnapshot = {
  capabilities: NOOP_CAPABILITIES,
  configured: false,
  enabled: false,
  intensity: "subtle",
  busy: false,
};
let started = false;
let startPromise: Promise<void> | null = null;
let unsubscribeSettings: (() => void) | null = null;
let pendingPerform: Promise<NativeHapticResult> | null = null;
let configurationSequence: Promise<void> = Promise.resolve();
let listeners = new Set<(next: HapticsSnapshot) => void>();

function publish(next: Partial<HapticsSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener(snapshot));
}

function foreground(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible" && document.hasFocus?.() !== false;
}

async function applyConfiguration(): Promise<void> {
  const preference = useSettingsStore.getState().settings.haptics;
  publish({ enabled: preference.enabled, intensity: preference.intensity, configured: false });
  if (!useSettingsStore.persist.hasHydrated()) return;
  try {
    const caps = await driver.getCapabilities();
    publish({ capabilities: caps });
    if (caps.driver === "none" || caps.hardware === "unavailable") {
      publish({ configured: true });
      return;
    }
    const configured = await driver.configure(preference.enabled, preference.intensity);
    publish({ configured });
  } catch {
    publish({ capabilities: NOOP_CAPABILITIES, configured: false });
  }
}

function queueConfiguration(): Promise<void> {
  const operation = configurationSequence.then(applyConfiguration);
  configurationSequence = operation.then(() => undefined, () => undefined);
  return operation;
}

async function refreshOnResume(): Promise<void> {
  if (!foreground()) return;
  // This refresh never queues or replays a perform request.
  await queueConfiguration();
}

export function startHapticsService(): void {
  if (started) return;
  started = true;
  const begin = () => {
    startPromise ??= queueConfiguration();
    void startPromise;
  };
  if (useSettingsStore.persist.hasHydrated()) begin();
  else useSettingsStore.persist.onFinishHydration(begin);
  unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.settings.haptics.enabled !== previous.settings.haptics.enabled || state.settings.haptics.intensity !== previous.settings.haptics.intensity) {
      startPromise = queueConfiguration();
    }
  });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => { if (foreground()) void refreshOnResume(); });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => { void refreshOnResume(); });
  }
}

export function subscribeHaptics(listener: (next: HapticsSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

export function getHapticsSnapshot(): HapticsSnapshot { return snapshot; }

/** Called only by the shared feedback admission resolver after policy selection. */
export function performAdmittedHaptic(effect: HapticEffect, interactionId: string): void {
  if (!started) startHapticsService();
  if (!snapshot.configured || !snapshot.enabled || snapshot.capabilities.hardware !== "available" || !foreground()) return;
  if (pendingPerform) return;
  const request = driver.perform(effect, interactionId, 150);
  pendingPerform = request;
  publish({ busy: true });
  void request.catch(() => undefined).finally(() => {
    if (pendingPerform === request) pendingPerform = null;
    publish({ busy: false });
  });
  // Native invokes may be slow, but callers never await them. The promise is
  // never placed in a queue; later work is dropped while it remains pending.
}

export function __setHapticsDriverForTests(next: HapticsDriver): void {
  driver = next;
  snapshot = { ...snapshot, capabilities: NOOP_CAPABILITIES, configured: false, busy: false };
  startPromise = null;
  configurationSequence = Promise.resolve();
  started = false;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
}
