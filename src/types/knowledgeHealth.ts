export interface RetentionBucket {
  range: string; // e.g. "90-100%", "70-89%", "50-69%", "<50%"
  itemCount: number;
  percentage: number;
}

export interface ConversionFunnelStats {
  readCount: number;
  extractCount: number;
  cardCount: number;
  retainedCount: number;
}

export interface AlgorithmCalibration {
  algorithm: 'fsrs' | 'sm20' | 'hlr';
  predictedRecall: number;
  actualRecall: number;
  sampleCount: number;
  brierScore: number;
}

export interface KnowledgeHealthSummary {
  overallRetentionEstimate: number; // 0.0 - 1.0
  retentionBuckets: RetentionBucket[];
  funnel: ConversionFunnelStats;
  unstableCardCount: number;
  calibrations: AlgorithmCalibration[];
  sampleSize: number;
  hasSufficientData: boolean;
  computedAt: string;
}

export function formatHealthConfidenceLabel(summary: KnowledgeHealthSummary): string {
  if (!summary.hasSufficientData || summary.sampleSize < 10) {
    return 'Insufficient Data (requires ≥10 reviews)';
  }
  if (summary.sampleSize < 50) {
    return 'Early Trend (moderate variance)';
  }
  return 'High Confidence';
}
