import { describe, it, expect } from 'vitest';
import { evaluateKnowledgeGapRules } from '../gapRules';
import { isGapSuppressed } from '../gapSuppression';
import { compareAttemptHistory, RETAKE_MEMORY_WARNING, CROSS_PAPER_DESCRIPTIVE_NOTE } from '../historyComparison';
import { planRemediationForGap } from '../remediationPlanner';
import { aggregateConceptEvidence } from '../evidenceAggregation';
import type { LearningEvidence } from '../../../../types/learningEvidence';
import type { ExamAttempt } from '../../../../types/assessmentSessions';

describe('Knowledge Gap Rules & Historical Comparison (C6-T02)', () => {
  const FIXED_NOW = '2026-11-10T12:00:00Z';

  const makeEvidence = (overrides: Partial<LearningEvidence>): LearningEvidence => ({
    id: `ev-${Math.random().toString(36).slice(2, 8)}`,
    conceptId: 'concept-calvin-cycle',
    conceptLabel: 'Calvin-Benson Cycle',
    planId: 'plan-bio',
    nodeId: 'node-calvin',
    sourceKind: 'exam-final',
    sourceId: 'sub-1',
    gradeId: 'grd-1',
    evidenceGroupId: 'att-1:concept-calvin-cycle',
    questionFingerprint: 'fp-1',
    observedScore: 1.0,
    outcome: 'correct',
    misconception: null,
    learnerConfidence: 0.8,
    hintLevel: 0,
    graderOrigin: 'deterministic',
    occurredAt: '2026-11-10T10:00:00Z',
    policyVersion: 'evidence-v1',
    ...overrides,
  });

  const baseSummary = (evidence: LearningEvidence[]) =>
    aggregateConceptEvidence('concept-calvin-cycle', evidence, { now: FIXED_NOW });

  describe('Rule 1: assessment-repeated-failure-v1', () => {
    it('does NOT trigger repeated failure on a single wrong answer', () => {
      const ev1Wrong = makeEvidence({
        evidenceGroupId: 'att-1',
        observedScore: 0.0,
        outcome: 'incorrect',
      });

      const summary = baseSummary([ev1Wrong]);
      const gaps = evaluateKnowledgeGapRules({
        conceptId: 'concept-calvin-cycle',
        conceptName: 'Calvin-Benson Cycle',
        evidence: [ev1Wrong],
        summary,
        now: FIXED_NOW,
      });

      expect(gaps.filter((g) => g.ruleId === 'assessment-repeated-failure-v1')).toHaveLength(0);
    });

    it('triggers repeated failure when latest two independent assessment groups both score < 0.6', () => {
      const ev1 = makeEvidence({
        evidenceGroupId: 'att-1',
        observedScore: 0.4,
        occurredAt: '2026-11-08T10:00:00Z',
      });
      const ev2 = makeEvidence({
        evidenceGroupId: 'att-2',
        observedScore: 0.3,
        occurredAt: '2026-11-09T10:00:00Z',
      });

      const summary = baseSummary([ev1, ev2]);
      const gaps = evaluateKnowledgeGapRules({
        conceptId: 'concept-calvin-cycle',
        conceptName: 'Calvin-Benson Cycle',
        evidence: [ev1, ev2],
        summary,
        now: FIXED_NOW,
      });

      const failureGap = gaps.find((g) => g.ruleId === 'assessment-repeated-failure-v1');
      expect(failureGap).toBeDefined();
      expect(failureGap?.kind).toBe('repeatedly_failed');
      expect(failureGap?.evidence.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Rule 2: review-lapse-v1', () => {
    it('triggers review lapse gap when 2 or more Again ratings occur on separate review sessions', () => {
      const evLapse1 = makeEvidence({
        sourceKind: 'review-result',
        evidenceGroupId: 'rev-session-1',
        observedScore: null,
        outcome: 'review-lapse',
        graderOrigin: 'user-review',
        occurredAt: '2026-11-05T10:00:00Z',
      });
      const evLapse2 = makeEvidence({
        sourceKind: 'review-result',
        evidenceGroupId: 'rev-session-2',
        observedScore: null,
        outcome: 'review-lapse',
        graderOrigin: 'user-review',
        occurredAt: '2026-11-07T10:00:00Z',
      });

      const summary = baseSummary([evLapse1, evLapse2]);
      const gaps = evaluateKnowledgeGapRules({
        conceptId: 'concept-calvin-cycle',
        conceptName: 'Calvin-Benson Cycle',
        evidence: [evLapse1, evLapse2],
        summary,
        now: FIXED_NOW,
      });

      const lapseGap = gaps.find((g) => g.ruleId === 'review-lapse-v1');
      expect(lapseGap).toBeDefined();
      expect(lapseGap?.kind).toBe('repeatedly_failed');
    });
  });

  describe('Rule 3: weak-prerequisite-v1:<dependentNodeId>', () => {
    it('triggers weak-prerequisite gap with distinct rule identity per dependent node and appropriate wording', () => {
      const dependentEvidence = [
        makeEvidence({ evidenceGroupId: 'att-1', observedScore: 0.4 }),
        makeEvidence({ evidenceGroupId: 'att-2', observedScore: 0.5 }),
      ];
      const dependentSummary = aggregateConceptEvidence('concept-calvin-cycle', dependentEvidence, { now: FIXED_NOW });

      // Prerequisite has insufficient evidence
      const prereqSummary = aggregateConceptEvidence('concept-light-rxn', [], { now: FIXED_NOW });
      const summariesMap = new Map([
        ['concept-calvin-cycle', dependentSummary],
        ['concept-light-rxn', prereqSummary],
      ]);

      const gaps = evaluateKnowledgeGapRules({
        conceptId: 'concept-calvin-cycle',
        conceptName: 'Calvin-Benson Cycle',
        evidence: dependentEvidence,
        summary: dependentSummary,
        relations: [
          {
            dependentNodeId: 'node-calvin',
            prerequisiteNodeId: 'node-light-rxn',
            dependentConceptId: 'concept-calvin-cycle',
            prerequisiteConceptId: 'concept-light-rxn',
          },
        ],
        conceptSummariesMap: summariesMap,
        now: FIXED_NOW,
      });

      const prereqGap = gaps.find((g) => g.kind === 'weak_prerequisite');
      expect(prereqGap).toBeDefined();
      expect(prereqGap?.ruleId).toBe('weak-prerequisite-v1:node-calvin');
      expect(prereqGap?.evidence[0].description).toContain('lacks sufficient evidence; check prerequisite');
    });
  });

  describe('Rule 4: missing-material-v1', () => {
    it('identifies missing material from coverage analysis without diagnosing learner ignorance', () => {
      const summary = baseSummary([]);
      const gaps = evaluateKnowledgeGapRules({
        conceptId: 'concept-calvin-cycle',
        conceptName: 'Calvin-Benson Cycle',
        evidence: [],
        summary,
        isMaterialMissing: true,
        now: FIXED_NOW,
      });

      const missingGap = gaps.find((g) => g.ruleId === 'missing-material-v1');
      expect(missingGap).toBeDefined();
      expect(missingGap?.kind).toBe('missing_concept');
      expect(missingGap?.evidence[0].description).toContain('not covered by selected library sources');
    });
  });

  describe('Rule 5: weak-transfer-v1', () => {
    it('triggers weak-transfer only when recall mean >= 0.75 (>= 2 groups) and application mean < 0.6 (>= 2 groups)', () => {
      // 2 recall groups (difficulty 1-2) with high scores
      const rec1 = makeEvidence({ evidenceGroupId: 'att-1', difficulty: 1, observedScore: 0.9, occurredAt: '2026-11-06T10:00:00Z' });
      const rec2 = makeEvidence({ evidenceGroupId: 'att-2', difficulty: 2, observedScore: 0.85, occurredAt: '2026-11-07T10:00:00Z' });

      // 2 application groups (difficulty 3-5) with low scores
      const app1 = makeEvidence({ evidenceGroupId: 'att-3', difficulty: 4, observedScore: 0.4, occurredAt: '2026-11-08T10:00:00Z' });
      const app2 = makeEvidence({ evidenceGroupId: 'att-4', difficulty: 5, observedScore: 0.5, occurredAt: '2026-11-09T10:00:00Z' });

      const allEv = [rec1, rec2, app1, app2];
      const summary = baseSummary(allEv);

      const gaps = evaluateKnowledgeGapRules({
        conceptId: 'concept-calvin-cycle',
        conceptName: 'Calvin-Benson Cycle',
        evidence: allEv,
        summary,
        now: FIXED_NOW,
      });

      const transferGap = gaps.find((g) => g.ruleId === 'weak-transfer-v1');
      expect(transferGap).toBeDefined();
      expect(transferGap?.kind).toBe('weak_transfer');
    });

    it('does NOT trigger weak-transfer if insufficient groups exist in either category', () => {
      // Only 1 recall group
      const rec1 = makeEvidence({ evidenceGroupId: 'att-1', difficulty: 1, observedScore: 0.9 });
      const app1 = makeEvidence({ evidenceGroupId: 'att-2', difficulty: 4, observedScore: 0.4 });
      const app2 = makeEvidence({ evidenceGroupId: 'att-3', difficulty: 5, observedScore: 0.5 });

      const allEv = [rec1, app1, app2];
      const summary = baseSummary(allEv);

      const gaps = evaluateKnowledgeGapRules({
        conceptId: 'concept-calvin-cycle',
        conceptName: 'Calvin-Benson Cycle',
        evidence: allEv,
        summary,
        now: FIXED_NOW,
      });

      expect(gaps.filter((g) => g.ruleId === 'weak-transfer-v1')).toHaveLength(0);
    });
  });

  describe('Rule 6 & 7: Structural and Read-Only Gaps', () => {
    it('detects unreviewed old reading without creating assessment deficits', () => {
      const summary = baseSummary([]);
      const gaps = evaluateKnowledgeGapRules({
        conceptId: 'concept-calvin-cycle',
        conceptName: 'Calvin-Benson Cycle',
        evidence: [],
        summary,
        hasUnreviewedOldReading: true,
        now: FIXED_NOW,
      });

      const readGap = gaps.find((g) => g.ruleId === 'read-never-reviewed-v1');
      expect(readGap).toBeDefined();
      expect(readGap?.kind).toBe('read_never_reviewed');
    });

    it('labels disconnected graph cluster as library structural issue rather than learner deficit', () => {
      const summary = baseSummary([]);
      const gaps = evaluateKnowledgeGapRules({
        conceptId: 'concept-calvin-cycle',
        conceptName: 'Calvin-Benson Cycle',
        evidence: [],
        summary,
        isDisconnectedCluster: true,
        now: FIXED_NOW,
      });

      const clusterGap = gaps.find((g) => g.ruleId === 'disconnected-cluster-v1');
      expect(clusterGap).toBeDefined();
      expect(clusterGap?.kind).toBe('disconnected_cluster');
      expect(clusterGap?.evidence[0].description).toContain('structural graph links');
    });
  });

  describe('Gap Suppression Policy', () => {
    it('suppresses dismissed gap until new material evidence occurs after evidenceCutoff', () => {
      const cutoff = '2026-11-09T12:00:00Z';
      const oldEvidence = [
        makeEvidence({ occurredAt: '2026-11-08T10:00:00Z' }),
        makeEvidence({ occurredAt: '2026-11-09T10:00:00Z' }),
      ];

      const isSuppressedBeforeNew = isGapSuppressed(
        'concept-calvin-cycle',
        'repeatedly_failed',
        'assessment-repeated-failure-v1',
        oldEvidence,
        [{ conceptId: 'concept-calvin-cycle', kind: 'repeatedly_failed', ruleId: 'assessment-repeated-failure-v1', status: 'dismissed', evidenceCutoff: cutoff }]
      );
      expect(isSuppressedBeforeNew).toBe(true);

      // Now add new evidence that occurred after cutoff
      const newEvidence = [
        ...oldEvidence,
        makeEvidence({ occurredAt: '2026-11-10T10:00:00Z' }),
      ];

      const isSuppressedAfterNew = isGapSuppressed(
        'concept-calvin-cycle',
        'repeatedly_failed',
        'assessment-repeated-failure-v1',
        newEvidence,
        [{ conceptId: 'concept-calvin-cycle', kind: 'repeatedly_failed', ruleId: 'assessment-repeated-failure-v1', status: 'dismissed', evidenceCutoff: cutoff }]
      );
      expect(isSuppressedAfterNew).toBe(false);
    });
  });

  describe('History Comparison & Non-Calibrated Labels', () => {
    const makeAttempt = (overrides: Partial<ExamAttempt>): ExamAttempt => ({
      id: 'att-1',
      blueprintRevisionId: 'bpr-bio-final',
      blueprintTitle: 'Biology Exam Paper',
      mode: 'exam',
      status: 'complete',
      startedAt: '2026-11-08T10:00:00Z',
      deadlineAt: '2026-11-08T11:00:00Z',
      submittedAt: '2026-11-08T10:45:00Z',
      completedAt: '2026-11-08T10:45:00Z',
      awardedPoints: 6,
      maximumPoints: 10,
      clientStartKey: 'start-1',
      revision: 2,
      questionRevisionIds: ['q-1', 'q-2'],
      submissionReason: 'user',
      submissionKey: 'sub-key-1',
      createdAt: '2026-11-08T10:00:00Z',
      updatedAt: '2026-11-08T10:45:00Z',
      ...overrides,
    });

    it('identifies same-paper retake, computes delta, and adds memory effect warning', () => {
      const earlier = makeAttempt({ id: 'att-1', awardedPoints: 6 });
      const later = makeAttempt({ id: 'att-2', awardedPoints: 8 });

      const result = compareAttemptHistory(earlier, later);
      expect(result.samePaper).toBe(true);
      expect(result.scoreDelta).toBe(2);
      expect(result.percentageDelta).toBe(20);
      expect(result.comparisonLabel).toBe('+2 pts (Retake)');
      expect(result.warningNote).toBe(RETAKE_MEMORY_WARNING);
    });

    it('identifies distinct examination papers without asserting calibrated difficulty equivalence', () => {
      const earlier = makeAttempt({ id: 'att-1', blueprintRevisionId: 'bpr-paper-A', awardedPoints: 6 });
      const later = makeAttempt({ id: 'att-2', blueprintRevisionId: 'bpr-paper-B', awardedPoints: 8 });

      const result = compareAttemptHistory(earlier, later);
      expect(result.samePaper).toBe(false);
      expect(result.comparisonLabel).toBe('Distinct Examination Papers');
      expect(result.warningNote).toBe(CROSS_PAPER_DESCRIPTIVE_NOTE);
    });
  });

  describe('Remediation Planner', () => {
    it('emits open-source, targeted practice, and follow-up exam recommendations without direct execution', () => {
      const summary = baseSummary([]);
      const gap = {
        id: 'gap-calvin-failure',
        kind: 'repeatedly_failed' as const,
        conceptId: 'concept-calvin-cycle',
        conceptName: 'Calvin-Benson Cycle',
        planId: 'plan-bio',
        nodeId: 'node-calvin',
        ruleId: 'assessment-repeated-failure-v1',
        status: 'active' as const,
        evidence: [],
        demonstrated: summary,
        firstDetectedAt: FIXED_NOW,
        lastDetectedAt: FIXED_NOW,
        evidenceCutoff: FIXED_NOW,
      };

      const recs = planRemediationForGap(gap, {
        sourceRefIds: ['ssr-bio-ch5'],
        objectives: ['Master RuBisCO regulation'],
        now: FIXED_NOW,
      });

      expect(recs).toHaveLength(3);
      expect(recs.map((r) => r.kind)).toEqual(['open-source', 'targeted-practice', 'follow-up-exam']);
      expect(recs.every((r) => r.status === 'suggested')).toBe(true);
      expect(recs[0].sourceRefIds).toEqual(['ssr-bio-ch5']);
    });
  });
});
