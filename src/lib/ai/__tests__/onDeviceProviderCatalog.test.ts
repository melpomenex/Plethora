import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPLE_FOUNDATION_PROVIDER_ID,
  getAppleFoundationProvider,
} from "../providers/appleFoundationProvider";
import { ON_DEVICE_PROVIDER_ID } from "../providers/onDeviceProvider";
import {
  isCatalogOnDeviceProviderId,
  listAvailableOnDeviceProviders,
} from "../onDeviceProviderCatalog";

vi.mock("../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../onDeviceAI")>("../onDeviceAI");
  return {
    ...actual,
    isOnDeviceAiAvailable: vi.fn(async () => ({
      status: "unavailable" as const,
      reason: "platform_unsupported",
    })),
  };
});

vi.mock("../providers/appleFoundationProvider", async () => {
  const actual = await vi.importActual<typeof import("../providers/appleFoundationProvider")>(
    "../providers/appleFoundationProvider"
  );
  return {
    ...actual,
    getAppleFoundationProvider: vi.fn(() => ({
      getCapabilities: vi.fn(async () => ({
        textGeneration: true,
        structuredGeneration: true,
      })),
    })),
  };
});

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      settings: { features: { appleFoundationModels: true } },
    }),
  },
}));

describe("onDeviceProviderCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recognizes catalog on-device provider ids", () => {
    expect(isCatalogOnDeviceProviderId(ON_DEVICE_PROVIDER_ID)).toBe(true);
    expect(isCatalogOnDeviceProviderId(APPLE_FOUNDATION_PROVIDER_ID)).toBe(true);
    expect(isCatalogOnDeviceProviderId("cloud-llm")).toBe(false);
  });

  it("lists Apple Foundation Models when Nano is unavailable", async () => {
    const options = await listAvailableOnDeviceProviders();
    expect(options.map((option) => option.id)).toEqual([APPLE_FOUNDATION_PROVIDER_ID]);
    expect(getAppleFoundationProvider).toHaveBeenCalled();
  });
});
