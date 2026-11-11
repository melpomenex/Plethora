import { describe, it, expect } from 'vitest';
import { aggregateConceptEvidence } from '../evidenceAggregation';
import type { LearningEvidence } from '../../../../types/learningEvidence';

describe('evidenceAggregation (evidence-v1)', () => {
  const FIXED_NOW = '2026-11-10T12:00:00Z';

  const makeEvidence = (overrides: Partial<LearningEvidence>): LearningEvidence => ({
    id: `ev-${Math.random().toString(36).slice(2, 8)}`,
    conceptId: 'concept-photosynthesis',
    conceptLabel: 'Photosynthesis in C3 Plants',
    planId: 'plan-bio',
    nodeId: 'node-calvin-cycle',
    sourceKind: 'exam-final',
    sourceId: 'sub-1',
    gradeId: 'grd-1',
    evidenceGroupId: 'att-1:concept-photosynthesis',
    questionFingerprint: 'fp-q1',
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

  it('handles empty evidence by returning insufficient-evidence and no-assessment uncertainty', () => {
    const summary = aggregateConceptEvidence('concept-photosynthesis', [], {
      now: FIXED_NOW,
    });

    expect(summary.level).toBe('insufficient-evidence');
    expect(summary.observedMean).toBeNull();
    expect(summary.evidenceWeight).toBe(0);
    expect(summary.independentSessions).toBe(0);
    expect(summary.distinctDays).toBe(0);
    expect(summary.uncertainty).toContain('no-assessment');
  });

  it('classifies single independent session as insufficient-evidence with few/one-session uncertainty', () => {
    const ev = makeEvidence({
      observedScore: 1.0,
      evidenceGroupId: 'att-1:concept-photosynthesis',
    });

    const summary = aggregateConceptEvidence('concept-photosynthesis', [ev], {
      now: FIXED_NOW,
    });

    expect(summary.level).toBe('insufficient-evidence');
    expect(summary.observedMean).toBe(1.0);
    expect(summary.independentSessions).toBe(1);
    expect(summary.uncertainty).toContain('one-independent-session');
  });

  describe('Golden Vector: Base Weights, AI multiplier, and Recency Decay', () => {
    it('applies exact base weights: exam=1.0, practice=0.75, practice-with-hints=0.5, and AI multiplier=0.75', () => {
      // 1. Exam deterministic = 1.0 * 1.0 = 1.0
      const evExam = makeEvidence({
        sourceKind: 'exam-final',
        graderOrigin: 'deterministic',
        hintLevel: 0,
        observedScore: 1.0,
        occurredAt: FIXED_NOW, // age 0 days -> recency 1.0
      });
      const summaryExam = aggregateConceptEvidence('concept-photosynthesis', [evExam], { now: FIXED_NOW });
      expect(summaryExam.evidenceWeight).toBe(1.0);

      // 2. Practice AI with hints: 0.5 (hints) * 0.75 (AI) = 0.375
      const evPracticeAiHint = makeEvidence({
        sourceKind: 'practice-check',
        graderOrigin: 'ai',
        hintLevel: 1,
        observedScore: 0.8,
        occurredAt: FIXED_NOW,
      });
      const summaryPractice = aggregateConceptEvidence('concept-photosynthesis', [evPracticeAiHint], { now: FIXED_NOW });
      expect(summaryPractice.evidenceWeight).toBe(0.375);

      // 3. Practice AI repeated fingerprint: 0.75 (no hints) * 0.75 (AI) * 0.25 (repeat) = 0.140625 -> 0.1406
      const ev1 = makeEvidence({
        sourceKind: 'practice-check',
        graderOrigin: 'ai',
        hintLevel: 0,
        evidenceGroupId: 'group-1',
        questionFingerprint: 'fp-shared',
        occurredAt: '2026-11-09T10:00:00Z',
      });
      const ev2Repeat = makeEvidence({
        sourceKind: 'practice-check',
        graderOrigin: 'ai',
        hintLevel: 0,
        evidenceGroupId: 'group-2',
        questionFingerprint: 'fp-shared',
        occurredAt: FIXED_NOW,
      });

      const summaryRepeat = aggregateConceptEvidence('concept-photosynthesis', [ev1, ev2Repeat], { now: FIXED_NOW });
      expect(summaryRepeat.uncertainty).toContain('same-question-repetition');
    });

    it('calculates recency decay at 90 days half-life (age 90 days gives 0.5 multiplier)', () => {
      // Exam 90 days ago: 1.0 base * 0.5^(90/90) = 0.5 weight
      const ninetyDaysAgo = new Date(new Date(FIXED_NOW).getTime() - 90 * 24 * 3600 * 1000).toISOString();
      const evOld = makeEvidence({
        sourceKind: 'exam-final',
        graderOrigin: 'deterministic',
        observedScore: 1.0,
        occurredAt: ninetyDaysAgo,
      });

      const summary = aggregateConceptEvidence('concept-photosynthesis', [evOld], { now: FIXED_NOW });
      expect(summary.evidenceWeight).toBe(0.5);
      expect(summary.uncertainty).toContain('stale-evidence');
    });
  });

  describe('Ordered State Policy and Classification', () => {
    it('detects repeated failure (latest two independent groups < 0.6) and sets needs-attention', () => {
      const ev1 = makeEvidence({
        evidenceGroupId: 'att-1',
        observedScore: 0.4,
        occurredAt: '2026-11-08T10:00:00Z',
      });
      const ev2 = makeEvidence({
        evidenceGroupId: 'att-2',
        observedScore: 0.5,
        occurredAt: '2026-11-09T10:00:00Z',
      });

      const summary = aggregateConceptEvidence('concept-photosynthesis', [ev1, ev2], { now: FIXED_NOW });
      expect(summary.level).toBe('needs-attention');
      expect(summary.observedMean).toBeLessThan(0.6);
    });

    it('flags unresolved misconception as needs-attention until resolved by later independent group >= 0.8', () => {
      const ev1Misconception = makeEvidence({
        evidenceGroupId: 'att-1',
        observedScore: 0.5,
        outcome: 'misconception',
        misconception: 'Believed light reaction occurs in stroma.',
        occurredAt: '2026-11-08T10:00:00Z',
      });
      const ev2Partial = makeEvidence({
        evidenceGroupId: 'att-2',
        observedScore: 0.7, // < 0.8: does not resolve misconception
        occurredAt: '2026-11-09T10:00:00Z',
      });

      const summaryUnresolved = aggregateConceptEvidence('concept-photosynthesis', [ev1Misconception, ev2Partial], {
        now: FIXED_NOW,
      });
      expect(summaryUnresolved.level).toBe('needs-attention');

      // Now add third session with success >= 0.8 and no misconception
      const ev3Success = makeEvidence({
        evidenceGroupId: 'att-3',
        observedScore: 0.9,
        outcome: 'correct',
        occurredAt: '2026-11-10T10:00:00Z',
      });

      const summaryResolved = aggregateConceptEvidence('concept-photosynthesis', [ev1Misconception, ev2Partial, ev3Success], {
        now: FIXED_NOW,
      });
      // Misconception resolved: level should no longer be needs-attention (is developing)
      expect(summaryResolved.level).toBe('developing');
    });

    it('advances to demonstrated-consistently only when all 6 strict invariants are satisfied', () => {
      // 1. >= 3 independent sessions
      // 2. >= 2 distinct UTC days
      // 3. >= 3 distinct fingerprints
      // 4. latest 3 groups all >= 0.8
      // 5. no unresolved misconception
      // 6. at least one deterministic or manual group
      const ev1 = makeEvidence({
        evidenceGroupId: 'att-1',
        questionFingerprint: 'fp-1',
        observedScore: 0.85,
        graderOrigin: 'deterministic',
        occurredAt: '2026-11-08T10:00:00Z',
      });
      const ev2 = makeEvidence({
        evidenceGroupId: 'att-2',
        questionFingerprint: 'fp-2',
        observedScore: 0.9,
        graderOrigin: 'ai',
        occurredAt: '2026-11-09T10:00:00Z',
      });
      const ev3 = makeEvidence({
        evidenceGroupId: 'att-3',
        questionFingerprint: 'fp-3',
        observedScore: 0.95,
        graderOrigin: 'ai',
        occurredAt: '2026-11-10T10:00:00Z',
      });

      const summary = aggregateConceptEvidence('concept-photosynthesis', [ev1, ev2, ev3], { now: FIXED_NOW });
      expect(summary.level).toBe('demonstrated-consistently');
      expect(summary.independentSessions).toBe(3);
      expect(summary.distinctDays).toBe(3);
    });

    it('requires at least one deterministic/manual group to reach demonstrated-consistently (pure AI cannot achieve it)', () => {
      const ev1 = makeEvidence({
        evidenceGroupId: 'att-1',
        questionFingerprint: 'fp-1',
        observedScore: 1.0,
        graderOrigin: 'ai',
        occurredAt: '2026-11-08T10:00:00Z',
      });
      const ev2 = makeEvidence({
        evidenceGroupId: 'att-2',
        questionFingerprint: 'fp-2',
        observedScore: 1.0,
        graderOrigin: 'ai',
        occurredAt: '2026-11-09T10:00:00Z',
      });
      const ev3 = makeEvidence({
        evidenceGroupId: 'att-3',
        questionFingerprint: 'fp-3',
        observedScore: 1.0,
        graderOrigin: 'ai',
        occurredAt: '2026-11-10T10:00:00Z',
      });

      const summary = aggregateConceptEvidence('concept-photosynthesis', [ev1, ev2, ev3], { now: FIXED_NOW });
      // Lacks deterministic/manual -> remains 'developing'
      expect(summary.level).toBe('developing');
    });
  });

  describe('Uncertainty Reasons Derivation', () => {
    it('detects low learner confidence and high confidence error', () => {
      const evLowConf = makeEvidence({
        evidenceGroupId: 'att-1',
        observedScore: 1.0,
        learnerConfidence: 0.2, // <= 0.3
        occurredAt: '2026-11-09T10:00:00Z',
      });
      const evHighConfErr = makeEvidence({
        evidenceGroupId: 'att-2',
        observedScore: 0.2, // < 0.6
        learnerConfidence: 0.95, // >= 0.9
        occurredAt: '2026-11-10T10:00:00Z',
      });

      const summary = aggregateConceptEvidence('concept-photosynthesis', [evLowConf, evHighConfErr], { now: FIXED_NOW });
      expect(summary.uncertainty).toContain('low-learner-confidence');
      expect(summary.uncertainty).toContain('high-confidence-error');
    });

    it('detects conflicting outcomes when min and max observed differ by at least 0.4', () => {
      const evLow = makeEvidence({
        evidenceGroupId: 'att-1',
        observedScore: 0.3,
        occurredAt: '2026-11-09T10:00:00Z',
      });
      const evHigh = makeEvidence({
        evidenceGroupId: 'att-2',
        observedScore: 0.9, // 0.9 - 0.3 = 0.6 >= 0.4
        occurredAt: '2026-11-10T10:00:00Z',
      });

      const summary = aggregateConceptEvidence('concept-photosynthesis', [evLow, evHigh], { now: FIXED_NOW });
      expect(summary.uncertainty).toContain('conflicting-outcomes');
      expect(summary.minimumObserved).toBe(0.3);
      expect(summary.maximumObserved).toBe(0.9);
    });
  });
});
