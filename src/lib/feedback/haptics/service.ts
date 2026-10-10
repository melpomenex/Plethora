import { nativePlatform, isPWA, isTauri } from "../../tauri";
import { useSettingsStore } from "../../../stores/settingsStore";
import { BrowserHapticsDriver } from "./browserDriver";
import { NativeHapticsDriver } from "./nativeDriver";
import { NoopHapticsDriver, type HapticsDriver } from "./noopDriver";
import { recordHapticDiagnostic } from "./diagnostics";
import type { HapticCapabilities, HapticEffect, HapticIntensity, NativeHapticResult } from "./types";

export interface HapticsSnapshot {
  capabilities: HapticCapabilities;
  configured: boolean;
  enabled: boolean;
  intensity: HapticIntensity;
  busy: boolean;
}

const NOOP_CAPABILITIES: HapticCapabilities = {
  protocolVersion: 1, driver: "none", driverSessionId: "none",
  configurationRevision: 0, hardware: "unavailable",
  systemPreference: "unknown", intensityControl: "none",
};
const initialSnapshot = (): HapticsSnapshot => ({
  capabilities: NOOP_CAPABILITIES, configured: false, enabled: false, intensity: "subtle", busy: false,
});

function selectDriver(): HapticsDriver | null {
  if (isTauri()) {
    const platform = nativePlatform()?.toLowerCase();
    // The OS plugin is injected before normal document execution, but do not
    // freeze a no-op if bridge metadata is temporarily absent during startup.
    if (!platform) return null;
    if (platform === "android" || platform === "ios") {
      return new NativeHapticsDriver(platform === "android" ? "android-native" : "ios-native");
    }
    return new NoopHapticsDriver();
  }
  const mobile = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0 && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const firefoxAndroidPwa = mobile && /Android.*Firefox/i.test(navigator.userAgent) && isPWA();
  return mobile && !firefoxAndroidPwa ? new BrowserHapticsDriver() : new NoopHapticsDriver();
}

let driver: HapticsDriver | null = null;
let snapshot = initialSnapshot();
let started = false;
let generation = 0;
let unsubscribeSettings: (() => void) | null = null;
let unsubscribeHydration: (() => void) | null = null;
let pendingPerform: Promise<NativeHapticResult> | null = null;
let configurationSequence: Promise<void> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 250;
const listeners = new Set<(next: HapticsSnapshot) => void>();

function publish(next: Partial<HapticsSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener(snapshot));
}

function deliverySuppression(): string | null {
  if (!snapshot.enabled) return "disabled";
  if (!snapshot.configured || !driver) return "configuration-pending";
  if (snapshot.capabilities.hardware !== "available") return "unsupported";
  if (!foreground()) return "background";
  return pendingPerform ? "in-flight" : null;
}

function foreground(): boolean {
  if (typeof document === "undefined") return true;
  // Android WebView document.hasFocus can be false during a committed native
  // gesture. Native lifecycle + visible View remain the final output authority.
  return document.visibilityState === "visible" && (isTauri() || document.hasFocus?.() !== false);
}

function cancelRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

function retryInitialization(): void {
  if (!started || retryTimer !== null || !foreground()) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (started && foreground()) void queueConfiguration();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

function failureReason(error: unknown, stage: "capabilities" | "configuration"): string {
  // Classify transport errors, never retain native exception text (which may
  // contain unrelated application data) in diagnostics or production logs.
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/permission|denied|not allowed/i.test(message)) return "ipc-permission-denied";
  if (/plugin.*(unavailable|missing|not.*(loaded|initialized|found))|missing plugin/i.test(message)) return "plugin-unavailable";
  if (/timed out|timeout/i.test(message)) return "ipc-timeout";
  if (/protocol mismatch/i.test(message)) return "protocol-mismatch";
  return stage === "configuration" ? "configuration-rejected" : "capability-query-failed";
}

async function applyConfiguration(expectedGeneration: number): Promise<void> {
  if (!started || expectedGeneration !== generation || !useSettingsStore.persist.hasHydrated()) return;
  const preference = useSettingsStore.getState().settings.haptics;
  driver ??= selectDriver();
  if (!driver) {
    recordHapticDiagnostic({ stage: "driver-selection", reason: "native-platform-pending" });
    retryInitialization();
    return;
  }
  const activeDriver = driver;
  const platform = nativePlatform();
  recordHapticDiagnostic({ stage: "driver-selection", details: {
    platform, selectedDriver: activeDriver instanceof NativeHapticsDriver ? `${platform?.toLowerCase()}-native` : isTauri() ? "none" : "browser-or-none",
  } });
  let stage: "capabilities" | "configuration" = "capabilities";
  try {
    const caps = await activeDriver.getCapabilities();
    if (expectedGeneration !== generation || activeDriver !== driver) return;
    publish({ capabilities: caps });
    recordHapticDiagnostic({ stage: "capabilities", details: {
      platform: nativePlatform(), driver: caps.driver, hardware: caps.hardware,
      systemPreference: caps.systemPreference, revision: caps.configurationRevision,
      sessionValid: Boolean(caps.driverSessionId),
      enabled: preference.enabled, intensity: preference.intensity, foreground: foreground(),
      ...(caps.nativeState ?? {}),
    } });
    if (caps.driver === "none") {
      publish({ configured: true });
      cancelRetry();
      return;
    }
    stage = "configuration";
    const configured = await activeDriver.configure(preference.enabled, preference.intensity);
    if (expectedGeneration !== generation || activeDriver !== driver) return;
    if (!configured) throw new Error("configuration-rejected");
    // Cache the applied revision/native lifecycle metadata for diagnostics.
    const appliedCaps = activeDriver instanceof NativeHapticsDriver ? activeDriver.getCachedCapabilities() : caps;
    publish({ capabilities: appliedCaps ?? caps, configured: true });
    recordHapticDiagnostic({ stage: "configuration", reason: "applied", details: {
      revision: snapshot.capabilities.configurationRevision, enabled: preference.enabled, intensity: preference.intensity,
    } });
    cancelRetry();
    retryDelay = 250;
    if (caps.hardware === "unknown") retryInitialization();
  } catch (error) {
    if (expectedGeneration !== generation || activeDriver !== driver) return;
    // Retain selected driver/capability identity, never hide IPC failures by
    // reporting an unsupported desktop or falling back to navigator.vibrate.
    publish({ configured: false });
    recordHapticDiagnostic({ stage, reason: failureReason(error, stage) });
    retryInitialization();
  }
}

function queueConfiguration(): Promise<void> {
  cancelRetry();
  const expectedGeneration = ++generation;
  const preference = useSettingsStore.getState().settings.haptics;
  // Stop admission synchronously, including while an older configure awaits IPC.
  publish({ enabled: preference.enabled, intensity: preference.intensity, configured: false });
  const operation = configurationSequence.then(() => applyConfiguration(expectedGeneration));
  configurationSequence = operation.catch(() => undefined);
  return operation;
}

function onVisibilityChange(): void {
  if (!foreground()) {
    ++generation;
    publish({ configured: false });
    cancelRetry();
  } else void queueConfiguration();
}
function onFocus(): void { if (foreground()) void queueConfiguration(); }

export function startHapticsService(): void {
  if (started) return;
  started = true;
  const begin = () => { void queueConfiguration(); };
  if (useSettingsStore.persist.hasHydrated()) begin();
  else unsubscribeHydration = useSettingsStore.persist.onFinishHydration(begin);
  unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.settings.haptics.enabled !== previous.settings.haptics.enabled || state.settings.haptics.intensity !== previous.settings.haptics.intensity) begin();
  });
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
}

export function stopHapticsService(): void {
  started = false;
  ++generation;
  cancelRetry();
  unsubscribeSettings?.();
  unsubscribeHydration?.();
  unsubscribeSettings = null;
  unsubscribeHydration = null;
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
  if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
  publish({ configured: false });
}

export function subscribeHaptics(listener: (next: HapticsSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => { listeners.delete(listener); };
}

export function getHapticsSnapshot(): HapticsSnapshot { return snapshot; }

function recordDeliveryResult(effect: HapticEffect, result: NativeHapticResult): void {
  const reason = result.status === "submitted" ? "submitted" : result.reason ?? "skipped";
  const details = result.nativeState ? { ...result.nativeState } : undefined;
  recordHapticDiagnostic({ stage: "native-result", reason, effect, details });
  if (result.status === "skipped" && result.reason === "stale") void queueConfiguration();
}

function finishDelivery(request: Promise<NativeHapticResult>): void {
  if (pendingPerform !== request) return;
  pendingPerform = null;
  publish({ busy: false });
}

/** Called only by the shared feedback admission resolver after policy selection. */
export function performAdmittedHaptic(effect: HapticEffect, interactionId: string): void {
  if (!started) startHapticsService();
  const reason = deliverySuppression();
  if (reason) {
    recordHapticDiagnostic({ stage: "delivery", reason, effect });
    return;
  }
  const activeDriver = driver!;
  recordHapticDiagnostic({ stage: "delivery", reason: "admitted", effect });
  // Promise.resolve also contains synchronous exceptions from a failing driver.
  const request = Promise.resolve().then(() => {
    if (!snapshot.configured || !snapshot.enabled || activeDriver !== driver || !foreground()) return { status: "skipped", reason: "stale" } as NativeHapticResult;
    return activeDriver.perform(effect, interactionId, 150);
  });
  pendingPerform = request;
  publish({ busy: true });
  void request.then((result) => recordDeliveryResult(effect, result), () => {
    recordHapticDiagnostic({ stage: "delivery", reason: "native-command-failed", effect });
    publish({ configured: false });
    retryInitialization();
  }).finally(() => finishDelivery(request));
}

export function __setHapticsDriverForTests(next: HapticsDriver | null): void {
  stopHapticsService();
  driver = next;
  snapshot = initialSnapshot();
  pendingPerform = null;
  retryDelay = 250;
  configurationSequence = Promise.resolve();
}
