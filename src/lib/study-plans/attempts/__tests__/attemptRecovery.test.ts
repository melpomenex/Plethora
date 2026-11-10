import { describe, it, expect } from 'vitest';
import {
  deriveAttemptRecoveryState,
  getRemainingTimeSeconds,
} from '../attemptRecovery';
import type { AttemptDetail } from '../../../../types/assessmentSessions';

describe('Attempt Recovery & Deadline Reconciliation', () => {
  const baseDetail: AttemptDetail = {
    attempt: {
      id: 'att_test',
      blueprintRevisionId: 'bpr_1',
      blueprintTitle: 'Test Exam',
      mode: 'exam',
      status: 'in-progress',
      startedAt: '2026-11-10T12:00:00Z',
      deadlineAt: '2026-11-10T12:30:00Z',
      submittedAt: null,
      completedAt: null,
      awardedPoints: null,
      maximumPoints: 10,
      clientStartKey: 'start_1',
      revision: 1,
      questionRevisionIds: ['q1'],
      submissionReason: null,
      submissionKey: null,
      createdAt: '2026-11-10T12:00:00Z',
      updatedAt: '2026-11-10T12:00:00Z',
    },
    responses: [],
    submissions: [],
    currentGrades: [],
  };

  it('calculates remaining time seconds correctly before deadline', () => {
    const nowMs = new Date('2026-11-10T12:15:00Z').getTime();
    const remaining = getRemainingTimeSeconds('2026-11-10T12:30:00Z', nowMs);
    expect(remaining).toBe(900); // 15 mins = 900s
  });

  it('calculates zero remaining seconds past deadline', () => {
    const nowMs = new Date('2026-11-10T12:35:00Z').getTime();
    const remaining = getRemainingTimeSeconds('2026-11-10T12:30:00Z', nowMs);
    expect(remaining).toBe(0);
  });

  it('handles null deadline (untimed/practice)', () => {
    const remaining = getRemainingTimeSeconds(null);
    expect(remaining).toBeNull();
  });

  it('recovers active in-progress attempt within deadline', () => {
    const nowMs = new Date('2026-11-10T12:10:00Z').getTime();
    const recovered = deriveAttemptRecoveryState(baseDetail, nowMs);

    expect(recovered.status).toBe('in-progress');
    expect(recovered.canResume).toBe(true);
    expect(recovered.isReadOnly).toBe(false);
    expect(recovered.isExpired).toBe(false);
    expect(recovered.mustAutoSubmit).toBe(false);
    expect(recovered.remainingSeconds).toBe(1200); // 20 mins = 1200s
  });

  it('detects expired deadline on restore and signals auto-submit', () => {
    const nowMs = new Date('2026-11-10T12:45:00Z').getTime();
    const recovered = deriveAttemptRecoveryState(baseDetail, nowMs);

    expect(recovered.status).toBe('in-progress');
    expect(recovered.canResume).toBe(false);
    expect(recovered.isReadOnly).toBe(true);
    expect(recovered.isExpired).toBe(true);
    expect(recovered.mustAutoSubmit).toBe(true);
    expect(recovered.remainingSeconds).toBe(0);
  });

  it('marks completed and cancelled attempts read-only without fake defaults', () => {
    const completedDetail: AttemptDetail = {
      ...baseDetail,
      attempt: {
        ...baseDetail.attempt,
        status: 'complete',
        completedAt: '2026-11-10T12:25:00Z',
      },
    };
    const recoveredComplete = deriveAttemptRecoveryState(completedDetail);
    expect(recoveredComplete.isReadOnly).toBe(true);
    expect(recoveredComplete.canResume).toBe(false);

    const cancelledDetail: AttemptDetail = {
      ...baseDetail,
      attempt: {
        ...baseDetail.attempt,
        status: 'cancelled',
      },
    };
    const recoveredCancelled = deriveAttemptRecoveryState(cancelledDetail);
    expect(recoveredCancelled.isReadOnly).toBe(true);
    expect(recoveredCancelled.canResume).toBe(false);
  });
});
