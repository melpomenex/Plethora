import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TTSSettings } from "../TTSSettings";
import { useSettingsStore } from "../../../stores/settingsStore";
import { createDefaultTTSSettings } from "../../../utils/ttsSettings";

vi.mock("../../../api/hfModels", async (original) => ({
  ...(await original<typeof import("../../../api/hfModels")>()),
  getInstalledHfModels: vi.fn(async () => []),
}));
describe("TTS authentication controls", () => {
  it("retains credentials for providers that authenticate requests", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, tts: { ...createDefaultTTSSettings(), provider: "openai", enabled: true } },
    }));
    render(<TTSSettings />);
    await waitFor(() => expect(screen.getByLabelText(/OpenAI API key/i)).toBeInTheDocument());
  });
});
