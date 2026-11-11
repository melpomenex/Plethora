/**
 * Knowledge Gap Suppression and Dismissal Evaluator.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §8.1
 * - openspec/changes/derive-study-gaps-from-exam-evidence/tasks.md (C6-T02)
 *
 * Requirements:
 * 1. Keyed by (conceptId, kind, ruleId).
 * 2. Compares evidence occurredAt against evidenceCutoff.
 * 3. A dismissed gap only resurfaces if materially new evidence occurred after the cutoff.
 */

import type {
  KnowledgeGapKind,
  LearningEvidence,
} from '../../../types/learningEvidence';

export interface GapSuppressionRecord {
  conceptId: string;
  kind: KnowledgeGapKind;
  ruleId: string;
  status: 'dismissed' | 'resolved';
  evidenceCutoff: string; // ISO 8601 timestamp at dismissal time
}

export function isGapSuppressed(
  conceptId: string,
  kind: KnowledgeGapKind,
  ruleId: string,
  evidence: LearningEvidence[],
  suppressionRecords: GapSuppressionRecord[]
): boolean {
  const match = suppressionRecords.find(
    (s) => s.conceptId === conceptId && s.kind === kind && s.ruleId === ruleId && s.status === 'dismissed'
  );

  if (!match) {
    return false;
  }

  const cutoffTime = new Date(match.evidenceCutoff).getTime();
  if (isNaN(cutoffTime)) {
    return false;
  }

  // Check if any material evidence for this concept occurred AFTER the cutoff
  const hasNewEvidenceAfterCutoff = evidence.some((e) => {
    if (e.conceptId !== conceptId) return false;
    const evTime = new Date(e.occurredAt).getTime();
    return evTime > cutoffTime;
  });

  // If no new evidence occurred after cutoff, gap remains suppressed
  return !hasNewEvidenceAfterCutoff;
}
