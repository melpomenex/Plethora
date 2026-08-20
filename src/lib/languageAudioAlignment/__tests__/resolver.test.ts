import { describe, expect, it, vi } from "vitest";
import { AudioAlignmentRegistry, normalizeAlignmentSegment, replayOriginalFirst } from "../index";

const alignment = normalizeAlignmentSegment({ sentenceId: "s1", sourceId: "doc", sourceFingerprint: "source-v1", mediaId: "audio", mediaFingerprint: "audio-v1", startMs: 100, endMs: 200, confidence: 0.96, method: "caption" }, 10)!;

describe("audio alignment resolver", () => {
  it("requires matching source/media fingerprints and prefers original audio", async () => {
    const registry = new AudioAlignmentRegistry();
    registry.add(alignment);
    const resolution = registry.resolve({ sourceId: "doc", sentenceId: "s1", sourceFingerprint: "source-v1", mediaId: "audio", mediaFingerprint: "audio-v1" });
    expect(resolution.kind).toBe("original");
    const play = vi.fn();
    const tts = vi.fn();
    const result = await replayOriginalFirst({ text: "Hola", resolution, playOriginal: play, speakTts: tts });
    expect(result.kind).toBe("original");
    expect(play).toHaveBeenCalledOnce();
    expect(tts).not.toHaveBeenCalled();
  });

  it("falls back to TTS for stale/ambiguous/missing media without wrong-occurrence playback", async () => {
    const registry = new AudioAlignmentRegistry();
    registry.add(alignment);
    const resolution = registry.resolve({ sourceId: "doc", sentenceId: "s1", sourceFingerprint: "changed", mediaId: "audio", mediaFingerprint: "audio-v1" });
    expect(resolution.kind).toBe("stale");
    const tts = vi.fn();
    const result = await replayOriginalFirst({ text: "Hola", resolution, playOriginal: vi.fn(), speakTts: tts });
    expect(result.kind).toBe("tts");
    expect(tts).toHaveBeenCalledWith("Hola");
  });
});
