/**
 * Evidence Grouping and Base Weight Policy Engine (`evidence-v1`).
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §8.1
 * - openspec/changes/derive-study-gaps-from-exam-evidence/tasks.md (C6-T01)
 */

import type {
  LearningEvidence,
  GraderOrigin,
} from '../../../types/learningEvidence';

export interface EvidenceGroup {
  groupKey: string;
  conceptId: string;
  evidenceGroupId: string;
  utcDate: string; // YYYY-MM-DD
  members: LearningEvidence[];
  groupScore: number | null; // arithmetic mean of non-null observedScores
  groupWeight: number; // minimum conservative base weight among members
  latestOccurredAt: string;
  distinctFingerprints: Set<string>;
  hasMisconception: boolean;
  latestMisconception: string | null;
  hasDeterministicOrManual: boolean;
  hasHints: boolean;
  hasAi: boolean;
}

export function extractUtcDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '1970-01-01';
    return d.toISOString().slice(0, 10);
  } catch {
    return '1970-01-01';
  }
}

/**
 * Calculates member base weight according to policy §8.1:
 * - exam-final / diagnostic-final: 1.0
 * - practice without hints (hintLevel == 0): 0.75
 * - practice with hints (hintLevel > 0): 0.5
 * - Multiplier: deterministic/manual/user-review: 1.0, AI: 0.75
 */
export function calculateMemberBaseWeight(item: LearningEvidence): number {
  let kindBase = 1.0;
  if (item.sourceKind === 'practice-check') {
    kindBase = item.hintLevel > 0 ? 0.5 : 0.75;
  } else if (item.sourceKind === 'exam-final' || item.sourceKind === 'diagnostic-final') {
    kindBase = 1.0;
  } else {
    // Review-result or activity-only
    kindBase = 0.5;
  }

  const graderMultiplier = item.graderOrigin === 'ai' ? 0.75 : 1.0;
  return kindBase * graderMultiplier;
}

/**
 * Groups assessment evidence by (conceptId, evidenceGroupId, UTC date).
 */
export function groupLearningEvidence(evidence: LearningEvidence[]): EvidenceGroup[] {
  const groupsMap = new Map<string, EvidenceGroup>();

  for (const item of evidence) {
    // Only final assessment responses or review lapses
    const utcDate = extractUtcDate(item.occurredAt);
    const groupKey = `${item.conceptId}:${item.evidenceGroupId}:${utcDate}`;

    let grp = groupsMap.get(groupKey);
    if (!grp) {
      grp = {
        groupKey,
        conceptId: item.conceptId,
        evidenceGroupId: item.evidenceGroupId,
        utcDate,
        members: [],
        groupScore: null,
        groupWeight: 1.0,
        latestOccurredAt: item.occurredAt,
        distinctFingerprints: new Set<string>(),
        hasMisconception: false,
        latestMisconception: null,
        hasDeterministicOrManual: false,
        hasHints: false,
        hasAi: false,
      };
      groupsMap.set(groupKey, grp);
    }

    grp.members.push(item);
    if (item.questionFingerprint) {
      grp.distinctFingerprints.add(item.questionFingerprint);
    }
    if (item.outcome === 'misconception' || item.misconception) {
      grp.hasMisconception = true;
      grp.latestMisconception = item.misconception || 'Misconception identified';
    }
    if (item.graderOrigin === 'deterministic' || item.graderOrigin === 'manual') {
      grp.hasDeterministicOrManual = true;
    }
    if (item.hintLevel > 0) {
      grp.hasHints = true;
    }
    if (item.graderOrigin === 'ai') {
      grp.hasAi = true;
    }

    if (new Date(item.occurredAt).getTime() > new Date(grp.latestOccurredAt).getTime()) {
      grp.latestOccurredAt = item.occurredAt;
    }
  }

  // Compute aggregate score and conservative group weight
  const result: EvidenceGroup[] = [];
  for (const grp of groupsMap.values()) {
    const scoredMembers = grp.members.filter((m) => m.observedScore !== null);
    if (scoredMembers.length > 0) {
      const sum = scoredMembers.reduce((acc, m) => acc + (m.observedScore as number), 0);
      grp.groupScore = sum / scoredMembers.length;
    } else {
      grp.groupScore = null;
    }

    // groupWeight uses the most conservative (smallest) base weight among members
    const memberWeights = grp.members.map(calculateMemberBaseWeight);
    grp.groupWeight = memberWeights.length > 0 ? Math.min(...memberWeights) : 0.5;

    result.push(grp);
  }

  // Sort groups chronologically
  result.sort((a, b) => new Date(a.latestOccurredAt).getTime() - new Date(b.latestOccurredAt).getTime());

  return result;
}
