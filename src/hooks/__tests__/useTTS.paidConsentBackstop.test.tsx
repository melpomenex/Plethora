/**
 * Tests the defensive paid-consent backstop in `useTTS` (ai-billing-safety
 * #14): when a synthesis call surfaces a typed `paid_consent_required` error
 * (a billable adapter reached without consent), read-aloud re-surfaces the
 * opt-in surface instead of showing a bare provider error — granted ⇒ retry,
 * denied ⇒ stop with feedback.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTTS } from "../useTTS";
import { useSettingsStore } from "../../stores/settingsStore";
import { createDefaultTTSSettings } from "../../utils/ttsSettings";
import {
  clearPaidConsentDenials,
  setPaidConsentHandler,
} from "../../utils/aiBillingConsent";

// The native bridge talks to a Tauri plugin that does not exist under jsdom.
vi.mock("../../api/tts/android/bridge", () => ({
  isAndroidTtsAvailable: () => false,
  onPlaybackState: async () => () => {},
  onSentencePosition: async () => () => {},
  onUtteranceComplete: async () => () => {},
  onTtsError: async () => () => {},
  pluginSpeak: async () => {},
  pluginPause: async () => {},
  pluginResume: async () => {},
  pluginStop: async () => {},
}));

const { generateSpeechMock } = vi.hoisted(() => ({
  generateSpeechMock: vi.fn(),
}));

vi.mock("../../api/tts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/tts")>();
  return {
    ...actual,
    generateSpeech: generateSpeechMock,
    resolveTTSMaxChunkSize: async () => 200,
  };
});

/** Minimal playback stub: jsdom has no media pipeline. */
class MockAudio {
  playbackRate = 1;
  currentTime = 0;
  ended = false;
  paused = true;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  async play() {
    this.paused = false;
    this.onplay?.();
    this.onended?.();
  }
  pause() {
    this.paused = true;
    this.onpause?.();
  }
}

function setProviderSettings(provider: string) {
  const store = useSettingsStore.getState();
  useSettingsStore.setState({
    settings: {
      ...store.settings,
      tts: { ...createDefaultTTSSettings(), provider, enabled: true } as never,
    },
  });
}

describe("useTTS paid-consent backstop", () => {
  beforeEach(() => {
    vi.stubGlobal("Audio", MockAudio);
    setPaidConsentHandler(null);
    clearPaidConsentDenials();
    generateSpeechMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setPaidConsentHandler(null);
    clearPaidConsentDenials();
  });

  it("surfaces the opt-in surface and stops with feedback when a billable adapter reports paid_consent_required", async () => {
    setProviderSettings("pocket");
    const { TTSServiceError } = await import("../../api/tts");
    generateSpeechMock.mockRejectedValue(
      new TTSServiceError(
        "Speech generation is blocked because paid TTS is disabled for Pocket TTS.",
        "paid_consent_required"
      )
    );
    const consentHandler = vi.fn(async () => false);
    setPaidConsentHandler(consentHandler);

    const { result } = renderHook(() => useTTS());
    await act(async () => {
      await result.current.speak("hello world");
    });

    expect(consentHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tts", provider: "pocket" })
    );
    // No provider synthesis fired after the denial.
    expect(result.current.lastError).toContain("Paid TTS is off");
  });

  it("retries synthesis once after the opt-in surface grants consent", async () => {
    setProviderSettings("pocket");
    const { TTSServiceError } = await import("../../api/tts");
    generateSpeechMock
      .mockRejectedValueOnce(
        new TTSServiceError(
          "Speech generation is blocked because paid TTS is disabled for Pocket TTS.",
          "paid_consent_required"
        )
      )
      .mockResolvedValueOnce({
        audioUrl: "blob:test-audio",
        durationSec: 1,
        rawOutput: {},
        wordTimings: undefined,
      });
    const consentHandler = vi.fn(async () => true);
    setPaidConsentHandler(consentHandler);

    const { result } = renderHook(() => useTTS());
    await act(async () => {
      await result.current.speak("hello world");
    });

    expect(consentHandler).toHaveBeenCalledTimes(1);
    expect(generateSpeechMock).toHaveBeenCalledTimes(2);
    expect(result.current.lastError).toBeNull();
  });
});
