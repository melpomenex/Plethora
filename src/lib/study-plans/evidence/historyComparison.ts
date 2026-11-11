/**
 * Attempt History Comparison and Non-Calibrated Labeling Engine.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §8.1
 * - openspec/changes/derive-study-gaps-from-exam-evidence/tasks.md (C6-T02)
 *
 * Requirements:
 * 1. Historical comparison uses Final attempts only.
 * 2. Same blueprintRevisionId is labeled as "same paper" with explicit retake/memory effect warnings.
 * 3. Different papers show observed histories side by side without claiming equivalent difficulty.
 */

import type { ExamAttempt } from '../../../types/assessmentSessions';

export interface AttemptComparisonResult {
  samePaper: boolean;
  earlierAttemptId: string;
  laterAttemptId: string;
  earlierScore: number | null;
  laterScore: number | null;
  earlierMaxPoints: number;
  laterMaxPoints: number;
  scoreDelta: number | null;
  percentageDelta: number | null;
  comparisonLabel: string;
  warningNote?: string;
}

export const RETAKE_MEMORY_WARNING =
  'Retake performance — score change may reflect memory or familiarity effects rather than generalized mastery.';

export const CROSS_PAPER_DESCRIPTIVE_NOTE =
  'Cross-paper comparison — observed scores shown side by side without asserting equivalent test difficulty or calibrated growth.';

export function compareAttemptHistory(
  earlier: ExamAttempt,
  later: ExamAttempt
): AttemptComparisonResult {
  const samePaper = earlier.blueprintRevisionId === later.blueprintRevisionId;

  const earlierScore = earlier.awardedPoints;
  const laterScore = later.awardedPoints;
  const earlierMax = earlier.maximumPoints || 1;
  const laterMax = later.maximumPoints || 1;

  let scoreDelta: number | null = null;
  let percentageDelta: number | null = null;

  if (earlierScore !== null && laterScore !== null) {
    scoreDelta = Number((laterScore - earlierScore).toFixed(2));
    const earlierPct = (earlierScore / earlierMax) * 100;
    const laterPct = (laterScore / laterMax) * 100;
    percentageDelta = Number((laterPct - earlierPct).toFixed(1));
  }

  if (samePaper) {
    return {
      samePaper: true,
      earlierAttemptId: earlier.id,
      laterAttemptId: later.id,
      earlierScore,
      laterScore,
      earlierMaxPoints: earlier.maximumPoints,
      laterMaxPoints: later.maximumPoints,
      scoreDelta,
      percentageDelta,
      comparisonLabel: scoreDelta !== null && scoreDelta >= 0 ? `+${scoreDelta} pts (Retake)` : `${scoreDelta} pts (Retake)`,
      warningNote: RETAKE_MEMORY_WARNING,
    };
  }

  return {
    samePaper: false,
    earlierAttemptId: earlier.id,
    laterAttemptId: later.id,
    earlierScore,
    laterScore,
    earlierMaxPoints: earlier.maximumPoints,
    laterMaxPoints: later.maximumPoints,
    scoreDelta,
    percentageDelta,
    comparisonLabel: 'Distinct Examination Papers',
    warningNote: CROSS_PAPER_DESCRIPTIVE_NOTE,
  };
}
