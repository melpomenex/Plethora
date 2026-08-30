import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  isNativeMobile: vi.fn(() => false),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: tauriMocks.isTauri,
  isNativeMobile: tauriMocks.isNativeMobile,
}));

import {
  canRunLocalNemotron,
  checkRealtimeSessionHealth,
  classifyDevice,
  getDeviceCapabilitySnapshot,
  getMobileNemotronInstallRecommendation,
} from "../DeviceCapabilityService";

function mockNavigator(partial: {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}) {
  Object.defineProperty(globalThis.navigator, "hardwareConcurrency", {
    configurable: true,
    value: partial.hardwareConcurrency ?? 8,
  });
  Object.defineProperty(globalThis.navigator, "deviceMemory", {
    configurable: true,
    value: partial.deviceMemory,
  });
}

describe("DeviceCapabilityService", () => {
  beforeEach(() => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.isNativeMobile.mockReturnValue(false);
    mockNavigator({ hardwareConcurrency: 8, deviceMemory: 8 });
  });

  it("classifies high-end desktop as excellent", () => {
    mockNavigator({ hardwareConcurrency: 12, deviceMemory: 16 });
    expect(classifyDevice()).toBe("excellent");
  });

  it("classifies low-memory desktop as unsupported", () => {
    mockNavigator({ hardwareConcurrency: 8, deviceMemory: 3 });
    expect(classifyDevice()).toBe("unsupported");
  });

  it("requires Good or better on mobile for local Nemotron", () => {
    tauriMocks.isNativeMobile.mockReturnValue(true);
    mockNavigator({ hardwareConcurrency: 6, deviceMemory: 6 });
    expect(classifyDevice()).toBe("usable");
    expect(canRunLocalNemotron("usable")).toBe(false);
    expect(canRunLocalNemotron("good")).toBe(true);
  });

  it("allows Usable or better on desktop for local Nemotron", () => {
    expect(canRunLocalNemotron("usable")).toBe(true);
  });

  it("returns unsupported outside Tauri", () => {
    tauriMocks.isTauri.mockReturnValue(false);
    mockNavigator({ hardwareConcurrency: 16, deviceMemory: 32 });
    expect(classifyDevice()).toBe("unsupported");
    expect(getDeviceCapabilitySnapshot().canRunLocalNemotron).toBe(false);
  });

  it("blocks mobile install on unsupported devices", () => {
    tauriMocks.isNativeMobile.mockReturnValue(true);
    mockNavigator({ hardwareConcurrency: 2, deviceMemory: 3 });
    const result = getMobileNemotronInstallRecommendation();
    expect(result.allowed).toBe(false);
    expect(result.performanceClass).toBe("unsupported");
    expect(result.warning).toBeTruthy();
  });

  it("warns on slow mobile devices but allows install", () => {
    tauriMocks.isNativeMobile.mockReturnValue(true);
    mockNavigator({ hardwareConcurrency: 5, deviceMemory: 8 });
    expect(classifyDevice()).toBe("slow");
    const result = getMobileNemotronInstallRecommendation();
    expect(result.allowed).toBe(true);
    expect(result.warning).toMatch(/slowly/i);
  });

  it("warns during realtime sessions on slow mobile devices", async () => {
    tauriMocks.isNativeMobile.mockReturnValue(true);
    mockNavigator({ hardwareConcurrency: 5, deviceMemory: 8 });
    const health = await checkRealtimeSessionHealth();
    expect(health.shouldWarn).toBe(true);
    expect(health.reason).toMatch(/hot|fall behind/i);
  });
});
