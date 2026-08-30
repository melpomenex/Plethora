export {
  canRunLocalNemotron,
  checkRealtimeSessionHealth,
  classifyDevice,
  getDeviceCapabilitySnapshot,
  getMobileNemotronInstallRecommendation,
} from "./DeviceCapabilityService";
export type {
  DeviceCapabilitySnapshot,
  MobileNemotronInstallRecommendation,
  PerformanceClass,
  RealtimeSessionHealth,
} from "./DeviceCapabilityService";
export { TranscriptionService, getTranscriptionService } from "./TranscriptionService";
export {
  buildFallbackChain,
  canFallbackToProvider,
  executeWithFallback,
  selectProvider,
  withExponentialBackoff,
} from "./TranscriptionRouter";
export {
  DEFAULT_PROVIDER_CHAINS,
  DEFAULT_STT_OPENROUTER_CONFIG,
  getDefaultProviderChains,
  getSttOpenRouterConfig,
  legacyProviderToMode,
  LOGICAL_STT_MODEL_KEYS,
  LOGICAL_STT_MODELS,
  modeFromSttProvider,
  resolveSttProvider,
  resolveSttModel,
  buildRoutingContextFromSettings,
  resolveTranscriptionMode,
  setSttOpenRouterConfig,
  sttProviderFromMode,
  OPENROUTER_ASR_MODELS,
  TRANSCRIPTION_PRICING,
  TRANSCRIPTION_PROVIDER_IDS,
} from "./config";
export {
  loadOpenRouterAsrCatalog,
  OPENROUTER_ASR_CURATED,
  clearOpenRouterAsrCatalogCache,
} from "./openrouterAsrCatalog";
export type { OpenRouterAsrModelInfo, AsrCatalogResult } from "./openrouterAsrCatalog";
export { TranscriptionError, normalizeError, isRetryableTranscriptionError } from "./errors";
export type { TranscriptionErrorCode } from "./errors";
export { mergeTranscriptChunks, mergeChunkedTranscriptionResults } from "./reconciliation";
export { VoiceActivityDetector } from "./audio/VoiceActivityDetector";
export type { VadSegment, VoiceActivityDetectorConfig } from "./audio/VoiceActivityDetector";
export { pcmFloat32ToWavBlob } from "./audio/pcmToWav";
export {
  PseudoStreamingSession,
  createPseudoStreamingSession,
} from "./streaming/PseudoStreamingSession";
export { TranscriptionStreamingService } from "./streaming/TranscriptionStreamingService";
export {
  runTranscriptionBenchmark,
} from "./benchmark/harness";
export type {
  BenchmarkProvider,
  BenchmarkResult,
  BenchmarkSuite,
} from "./benchmark/harness";
export { BENCHMARK_FIXTURES, getBenchmarkFixture } from "./benchmark/fixtures";
export type { BenchmarkFixture } from "./benchmark/fixtures";
export { computeCER, computeWER, levenshteinDistance } from "./benchmark/metrics";
export {
  DEFAULT_STT_BENCHMARK_DEFAULTS,
  getSttBenchmarkDefaults,
  resetSttBenchmarkDefaults,
  setSttBenchmarkDefaults,
  classifyPerformanceFromRealtimeFactor,
} from "./benchmark/defaultProviderConfig";
export type {
  SttBenchmarkCapabilityThresholds,
  SttBenchmarkDefaults,
} from "./benchmark/defaultProviderConfig";
export { estimateCost } from "./pricing";
export { persistTranscriptionResult, transcriptionResultToVideoSegments } from "./persist";
export { getTranscriptionJobManager, TranscriptionJobManager } from "./jobs/TranscriptionJobManager";
export type { StartTranscriptionJobInput, TranscriptionJobProgressView } from "./jobs/types";
export { listLocalSttModels } from "./listLocalSttModels";
export { recordUsage } from "./usage";
export type { TranscriptionUsageRecord } from "./usage";
export { BaseProvider } from "./providers/BaseProvider";
export { GroqTranscriptionProvider } from "./providers/GroqTranscriptionProvider";
export { LocalNemotronProvider } from "./providers/LocalNemotronProvider";
export { LocalTranscriptionProvider } from "./providers/LocalTranscriptionProvider";
export { GeminiTranscribeProvider } from "./providers/GeminiTranscribeProvider";
export { GeminiLiveProvider } from "./providers/GeminiLiveProvider";
export { DeepgramProvider } from "./providers/DeepgramProvider";
export {
  checkPremiumTranscriptionAllowed,
  getPremiumMinutesUsed,
  getPremiumMonthlyAllowanceMinutes,
  recordPremiumTranscriptionUsage,
} from "./premiumGuard";
export {
  canUseServerPremiumQuota,
  checkServerPremiumTranscriptionQuota,
  fetchServerTranscriptionQuota,
  meterServerPremiumTranscriptionUsage,
} from "./premiumQuotaClient";
export {
  TranscriptionMode,
} from "./types";
export type {
  LogicalSttModelKey,
  PartialTranscript,
  ProviderHealthEntry,
  ProviderHealthState,
  ProviderHealthStatus,
  Speaker,
  StreamingTranscriptionSession,
  SttModelSelection,
  SttProviderCategory,
  TranscriptionModel,
  TranscriptionCapabilities,
  TranscriptionInput,
  TranscriptionJob,
  TranscriptionJobStatus,
  TranscriptionOptions,
  TranscriptionPricing,
  TranscriptionPricingTier,
  TranscriptionProgress,
  TranscriptionProvider,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionRoutingContext,
  TranscriptionSegment,
  TranscriptionWord,
} from "./types";
