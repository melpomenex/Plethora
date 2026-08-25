import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppleFoundationProvider } from "../appleFoundationProvider";
import { useSettingsStore } from "../../../../stores/settingsStore";

const fm = vi.hoisted(() => ({
  availability: vi.fn(async () => ({ status: "available", tokenLimit: 4096 })),
  snapshot: vi.fn(async () => ({
    appleOs: true,
    foundationModels: { status: "available" as const },
    speech: { status: "unavailable" as const },
    visionDocuments: { status: "unavailable" as const },
    spotlightSemantic: { status: "unavailable" as const },
    naturalLanguageEmbeddings: { status: "unavailable" as const },
    coreAi: { status: "unavailable" as const },
    checkedAt: 1,
  })),
}));

vi.mock("../../apple/plugin", () => ({
  invokeApple: (cmd: string) => {
    if (cmd === "apple_fm_availability") return fm.availability();
    return { ok: true };
  },
}));

vi.mock("../../apple/capabilities", () => ({
  getAppleIntelligenceSnapshot: () => fm.snapshot(),
  isAppleOsPlatform: () => true,
}));

function enableAppleFoundationModels() {
  useSettingsStore.setState((s) => ({
    ...s,
    settings: {
      ...s.settings,
      features: { ...s.settings.features, appleFoundationModels: true },
    },
  }));
}

describe("AppleFoundationProvider availability mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableAppleFoundationModels();
    fm.availability.mockResolvedValue({ status: "available", tokenLimit: 4096 });
    fm.snapshot.mockResolvedValue({
      appleOs: true,
      foundationModels: { status: "available" },
      speech: { status: "unavailable" },
      visionDocuments: { status: "unavailable" },
      spotlightSemantic: { status: "unavailable" },
      naturalLanguageEmbeddings: { status: "unavailable" },
      coreAi: { status: "unavailable" },
      checkedAt: 1,
    });
  });

  it("reports live generation when snapshot and availability are available", async () => {
    const caps = await new AppleFoundationProvider().getCapabilities();

    expect(caps.textGeneration).toBe(true);
    expect(caps.structuredGeneration).toBe(true);
    expect(caps.downloadState).toBe("downloaded");
    expect(caps.contextTokens).toBe(4096);
  });

  it("uses native contextSize when the bridge reports one", async () => {
    fm.availability.mockResolvedValueOnce({
      status: "available",
      contextSize: 8192,
    });

    const caps = await new AppleFoundationProvider().getCapabilities();
    expect(caps.contextTokens).toBe(8192);
  });

  it.each([
    ["downloadable", "downloadable"],
    ["downloading", "downloading"],
  ] as const)("maps %s to downloadState %s", async (status, downloadState) => {
    fm.snapshot.mockResolvedValueOnce({
      appleOs: true,
      foundationModels: { status },
      speech: { status: "unavailable" },
      visionDocuments: { status: "unavailable" },
      spotlightSemantic: { status: "unavailable" },
      naturalLanguageEmbeddings: { status: "unavailable" },
      coreAi: { status: "unavailable" },
      checkedAt: 1,
    });
    fm.availability.mockResolvedValueOnce({ status });

    const caps = await new AppleFoundationProvider().getCapabilities();
    expect(caps.downloadState).toBe(downloadState);
  });

  it("disables generation when Foundation Models are unavailable", async () => {
    fm.snapshot.mockResolvedValueOnce({
      appleOs: true,
      foundationModels: { status: "unavailable", reason: "unsupported_os" },
      speech: { status: "unavailable" },
      visionDocuments: { status: "unavailable" },
      spotlightSemantic: { status: "unavailable" },
      naturalLanguageEmbeddings: { status: "unavailable" },
      coreAi: { status: "unavailable" },
      checkedAt: 1,
    });
    fm.availability.mockResolvedValueOnce({
      status: "unavailable",
      reason: "unsupported_os",
    });

    const caps = await new AppleFoundationProvider().getCapabilities();
    expect(caps.textGeneration).toBe(false);
    expect(caps.structuredGeneration).toBe(false);
    expect(caps.downloadState).toBe("unavailable");
  });

  it("marks platform_unsupported as not-applicable", async () => {
    fm.snapshot.mockResolvedValueOnce({
      appleOs: true,
      foundationModels: { status: "unavailable", reason: "platform_unsupported" },
      speech: { status: "unavailable" },
      visionDocuments: { status: "unavailable" },
      spotlightSemantic: { status: "unavailable" },
      naturalLanguageEmbeddings: { status: "unavailable" },
      coreAi: { status: "unavailable" },
      checkedAt: 1,
    });
    fm.availability.mockResolvedValueOnce({
      status: "unavailable",
      reason: "platform_unsupported",
    });

    const caps = await new AppleFoundationProvider().getCapabilities();
    expect(caps.downloadState).toBe("not-applicable");
  });

  it("treats native availability as ready even when the snapshot is stale", async () => {
    fm.snapshot.mockResolvedValueOnce({
      appleOs: true,
      foundationModels: { status: "unavailable", reason: "apple_intelligence_disabled" },
      speech: { status: "unavailable" },
      visionDocuments: { status: "unavailable" },
      spotlightSemantic: { status: "unavailable" },
      naturalLanguageEmbeddings: { status: "unavailable" },
      coreAi: { status: "unavailable" },
      checkedAt: 1,
    });
    fm.availability.mockResolvedValueOnce({ status: "available", tokenLimit: 4096 });

    const caps = await new AppleFoundationProvider().getCapabilities();
    expect(caps.textGeneration).toBe(true);
    expect(caps.structuredGeneration).toBe(true);
  });

  it("returns dead capabilities when the feature flag is off", async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        features: { ...s.settings.features, appleFoundationModels: false },
      },
    }));

    const caps = await new AppleFoundationProvider().getCapabilities();
    expect(caps.textGeneration).toBe(false);
    expect(caps.structuredGeneration).toBe(false);
    expect(caps.offlineAvailable).toBe(true);
  });
});
