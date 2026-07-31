/**
 * Regression test for the TTS provider switch.
 *
 * useTTS used to `return` the native-Android surface partway down the hook,
 * before eight further hooks. Switching the provider to or from "android" —
 * which the TTS settings screen does on a tap — therefore changed the hook
 * count between two renders of the same mounted component, and React aborted
 * the render with "Rendered fewer hooks than expected". On Android that blanked
 * the app until it was force-restarted.
 *
 * These tests flip the provider on a mounted component in both directions. They
 * fail loudly if the early return is ever reintroduced.
 */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The native bridge talks to a Tauri plugin that does not exist under jsdom.
// Stub it: this test is about hook ordering, not about playback.
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

import { useTTS } from "../useTTS";
import { useSettingsStore } from "../../stores/settingsStore";
import { createDefaultTTSSettings } from "../../utils/ttsSettings";

function setProvider(provider: string) {
  const store = useSettingsStore.getState();
  const tts = { ...createDefaultTTSSettings(), provider } as never;
  store.updateSettings({ tts });
}

function Probe() {
  const tts = useTTS();
  return <div data-testid="probe">{String(tts.isSupported)}</div>;
}

describe("useTTS provider switching", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React reports a hook-order violation by throwing, but it also logs. Fail
    // on any React error so a reintroduced early return cannot pass quietly.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    setProvider("system");
  });

  it("keeps a stable hook count when switching from a cloud provider to android", () => {
    setProvider("fal");
    const view = render(<Probe />);

    expect(() => {
      setProvider("android");
      view.rerender(<Probe />);
    }).not.toThrow();

    const hookErrors = consoleError.mock.calls
      .map((args) => String(args[0] ?? ""))
      .filter((msg) => /hooks|Rendered/i.test(msg));
    expect(hookErrors).toEqual([]);
  });

  it("keeps a stable hook count when switching from android back to a cloud provider", () => {
    setProvider("android");
    const view = render(<Probe />);

    expect(() => {
      setProvider("fal");
      view.rerender(<Probe />);
      setProvider("system");
      view.rerender(<Probe />);
    }).not.toThrow();

    const hookErrors = consoleError.mock.calls
      .map((args) => String(args[0] ?? ""))
      .filter((msg) => /hooks|Rendered/i.test(msg));
    expect(hookErrors).toEqual([]);
  });
});
