import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../../stores/settingsStore";
import { DEFAULT_PREMIUM_MONTHLY_ALLOWANCE_MINUTES } from "../config";
import {
  checkPremiumTranscriptionAllowed,
  getPremiumMinutesUsed,
  getPremiumMonthlyAllowanceMinutes,
  recordPremiumTranscriptionUsage,
} from "../premiumGuard";

const settings = (overrides: Partial<Settings["audioTranscription"]> = {}): Settings => ({
  audioTranscription: {
    provider: "local",
    autoTranscription: false,
    autoTranscribeLocalVideos: true,
    language: "en",
    timestampGeneration: true,
    speakerDiarization: false,
    confidenceScores: false,
    confidenceThreshold: 0.7,
    preferAndroidSpeech: true,
    groq: {
      apiKey: "",
      model: "whisper-large-v3-turbo",
      useFreeTier: true,
      usage: {
        lastResetDate: "",
        audioSecondsProcessed: 0,
        requestsMade: 0,
      },
    },
    premiumMinutesUsed: 0,
    premiumMonthlyAllowance: DEFAULT_PREMIUM_MONTHLY_ALLOWANCE_MINUTES,
    ...overrides,
  },
} as Settings);

const updateSettings = vi.fn();
const setSnapshot = vi.fn();
const getCapabilityState = vi.fn(() => ({ enabled: true }));

vi.mock("../../../config/product", () => ({
  PLETHORA_API_URL: "https://api.test",
  isCloudApiEnabled: () => false,
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      settings: settings(),
      updateSettings,
    }),
  },
}));

vi.mock("../../../stores/entitlementStore", () => ({
  useEntitlementStore: {
    getState: () => ({
      getCapabilityState,
      setSnapshot,
      snapshot: { capabilities: {} },
    }),
  },
}));

vi.mock("../../../stores/accountStore", () => ({
  useAccountStore: {
    getState: () => ({ isAuthenticated: false, tokens: null }),
  },
}));

vi.mock("../premiumQuotaClient", () => ({
  canUseServerPremiumQuota: () => false,
  checkServerPremiumTranscriptionQuota: vi.fn(),
  meterServerPremiumTranscriptionUsage: vi.fn(),
  fetchServerTranscriptionQuota: vi.fn(),
}));

describe("premiumGuard", () => {
  beforeEach(() => {
    updateSettings.mockClear();
    setSnapshot.mockClear();
  });

  it("allows transcription within the monthly allowance", async () => {
    const audioSettings = settings({ premiumMinutesUsed: 10, premiumMonthlyAllowance: 60 });
    await expect(checkPremiumTranscriptionAllowed(audioSettings, 600)).resolves.toBeUndefined();
    expect(getPremiumMinutesUsed(audioSettings)).toBe(10);
    expect(getPremiumMonthlyAllowanceMinutes(audioSettings)).toBe(60);
  });

  it("throws when premium quota would be exceeded", async () => {
    const audioSettings = settings({ premiumMinutesUsed: 59.5, premiumMonthlyAllowance: 60 });
    await expect(checkPremiumTranscriptionAllowed(audioSettings, 120)).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      recoverable: false,
    });
  });

  it("records premium usage in settings when server quota is unavailable", async () => {
    await recordPremiumTranscriptionUsage(120);
    expect(updateSettings).toHaveBeenCalledWith({
      audioTranscription: expect.objectContaining({
        premiumMinutesUsed: 2,
      }),
    });
  });
});
