import { describe, it, expect } from 'vitest';
import {
  buildDefaultDiagnosticConfig,
  validateDiagnosticConfig,
  validatePracticeTimer,
  DIAGNOSTIC_MIN_COUNT,
  DIAGNOSTIC_MAX_COUNT,
} from '../diagnosticConfig';
import { buildDiagnosticPriorEvidence } from '../diagnosticPriorEvidence';
import { computeCurriculumPreferences } from '../curriculumAdaptation';
import type { AttemptDetail } from '../../../../types/assessmentSessions';

describe('C7-T01 diagnostic contracts', () => {
  it('default diagnostic is 6, bounded 4-12, essay and timer rejected', () => {
    const def = buildDefaultDiagnosticConfig();
    expect(def.mode).toBe('diagnostic');
    expect(def.requestedCount).toBe(6);
    expect(def.timeLimitSeconds).toBeNull();
    expect(validateDiagnosticConfig(def).ok).toBe(true);

    expect(validateDiagnosticConfig({ ...def, requestedCount: 3 }).ok).toBe(false);
    expect(validateDiagnosticConfig({ ...def, requestedCount: 13 }).ok).toBe(false);
    expect(DIAGNOSTIC_MIN_COUNT).toBe(4);
    expect(DIAGNOSTIC_MAX_COUNT).toBe(12);
    expect(
      validateDiagnosticConfig({
        ...def,
        typeWeights: { essay: 1 } as never,
      }).ok,
    ).toBe(false);
    expect(validateDiagnosticConfig({ ...def, timeLimitSeconds: 300 }).ok).toBe(false);
    expect(validatePracticeTimer({ ...def, mode: 'practice', timeLimitSeconds: null })).toBe(true);
    expect(validatePracticeTimer({ ...def, mode: 'practice', timeLimitSeconds: 600 })).toBe(false);
  });

  it('Skip returns null; incomplete/pending/mismatched return null (no auto-skip)', () => {
    expect(buildDiagnosticPriorEvidence(null)).toBeNull();
    const base = {
      attempt: {
        id: 'ea1',
        mode: 'diagnostic',
        status: 'complete',
        blueprintRevisionId: 'abr1',
      },
      currentGrades: [],
      questions: [],
    } as unknown as AttemptDetail;
    expect(buildDiagnosticPriorEvidence(base)).toBeNull();

    const incomplete = {
      attempt: { id: 'ea1', mode: 'diagnostic', status: 'in-progress', blueprintRevisionId: 'abr1' },
      currentGrades: [{ state: 'final', points: 1, maxPoints: 1, questionRevisionId: 'q1' }],
      questions: [{ id: 'q1', targets: [{ conceptId: 'c1' }] }],
    } as unknown as AttemptDetail;
    expect(buildDiagnosticPriorEvidence(incomplete)).toBeNull();

    const mismatch = {
      attempt: { id: 'ea1', mode: 'diagnostic', status: 'complete', blueprintRevisionId: 'abr1' },
      currentGrades: [{ state: 'final', points: 1, maxPoints: 1, questionRevisionId: 'q1' }],
      questions: [{ id: 'q1', targets: [{ conceptId: 'c1' }] }],
    } as unknown as AttemptDetail;
    expect(buildDiagnosticPriorEvidence(mismatch, { blueprintRevisionId: 'abr2' })).toBeNull();

    const pending = {
      attempt: { id: 'ea1', mode: 'diagnostic', status: 'complete', blueprintRevisionId: 'abr1' },
      currentGrades: [{ state: 'needs-review', points: null, maxPoints: 1, questionRevisionId: 'q1' }],
      questions: [{ id: 'q1', targets: [{ conceptId: 'c1' }] }],
    } as unknown as AttemptDetail;
    expect(buildDiagnosticPriorEvidence(pending)).toBeNull();
  });

  it('completed diagnostic yields exact reviewable preference/diff; one success never auto-skips', () => {
    const detail = {
      attempt: { id: 'ea1', mode: 'diagnostic', status: 'complete', blueprintRevisionId: 'abr1' },
      currentGrades: [
        { state: 'final', points: 0, maxPoints: 1, questionRevisionId: 'q1' },
        { state: 'final', points: 1, maxPoints: 1, questionRevisionId: 'q2' },
      ],
      questions: [
        { id: 'q1', targets: [{ conceptId: 'c-weak' }] },
        { id: 'q2', targets: [{ conceptId: 'c-strong' }] },
      ],
    } as unknown as AttemptDetail;
    const prior = buildDiagnosticPriorEvidence(detail, { blueprintRevisionId: 'abr1' });
    expect(prior?.diagnosticAttemptId).toBe('ea1');
    expect(prior?.concepts).toHaveLength(2);

    const prefs = computeCurriculumPreferences(
      [
        { nodeId: 'n1', conceptId: 'c-weak', included: true, locked: false },
        { nodeId: 'n2', conceptId: 'c-strong', included: true, locked: false },
        { nodeId: 'n3', conceptId: 'c-unknown', included: true, locked: true },
      ] as never,
      prior,
    );
    expect(prefs.find((p) => p.nodeId === 'n1')?.rank).toBe(0);
    expect(prefs.find((p) => p.nodeId === 'n3')?.locked).toBe(true);
    // Strong never removed: still present with rank 2
    expect(prefs.find((p) => p.nodeId === 'n2')?.rank).toBe(2);
    expect(prefs).toHaveLength(3);
  });
});
