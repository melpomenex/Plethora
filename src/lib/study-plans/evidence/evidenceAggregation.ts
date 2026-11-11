/**
 * Deterministic Learning Evidence Aggregation Engine (`evidence-v1`).
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §8.1
 * - openspec/changes/derive-study-gaps-from-exam-evidence/tasks.md (C6-T01)
 *
 * Requirements:
 * 1. Final-only assessment evidence produces performance metrics.
 * 2. Group by (conceptId, evidenceGroupId, UTC date).
 * 3. Base weights: exam/diagnostic 1.0, practice 0.75 (no hints) / 0.5 (with hints), AI multiplier 0.75.
 * 4. Recency multiplier: 0.5^(ageDays/90).
 * 5. Subsequent same-fingerprint group multiplier: 0.25.
 * 6. Ordered state policy: insufficient -> needs-attention -> demonstrated-consistently -> developing.
 * 7. Injected now UTC parameter for deterministic calculation without global clock reliance.
 */

import type {
  LearningEvidence,
  ConceptMasterySummary,
  MasteryEvidenceLevel,
} from '../../../types/learningEvidence';
import {
  groupLearningEvidence,
  type EvidenceGroup,
} from './evidenceGrouping';
import { deriveUncertaintyReasons } from './uncertainty';

export interface AggregateOptions {
  now?: string | number | Date;
}

export function aggregateConceptEvidence(
  conceptId: string,
  evidence: LearningEvidence[],
  options: AggregateOptions = {}
): ConceptMasterySummary {
  const nowTimestamp = options.now
    ? new Date(options.now).getTime()
    : Date.now();

  // Filter evidence to this concept
  const conceptEvidence = evidence.filter((e) => e.conceptId === conceptId);

  if (conceptEvidence.length === 0) {
    return {
      conceptId,
      level: 'insufficient-evidence',
      observedMean: null,
      evidenceWeight: 0,
      independentSessions: 0,
      distinctDays: 0,
      minimumObserved: null,
      maximumObserved: null,
      latestEvidenceAt: null,
      uncertainty: ['no-assessment'],
      evidenceIds: [],
      policyVersion: 'evidence-v1',
    };
  }

  // 1. Group evidence into chronological groups
  const groups = groupLearningEvidence(conceptEvidence);

  // 2. Track repeat fingerprints across groups
  const seenFingerprints = new Set<string>();
  let hadRepeatPenalty = false;

  let totalWeightedScore = 0;
  let totalWeight = 0;

  // Process groups chronologically
  const scoredGroups: { group: EvidenceGroup; score: number; effectiveWeight: number }[] = [];

  for (const grp of groups) {
    // Check if any fingerprint was seen in an earlier distinct group
    let hasRepeatedFingerprint = false;
    for (const fp of grp.distinctFingerprints) {
      if (seenFingerprints.has(fp)) {
        hasRepeatedFingerprint = true;
        break;
      }
    }

    const repeatMultiplier = hasRepeatedFingerprint ? 0.25 : 1.0;
    if (hasRepeatedFingerprint) {
      hadRepeatPenalty = true;
    }

    // Add current fingerprints to seen set
    for (const fp of grp.distinctFingerprints) {
      seenFingerprints.add(fp);
    }

    // Calculate recency multiplier: 0.5 ^ (ageDays / 90)
    const grpTime = new Date(grp.latestOccurredAt).getTime();
    const ageDays = Math.max(0, Math.floor((nowTimestamp - grpTime) / (24 * 3600 * 1000)));
    const recencyMultiplier = Math.pow(0.5, ageDays / 90);

    const effectiveWeight = grp.groupWeight * recencyMultiplier * repeatMultiplier;

    if (grp.groupScore !== null) {
      totalWeightedScore += grp.groupScore * effectiveWeight;
      totalWeight += effectiveWeight;
      scoredGroups.push({ group: grp, score: grp.groupScore, effectiveWeight });
    }
  }

  const observedMean = totalWeight > 0 ? totalWeightedScore / totalWeight : null;
  const evidenceWeight = totalWeight;

  // 3. Aggregate metrics across evidence items
  const sessionIds = new Set(conceptEvidence.map((e) => e.evidenceGroupId));
  const distinctDays = new Set(groups.map((g) => g.utcDate)).size;
  const independentSessions = sessionIds.size;

  const scoredItems = conceptEvidence.filter((e) => e.observedScore !== null);
  const minimumObserved =
    scoredItems.length > 0
      ? Math.min(...scoredItems.map((e) => e.observedScore as number))
      : null;
  const maximumObserved =
    scoredItems.length > 0
      ? Math.max(...scoredItems.map((e) => e.observedScore as number))
      : null;

  // Latest evidence timestamp
  let latestEvidenceAt: string | null = null;
  for (const item of conceptEvidence) {
    if (!latestEvidenceAt || new Date(item.occurredAt).getTime() > new Date(latestEvidenceAt).getTime()) {
      latestEvidenceAt = item.occurredAt;
    }
  }

  // 4. Misconception Resolution Evaluation:
  // "Latest misconception is unresolved until a later independent group's mean >= 0.8 without a new misconception."
  let hasUnresolvedMisconception = false;
  let lastMisconceptionGroupIdx = -1;

  for (let i = 0; i < scoredGroups.length; i++) {
    if (scoredGroups[i].group.hasMisconception) {
      lastMisconceptionGroupIdx = i;
    }
  }

  if (lastMisconceptionGroupIdx !== -1) {
    // Check subsequent groups
    let subsequentSuccess = false;
    for (let i = lastMisconceptionGroupIdx + 1; i < scoredGroups.length; i++) {
      const g = scoredGroups[i];
      if (g.group.hasMisconception) {
        subsequentSuccess = false;
        break;
      }
      if (g.score >= 0.8) {
        subsequentSuccess = true;
      }
    }
    hasUnresolvedMisconception = !subsequentSuccess;
  }

  // 5. Ordered State Classification
  let level: MasteryEvidenceLevel = 'developing';

  // Rule 1: insufficient-evidence if no scored assessment, all-blank, or < 2 independent sessions
  if (scoredItems.length === 0 || independentSessions < 2 || observedMean === null) {
    level = 'insufficient-evidence';
  } else {
    // Rule 2: needs-attention
    // if independentSessions >= 2 and either:
    // - latest two independent groups both score < 0.6
    // - an unresolved latest misconception exists
    // - observedMean < 0.6
    let latestTwoGroupsUnder06 = false;
    if (scoredGroups.length >= 2) {
      const g1 = scoredGroups[scoredGroups.length - 1];
      const g2 = scoredGroups[scoredGroups.length - 2];
      if (g1.score < 0.6 && g2.score < 0.6) {
        latestTwoGroupsUnder06 = true;
      }
    }

    if (latestTwoGroupsUnder06 || hasUnresolvedMisconception || observedMean < 0.6) {
      level = 'needs-attention';
    } else {
      // Rule 3: demonstrated-consistently requires:
      // - >= 3 independent sessions
      // - >= 2 distinct UTC days
      // - >= 3 distinct question fingerprints
      // - each of the latest three independent groups >= 0.8
      // - no unresolved latest misconception
      // - at least one deterministic or manual group
      const distinctFingerprintsCount = seenFingerprints.size;
      const hasDeterministicOrManualGroup = scoredGroups.some(
        (sg) => sg.group.hasDeterministicOrManual
      );

      let latestThreeGroupsAtLeast08 = false;
      if (scoredGroups.length >= 3) {
        const last3 = scoredGroups.slice(-3);
        latestThreeGroupsAtLeast08 = last3.every((sg) => sg.score >= 0.8);
      }

      if (
        independentSessions >= 3 &&
        distinctDays >= 2 &&
        distinctFingerprintsCount >= 3 &&
        latestThreeGroupsAtLeast08 &&
        !hasUnresolvedMisconception &&
        hasDeterministicOrManualGroup
      ) {
        level = 'demonstrated-consistently';
      } else {
        // Rule 4: otherwise developing
        level = 'developing';
      }
    }
  }

  // 6. Uncertainty Reasons
  const uncertainty = deriveUncertaintyReasons({
    evidence: conceptEvidence,
    independentSessions,
    minimumObserved,
    maximumObserved,
    latestEvidenceAt,
    hadRepeatPenalty,
    nowTimestamp,
  });

  return {
    conceptId,
    level,
    observedMean: observedMean !== null ? Number(observedMean.toFixed(4)) : null,
    evidenceWeight: Number(evidenceWeight.toFixed(4)),
    independentSessions,
    distinctDays,
    minimumObserved,
    maximumObserved,
    latestEvidenceAt,
    uncertainty,
    evidenceIds: conceptEvidence.map((e) => e.id),
    policyVersion: 'evidence-v1',
  };
}
