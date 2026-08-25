import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  nativePlatform: vi.fn(() => "macos"),
}));

const plugin = vi.hoisted(() => ({
  invokeApple: vi.fn(),
}));

vi.mock("../../../tauri", () => tauri);
vi.mock("../plugin", () => ({
  invokeApple: plugin.invokeApple,
}));

import {
  getAppleIntelligenceSnapshot,
  isAppleOsPlatform,
  resetAppleIntelligenceCache,
} from "../capabilities";

function appleSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    appleOs: true,
    foundationModels: { status: "available" as const },
    speech: { status: "unavailable" as const },
    visionDocuments: { status: "unavailable" as const },
    spotlightSemantic: { status: "unavailable" as const },
    naturalLanguageEmbeddings: { status: "unavailable" as const },
    coreAi: { status: "unavailable" as const },
    checkedAt: 1,
    ...overrides,
  };
}

describe("isAppleOsPlatform", () => {
  beforeEach(() => {
    tauri.isTauri.mockReturnValue(true);
    tauri.nativePlatform.mockReturnValue("macos");
  });

  it.each(["macos", "darwin", "ios"])("returns true for %s", (platform) => {
    tauri.nativePlatform.mockReturnValue(platform);
    expect(isAppleOsPlatform()).toBe(true);
  });

  it("returns false when not running inside Tauri", () => {
    tauri.isTauri.mockReturnValue(false);
    expect(isAppleOsPlatform()).toBe(false);
  });

  it("returns false for non-Apple platforms", () => {
    tauri.nativePlatform.mockReturnValue("android");
    expect(isAppleOsPlatform()).toBe(false);
  });

  it("returns false when nativePlatform throws", () => {
    tauri.nativePlatform.mockImplementation(() => {
      throw new Error("bridge unavailable");
    });
    expect(isAppleOsPlatform()).toBe(false);
  });
});

describe("getAppleIntelligenceSnapshot", () => {
  beforeEach(() => {
    resetAppleIntelligenceCache();
    vi.clearAllMocks();
    tauri.isTauri.mockReturnValue(true);
    tauri.nativePlatform.mockReturnValue("darwin");
  });

  it("returns an unsupported snapshot off Apple OS without invoking native code", async () => {
    tauri.isTauri.mockReturnValue(false);

    const snap = await getAppleIntelligenceSnapshot();

    expect(snap.appleOs).toBe(false);
    expect(snap.foundationModels).toEqual({
      status: "unavailable",
      reason: "platform_unsupported",
    });
    expect(plugin.invokeApple).not.toHaveBeenCalled();
  });

  it("fetches capabilities from the native bridge on macOS", async () => {
    plugin.invokeApple.mockResolvedValueOnce(appleSnapshot());

    const snap = await getAppleIntelligenceSnapshot();

    expect(plugin.invokeApple).toHaveBeenCalledWith("apple_capabilities");
    expect(snap.foundationModels.status).toBe("available");
  });

  it("caches the snapshot within the TTL", async () => {
    plugin.invokeApple.mockResolvedValue(appleSnapshot({ checkedAt: 42 }));

    await getAppleIntelligenceSnapshot();
    await getAppleIntelligenceSnapshot();

    expect(plugin.invokeApple).toHaveBeenCalledTimes(1);
  });

  it("does not cache while a feature is downloading", async () => {
    plugin.invokeApple
      .mockResolvedValueOnce(
        appleSnapshot({
          foundationModels: { status: "downloading" },
          checkedAt: 1,
        })
      )
      .mockResolvedValueOnce(
        appleSnapshot({
          foundationModels: { status: "available" },
          checkedAt: 2,
        })
      );

    await getAppleIntelligenceSnapshot();
    await getAppleIntelligenceSnapshot();

    expect(plugin.invokeApple).toHaveBeenCalledTimes(2);
  });

  it("falls back to unsupported when the bridge throws", async () => {
    plugin.invokeApple.mockRejectedValueOnce(new Error("native unavailable"));

    const snap = await getAppleIntelligenceSnapshot();

    expect(snap.foundationModels.reason).toBe("platform_unsupported");
    expect(snap.appleOs).toBe(false);
  });
});
