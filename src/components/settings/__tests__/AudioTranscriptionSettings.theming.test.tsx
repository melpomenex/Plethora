/**
 * Fast Cloud Transcription theming (#18): the Groq intro card in
 * AudioTranscriptionSettings must consume Plethora theme tokens instead of the
 * hard-coded orange/amber/green/purple/blue palette.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AudioTranscriptionSettings } from "../AudioTranscriptionSettings";
import { useSettingsStore } from "../../../stores/settingsStore";

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => false,
  isNativeMobile: () => false,
  isPWA: () => false,
  invokeCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../stores/useTranscriptionStore", () => ({
  useTranscriptionStore: () => ({
    profiles: [],
    fetchProfiles: vi.fn().mockResolvedValue(undefined),
    downloadProgress: {},
    currentStatus: "idle",
  }),
}));

vi.mock("../../stores/transcriptionQueueStore", () => ({
  useTranscriptionQueueStore: () => ({
    fetchQueue: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../api/groqTranscription", () => ({
  isGroqConfigured: () => false,
  validateGroqApiKey: () => ({ valid: false }),
  getUsageStats: () => null,
  getRateLimitStatus: async () => null,
  GROQ_FREE_TIER: { AUDIO_SECONDS_PER_DAY: 3600 },
  GROQ_PRICING: { "whisper-large-v3-turbo": 0.111 },
}));

vi.mock("./HuggingFaceModelManager", () => ({
  HuggingFaceModelManager: () => null,
}));

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    settings: JSON.parse(JSON.stringify(useSettingsStore.getState().settings)),
  });
});

describe("AudioTranscriptionSettings Fast Cloud card theming", () => {
  it("renders the Groq intro card with theme tokens (bg-card / border-border / bg-primary)", () => {
    render(<AudioTranscriptionSettings />);

    const heading = screen.getByText("Fast Cloud Transcription");
    const infoCard = heading.closest(".bg-card") as HTMLElement;
    expect(infoCard).not.toBeNull();
    expect(infoCard.className).toContain("border-border");

    // The accent is the theme primary token, not a fixed orange.
    const html = infoCard.innerHTML;
    expect(html).toContain("text-primary");
    // Badges use theme tokens.
    expect(html).toContain("bg-primary/10");
    expect(html).toContain("bg-secondary/10");
    expect(html).toContain("bg-muted");

    // No hard-coded palette colors remain inside the Fast Cloud card.
    expect(html).not.toContain("from-orange-500");
    expect(html).not.toContain("to-amber-500");
    expect(html).not.toContain("border-orange-200");
    expect(html).not.toContain("text-orange-600");
    expect(html).not.toContain("bg-green-500/20");
    expect(html).not.toContain("bg-purple-500/20");
    expect(html).not.toContain("bg-blue-500/20");
    expect(html).not.toContain("bg-green-50");

    // The privacy reminder card next to it uses primary-tinted theme tokens.
    const privacy = screen.getByText("Your Data Stays Private").closest("div")?.parentElement as HTMLElement;
    expect(privacy.className).toContain("bg-primary/10");
    expect(privacy.className).toContain("border-primary/20");
  });

  it("keeps the themed structure identical in a dark theme context", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<AudioTranscriptionSettings />);

    const heading = screen.getByText("Fast Cloud Transcription");
    const infoCard = heading.closest(".bg-card") as HTMLElement;
    expect(infoCard).not.toBeNull();
    expect(infoCard.className).toContain("bg-card");
    expect(infoCard.className).toContain("border-border");
    expect(infoCard.innerHTML).not.toContain("from-orange-500");
    expect(infoCard.innerHTML).not.toContain("border-orange-200");
  });
});
