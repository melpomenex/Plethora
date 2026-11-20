/** Native health IPC payloads from the Rust health commands. */

export interface HealthAnalysisRange {
  startMs: number;
  endMs: number;
  tzOffsetSecs?: number | null;
}

export type HealthImportFormat = 'json' | 'csv' | 'apple_health_xml';

export type HealthProviderId =
  | 'apple_healthkit'
  | 'android_health_connect'
  | 'oura'
  | 'whoop'
  | 'google_health'
  | 'garmin'
  | 'polar'
  | 'withings'
  | 'samsung_health'
  | 'suunto'
  | 'ultrahuman'
  | 'ringconn'
  | 'manual'
  | 'file_import';

export type ProviderCategory =
  | 'native_mobile'
  | 'cloud_oauth'
  | 'local_manual'
  | 'local_import'
  | 'aggregator_bridged';

export type ProviderReadinessState =
  | 'available'
  | 'not_configured'
  | 'requires_developer_approval'
  | 'requires_user_authorization'
  | 'connected'
  | 'synchronizing'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'permission_revoked'
  | 'unsupported'
  | 'feature_disabled_compliance';

export type HealthDataCategory =
  | 'sleep'
  | 'sleep_stages'
  | 'heart_rate'
  | 'resting_heart_rate'
  | 'hrv'
  | 'activity'
  | 'recovery'
  | 'temperature'
  | 'respiratory_rate';

export interface HealthProviderInfo {
  id: HealthProviderId;
  category: ProviderCategory;
  displayName: string;
  supportedCategories: HealthDataCategory[];
  readinessState: ProviderReadinessState;
  readinessReason: string;
  implementationVersion: string;
  requiresApproval: boolean;
  requiresCredentials: boolean;
  supportsBackfill: boolean;
  maxBackfillDays: number | null;
  bridgedVia: HealthProviderId[];
  documentationUrl: string;
  limitations: string[];
}

export interface HealthConnection {
  providerId: HealthProviderId;
  status: ProviderReadinessState;
  authState: string;
  requestedCategories: HealthDataCategory[];
  grantedCategories: HealthDataCategory[];
  lastSyncAtMs: number | null;
  lastSuccessAtMs: number | null;
  syncCursor: string | null;
  accountSubjectHint: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  historyLimitDays: number | null;
  backgroundSyncEnabled: boolean;
  updatedAtMs: number;
}

export interface HealthConsentRecord {
  id: string;
  providerId: HealthProviderId;
  action: string;
  categories: HealthDataCategory[];
  purpose: string;
  policyVersion: string;
  recordedAtMs: number;
}

export type SleepStageType =
  | 'awake'
  | 'light'
  | 'deep'
  | 'rem'
  | 'asleep_unknown'
  | 'in_bed'
  | 'unknown';

export type SleepKind =
  | 'main_sleep'
  | 'nap'
  | 'unknown';

export type SleepQualityFlag =
  | 'missing_stages'
  | 'partial_stages'
  | 'implausible_duration'
  | 'source_conflict'
  | 'clock_skew_or_dst'
  | 'user_entered'
  | 'incomplete_boundaries'
  | 'aggregate_stage_durations_only';

export interface SleepStageInterval {
  id: string;
  rawSessionId: string;
  stageType: SleepStageType;
  startAtMs: number;
  endAtMs: number;
  providerStageCode: string | null;
}

export type DuplicateRelationship =
  | 'primary'
  | 'same_source_export_duplicate'
  | 'independent_device_observation';

export interface SleepEpisodeMember {
  canonicalEpisodeId: string;
  rawSessionId: string;
  providerId: HealthProviderId;
  sourceAppBundle: string | null;
  durationMins: number;
  relationship: DuplicateRelationship;
  priorityRank: number;
}

export interface CanonicalSleepEpisode {
  id: string;
  primaryRawSessionId: string;
  primaryProviderId: HealthProviderId;
  startAtMs: number;
  endAtMs: number;
  startTzOffsetSecs: number | null;
  endTzOffsetSecs: number | null;
  anchorLocalDate: string;
  sleepKind: SleepKind;
  userSleepKindOverride: SleepKind | null;
  totalSleepMins: number;
  timeInBedMins: number | null;
  sleepEfficiencyPct: number | null;
  wasoMins: number | null;
  stageCoverageRatio: number;
  awakeMins: number | null;
  lightMins: number | null;
  deepMins: number | null;
  remMins: number | null;
  hasSourceConflict: boolean;
  conflictDurationDiffMins: number | null;
  qualityFlags: SleepQualityFlag[];
  isSynthetic: boolean;
  stages: SleepStageInterval[];
  members: SleepEpisodeMember[];
}

export interface HealthSourcePreference {
  category: string;
  orderedProviderIds: HealthProviderId[];
  updatedAtMs: number;
}

export interface HealthPrivacySettings {
  aiSharingEnabled: boolean;
  cloudSyncEnabled: boolean;
  demoModeEnabled: boolean;
  retentionDays: number | null;
  updatedAtMs: number;
}

export interface HealthSyncReport {
  batchId: string;
  providerId: HealthProviderId;
  sleepUpserts: number;
  sleepDeletes: number;
  physioUpserts: number;
  recoveryUpserts: number;
  reconciledEpisodes: number;
  warnings: string[];
  nextCursor: string | null;
}

export interface ManualSleepInput {
  id?: string | null;
  startIso: string;
  endIso: string;
  tzOffsetMinutes?: number | null;
  sleepKind?: SleepKind | null;
  timeInBedMins?: number | null;
  subjectiveQuality?: number | null;
  notes?: string | null;
}

export interface HealthFileImportResult {
  format: string;
  sleepImported: number;
  sleepSkipped: number;
  physioImported: number;
  recoveryImported: number;
  warnings: string[];
  rowErrors: string[];
}

export interface HealthProviderError {
  code: string;
  message: string;
  retryAfterSecs: number | null;
  recoverable: boolean;
}

export interface StudyOverlayPoint {
  sessionId: string;
  startedAtMs: number;
  endedAtMs: number;
  reviewCount: number;
  meanResidual: number | null;
  activityKind: string;
  planIds: string[];
}

export interface SleepDaySummary {
  localDate: string;
  mainSleepId: string | null;
  mainSleepStartMs: number | null;
  mainSleepEndMs: number | null;
  mainSleepMins: number | null;
  napCount: number;
  totalNapMins: number;
  totalSleepAllEpisodesMins: number;
  timeInBedMins: number | null;
  efficiencyPct: number | null;
  wasoMins: number | null;
  awakeningsCount: number;
  stageCoverageRatio: number;
  awakePct: number | null;
  lightPct: number | null;
  deepPct: number | null;
  remPct: number | null;
  sleepOnsetLocalMins: number | null;
  wakeLocalMins: number | null;
  sleepMidpointLocalMins: number | null;
  overnightRmssdMs: number | null;
  overnightSdnnMs: number | null;
  restingHrBpm: number | null;
  recoveryScore: number | null;
  recoveryScaleMax: number | null;
  recoveryScoreName: string | null;
  hasSourceConflict: boolean;
  missingData: boolean;
}

export interface RollingSleepMetrics {
  windowDays: number;
  nightsTracked: number;
  missingNights: number;
  coverageRatio: number;
  meanTotalSleepMins: number | null;
  sdTotalSleepMins: number | null;
  meanTimeInBedMins: number | null;
  meanEfficiencyPct: number | null;
  meanWasoMins: number | null;
  circularBedtimeMeanMins: number | null;
  circularBedtimeSdMins: number | null;
  circularWakeMeanMins: number | null;
  circularWakeSdMins: number | null;
  circularMidpointMeanMins: number | null;
  socialJetlagMins: number | null;
  sriProxy: number | null;
  sriDayPairs: number;
  sriStatus: "available" | "insufficient_consecutive_days";
  totalNaps: number;
  meanOvernightRmssdMs: number | null;
  meanOvernightSdnnMs: number | null;
  meanRestingHrBpm: number | null;
}

export interface TimingHistogramBin {
  label: string;
  startMinute: number;
  endMinute: number;
  count: number;
}

export interface DurationHistogramBin {
  label: string;
  minHours: number;
  maxHours: number;
  count: number;
}

export interface BorbelyAlertnessPoint {
  timestampMs: number;
  localLabel: string;
  alertness: number;
  uncertaintyHalfWidth: number;
  processS: number;
  processC: number;
}

export interface BorbelyCurveSummary {
  isClinical: boolean;
  modelLabel: string;
  methodologyNote: string;
  inferredCircadianMidpointMins: number | null;
  estimatedNadirMins: number | null;
  scheduleSdMins: number | null;
  points: BorbelyAlertnessPoint[];
}

export interface SleepChartData {
  startMs: number;
  endMs: number;
  episodes: CanonicalSleepEpisode[];
  daySummaries: SleepDaySummary[];
  rolling7d: RollingSleepMetrics;
  rolling14d: RollingSleepMetrics;
  rolling30d: RollingSleepMetrics;
  rolling90d: RollingSleepMetrics;
  bedtimeDistribution: TimingHistogramBin[];
  wakeDistribution: TimingHistogramBin[];
  durationDistribution: DurationHistogramBin[];
  studyOverlays: StudyOverlayPoint[];
  alertnessCurve: BorbelyCurveSummary;
  warnings: string[];
}

export interface StatisticalGuardrails {
  minPairedReviews: number;
  minSessions: number;
  minDistinctDays: number;
  minAssessmentAttempts: number;
  minSleepSdHours: number;
  minCoverageRatio: number;
  minBucketSessions: number;
  minBucketReviews: number;
  fdrAlpha: number;
}

export interface DataSufficiencySummary {
  totalReviews: number;
  fsrsReplayReviews: number;
  pairedFsrsReviews: number;
  totalSessions: number;
  pairedSessions: number;
  distinctDays: number;
  sleepCoverageRatio: number;
  sleepDurationSdHours: number | null;
  finalizedAssessments: number;
  meetsCoreGuardrails: boolean;
  blockingReasons: string[];
}

export interface PerformanceBucketPoint {
  label: string;
  sessions: number;
  reviews: number;
  meanRawRecall: number | null;
  meanFsrsResidual: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  medianLatencySecs: number | null;
  meanLogLatency: number | null;
  sufficient: boolean;
}

export interface AssessmentModeBreakdown {
  mode: string;
  attempts: number;
  distinctDays: number;
  sleepPairedAttempts: number;
  meanScorePct: number | null;
  shortSleepMeanPct: number | null;
  adequateSleepMeanPct: number | null;
  pearsonRSleepDuration: number | null;
  pearsonRRegularity: number | null;
  pValue: number | null;
  sufficient: boolean;
  note: string;
}

export interface LearningWindowBucket {
  label: string;
  hourStart: number;
  hourEnd: number;
  sessions: number;
  reviews: number;
  meanFsrsResidual: number | null;
  medianLatencySecs: number | null;
  sufficient: boolean;
  isFavorableWindow: boolean;
}

export interface ModelComparisonRow {
  modelId: string;
  label: string;
  evaluated: boolean;
  heldOutRmse: number | null;
  skipReason: string | null;
}

export interface LearningWindowsAnalysis {
  validationStatus: string;
  trainSessions: number;
  testSessions: number;
  bestModelId: string | null;
  rmseBaselineM0: number | null;
  rmseBestModel: number | null;
  recommendedWindowLabel: string | null;
  explanation: string;
  windows: LearningWindowBucket[];
  models: ModelComparisonRow[];
}

export interface InsightEvidenceDetails {
  sampleReviews: number;
  sampleSessions: number;
  distinctDays: number;
  coverageRatio: number;
  effectSizeLabel: string;
  effectSize: number | null;
  partialR: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  pValue: number | null;
  qValue: number | null;
  confoundersControlled: string[];
  limitations: string[];
}

export interface PersonalInsight {
  id: string;
  metricKey: string;
  status: string;
  direction: string;
  title: string;
  summary: string;
  evidence: InsightEvidenceDetails;
}

export interface LearningInsightsReport {
  scopePlanId: string | null;
  isSyntheticDemo: boolean;
  guardrails: StatisticalGuardrails;
  sufficiency: DataSufficiencySummary;
  studyPlans: StudyPlanRef[];
  sleepDurationBuckets: PerformanceBucketPoint[];
  awakeDurationBuckets: PerformanceBucketPoint[];
  timeOfDayBuckets: PerformanceBucketPoint[];
  hrvRmssdBuckets: PerformanceBucketPoint[];
  hrvSdnnBuckets: PerformanceBucketPoint[];
  restingHrBuckets: PerformanceBucketPoint[];
  napComparison: NapComparisonResult;
  assessmentBreakdowns: AssessmentModeBreakdown[];
  learningWindows: LearningWindowsAnalysis;
  insights: PersonalInsight[];
}

export interface NapComparisonResult {
  napSessions: number;
  matchedPairs: number;
  meanNapResidual: number | null;
  meanNonNapResidual: number | null;
  residualDelta: number | null;
  hedgesG: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  pValue: number | null;
  sufficientMatches: boolean;
}

export interface StudyPlanRef {
  id: string;
  title: string;
  status: string;
}
