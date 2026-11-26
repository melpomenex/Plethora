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

  it("plays a stale candidate only when the user explicitly overrides", async () => {
    const registry = new AudioAlignmentRegistry();
    registry.add(alignment);
    const stale = registry.resolve({ sourceId: "doc", sentenceId: "s1", sourceFingerprint: "changed", mediaId: "audio", mediaFingerprint: "audio-v1" });
    expect(stale.kind).toBe("stale");
    // Default: safe TTS fallback.
    const ttsDefault = vi.fn();
    await replayOriginalFirst({ text: "Hola", resolution: stale, playOriginal: vi.fn(), speakTts: ttsDefault });
    expect(ttsDefault).toHaveBeenCalledWith("Hola");
    // Explicit override: stale original audio plays, marked as override.
    const play = vi.fn();
    const tts = vi.fn();
    const result = await replayOriginalFirst({ text: "Hola", resolution: stale, playOriginal: play, speakTts: tts }, { allowStale: true });
    expect(result.kind).toBe("original");
    expect(result.reason).toBe("stale-override");
    expect(play).toHaveBeenCalledOnce();
    expect(tts).not.toHaveBeenCalled();
    // Override still preserves TTS fallback when playback fails.
    const failingPlay = vi.fn(() => { throw new Error("media deleted"); });
    const ttsFallback = vi.fn();
    const failed = await replayOriginalFirst({ text: "Hola", resolution: stale, playOriginal: failingPlay, speakTts: ttsFallback }, { allowStale: true });
    expect(failed.kind).toBe("tts");
    expect(ttsFallback).toHaveBeenCalledWith("Hola");
  });

  it("plays the top ambiguous candidate only with an explicit override", async () => {
    const registry = new AudioAlignmentRegistry();
    const nearEqual = normalizeAlignmentSegment({ sentenceId: "s1", sourceId: "doc", sourceFingerprint: "source-v1", mediaId: "audio", mediaFingerprint: "audio-v1", startMs: 300, endMs: 400, confidence: 0.95, method: "forced" }, 10)!;
    registry.add(alignment);
    registry.add(nearEqual);
    const ambiguous = registry.resolve({ sourceId: "doc", sentenceId: "s1", sourceFingerprint: "source-v1", mediaId: "audio", mediaFingerprint: "audio-v1" });
    expect(ambiguous.kind).toBe("ambiguous");
    const tts = vi.fn();
    await replayOriginalFirst({ text: "Hola", resolution: ambiguous, playOriginal: vi.fn(), speakTts: tts });
    expect(tts).toHaveBeenCalledWith("Hola");
    const ttsOverride = vi.fn();
    const override = await replayOriginalFirst({ text: "Hola", resolution: ambiguous, playOriginal: vi.fn(), speakTts: ttsOverride }, { allowAmbiguous: true });
    expect(override.kind).toBe("original");
    expect(override.reason).toBe("ambiguous-override");
    expect(ttsOverride).not.toHaveBeenCalled();
  });
});
