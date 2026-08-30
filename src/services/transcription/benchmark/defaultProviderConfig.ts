import {
  DEFAULT_STT_OPENROUTER_CONFIG,
  TRANSCRIPTION_PROVIDER_IDS,
} from "../config";
import type { TranscriptionProviderId } from "../types";
import type { PerformanceClass } from "../DeviceCapabilityService";

export interface SttBenchmarkCapabilityThresholds {
  /** Realtime factor at or below which a device is Excellent. */
  excellentRealtimeFactor: number;
  /** Realtime factor at or below which a device is Good. */
  goodRealtimeFactor: number;
  /** Realtime factor at or below which a device is Usable. */
  usableRealtimeFactor: number;
  /** Realtime factor above which a device is Slow (below Unsupported). */
  slowRealtimeFactor: number;
}

export interface SttBenchmarkDefaults {
  defaultProviderId: TranscriptionProviderId;
  defaultModel: string;
  capabilityThresholds: SttBenchmarkCapabilityThresholds;
}

export const DEFAULT_STT_BENCHMARK_DEFAULTS: SttBenchmarkDefaults = {
  defaultProviderId: TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON,
  defaultModel: DEFAULT_STT_OPENROUTER_CONFIG.defaultModel,
  capabilityThresholds: {
    excellentRealtimeFactor: 0.5,
    goodRealtimeFactor: 0.75,
    usableRealtimeFactor: 1.0,
    slowRealtimeFactor: 2.0,
  },
};

let sttBenchmarkDefaults: SttBenchmarkDefaults = {
  ...DEFAULT_STT_BENCHMARK_DEFAULTS,
  capabilityThresholds: { ...DEFAULT_STT_BENCHMARK_DEFAULTS.capabilityThresholds },
};

export function getSttBenchmarkDefaults(): SttBenchmarkDefaults {
  return sttBenchmarkDefaults;
}

/** Remotely overridable benchmark defaults (mirrors `setSttOpenRouterConfig`). */
export function setSttBenchmarkDefaults(partial: Partial<SttBenchmarkDefaults>): void {
  sttBenchmarkDefaults = {
    ...sttBenchmarkDefaults,
    ...partial,
    capabilityThresholds: {
      ...sttBenchmarkDefaults.capabilityThresholds,
      ...partial.capabilityThresholds,
    },
  };
}

export function resetSttBenchmarkDefaults(): void {
  sttBenchmarkDefaults = {
    ...DEFAULT_STT_BENCHMARK_DEFAULTS,
    capabilityThresholds: { ...DEFAULT_STT_BENCHMARK_DEFAULTS.capabilityThresholds },
  };
}

/** Map measured realtime factor to device performance class (Phase 12.3). */
export function classifyPerformanceFromRealtimeFactor(realtimeFactor: number): PerformanceClass {
  const thresholds = getSttBenchmarkDefaults().capabilityThresholds;
  if (realtimeFactor <= thresholds.excellentRealtimeFactor) return "excellent";
  if (realtimeFactor <= thresholds.goodRealtimeFactor) return "good";
  if (realtimeFactor <= thresholds.usableRealtimeFactor) return "usable";
  if (realtimeFactor <= thresholds.slowRealtimeFactor) return "slow";
  return "unsupported";
}
