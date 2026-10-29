import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultTTSSettings } from "../../../utils/ttsSettings";
import { clearTTSDeduper } from "../dedup";
import { getCachedAudio } from "../../../utils/ttsCache";
import { generateSpeech } from "../../tts";
import type { Settings } from "../../../stores/settingsStore";
vi.mock("../../lfm3Tts", () => ({ generateLfm3Speech: vi.fn(async () => ({ audioUrl: "data:audio/wav;base64,UklGRg==", durationSec: 1, backend: "CPU" })) }));
vi.mock("../../../utils/ttsCache", async (original) => ({ ...await original<typeof import("../../../utils/ttsCache")>(), getCachedAudio: vi.fn(async () => null), setCachedAudioDurable: vi.fn(async () => {}) }));
beforeEach(() => { clearTTSDeduper(); vi.mocked(getCachedAudio).mockClear(); });
describe("LFM3 cache identity", () => {
  it("separates locale and excludes playback-only speed without a legacy fallback", async () => {
    const tts = createDefaultTTSSettings(); tts.provider = "lfm3";
    const settings = { tts } as Settings;
    await generateSpeech(settings, { text: "The quiet lake." });
    tts.providers.lfm3.speed = 2;
    await generateSpeech(settings, { text: "The quiet lake." });
    tts.providers.lfm3.language = "en-GB";
    await generateSpeech(settings, { text: "The quiet lake." });
    const keys = vi.mocked(getCachedAudio).mock.calls.map(([key]) => key);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
