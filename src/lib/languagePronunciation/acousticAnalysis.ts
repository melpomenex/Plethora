export interface SpeechSegment {
  startMs: number;
  endMs: number;
}

export interface SpeechTimingAnalysis {
  status: "ready" | "insufficient-signal";
  totalDurationMs: number;
  speechDurationMs: number;
  pauseCount: number;
  pauseRatio: number;
  speechRateEstimate: number;
  syllablePeakCount: number;
  durationRatio?: number;
  noiseFloorRms: number;
  speechSegments: readonly SpeechSegment[];
}

export interface PitchFrame {
  timeMs: number;
  f0Hz: number;
  clarity: number;
}

export type PitchContourTrend = "rising" | "falling" | "flat" | "varied";

export interface PitchContourAnalysis {
  status: "ready" | "unreliable-f0";
  frames: readonly PitchFrame[];
  medianF0Hz?: number;
  minF0Hz?: number;
  maxF0Hz?: number;
  f0RangeHz?: number;
  contourTrend?: PitchContourTrend;
  voicedFrameRatio: number;
  medianClarity: number;
  feedbackSummary: string;
}

export interface DecodedPcmAudio {
  samples: Float32Array;
  sampleRate: number;
}

export interface AcousticAnalysisResult {
  timing: SpeechTimingAnalysis;
  pitch: PitchContourAnalysis;
}

const TIMING_FRAME_MS = 20;
const TIMING_HOP_MS = 10;
const MIN_AUDIO_DURATION_MS = 150;
const MIN_SILENCE_RMS = 0.002;
const MIN_SPEECH_DURATION_MS = 60;
const MIN_PAUSE_GAP_MS = 60;
const MIN_SYLLABLE_INTERVAL_FRAMES = 10; // 100ms at 10ms hop

const PITCH_FRAME_MS = 30;
const PITCH_HOP_MS = 10;
const MIN_F0_HZ = 65;
const MAX_F0_HZ = 450;
const YIN_THRESHOLD = 0.25;
const MIN_VOICED_CLARITY = 0.65;
const MIN_VOICED_FRAMES = 5;
const MIN_MEDIAN_VOICED_CLARITY = 0.7;
const MIN_ACTIVE_VOICED_RATIO = 0.15;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function quantile(sortedValues: readonly number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;
  const pos = clamp01(q) * (sortedValues.length - 1);
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  if (low === high) return sortedValues[low]!;
  const weight = pos - low;
  return sortedValues[low]! * (1 - weight) + sortedValues[high]! * weight;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

function insufficientTiming(
  totalDurationMs: number,
  noiseFloorRms: number,
  referenceDurationMs?: number,
): SpeechTimingAnalysis {
  const validRef = typeof referenceDurationMs === "number"
    && Number.isFinite(referenceDurationMs)
    && referenceDurationMs > 0;
  return {
    status: "insufficient-signal",
    totalDurationMs,
    speechDurationMs: 0,
    pauseCount: 0,
    pauseRatio: 0,
    speechRateEstimate: 0,
    syllablePeakCount: 0,
    durationRatio: validRef ? 0 : undefined,
    noiseFloorRms,
    speechSegments: [],
  };
}

function mergeSpeechSegments(
  activeFlags: readonly boolean[],
  hopMs: number,
  frameMs: number,
  totalDurationMs: number,
): SpeechSegment[] {
  const rawSegments: SpeechSegment[] = [];
  let activeStartIndex = -1;

  for (let i = 0; i < activeFlags.length; i += 1) {
    if (activeFlags[i] && activeStartIndex === -1) {
      activeStartIndex = i;
    } else if (!activeFlags[i] && activeStartIndex !== -1) {
      const startMs = activeStartIndex * hopMs;
      const endMs = Math.min(totalDurationMs, (i - 1) * hopMs + frameMs);
      rawSegments.push({ startMs, endMs });
      activeStartIndex = -1;
    }
  }
  if (activeStartIndex !== -1) {
    const startMs = activeStartIndex * hopMs;
    const endMs = Math.min(totalDurationMs, (activeFlags.length - 1) * hopMs + frameMs);
    rawSegments.push({ startMs, endMs });
  }

  // Bridge micro-gaps shorter than MIN_PAUSE_GAP_MS inside continuous speech
  const merged: SpeechSegment[] = [];
  for (const segment of rawSegments) {
    const prev = merged[merged.length - 1];
    if (prev && segment.startMs - prev.endMs < MIN_PAUSE_GAP_MS) {
      merged[merged.length - 1] = { startMs: prev.startMs, endMs: segment.endMs };
    } else {
      merged.push(segment);
    }
  }

  // Drop tiny transient spikes shorter than MIN_SPEECH_DURATION_MS
  return merged.filter((segment) => segment.endMs - segment.startMs >= MIN_SPEECH_DURATION_MS);
}

function countSyllableNucleusPeaks(
  rmsFrames: readonly number[],
  activeFlags: readonly boolean[],
  speechThreshold: number,
  noiseFloorRms: number,
): number {
  if (rmsFrames.length < 3) return 0;

  // Smooth RMS with a 5-point triangular window [1, 2, 3, 2, 1] / 9 (~50ms)
  const smoothed = new Float64Array(rmsFrames.length);
  const weights = [1, 2, 3, 2, 1];
  for (let i = 0; i < rmsFrames.length; i += 1) {
    let weightedSum = 0;
    let weightTotal = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const idx = i + offset;
      if (idx >= 0 && idx < rmsFrames.length) {
        const w = weights[offset + 2]!;
        weightedSum += rmsFrames[idx]! * w;
        weightTotal += w;
      }
    }
    smoothed[i] = weightTotal > 0 ? weightedSum / weightTotal : 0;
  }

  let maxActiveEnv = 0;
  for (let i = 0; i < smoothed.length; i += 1) {
    if (activeFlags[i] && smoothed[i]! > maxActiveEnv) {
      maxActiveEnv = smoothed[i]!;
    }
  }

  const peakThreshold = Math.max(
    speechThreshold,
    noiseFloorRms + 0.25 * Math.max(0, maxActiveEnv - noiseFloorRms),
  );

  // Collect candidate local maxima inside active speech frames (including boundary plateaus)
  const candidates: number[] = [];
  for (let i = 0; i < smoothed.length; i += 1) {
    if (!activeFlags[i]) continue;
    const current = smoothed[i]!;
    if (current < peakThreshold) continue;
    const left = i > 0 ? smoothed[i - 1]! : 0;
    const right = i + 1 < smoothed.length ? smoothed[i + 1]! : 0;
    if (current >= left && current >= right && (current > left || current > right)) {
      candidates.push(i);
    }
  }

  // Enforce minimum syllable refractory period, keeping the stronger peak on collisions
  const accepted: number[] = [];
  for (const idx of candidates) {
    const prevIdx = accepted[accepted.length - 1];
    if (prevIdx !== undefined && idx - prevIdx < MIN_SYLLABLE_INTERVAL_FRAMES) {
      if (smoothed[idx]! > smoothed[prevIdx]!) {
        accepted[accepted.length - 1] = idx;
      }
    } else {
      accepted.push(idx);
    }
  }

  return accepted.length;
}

/**
 * Analyzes PCM speech timing, pauses, and energy-envelope syllable rate.
 * Uses 20ms frames with 10ms hop and an adaptive noise floor.
 */
export function analyzeSpeechTimingAndRhythm(
  samples: Float32Array,
  sampleRate: number,
  referenceDurationMs?: number,
): SpeechTimingAnalysis {
  if (!samples || samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return insufficientTiming(0, 0, referenceDurationMs);
  }

  const totalDurationMs = (samples.length / sampleRate) * 1000;
  if (totalDurationMs < MIN_AUDIO_DURATION_MS) {
    return insufficientTiming(totalDurationMs, 0, referenceDurationMs);
  }

  const frameLength = Math.max(1, Math.round((sampleRate * TIMING_FRAME_MS) / 1000));
  const hopLength = Math.max(1, Math.round((sampleRate * TIMING_HOP_MS) / 1000));
  const rmsFrames: number[] = [];

  for (let start = 0; start + frameLength <= samples.length; start += hopLength) {
    let sumSq = 0;
    for (let j = 0; j < frameLength; j += 1) {
      const value = samples[start + j]!;
      sumSq += value * value;
    }
    rmsFrames.push(Math.sqrt(sumSq / frameLength));
  }

  if (rmsFrames.length === 0) {
    return insufficientTiming(totalDurationMs, 0, referenceDurationMs);
  }

  const sortedRms = [...rmsFrames].sort((a, b) => a - b);
  const p10 = quantile(sortedRms, 0.1);
  const p90 = quantile(sortedRms, 0.9);
  const maxRms = sortedRms[sortedRms.length - 1] ?? 0;

  if (maxRms < MIN_SILENCE_RMS || p90 < MIN_SILENCE_RMS) {
    return insufficientTiming(totalDurationMs, p10, referenceDurationMs);
  }

  // If dynamic range indicates pauses exist, estimate noise floor from p10;
  // otherwise handle continuous steady speech without falsely classifying it as noise.
  const hasDynamicRange = p90 > p10 * 2.5;
  const noiseFloorRms = hasDynamicRange ? p10 : Math.min(p10, MIN_SILENCE_RMS);
  const speechThreshold = hasDynamicRange
    ? Math.max(MIN_SILENCE_RMS, noiseFloorRms * 2.2, noiseFloorRms + 0.15 * (p90 - noiseFloorRms))
    : Math.max(MIN_SILENCE_RMS, p90 * 0.25);

  const activeFlags = rmsFrames.map((rms) => rms >= speechThreshold);
  const speechSegments = mergeSpeechSegments(activeFlags, TIMING_HOP_MS, TIMING_FRAME_MS, totalDurationMs);

  const speechDurationMs = speechSegments.reduce((sum, seg) => sum + Math.max(0, seg.endMs - seg.startMs), 0);
  if (speechSegments.length === 0 || speechDurationMs < MIN_SPEECH_DURATION_MS) {
    return insufficientTiming(totalDurationMs, noiseFloorRms, referenceDurationMs);
  }

  let pauseCount = 0;
  for (let i = 1; i < speechSegments.length; i += 1) {
    const gap = speechSegments[i]!.startMs - speechSegments[i - 1]!.endMs;
    if (gap >= MIN_PAUSE_GAP_MS) {
      pauseCount += 1;
    }
  }

  const nonSpeechMs = Math.max(0, totalDurationMs - speechDurationMs);
  const pauseRatio = totalDurationMs > 0 ? clamp01(nonSpeechMs / totalDurationMs) : 0;

  const syllablePeakCount = countSyllableNucleusPeaks(rmsFrames, activeFlags, speechThreshold, noiseFloorRms);
  const speechDurationSec = speechDurationMs / 1000;
  const speechRateEstimate = speechDurationSec > 0 ? syllablePeakCount / speechDurationSec : 0;

  const validRef = typeof referenceDurationMs === "number"
    && Number.isFinite(referenceDurationMs)
    && referenceDurationMs > 0;
  const durationRatio = validRef ? speechDurationMs / referenceDurationMs : undefined;

  return {
    status: "ready",
    totalDurationMs,
    speechDurationMs,
    pauseCount,
    pauseRatio,
    speechRateEstimate,
    syllablePeakCount,
    durationRatio,
    noiseFloorRms,
    speechSegments,
  };
}

function classifyPitchContourTrend(frames: readonly PitchFrame[], medianF0Hz: number, f0RangeHz: number): PitchContourTrend {
  if (frames.length < 3 || f0RangeHz < 12 || (medianF0Hz > 0 && f0RangeHz / medianF0Hz < 0.06)) {
    return "flat";
  }

  const third = Math.max(1, Math.floor(frames.length / 3));
  const firstSlice = frames.slice(0, third).map((frame) => frame.f0Hz);
  const lastSlice = frames.slice(frames.length - third).map((frame) => frame.f0Hz);
  const netShiftHz = median(lastSlice) - median(firstSlice);
  const minShiftHz = Math.max(12, medianF0Hz * 0.07);

  if (Math.abs(netShiftHz) >= minShiftHz && Math.abs(netShiftHz) >= 0.45 * f0RangeHz) {
    return netShiftHz > 0 ? "rising" : "falling";
  }
  return "varied";
}

function buildAccentFairPitchSummary(
  trend: PitchContourTrend,
  medianF0Hz: number,
  f0RangeHz: number,
): string {
  const roundedMedian = Math.round(medianF0Hz);
  const roundedRange = Math.round(f0RangeHz);
  const trendDescription = trend === "flat"
    ? "a steady pitch contour"
    : `a ${trend} pitch contour`;
  return `Observed ${trendDescription} centered near ${roundedMedian} Hz (${roundedRange} Hz span). Natural pitch ranges vary widely across speakers and accents; treat this only as a descriptive prosody cue.`;
}

function unreliablePitch(
  voicedFrameRatio: number,
  medianClarity: number,
  reason?: string,
): PitchContourAnalysis {
  return {
    status: "unreliable-f0",
    frames: [],
    voicedFrameRatio,
    medianClarity,
    feedbackSummary: reason
      ?? "Pitch contour could not be tracked reliably from this recording (too few clear voiced frames). Speech clarity or background noise may have obscured voicing.",
  };
}

/**
 * Extracts a per-frame fundamental frequency (F0) contour using a YIN-style
 * cumulative mean normalized difference function (CMNDF) with parabolic interpolation
 * over 30ms frames (10ms hop) in the human speech range (65 Hz - 450 Hz).
 */
export function extractPitchContourF0(
  samples: Float32Array,
  sampleRate: number,
): PitchContourAnalysis {
  if (!samples || samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return unreliablePitch(0, 0, "Audio buffer is empty or sample rate is invalid.");
  }

  const totalDurationMs = (samples.length / sampleRate) * 1000;
  if (totalDurationMs < MIN_AUDIO_DURATION_MS) {
    return unreliablePitch(0, 0, "Recording is too short (< 150 ms) for reliable pitch tracking.");
  }

  const hopLength = Math.max(1, Math.round((sampleRate * PITCH_HOP_MS) / 1000));
  const frameLength = Math.max(4, Math.round((sampleRate * PITCH_FRAME_MS) / 1000));
  const tauMin = Math.max(2, Math.floor(sampleRate / MAX_F0_HZ));
  const tauMax = Math.floor(sampleRate / MIN_F0_HZ);
  if (tauMax <= tauMin + 1) {
    return unreliablePitch(0, 0, "Sample rate is too low for 65-450 Hz pitch analysis.");
  }

  const integrationWindow = Math.max(Math.round(sampleRate * 0.012), frameLength - tauMax);
  const analysisWindow = integrationWindow + tauMax;
  if (samples.length < analysisWindow) {
    return unreliablePitch(0, 0, "Recording is too short for a pitch analysis frame.");
  }

  const centered = new Float64Array(analysisWindow);
  const cmndf = new Float64Array(tauMax + 1);

  let totalFrames = 0;
  let activeFrames = 0;
  const activeClarities: number[] = [];
  const voicedFrames: PitchFrame[] = [];

  for (let start = 0; start + analysisWindow <= samples.length; start += hopLength) {
    totalFrames += 1;

    // Remove DC offset per frame and compute AC RMS
    let mean = 0;
    for (let i = 0; i < analysisWindow; i += 1) {
      mean += samples[start + i]!;
    }
    mean /= analysisWindow;

    let acSumSq = 0;
    for (let i = 0; i < analysisWindow; i += 1) {
      const value = samples[start + i]! - mean;
      centered[i] = value;
      acSumSq += value * value;
    }
    const acRms = Math.sqrt(acSumSq / analysisWindow);
    if (acRms < MIN_SILENCE_RMS) {
      continue;
    }
    activeFrames += 1;

    // YIN difference function + cumulative mean normalized difference (CMNDF)
    cmndf[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= tauMax; tau += 1) {
      let diffSum = 0;
      for (let j = 0; j < integrationWindow; j += 1) {
        const delta = centered[j]! - centered[j + tau]!;
        diffSum += delta * delta;
      }
      runningSum += diffSum;
      cmndf[tau] = runningSum > 0 ? (diffSum * tau) / runningSum : 1;
    }

    // YIN Step 4: first local minimum dip below threshold within [tauMin, tauMax]
    let bestTau = -1;
    for (let tau = tauMin; tau <= tauMax; tau += 1) {
      if (cmndf[tau]! < YIN_THRESHOLD) {
        while (tau + 1 <= tauMax && cmndf[tau + 1]! < cmndf[tau]!) {
          tau += 1;
        }
        if (tau > tauMin && tau < tauMax) {
          bestTau = tau;
          break;
        }
      }
    }

    if (bestTau === -1) {
      let minVal = Number.POSITIVE_INFINITY;
      for (let tau = tauMin + 1; tau < tauMax; tau += 1) {
        if (cmndf[tau]! < minVal) {
          minVal = cmndf[tau]!;
          bestTau = tau;
        }
      }
    }

    if (bestTau <= tauMin || bestTau >= tauMax) {
      activeClarities.push(0);
      continue;
    }

    // YIN Step 5: parabolic interpolation around bestTau for sub-sample F0 accuracy
    const s0 = cmndf[bestTau - 1]!;
    const s1 = cmndf[bestTau]!;
    const s2 = cmndf[bestTau + 1]!;
    const denom = 2 * (s0 - 2 * s1 + s2);
    let refinedTau = bestTau;
    let refinedCmndf = s1;
    if (denom > 1e-12) {
      const shift = Math.max(-0.5, Math.min(0.5, (s0 - s2) / denom));
      refinedTau = bestTau + shift;
      refinedCmndf = Math.max(0, s1 - 0.25 * (s0 - s2) * shift);
    }

    const f0Hz = sampleRate / refinedTau;
    const clarity = clamp01(1 - refinedCmndf);
    activeClarities.push(clarity);

    if (clarity >= MIN_VOICED_CLARITY && f0Hz >= MIN_F0_HZ && f0Hz <= MAX_F0_HZ) {
      const timeMs = ((start + analysisWindow / 2) / sampleRate) * 1000;
      voicedFrames.push({ timeMs, f0Hz, clarity });
    }
  }

  const voicedFrameRatio = totalFrames > 0 ? clamp01(voicedFrames.length / totalFrames) : 0;
  const activeVoicedRatio = activeFrames > 0 ? voicedFrames.length / activeFrames : 0;
  const medianVoicedClarity = voicedFrames.length > 0
    ? median(voicedFrames.map((frame) => frame.clarity))
    : median(activeClarities);

  if (
    voicedFrames.length < MIN_VOICED_FRAMES
    || medianVoicedClarity < MIN_MEDIAN_VOICED_CLARITY
    || activeVoicedRatio < MIN_ACTIVE_VOICED_RATIO
  ) {
    return unreliablePitch(voicedFrameRatio, medianVoicedClarity);
  }

  const f0Values = voicedFrames.map((frame) => frame.f0Hz);
  const medianF0Hz = median(f0Values);
  const minF0Hz = Math.min(...f0Values);
  const maxF0Hz = Math.max(...f0Values);
  const f0RangeHz = maxF0Hz - minF0Hz;
  const contourTrend = classifyPitchContourTrend(voicedFrames, medianF0Hz, f0RangeHz);

  return {
    status: "ready",
    frames: voicedFrames,
    medianF0Hz,
    minF0Hz,
    maxF0Hz,
    f0RangeHz,
    contourTrend,
    voicedFrameRatio,
    medianClarity: medianVoicedClarity,
    feedbackSummary: buildAccentFairPitchSummary(contourTrend, medianF0Hz, f0RangeHz),
  };
}

/**
 * Convenience helper to run both speech timing/rhythm and F0 pitch contour analysis
 * on a decoded mono PCM buffer.
 */
export function analyzeAcousticPronunciation(
  samples: Float32Array,
  sampleRate: number,
  referenceDurationMs?: number,
): AcousticAnalysisResult {
  return {
    timing: analyzeSpeechTimingAndRhythm(samples, sampleRate, referenceDurationMs),
    pitch: extractPitchContourF0(samples, sampleRate),
  };
}

type AudioContextConstructorLike = new () => {
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBuffer>;
  close?: () => Promise<void>;
};

async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer | null> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  if (typeof Response === "function") {
    return new Response(blob).arrayBuffer();
  }
  if (typeof FileReader === "function") {
    return new Promise<ArrayBuffer | null>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result instanceof ArrayBuffer ? reader.result : null);
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio blob"));
      reader.readAsArrayBuffer(blob);
    });
  }
  return null;
}

/**
 * Decodes recorded WebM/WAV/audio blobs to mono Float32Array PCM using WebAudio
 * when available in browser or Tauri WebView. Returns null safely in Node/jsdom
 * or on decode failure without throwing.
 */
export async function decodeAudioBlobToPcm(blob: Blob): Promise<DecodedPcmAudio | null> {
  if (!blob) {
    return null;
  }

  const scope = globalThis as {
    AudioContext?: AudioContextConstructorLike;
    webkitAudioContext?: AudioContextConstructorLike;
  };
  const AudioContextCtor = scope.AudioContext ?? scope.webkitAudioContext;
  if (typeof AudioContextCtor !== "function") {
    return null;
  }

  let ctx: InstanceType<AudioContextConstructorLike> | null = null;
  try {
    const arrayBuffer = await readBlobAsArrayBuffer(blob);
    if (!arrayBuffer) {
      return null;
    }
    ctx = new AudioContextCtor();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    if (!audioBuffer || audioBuffer.length === 0 || audioBuffer.numberOfChannels <= 0) {
      return null;
    }

    const { length, numberOfChannels, sampleRate } = audioBuffer;
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      return null;
    }

    if (numberOfChannels === 1) {
      return {
        samples: new Float32Array(audioBuffer.getChannelData(0)),
        sampleRate,
      };
    }

    const mono = new Float32Array(length);
    for (let ch = 0; ch < numberOfChannels; ch += 1) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < length; i += 1) {
        mono[i]! += channelData[i]! / numberOfChannels;
      }
    }
    return { samples: mono, sampleRate };
  } catch {
    return null;
  } finally {
    if (ctx && typeof ctx.close === "function") {
      try {
        await ctx.close();
      } catch {
        // Ignore cleanup failures
      }
    }
  }
}
