import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HapticCapabilities } from "../types";
import type { HapticsDriver } from "../noopDriver";

const runtime = vi.hoisted(() => ({ native: true, platform: "android" as string | null, hydrated: true,
  settings: { haptics: { enabled: true, intensity: "subtle" as "subtle" | "standard" | "strong" } },
  subscriptions: new Set<(state: unknown, previous: unknown) => void>(),
  hydrationListeners: new Set<() => void>(),
  invoke: vi.fn(),
}));
vi.mock("../../../tauri", () => ({ isTauri: () => runtime.native, nativePlatform: () => runtime.platform, isPWA: () => false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: runtime.invoke }));
vi.mock("../../../../stores/settingsStore", () => ({ useSettingsStore: {
  getState: () => ({ settings: runtime.settings }),
  subscribe: (listener: (state: unknown, previous: unknown) => void) => {
    runtime.subscriptions.add(listener);
    return () => runtime.subscriptions.delete(listener);
  },
  persist: {
    hasHydrated: () => runtime.hydrated,
    onFinishHydration: (listener: () => void) => {
      runtime.hydrationListeners.add(listener);
      return () => runtime.hydrationListeners.delete(listener);
    },
  },
} }));
import { __setHapticsDriverForTests, getHapticsSnapshot, performAdmittedHaptic, startHapticsService, stopHapticsService } from "../service";
import { __resetHapticDiagnosticsForTests, getHapticDiagnostics } from "../diagnostics";

const caps: HapticCapabilities = { protocolVersion: 1, driver: "android-native", driverSessionId: "s", configurationRevision: 0,
  hardware: "available", systemPreference: "enabled", intensityControl: "effect-style" };
function fakeDriver(): HapticsDriver {
  return { getCapabilities: vi.fn(async () => caps), configure: vi.fn(async () => true), perform: vi.fn(async () => ({ status: "submitted" as const })) };
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function preference(enabled: boolean, intensity: "subtle" | "standard" | "strong" = "subtle") {
  const previous = { settings: runtime.settings };
  runtime.settings = { haptics: { enabled, intensity } };
  runtime.subscriptions.forEach((listener) => listener({ settings: runtime.settings }, previous));
}

describe("haptics lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runtime.native = true;
    runtime.platform = "android";
    runtime.hydrated = true;
    runtime.settings = { haptics: { enabled: true, intensity: "subtle" } };
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    __setHapticsDriverForTests(null);
    __resetHapticDiagnosticsForTests();
    runtime.invoke.mockReset();
    runtime.invoke.mockImplementation(async (command: string, args?: { config: { revision: number } }) => {
      if (command.endsWith("get_capabilities")) return caps;
      if (command.endsWith("configure")) return { driverSessionId: "s", revision: args!.config.revision };
      return { status: "submitted" };
    });
  });
  afterEach(() => { stopHapticsService(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("waits for hydration and registers one subscription/listener across repeated starts", async () => {
    const driver = fakeDriver();
    __setHapticsDriverForTests(driver);
    runtime.hydrated = false;
    startHapticsService(); startHapticsService();
    await settle();
    expect(driver.getCapabilities).not.toHaveBeenCalled();
    expect(runtime.subscriptions.size).toBe(1);
    expect(runtime.hydrationListeners.size).toBe(1);
    runtime.hydrated = true;
    runtime.hydrationListeners.forEach((listener) => listener());
    await settle();
    expect(getHapticsSnapshot().configured).toBe(true);
    stopHapticsService();
    expect(runtime.subscriptions.size).toBe(0);
    expect(runtime.hydrationListeners.size).toBe(0);
  });

  it("reselects the native driver when platform metadata arrives after service import/start", async () => {
    vi.useRealTimers();
    runtime.platform = null;
    startHapticsService();
    await settle();
    expect(runtime.invoke).not.toHaveBeenCalled();
    expect(getHapticsSnapshot().configured).toBe(false);
    runtime.platform = "android";
    await vi.waitFor(() => expect(getHapticsSnapshot().configured).toBe(true));
    expect(getHapticsSnapshot()).toMatchObject({ configured: true, capabilities: { driver: "android-native", configurationRevision: 1 } });
    performAdmittedHaptic("completion", "test");
    await settle();
    expect(runtime.invoke).toHaveBeenCalledWith("plugin:plethora-haptics|perform", expect.anything());
  });

  it("does not use document.hasFocus as the native foreground authority", async () => {
    const driver = fakeDriver();
    __setHapticsDriverForTests(driver);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    startHapticsService(); await settle();
    performAdmittedHaptic("commit", "test"); await settle();
    expect(driver.perform).toHaveBeenCalledOnce();
  });

  it("stops admission immediately on preference changes, then applies the latest preference", async () => {
    const driver = fakeDriver();
    let finish!: (value: boolean) => void;
    vi.mocked(driver.configure).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    __setHapticsDriverForTests(driver); startHapticsService(); await settle();
    preference(false, "strong");
    expect(getHapticsSnapshot()).toMatchObject({ enabled: false, configured: false });
    finish(true); await settle();
    expect(driver.configure).toHaveBeenLastCalledWith(false, "strong");
    expect(getHapticsSnapshot()).toMatchObject({ enabled: false, configured: true });
    performAdmittedHaptic("completion", "disabled"); await settle();
    expect(driver.perform).not.toHaveBeenCalled();
  });

  it("recovers a transient initialization failure without interaction replay", async () => {
    const driver = fakeDriver();
    vi.mocked(driver.getCapabilities).mockRejectedValueOnce(new Error("missing plugin"));
    __setHapticsDriverForTests(driver); startHapticsService(); await settle();
    performAdmittedHaptic("commit", "missed");
    await vi.advanceTimersByTimeAsync(250); await settle();
    expect(getHapticsSnapshot().configured).toBe(true);
    expect(driver.perform).not.toHaveBeenCalled();
    expect(getHapticDiagnostics().some((entry) => entry.stage === "capabilities" && entry.reason === "plugin-unavailable")).toBe(true);
  });

  it("drops an in-flight second request and records native system refusal", async () => {
    const driver = fakeDriver();
    let finish!: (value: { status: "skipped"; reason: "system-suppressed" }) => void;
    vi.mocked(driver.perform).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    __setHapticsDriverForTests(driver); startHapticsService(); await settle();
    performAdmittedHaptic("completion", "first"); performAdmittedHaptic("completion", "second"); await settle();
    expect(driver.perform).toHaveBeenCalledOnce();
    finish({ status: "skipped", reason: "system-suppressed" }); await settle();
    expect(getHapticsSnapshot().busy).toBe(false);
    expect(getHapticDiagnostics().some((entry) => entry.reason === "system-suppressed")).toBe(true);
  });

  it("reconfigures on resume, drops hidden events and removes lifecycle listeners at teardown", async () => {
    const driver = fakeDriver();
    __setHapticsDriverForTests(driver); startHapticsService(); await settle();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    performAdmittedHaptic("completion", "hidden"); await settle();
    expect(driver.perform).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange")); await settle();
    expect(driver.configure).toHaveBeenCalledTimes(2);
    stopHapticsService();
    window.dispatchEvent(new Event("focus")); await settle();
    expect(driver.configure).toHaveBeenCalledTimes(2);
  });

  it("never falls back to browser vibration when native IPC fails", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    runtime.invoke.mockRejectedValue(new Error("plugin unavailable"));
    startHapticsService(); await settle();
    await vi.advanceTimersByTimeAsync(250); await settle();
    expect(vibrate).not.toHaveBeenCalled();
    expect(getHapticsSnapshot().configured).toBe(false);
  });
});
