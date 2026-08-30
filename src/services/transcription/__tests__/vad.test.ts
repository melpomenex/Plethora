import { describe, expect, it } from "vitest";
import { VoiceActivityDetector } from "../audio/VoiceActivityDetector";

const SAMPLE_RATE = 16_000;

function makePcm(durationMs: number, amplitude: number): Float32Array {
  const sampleCount = Math.ceil((durationMs / 1000) * SAMPLE_RATE);
  return new Float32Array(sampleCount).fill(amplitude);
}

function makeSilentPcm(durationMs: number): Float32Array {
  return makePcm(durationMs, 0);
}

describe("VoiceActivityDetector", () => {
  it("does not emit segments below minSpeechMs", () => {
    const vad = new VoiceActivityDetector({
      sampleRate: SAMPLE_RATE,
      minSpeechMs: 500,
      energyThreshold: 0.01,
    });

    const segments = vad.push(makePcm(200, 0.5));
    expect(segments).toHaveLength(0);
    expect(vad.flush()).toBeNull();
  });

  it("emits a segment after speech followed by silence", () => {
    const vad = new VoiceActivityDetector({
      sampleRate: SAMPLE_RATE,
      minSpeechMs: 300,
      energyThreshold: 0.01,
    });

    vad.push(makePcm(400, 0.5));
    const segments = vad.push(makeSilentPcm(200));

    expect(segments).toHaveLength(1);
    expect(segments[0]?.durationMs).toBeGreaterThanOrEqual(300);
    expect(segments[0]?.samples.length).toBeGreaterThan(0);
  });

  it("forces emit when max chunk duration is reached", () => {
    const vad = new VoiceActivityDetector({
      sampleRate: SAMPLE_RATE,
      minSpeechMs: 300,
      maxChunkSeconds: 2,
      energyThreshold: 0.01,
    });

    const segments = vad.push(makePcm(2500, 0.5));
    expect(segments).toHaveLength(1);
    expect(segments[0]?.durationMs).toBeLessThanOrEqual(2100);
  });

  it("clamps maxChunkSeconds to the 2–6 second range", () => {
    const shortMax = new VoiceActivityDetector({
      sampleRate: SAMPLE_RATE,
      maxChunkSeconds: 1,
      energyThreshold: 0.01,
    });
    const longMax = new VoiceActivityDetector({
      sampleRate: SAMPLE_RATE,
      maxChunkSeconds: 10,
      energyThreshold: 0.01,
    });

    expect(shortMax.maxChunkSamples).toBe(2 * SAMPLE_RATE);
    expect(longMax.maxChunkSamples).toBe(6 * SAMPLE_RATE);
  });

  it("tracks segment startMs on the audio timeline", () => {
    const vad = new VoiceActivityDetector({
      sampleRate: SAMPLE_RATE,
      minSpeechMs: 200,
      energyThreshold: 0.01,
    });

    vad.push(makeSilentPcm(1000));
    vad.push(makePcm(400, 0.5));
    const segments = vad.push(makeSilentPcm(300));

    expect(segments[0]?.startMs).toBe(1000);
  });
});
