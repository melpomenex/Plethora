/**
 * On-device AI panel STT section (android-on-device-transcription #7.3):
 * model rows must reflect plugin state — not-downloaded (download button),
 * ready (select + delete) — and the pacing selector writes settings.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnDeviceAiPanel } from "../OnDeviceAiPanel";
import { useSettingsStore } from "../../../stores/settingsStore";

const sttState = vi.hoisted(() => ({
  status: {
    id: "stt.transcribe",
    available: true,
    ready: false,
    requiresDownload: true,
    onDevice: true,
    networkRequired: false,
    supportsWordTimestamps: true,
    readyModelIds: [] as string[],
  },
  models: [
    {
      id: "sense-voice-multi-int8",
      name: "SenseVoice (multilingual)",
      kind: "sense-voice",
      ready: false,
      installing: false,
      bytesOnDisk: 0,
      downloadBytes: 163_002_883,
      description: "Multilingual",
      default: true,
    },
    {
      id: "parakeet-en-110m-int8",
      name: "Parakeet (English)",
      kind: "parakeet-ctc",
      ready: true,
      installing: false,
      bytesOnDisk: 131_674_112,
      downloadBytes: 104_337_827,
      description: "English fast path",
      default: false,
    },
  ],
}));

vi.mock("../../../lib/ai/onDeviceAI", () => ({
  isOnDeviceAiSupportedPlatform: () => true,
  isOnDeviceAiAvailable: vi.fn().mockResolvedValue({ status: "unavailable" }),
  getOnDeviceEmbeddingStatus: vi
    .fn()
    .mockResolvedValue({ status: "unavailable", reason: "platform_unsupported" }),
  downloadOnDeviceEmbeddingModel: vi.fn(),
  requestModelDownload: vi.fn(),
}));

vi.mock("../../../lib/ai/apple/capabilities", () => ({
  isAppleOsPlatform: () => false,
  getAppleIntelligenceSnapshot: vi.fn(),
}));

vi.mock("../../../lib/ai/android/androidStt", () => ({
  getAndroidSttStatus: vi.fn().mockResolvedValue(sttState.status),
  listAndroidSttModels: vi.fn().mockResolvedValue({ models: sttState.models }),
  prepareAndroidSttModel: vi.fn().mockResolvedValue({ ready: true }),
  deleteAndroidSttModel: vi.fn().mockResolvedValue({ deleted: true }),
  onAndroidSttDownloadProgress: vi.fn(() => () => {}),
  invalidateAndroidSttReadiness: vi.fn(),
}));

vi.mock("../../../lib/ai/modelLicense", () => ({
  listLicensedModels: () => [],
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

type Settings = ReturnType<typeof useSettingsStore.getState>["settings"];

function cloneDefaults(): Settings {
  return JSON.parse(JSON.stringify(useSettingsStore.getState().settings)) as Settings;
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    settings: {
      ...cloneDefaults(),
      audioTranscription: {
        ...cloneDefaults().audioTranscription,
        androidOnDevice: { modelId: "", pacing: "capped" },
      },
    },
  });
});

describe("OnDeviceAiPanel STT section", () => {
  it("renders a row per model with download for not-ready and select/delete for ready", async () => {
    render(<OnDeviceAiPanel onChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByText("SenseVoice (multilingual)").length).toBeGreaterThan(0);
    });

    // Not-ready model shows download; ready model shows ready + delete.
    expect(screen.getAllByText("onDeviceAi.download").length).toBeGreaterThan(0);
    expect(screen.getAllByText("onDeviceAi.sttDelete").length).toBeGreaterThan(0);
    expect(screen.getAllByText("onDeviceAi.sttModelReady").length).toBeGreaterThan(0);
    expect(screen.getAllByText("onDeviceAi.sttModelNotReady").length).toBeGreaterThan(0);
  });

  it("selecting a ready model writes androidOnDevice.modelId", async () => {
    render(<OnDeviceAiPanel onChange={() => {}} />);

    const radio = await screen.findByRole("radio", {
      name: "onDeviceAi.sttSelectModel: Parakeet (English)",
    });
    fireEvent.click(radio);

    expect(
      useSettingsStore.getState().settings.audioTranscription.androidOnDevice?.modelId,
    ).toBe("parakeet-en-110m-int8");
  });

  it("switching pacing writes androidOnDevice.pacing", async () => {
    render(<OnDeviceAiPanel onChange={() => {}} />);

    const select = await screen.findByLabelText("onDeviceAi.sttPacingLabel");
    fireEvent.change(select, { target: { value: "full" } });

    expect(
      useSettingsStore.getState().settings.audioTranscription.androidOnDevice?.pacing,
    ).toBe("full");
  });
});
