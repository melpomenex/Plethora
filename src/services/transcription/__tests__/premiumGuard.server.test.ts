import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../../stores/settingsStore";
import { checkPremiumTranscriptionAllowed, recordPremiumTranscriptionUsage } from "../premiumGuard";

const settings = {} as Settings;

const setSnapshot = vi.fn();

vi.mock("../../../config/product", () => ({
  PLETHORA_API_URL: "https://api.test",
  isCloudApiEnabled: () => true,
}));

vi.mock("../../../stores/accountStore", () => ({
  useAccountStore: {
    getState: () => ({
      isAuthenticated: true,
      tokens: { accessToken: "token" },
    }),
  },
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      settings,
      updateSettings: vi.fn(),
    }),
  },
}));

vi.mock("../../../stores/entitlementStore", () => ({
  useEntitlementStore: {
    getState: () => ({
      getCapabilityState: () => ({ enabled: true }),
      setSnapshot,
      snapshot: { capabilities: {} },
    }),
  },
}));

const checkServerPremiumTranscriptionQuota = vi.fn(async () => ({
  used: 60,
  limit: 7200,
  remaining: 7140,
  window: "monthly" as const,
  resetsAt: "2026-09-01T00:00:00.000Z",
}));

const meterServerPremiumTranscriptionUsage = vi.fn(async () => ({
  used: 180,
  limit: 7200,
  remaining: 7020,
  window: "monthly" as const,
  resetsAt: "2026-09-01T00:00:00.000Z",
}));

vi.mock("../premiumQuotaClient", () => ({
  canUseServerPremiumQuota: () => true,
  checkServerPremiumTranscriptionQuota: (...args: any[]) =>
    (checkServerPremiumTranscriptionQuota as any)(...args),
  meterServerPremiumTranscriptionUsage: (...args: any[]) =>
    (meterServerPremiumTranscriptionUsage as any)(...args),
  fetchServerTranscriptionQuota: vi.fn(),
}));

describe("premiumGuard (server-backed)", () => {
  beforeEach(() => {
    checkServerPremiumTranscriptionQuota.mockClear();
    meterServerPremiumTranscriptionUsage.mockClear();
    setSnapshot.mockClear();
  });

  it("checks quota on the server before premium transcription", async () => {
    await checkPremiumTranscriptionAllowed(settings, 120);
    expect(checkServerPremiumTranscriptionQuota).toHaveBeenCalledWith(120);
    expect(setSnapshot).toHaveBeenCalled();
  });

  it("meters usage on the server after premium transcription", async () => {
    await recordPremiumTranscriptionUsage(90, { providerId: "gemini:transcribe" });
    expect(meterServerPremiumTranscriptionUsage).toHaveBeenCalledWith(90, {
      providerId: "gemini:transcribe",
    });
    expect(setSnapshot).toHaveBeenCalled();
  });
});
