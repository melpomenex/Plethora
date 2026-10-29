import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TTSSettings } from "../TTSSettings";
import { useSettingsStore } from "../../../stores/settingsStore";
import { createDefaultTTSSettings } from "../../../utils/ttsSettings";

vi.mock("../../../api/lfm3Tts", () => ({
  getLfm3Status: vi.fn(async () => ({
    available: true,
    loaded: false,
    modelId: null,
    backend: null,
    error: null,
  })),
}));
vi.mock("../../../api/hfModels", async (original) => ({
  ...(await original<typeof import("../../../api/hfModels")>()),
  getInstalledHfModels: vi.fn(async () => []),
}));
beforeEach(() => {
  useSettingsStore.setState((state) => ({
    settings: {
      ...state.settings,
      tts: { ...createDefaultTTSSettings(), provider: "lfm3", enabled: true },
    },
  }));
});
describe("TTS authentication controls", () => {
  it("shows local LFM3 model setup without an API key or proxy control", async () => {
    render(<TTSSettings />);
    await screen.findByRole("button", { name: "Get model" });
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
    expect(screen.queryByText(/API key is required/i)).toBeNull();
    expect(screen.queryByRole("option", { name: /Proxy/i })).toBeNull();
    expect(screen.getByText(/Local LFM3 model/i)).toBeInTheDocument();
  });
  it("retains credentials for providers that authenticate requests", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, tts: { ...state.settings.tts, provider: "openai" } },
    }));
    render(<TTSSettings />);
    await waitFor(() => expect(screen.getByLabelText(/OpenAI API key/i)).toBeInTheDocument());
  });
});
