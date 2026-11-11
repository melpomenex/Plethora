/**
 * Seven Named Knowledge Gap Rules Engine.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §8.1
 * - openspec/changes/derive-study-gaps-from-exam-evidence/tasks.md (C6-T02)
 */

import type {
  LearningEvidence,
  ConceptMasterySummary,
  KnowledgeGapView,
  KnowledgeGapKind,
  GapEvidenceRecord,
} from '../../../types/learningEvidence';
import { groupLearningEvidence, type EvidenceGroup } from './evidenceGrouping';
import { isGapSuppressed, type GapSuppressionRecord } from './gapSuppression';

export interface PlanPrerequisiteRelation {
  dependentNodeId: string;
  prerequisiteNodeId: string;
  dependentConceptId: string;
  prerequisiteConceptId: string;
}

export interface EvaluateGapRulesInput {
  conceptId: string;
  conceptName: string;
  planId?: string | null;
  nodeId?: string | null;
  evidence: LearningEvidence[];
  summary: ConceptMasterySummary;
  suppressions?: GapSuppressionRecord[];
  relations?: PlanPrerequisiteRelation[];
  conceptSummariesMap?: Map<string, ConceptMasterySummary>;
  isMaterialMissing?: boolean;
  isDisconnectedCluster?: boolean;
  hasUnreviewedOldReading?: boolean;
  now?: string | number | Date;
}

export function evaluateKnowledgeGapRules(input: EvaluateGapRulesInput): KnowledgeGapView[] {
  const {
    conceptId,
    conceptName,
    planId = null,
    nodeId = null,
    evidence,
    summary,
    suppressions = [],
    relations = [],
    conceptSummariesMap = new Map(),
    isMaterialMissing = false,
    isDisconnectedCluster = false,
    hasUnreviewedOldReading = false,
    now = new Date(),
  } = input;

  const nowIso = new Date(now).toISOString();
  const conceptEvidence = evidence.filter((e) => e.conceptId === conceptId);
  const groups = groupLearningEvidence(conceptEvidence);
  const scoredGroups = groups.filter((g) => g.groupScore !== null);

  const gaps: KnowledgeGapView[] = [];

  // Helper to build GapEvidenceRecords from items
  const buildEvidenceRecords = (items: LearningEvidence[], descPrefix: string): GapEvidenceRecord[] => {
    return items.map((item) => ({
      recordId: `ger-${item.id}`,
      kind: item.outcome === 'review-lapse' ? 'review_lapse' : 'assessment',
      description: `${descPrefix}: outcome "${item.outcome}", score ${item.observedScore !== null ? item.observedScore : '\u2014'} (${item.occurredAt})`,
      learningEvidenceId: item.id,
      sourceRefId: null,
      payload: {
        sourceKind: item.sourceKind,
        observedScore: item.observedScore,
        outcome: item.outcome,
        graderOrigin: item.graderOrigin,
        hintLevel: item.hintLevel,
      },
    }));
  };

  // --------------------------------------------------------------------------
  // Rule 1: assessment-repeated-failure-v1
  // Trigger: latest two independent assessment groups both score < 0.6.
  // Resolution: latest two independent groups >= 0.8 and no unresolved misconception.
  // Invariant: A single wrong answer never creates Repeated Failure.
  // --------------------------------------------------------------------------
  const ruleIdAssessmentFailure = 'assessment-repeated-failure-v1';
  if (scoredGroups.length >= 2) {
    const last1 = scoredGroups[scoredGroups.length - 1];
    const last2 = scoredGroups[scoredGroups.length - 2];

    const isTriggered = (last1.groupScore as number) < 0.6 && (last2.groupScore as number) < 0.6;
    const isResolved = (last1.groupScore as number) >= 0.8 && (last2.groupScore as number) >= 0.8 && !summary.uncertainty.includes('few-independent-sessions');

    if (isTriggered && !isResolved) {
      if (!isGapSuppressed(conceptId, 'repeatedly_failed', ruleIdAssessmentFailure, conceptEvidence, suppressions)) {
        const contributing = [...last2.members, ...last1.members];
        gaps.push({
          id: `gap-${conceptId}-repeated-failure`,
          kind: 'repeatedly_failed',
          conceptId,
          conceptName,
          planId,
          nodeId,
          ruleId: ruleIdAssessmentFailure,
          status: 'active',
          evidence: buildEvidenceRecords(contributing, 'Assessment group failure'),
          demonstrated: summary,
          firstDetectedAt: last2.latestOccurredAt,
          lastDetectedAt: last1.latestOccurredAt,
          evidenceCutoff: last1.latestOccurredAt,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Rule 2: review-lapse-v1
  // Trigger: >= 2 review-lapse events on separate sessions for confirmed concept.
  // --------------------------------------------------------------------------
  const ruleIdReviewLapse = 'review-lapse-v1';
  const reviewLapseItems = conceptEvidence.filter((e) => e.outcome === 'review-lapse');
  const distinctLapseSessions = new Set(reviewLapseItems.map((e) => e.evidenceGroupId));

  if (distinctLapseSessions.size >= 2) {
    if (!isGapSuppressed(conceptId, 'repeatedly_failed', ruleIdReviewLapse, conceptEvidence, suppressions)) {
      gaps.push({
        id: `gap-${conceptId}-review-lapse`,
        kind: 'repeatedly_failed',
        conceptId,
        conceptName,
        planId,
        nodeId,
        ruleId: ruleIdReviewLapse,
        status: 'active',
        evidence: buildEvidenceRecords(reviewLapseItems, 'Spaced review lapse (Again rating)'),
        demonstrated: summary,
        firstDetectedAt: reviewLapseItems[0].occurredAt,
        lastDetectedAt: reviewLapseItems[reviewLapseItems.length - 1].occurredAt,
        evidenceCutoff: reviewLapseItems[reviewLapseItems.length - 1].occurredAt,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Rule 3: weak-prerequisite-v1:<dependentNodeId>
  // Trigger: active dependent node has needs-attention AND prerequisite has
  //          needs-attention OR insufficient-evidence.
  // Distinct rule identity per dependent node.
  // --------------------------------------------------------------------------
  for (const rel of relations) {
    if (rel.dependentConceptId === conceptId) {
      // Current concept is the dependent
      const prereqSummary = conceptSummariesMap.get(rel.prerequisiteConceptId);
      const isDependentStruggling = summary.level === 'needs-attention' || (summary.observedMean !== null && summary.observedMean < 0.6);
      const isPrereqWeakOrInsufficient = prereqSummary && (prereqSummary.level === 'needs-attention' || prereqSummary.level === 'insufficient-evidence');

      if (isDependentStruggling && isPrereqWeakOrInsufficient) {
        const ruleIdPrereq = `weak-prerequisite-v1:${rel.dependentNodeId}`;
        if (!isGapSuppressed(conceptId, 'weak_prerequisite', ruleIdPrereq, conceptEvidence, suppressions)) {
          const isInsuff = prereqSummary.level === 'insufficient-evidence';
          const description = isInsuff
            ? `Prerequisite concept lacks sufficient evidence; check prerequisite mastery before advancing.`
            : `Prerequisite concept demonstrated active weaknesses (needs-attention).`;

          gaps.push({
            id: `gap-${conceptId}-prereq-${rel.prerequisiteConceptId}`,
            kind: 'weak_prerequisite',
            conceptId,
            conceptName,
            planId,
            nodeId: rel.dependentNodeId,
            ruleId: ruleIdPrereq,
            status: 'active',
            evidence: [
              {
                recordId: `ger-prereq-${rel.prerequisiteConceptId}`,
                kind: 'graph_edge',
                description,
                learningEvidenceId: null,
                sourceRefId: null,
                payload: {
                  prerequisiteConceptId: rel.prerequisiteConceptId,
                  prerequisiteLevel: prereqSummary.level,
                  dependentConceptId: conceptId,
                  dependentLevel: summary.level,
                },
              },
            ],
            demonstrated: summary,
            firstDetectedAt: summary.latestEvidenceAt || nowIso,
            lastDetectedAt: summary.latestEvidenceAt || nowIso,
            evidenceCutoff: summary.latestEvidenceAt || nowIso,
          });
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Rule 4: missing-material-v1
  // Trigger: Plan unsupported material / not covered by sources.
  // Invariant: Never inferred from wrong answers!
  // --------------------------------------------------------------------------
  const ruleIdMissing = 'missing-material-v1';
  if (isMaterialMissing) {
    if (!isGapSuppressed(conceptId, 'missing_concept', ruleIdMissing, conceptEvidence, suppressions)) {
      gaps.push({
        id: `gap-${conceptId}-missing-material`,
        kind: 'missing_concept',
        conceptId,
        conceptName,
        planId,
        nodeId,
        ruleId: ruleIdMissing,
        status: 'active',
        evidence: [
          {
            recordId: `ger-missing-${conceptId}`,
            kind: 'unreviewed_reading',
            description: `Curriculum coverage indicates required concept "${conceptName}" is not covered by selected library sources.`,
            learningEvidenceId: null,
            sourceRefId: null,
            payload: { coverageStatus: 'not-covered' },
          },
        ],
        demonstrated: summary,
        firstDetectedAt: nowIso,
        lastDetectedAt: nowIso,
        evidenceCutoff: nowIso,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Rule 5: weak-transfer-v1
  // Trigger: recall/comprehension group mean >= 0.75 across >= 2 groups AND
  //          application/multi-step group mean < 0.6 across >= 2 groups.
  // --------------------------------------------------------------------------
  const ruleIdTransfer = 'weak-transfer-v1';
  // Categorize scored items by application level / difficulty
  // difficulty 1-2 = recall/comprehension, difficulty 3-5 = application/multi-step
  const recallItems = conceptEvidence.filter((e) => typeof e.difficulty === 'number' && e.difficulty <= 2 && e.observedScore !== null);
  const appItems = conceptEvidence.filter((e) => typeof e.difficulty === 'number' && e.difficulty >= 3 && e.observedScore !== null);

  const recallGroups = groupLearningEvidence(recallItems).filter((g) => g.groupScore !== null);
  const appGroups = groupLearningEvidence(appItems).filter((g) => g.groupScore !== null);

  if (recallGroups.length >= 2 && appGroups.length >= 2) {
    const recallMean = recallGroups.reduce((acc, g) => acc + (g.groupScore as number), 0) / recallGroups.length;
    const appMean = appGroups.reduce((acc, g) => acc + (g.groupScore as number), 0) / appGroups.length;

    if (recallMean >= 0.75 && appMean < 0.6) {
      if (!isGapSuppressed(conceptId, 'weak_transfer', ruleIdTransfer, conceptEvidence, suppressions)) {
        gaps.push({
          id: `gap-${conceptId}-weak-transfer`,
          kind: 'weak_transfer',
          conceptId,
          conceptName,
          planId,
          nodeId,
          ruleId: ruleIdTransfer,
          status: 'active',
          evidence: [
            ...buildEvidenceRecords(recallItems, 'Recall / foundational success'),
            ...buildEvidenceRecords(appItems, 'Application / problem-solving difficulty'),
          ],
          demonstrated: summary,
          firstDetectedAt: appGroups[0].latestOccurredAt,
          lastDetectedAt: appGroups[appGroups.length - 1].latestOccurredAt,
          evidenceCutoff: appGroups[appGroups.length - 1].latestOccurredAt,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Rule 6: read-never-reviewed-v1
  // Trigger: Document reading >= 30 days old without review activity.
  // --------------------------------------------------------------------------
  const ruleIdReadNoReview = 'read-never-reviewed-v1';
  if (hasUnreviewedOldReading) {
    if (!isGapSuppressed(conceptId, 'read_never_reviewed', ruleIdReadNoReview, conceptEvidence, suppressions)) {
      gaps.push({
        id: `gap-${conceptId}-read-never-reviewed`,
        kind: 'read_never_reviewed',
        conceptId,
        conceptName,
        planId,
        nodeId,
        ruleId: ruleIdReadNoReview,
        status: 'active',
        evidence: [
          {
            recordId: `ger-read-${conceptId}`,
            kind: 'unreviewed_reading',
            description: `Full reading completed over 30 days ago with zero subsequent active recall or review questions.`,
            learningEvidenceId: null,
            sourceRefId: null,
            payload: { readAgeDays: 30 },
          },
        ],
        demonstrated: summary,
        firstDetectedAt: nowIso,
        lastDetectedAt: nowIso,
        evidenceCutoff: nowIso,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Rule 7: disconnected-cluster-v1
  // Trigger: Confirmed concept in graph with no confirmed links to other components.
  // --------------------------------------------------------------------------
  const ruleIdDisconnected = 'disconnected-cluster-v1';
  if (isDisconnectedCluster) {
    if (!isGapSuppressed(conceptId, 'disconnected_cluster', ruleIdDisconnected, conceptEvidence, suppressions)) {
      gaps.push({
        id: `gap-${conceptId}-disconnected`,
        kind: 'disconnected_cluster',
        conceptId,
        conceptName,
        planId,
        nodeId,
        ruleId: ruleIdDisconnected,
        status: 'active',
        evidence: [
          {
            recordId: `ger-disconnected-${conceptId}`,
            kind: 'graph_edge',
            description: `Concept cluster has library relevance but lacks confirmed structural graph links to related study concepts.`,
            learningEvidenceId: null,
            sourceRefId: null,
            payload: { clusterState: 'isolated' },
          },
        ],
        demonstrated: summary,
        firstDetectedAt: nowIso,
        lastDetectedAt: nowIso,
        evidenceCutoff: nowIso,
      });
    }
  }

  return gaps;
}
