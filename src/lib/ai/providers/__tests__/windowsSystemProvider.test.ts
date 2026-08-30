import type { WindowsIntelligenceSnapshot } from "../../windows/types";
import type { AppleFmAvailability } from "../../apple/foundation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsSystemProvider } from "../windowsSystemProvider";
import { useSettingsStore } from "../../../../stores/settingsStore";

const windows = vi.hoisted(() => ({
  availability: vi.fn(async (): Promise<AppleFmAvailability> => ({ status: "available", tokenLimit: 4096 })),
  snapshot: vi.fn(async (): Promise<WindowsIntelligenceSnapshot> => ({
    windowsOs: true,
    packageIdentity: "mock-package",
    languageModel: { status: "available" },
    ocr: { status: "unavailable" },
    imageDescription: { status: "unavailable" },
    embeddings: { status: "unavailable" },
    checkedAt: 1,
  })),
}));

vi.mock("../../windows/languageModel", () => ({
  windowsLmAvailability: () => windows.availability(),
  windowsLmGenerate: vi.fn(),
  windowsLmGenerateStream: vi.fn(),
  windowsLmCancel: vi.fn(),
  windowsLmWarmup: vi.fn(),
}));

vi.mock("../../windows/capabilities", () => ({
  getWindowsIntelligenceSnapshot: () => windows.snapshot(),
  isWindowsDesktop: () => true,
}));

function enableWindowsSystemAi() {
  useSettingsStore.setState((s) => ({
    ...s,
    settings: {
      ...s.settings,
      features: {
        ...s.settings.features,
        windowsSystemAi: true,
        windowsAiExperimental: false,
      },
    },
  }));
}

describe("WindowsSystemProvider availability mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableWindowsSystemAi();
    windows.availability.mockResolvedValue({ status: "available", tokenLimit: 4096 });
    windows.snapshot.mockResolvedValue({
      windowsOs: true,
      packageIdentity: "mock-package",
      languageModel: { status: "available" },
      ocr: { status: "unavailable" },
      imageDescription: { status: "unavailable" },
      embeddings: { status: "unavailable" },
      checkedAt: 1,
    });
  });

  it("reports live generation when snapshot and availability are available", async () => {
    const caps = await new WindowsSystemProvider().getCapabilities();

    expect(caps.textGeneration).toBe(true);
    expect(caps.streaming).toBe(true);
    expect(caps.downloadState).toBe("downloaded");
    expect(caps.contextTokens).toBe(4096);
  });

  it("does not advertise structured output unless experimental flag is on", async () => {
    const caps = await new WindowsSystemProvider().getCapabilities();
    expect(caps.structuredGeneration).toBe(false);

    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        features: { ...s.settings.features, windowsAiExperimental: true },
      },
    }));

    const experimentalCaps = await new WindowsSystemProvider().getCapabilities();
    expect(experimentalCaps.structuredGeneration).toBe(true);
  });

  it("maps package_identity_missing to unavailable download state", async () => {
    windows.snapshot.mockResolvedValueOnce({
      windowsOs: true,
      packageIdentity: null,
      languageModel: { status: "unavailable", reason: "package_identity_missing" },
      ocr: { status: "unavailable" },
      imageDescription: { status: "unavailable" },
      embeddings: { status: "unavailable" },
      checkedAt: 1,
    });
    windows.availability.mockResolvedValueOnce({
      status: "unavailable",
      reason: "package_identity_missing",
    });

    const caps = await new WindowsSystemProvider().getCapabilities();
    expect(caps.textGeneration).toBe(false);
    expect(caps.downloadState).toBe("unavailable");
  });

  it("returns dead capabilities when windowsSystemAi is disabled", async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        features: { ...s.settings.features, windowsSystemAi: false },
      },
    }));

    const caps = await new WindowsSystemProvider().getCapabilities();
    expect(caps.textGeneration).toBe(false);
    expect(caps.offlineAvailable).toBe(true);
  });
});
