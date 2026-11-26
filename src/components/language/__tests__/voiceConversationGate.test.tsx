import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageVoiceConversation } from "../LanguageVoiceConversation";
import type { ShadowingRecognitionProvider } from "../../../lib/languageShadowing";

const mocks = vi.hoisted(() => ({
  profile: {
    id: "profile-1",
    targetLanguage: "es",
    baseLanguage: "en",
    proficiency: "B1",
  },
  providers: [] as readonly ShadowingRecognitionProvider[],
  aiAvailable: false,
}));

vi.mock("../../../stores/languageProfileStore", () => ({
  useLanguageProfileStore: (selector: (state: unknown) => unknown) =>
    selector({ activeProfile: mocks.profile }),
}));

vi.mock("../../../lib/languageShadowing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/languageShadowing")>();
  return {
    ...actual,
    createConfiguredShadowingProviders: () => mocks.providers,
  };
});

vi.mock("../../../lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/ai/provider")>();
  return {
    ...actual,
    isAnyAiAvailable: () => Promise.resolve(mocks.aiAvailable),
  };
});

const fakeProvider: ShadowingRecognitionProvider = {
  id: "test-stt",
  version: "test",
  route: "local",
  supports: () => true,
  recognize: async () => ({ text: "hola", confidence: 0.9 }),
};

describe("LanguageVoiceConversation capability gating (OpenSpec 2.1/3.1)", () => {
  it("reports unavailable with honest reasons when no STT provider is configured", async () => {
    mocks.providers = [];
    mocks.aiAvailable = true;
    render(<LanguageVoiceConversation />);

    expect(await screen.findByText("Voice conversation is unavailable")).toBeTruthy();
    expect(
      screen.getByText(/No speech-recognition provider is configured/),
    ).toBeTruthy();
    expect(screen.getByText(/Voice is never simulated with text-only UI/)).toBeTruthy();
    // No fake voice UI: there must be no speak/record affordance.
    expect(screen.queryByRole("button", { name: /speak/i })).toBeNull();
  });

  it("reports unavailable when no AI tutor provider is available", async () => {
    mocks.providers = [fakeProvider];
    mocks.aiAvailable = false;
    render(<LanguageVoiceConversation />);

    expect(await screen.findByText("Voice conversation is unavailable")).toBeTruthy();
    expect(screen.getByText(/No AI provider is configured/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /speak/i })).toBeNull();
  });

  it("enables the recording affordance only when profile + STT + AI are all present", async () => {
    mocks.providers = [fakeProvider];
    mocks.aiAvailable = true;
    render(<LanguageVoiceConversation />);

    expect(await screen.findByRole("button", { name: /speak/i })).toBeTruthy();
    expect(screen.queryByText("Voice conversation is unavailable")).toBeNull();
  });
});
