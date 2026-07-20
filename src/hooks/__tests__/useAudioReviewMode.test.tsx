import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioReviewMode } from "../useAudioReviewMode";

const tts = vi.hoisted(() => ({
  speak: vi.fn<(_text: string) => Promise<void>>(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  isSpeaking: false,
  isPaused: false,
  isGenerating: false,
  lastError: null,
  isSupported: true,
  voices: [],
  selectedVoice: null,
  setSelectedVoice: vi.fn(),
}));

const settingsHarness = vi.hoisted(() => ({
  settings: {
    audioReviewMode: {
      enabled: true,
      autoFlip: true,
      autoFlipDelayMs: 0,
      defaultRating: 3 as const,
    },
  },
  updateSettings: vi.fn(),
}));

vi.mock("../useTTS", () => ({ useTTS: () => tts }));
vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: typeof settingsHarness) => unknown) => selector(settingsHarness),
}));

describe("useAudioReviewMode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    tts.speak.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("auto-flips, advances, and speaks the committed Arena interval", async () => {
    const onFlip = vi.fn();
    const onAdvance = vi.fn().mockResolvedValue("Next review in 18 days.");
    const { rerender } = renderHook(
      ({ answerShown }) => useAudioReviewMode({
        cardId: "card-1",
        questionText: "What is spaced repetition?",
        answerText: "A learning method.",
        isAnswerShown: answerShown,
        onFlip,
        onAdvance,
      }),
      { initialProps: { answerShown: false } },
    );

    await act(async () => {
      await Promise.resolve();
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    expect(onFlip).toHaveBeenCalledTimes(1);

    rerender({ answerShown: true });
    await act(async () => {
      await Promise.resolve();
      vi.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(tts.speak.mock.calls.map(([text]) => text)).toEqual([
      "What is spaced repetition?",
      "A learning method.",
      "Next review in 18 days.",
    ]);
  });
});
