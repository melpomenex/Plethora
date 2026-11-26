import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeSpeechTimingAndRhythm,
  decodeAudioBlobToPcm,
  evaluatePronunciationFeedback,
  extractPitchContourF0,
  withOnDeviceTimingCapability,
  type PronunciationProviderManifest,
} from "../index";

const SAMPLE_RATE = 16_000;

function createSeededPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthesizeHarmonicTone(
  sampleRate: number,
  durationMs: number,
  startHz: number,
  endHz = startHz,
  amplitude = 0.45,
): Float32Array {
  const length = Math.round((sampleRate * durationMs) / 1000);
  const samples = new Float32Array(length);
  let phase = 0;

  for (let i = 0; i < length; i += 1) {
    const progress = length > 1 ? i / (length - 1) : 0;
    const freq = startHz + (endHz - startHz) * progress;
    phase += (2 * Math.PI * freq) / sampleRate;
    // Glottal-pulse-like harmonic series (fundamental + 2nd + 3rd harmonic)
    const wave = 0.6 * Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
    samples[i] = amplitude * wave;
  }

  return samples;
}

function synthesizeWhiteNoise(sampleRate: number, durationMs: number, amplitude = 0.25, seed = 42): Float32Array {
  const rand = createSeededPrng(seed);
  const length = Math.round((sampleRate * durationMs) / 1000);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    samples[i] = (rand() * 2 - 1) * amplitude;
  }
  return samples;
}

function appendBurstWithSyllables(
  target: Float32Array,
  offsetSamples: number,
  sampleRate: number,
  durationMs: number,
  syllables: number,
  f0Hz: number,
): number {
  const length = Math.round((sampleRate * durationMs) / 1000);
  for (let i = 0; i < length && offsetSamples + i < target.length; i += 1) {
    const t = i / sampleRate;
    const u = i / length;
    // Raised-sine syllable envelope creating clear syllable-nucleus peaks
    const syllablePhase = Math.sin(Math.PI * ((u * syllables) % 1));
    const envelope = Math.pow(Math.max(0, syllablePhase), 1.2);
    const wave = 0.65 * Math.sin(2 * Math.PI * f0Hz * t) + 0.35 * Math.sin(2 * Math.PI * 2 * f0Hz * t);
    target[offsetSamples + i] = target[offsetSamples + i]! + 0.45 * envelope * wave;
  }
  return offsetSamples + length;
}

describe("acousticAnalysis", () => {
  const originalAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;

  afterEach(() => {
    if (originalAudioContext === undefined) {
      delete (globalThis as { AudioContext?: unknown }).AudioContext;
    } else {
      (globalThis as { AudioContext?: unknown }).AudioContext = originalAudioContext;
    }
  });

  it("extracts steady 200 Hz F0 within +/- 5 Hz and classifies contour as flat", () => {
    const pcm = synthesizeHarmonicTone(SAMPLE_RATE, 1000, 200);
    const pitch = extractPitchContourF0(pcm, SAMPLE_RATE);

    expect(pitch.status).toBe("ready");
    expect(pitch.frames.length).toBeGreaterThan(80);
    expect(pitch.medianF0Hz).toBeDefined();
    expect(Math.abs((pitch.medianF0Hz ?? 0) - 200)).toBeLessThanOrEqual(5);
    expect(pitch.f0RangeHz).toBeLessThan(10);
    expect(pitch.contourTrend).toBe("flat");
    expect(pitch.voicedFrameRatio).toBeGreaterThan(0.9);
    expect(pitch.medianClarity).toBeGreaterThan(0.85);
    expect(pitch.feedbackSummary.toLowerCase()).toContain("vary");
  });

  it("tracks rising 140 Hz to 220 Hz pitch contour accurately within +/- 5 Hz", () => {
    const pcm = synthesizeHarmonicTone(SAMPLE_RATE, 1000, 140, 220);
    const pitch = extractPitchContourF0(pcm, SAMPLE_RATE);

    expect(pitch.status).toBe("ready");
    expect(pitch.frames.length).toBeGreaterThan(80);
    const firstFrame = pitch.frames[0]!;
    const lastFrame = pitch.frames[pitch.frames.length - 1]!;
    expect(Math.abs(firstFrame.f0Hz - 140)).toBeLessThanOrEqual(5);
    expect(Math.abs(lastFrame.f0Hz - 220)).toBeLessThanOrEqual(5);
    expect(Math.abs((pitch.medianF0Hz ?? 0) - 180)).toBeLessThanOrEqual(5);
    expect(pitch.f0RangeHz).toBeGreaterThan(65);
    expect(pitch.contourTrend).toBe("rising");
  });

  it("tracks falling 220 Hz to 140 Hz pitch contour as falling", () => {
    const pcm = synthesizeHarmonicTone(SAMPLE_RATE, 1000, 220, 140);
    const pitch = extractPitchContourF0(pcm, SAMPLE_RATE);

    expect(pitch.status).toBe("ready");
    expect(pitch.contourTrend).toBe("falling");
  });

  it("returns unreliable-f0 on pure white noise", () => {
    const noise = synthesizeWhiteNoise(SAMPLE_RATE, 1000, 0.3, 1337);
    const pitch = extractPitchContourF0(noise, SAMPLE_RATE);

    expect(pitch.status).toBe("unreliable-f0");
    expect(pitch.frames).toEqual([]);
    expect(pitch.medianF0Hz).toBeUndefined();
  });

  it("returns insufficient-signal on silence and < 150ms clips", () => {
    const silence = new Float32Array(SAMPLE_RATE); // 1 second of zeros
    const timingSilence = analyzeSpeechTimingAndRhythm(silence, SAMPLE_RATE);
    const pitchSilence = extractPitchContourF0(silence, SAMPLE_RATE);

    expect(timingSilence.status).toBe("insufficient-signal");
    expect(timingSilence.speechDurationMs).toBe(0);
    expect(pitchSilence.status).toBe("unreliable-f0");

    const shortTone = synthesizeHarmonicTone(SAMPLE_RATE, 100, 200);
    const timingShort = analyzeSpeechTimingAndRhythm(shortTone, SAMPLE_RATE);
    const pitchShort = extractPitchContourF0(shortTone, SAMPLE_RATE);

    expect(timingShort.status).toBe("insufficient-signal");
    expect(pitchShort.status).toBe("unreliable-f0");
  });

  it("segments speech bursts, pauses, syllable peaks, and durationRatio with noise floor", () => {
    // 400ms (2 syl) + 250ms pause + 400ms (2 syl) + 250ms pause + 400ms (2 syl) = 1700ms
    const totalMs = 1700;
    const pcm = synthesizeWhiteNoise(SAMPLE_RATE, totalMs, 0.004, 99);
    const pauseSamples = Math.round((SAMPLE_RATE * 250) / 1000);

    let cursor = 0;
    cursor = appendBurstWithSyllables(pcm, cursor, SAMPLE_RATE, 400, 2, 190);
    cursor += pauseSamples;
    cursor = appendBurstWithSyllables(pcm, cursor, SAMPLE_RATE, 400, 2, 180);
    cursor += pauseSamples;
    appendBurstWithSyllables(pcm, cursor, SAMPLE_RATE, 400, 2, 200);

    const timing = analyzeSpeechTimingAndRhythm(pcm, SAMPLE_RATE, 1200);

    expect(timing.status).toBe("ready");
    expect(timing.totalDurationMs).toBeCloseTo(1700, 1);
    expect(timing.pauseCount).toBe(2);
    expect(timing.speechSegments.length).toBe(3);
    expect(timing.speechDurationMs).toBeGreaterThan(950);
    expect(timing.speechDurationMs).toBeLessThan(1350);
    expect(timing.pauseRatio).toBeGreaterThan(0.2);
    expect(timing.pauseRatio).toBeLessThan(0.45);
    expect(timing.syllablePeakCount).toBe(6);
    expect(timing.speechRateEstimate).toBeGreaterThan(4);
    expect(timing.speechRateEstimate).toBeLessThan(7);
    expect(timing.durationRatio).toBeDefined();
    expect(timing.durationRatio!).toBeGreaterThan(0.8);
    expect(timing.durationRatio!).toBeLessThan(1.15);
  });

  it("decodes audio blobs safely when AudioContext is unavailable or available", async () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" });
    await expect(decodeAudioBlobToPcm(blob)).resolves.toBeNull();

    let closed = false;
    class MockAudioContext {
      async decodeAudioData(): Promise<AudioBuffer> {
        const left = new Float32Array([0.2, 0.4, 0.6]);
        const right = new Float32Array([0.4, 0.6, 0.8]);
        return {
          length: 3,
          numberOfChannels: 2,
          sampleRate: 16_000,
          duration: 3 / 16_000,
          getChannelData: (ch: number) => (ch === 0 ? left : right),
          copyFromChannel: () => {},
          copyToChannel: () => {},
        } as unknown as AudioBuffer;
      }
      async close(): Promise<void> {
        closed = true;
      }
    }

    (globalThis as { AudioContext?: unknown }).AudioContext = MockAudioContext;
    const decoded = await decodeAudioBlobToPcm(blob);
    expect(decoded).not.toBeNull();
    expect(decoded?.sampleRate).toBe(16_000);
    expect(Array.from(decoded?.samples ?? []).map((v) => Number(v.toFixed(2)))).toEqual([0.3, 0.5, 0.7]);
    expect(closed).toBe(true);
  });
});

describe("evaluatePronunciationFeedback acoustic gating", () => {
  const baseManifest: PronunciationProviderManifest = {
    providerId: "local-stt",
    providerVersion: "1.0",
    capabilities: ["transcription"],
    languages: ["es"],
    sendsAudioOffDevice: false,
    maxAudioMs: 30_000,
    configured: true,
  };

  it("gates out acousticMetrics when provider lacks timing capability and never fabricates phoneme scores", () => {
    const pcm = synthesizeHarmonicTone(SAMPLE_RATE, 800, 180);
    const timing = analyzeSpeechTimingAndRhythm(pcm, SAMPLE_RATE, 800);
    const pitch = extractPitchContourF0(pcm, SAMPLE_RATE);

    const result = evaluatePronunciationFeedback({
      attemptId: "att-1",
      languageTag: "es-ES",
      expectedText: "Buenos días",
      recognizedText: "Buenos días",
      confidence: 0.95,
      acousticMetrics: { timing, pitch },
      phonemeIssues: [{ kind: "phoneme", expected: "d", actual: "t" }],
      provider: baseManifest,
    });

    expect(result.status).toBe("ready");
    expect(result.availableDimensions).toEqual(["transcription"]);
    expect(result.availableDimensions).not.toContain("timing");
    expect(result.availableDimensions).not.toContain("phoneme");
    expect(result.acoustic).toBeUndefined();
    expect(result.issues).toEqual([]);
  });

  it("integrates acousticMetrics when timing capability is enabled without fabricating phoneme issues", () => {
    const pcm = synthesizeHarmonicTone(SAMPLE_RATE, 800, 140, 210);
    const timing = analyzeSpeechTimingAndRhythm(pcm, SAMPLE_RATE, 800);
    const pitch = extractPitchContourF0(pcm, SAMPLE_RATE);
    const timingManifest = withOnDeviceTimingCapability(baseManifest);

    const result = evaluatePronunciationFeedback({
      attemptId: "att-2",
      languageTag: "es-MX",
      expectedText: "Hola mundo",
      recognizedText: "Hola mundo",
      confidence: 0.92,
      acousticMetrics: { timing, pitch },
      phonemeIssues: [{ kind: "phoneme", expected: "o", actual: "u" }],
      provider: timingManifest,
    });

    expect(result.status).toBe("ready");
    expect(result.availableDimensions).toEqual(["transcription", "timing"]);
    expect(result.availableDimensions).not.toContain("phoneme");
    expect(result.acoustic?.timing?.status).toBe("ready");
    expect(result.acoustic?.pitch?.status).toBe("ready");
    expect(result.acoustic?.pitch?.contourTrend).toBe("rising");
    expect(result.issues.some((issue) => issue.kind === "phoneme")).toBe(false);
  });

  it("supports timing-only local acoustic feedback and respects real phoneme providers", () => {
    const pcm = synthesizeHarmonicTone(SAMPLE_RATE, 800, 200);
    const timing = analyzeSpeechTimingAndRhythm(pcm, SAMPLE_RATE);
    const pitch = extractPitchContourF0(pcm, SAMPLE_RATE);

    const timingOnlyResult = evaluatePronunciationFeedback({
      attemptId: "att-3",
      languageTag: "es",
      expectedText: "Hola",
      acousticMetrics: { timing, pitch },
      provider: {
        providerId: "webaudio-local",
        providerVersion: "1.0",
        capabilities: ["timing"],
        languages: ["es"],
        sendsAudioOffDevice: false,
        maxAudioMs: 30_000,
        configured: true,
      },
    });

    expect(timingOnlyResult.status).toBe("ready");
    expect(timingOnlyResult.score).toBeUndefined();
    expect(timingOnlyResult.availableDimensions).toEqual(["timing"]);
    expect(timingOnlyResult.acoustic?.pitch?.medianF0Hz).toBeDefined();

    const phonemeResult = evaluatePronunciationFeedback({
      attemptId: "att-4",
      languageTag: "es",
      expectedText: "pero",
      recognizedText: "pero",
      confidence: 0.9,
      phonemeIssues: [{ kind: "phoneme", expected: "ɾ", actual: "r", confidence: 0.8 }],
      provider: {
        providerId: "phoneme-aligner",
        providerVersion: "2.0",
        capabilities: ["transcription", "phoneme"],
        languages: ["es"],
        sendsAudioOffDevice: false,
        maxAudioMs: 30_000,
        configured: true,
      },
    });

    expect(phonemeResult.availableDimensions).toEqual(["transcription", "phoneme"]);
    expect(phonemeResult.issues).toEqual([{ kind: "phoneme", expected: "ɾ", actual: "r", confidence: 0.8 }]);
  });
});
