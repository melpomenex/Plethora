import type { HealthProviderInfo, LearningInsightsReport, RollingSleepMetrics, SleepChartData } from "../../../types/health";

const day = Date.UTC(2026, 10, 19);
const night = "2026-11-19";
const start = day - 3_600_000;
const end = day + 7 * 3_600_000;

export function sleepChartFixture(recorded = false, demo = false): SleepChartData {
  const rolling: RollingSleepMetrics = {
    windowDays: 30, nightsTracked: Number(recorded), missingNights: 30 - Number(recorded),
    coverageRatio: Number(recorded) / 30, meanTotalSleepMins: recorded ? 480 : null,
    sdTotalSleepMins: null, meanTimeInBedMins: null, meanEfficiencyPct: null, meanWasoMins: null,
    circularBedtimeMeanMins: null, circularBedtimeSdMins: null, circularWakeMeanMins: recorded ? 420 : null,
    circularWakeSdMins: null, circularMidpointMeanMins: null, socialJetlagMins: null, sriProxy: null,
    sriDayPairs: 0, sriStatus: "insufficient_consecutive_days", totalNaps: 0, meanOvernightRmssdMs: null,
    meanOvernightSdnnMs: null, meanRestingHrBpm: null,
  };
  return {
    startMs: start, endMs: end, rolling7d: rolling, rolling14d: rolling, rolling30d: rolling, rolling90d: rolling,
    bedtimeDistribution: [], wakeDistribution: [], durationDistribution: [], studyOverlays: [], warnings: [],
    alertnessCurve: { isClinical: false, modelLabel: "Two-process model", methodologyNote: "For reflection.",
      inferredCircadianMidpointMins: null, estimatedNadirMins: null, scheduleSdMins: null, points: [] },
    episodes: recorded ? [{
      id: "sample-night", primaryRawSessionId: "local-entry", primaryProviderId: demo ? "oura" : "manual",
      startAtMs: start, endAtMs: end, anchorLocalDate: night, startTzOffsetSecs: 0, endTzOffsetSecs: 0,
      sleepKind: "main_sleep", userSleepKindOverride: null, totalSleepMins: 480, timeInBedMins: 480,
      sleepEfficiencyPct: null, wasoMins: null, stageCoverageRatio: demo ? 1 : 0, awakeMins: null,
      lightMins: null, deepMins: null, remMins: null, hasSourceConflict: !demo,
      conflictDurationDiffMins: demo ? null : 42, qualityFlags: [], isSynthetic: demo,
      stages: demo ? [
        { id: "deep", rawSessionId: "local-entry", stageType: "deep", startAtMs: start, endAtMs: day, providerStageCode: null },
        { id: "light", rawSessionId: "local-entry", stageType: "light", startAtMs: day, endAtMs: day + 17_000_000, providerStageCode: null },
        { id: "rem", rawSessionId: "local-entry", stageType: "rem", startAtMs: day + 17_000_000, endAtMs: end, providerStageCode: null },
      ] : [], members: [{
        canonicalEpisodeId: "sample-night", rawSessionId: "local-entry", providerId: demo ? "oura" : "manual",
        sourceAppBundle: null, durationMins: 480, relationship: "primary", priorityRank: 0,
      }],
    }] : [],
    daySummaries: recorded ? [{
      localDate: night, mainSleepId: "sample-night", mainSleepStartMs: start, mainSleepEndMs: end, mainSleepMins: 480,
      napCount: 0, totalNapMins: 0, totalSleepAllEpisodesMins: 480, timeInBedMins: 480, efficiencyPct: null, wasoMins: null,
      awakeningsCount: 0, stageCoverageRatio: demo ? 1 : 0, awakePct: null, lightPct: null, deepPct: null, remPct: null,
      sleepOnsetLocalMins: 1380, wakeLocalMins: 420, sleepMidpointLocalMins: 180, overnightRmssdMs: null,
      overnightSdnnMs: null, restingHrBpm: null, recoveryScore: null, recoveryScaleMax: null, recoveryScoreName: null,
      hasSourceConflict: !demo, missingData: false,
    }] : [],
  };
}

export function learningReportFixture(planId: string | null = null): LearningInsightsReport {
  return {
    scopePlanId: planId, isSyntheticDemo: false,
    guardrails: {
      minPairedReviews: 60, minSessions: 12, minDistinctDays: 10, minAssessmentAttempts: 8,
      minSleepSdHours: 0.5, minCoverageRatio: 0.5, minBucketSessions: 5, minBucketReviews: 20, fdrAlpha: 0.05,
    },
    sufficiency: {
      totalReviews: 162, fsrsReplayReviews: 143, pairedFsrsReviews: 120, totalSessions: 36, pairedSessions: 25,
      distinctDays: 18, sleepCoverageRatio: 0.8, sleepDurationSdHours: 1.2,
      finalizedAssessments: 0, meetsCoreGuardrails: true, blockingReasons: [],
    },
    studyPlans: [{ id: "biology", title: "Biology", status: "active" }],
    sleepDurationBuckets: [{ label: "7–8 hours", sessions: 20, reviews: 89, meanRawRecall: 0.85,
      meanFsrsResidual: 0.03, ciLow: 0.01, ciHigh: 0.08, medianLatencySecs: 9, meanLogLatency: 2.22, sufficient: true }],
    awakeDurationBuckets: [], timeOfDayBuckets: [], hrvRmssdBuckets: [], hrvSdnnBuckets: [], restingHrBuckets: [],
    napComparison: { napSessions: 0, matchedPairs: 0, meanNapResidual: null, meanNonNapResidual: null,
      residualDelta: null, hedgesG: null, ciLow: null, ciHigh: null, pValue: null, sufficientMatches: false },
    assessmentBreakdowns: [],
    learningWindows: { validationStatus: "insufficient", trainSessions: 0, testSessions: 0, bestModelId: null,
      rmseBaselineM0: null, rmseBestModel: null, recommendedWindowLabel: null, explanation: "More study sessions are needed.",
      windows: [], models: [] },
    insights: [{
      id: "sleep-insight", metricKey: "sleep_duration", status: "supported", direction: "positive",
      title: planId ? "Biology recall and sleep" : "Recall and sleep duration",
      summary: "Longer sleep was associated with higher adjusted recall.",
      evidence: { sampleReviews: 120, sampleSessions: 25, distinctDays: 18, coverageRatio: 0.8,
        effectSizeLabel: "Adjusted effect", effectSize: 0.034, partialR: 0.2, ciLow: 0.01, ciHigh: 0.07,
        pValue: 0.01, qValue: 0.03, confoundersControlled: ["Item difficulty"], limitations: ["Observational data."] },
    }],
  };
}

export const healthConnectFixture: HealthProviderInfo = {
  id: "android_health_connect", category: "native_mobile", displayName: "Health Connect",
  supportedCategories: ["sleep", "sleep_stages", "heart_rate"], readinessState: "requires_user_authorization",
  readinessReason: "Available on this device.", implementationVersion: "1", requiresApproval: false,
  requiresCredentials: false, supportsBackfill: true, maxBackfillDays: 30, bridgedVia: [],
  documentationUrl: "", limitations: [],
};
