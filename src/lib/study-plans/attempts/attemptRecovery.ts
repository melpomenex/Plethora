/**
 * Attempt Recovery & Deadline Reconciliation.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T04)
 */

import type { AttemptDetail, ExamAttempt } from '../../../types/assessmentSessions';

export interface AttemptRecoveryState {
  status: ExamAttempt['status'];
  isReadOnly: boolean;
  canResume: boolean;
  isExpired: boolean;
  mustAutoSubmit: boolean;
  remainingSeconds: number | null;
  mode: ExamAttempt['mode'];
}

/**
 * Calculates remaining seconds until deadline from UTC ISO timestamp.
 */
export function getRemainingTimeSeconds(
  deadlineAt: string | null,
  nowMs: number = Date.now()
): number | null {
  if (!deadlineAt) return null;
  const deadlineMs = new Date(deadlineAt).getTime();
  if (isNaN(deadlineMs)) return null;
  const diffSec = Math.ceil((deadlineMs - nowMs) / 1000);
  return Math.max(0, diffSec);
}

/**
 * Reconciles attempt status against clock and server record without fake browser defaults.
 */
export function deriveAttemptRecoveryState(
  detail: AttemptDetail,
  nowMs: number = Date.now()
): AttemptRecoveryState {
  const { attempt } = detail;
  const { status, mode, deadlineAt } = attempt;

  if (status === 'cancelled') {
    return {
      status: 'cancelled',
      isReadOnly: true,
      canResume: false,
      isExpired: false,
      mustAutoSubmit: false,
      remainingSeconds: null,
      mode,
    };
  }

  if (status === 'complete' || status === 'grading') {
    return {
      status,
      isReadOnly: true,
      canResume: false,
      isExpired: false,
      mustAutoSubmit: false,
      remainingSeconds: 0,
      mode,
    };
  }

  // status === 'in-progress'
  if (deadlineAt) {
    const remaining = getRemainingTimeSeconds(deadlineAt, nowMs);
    if (remaining !== null && remaining <= 0) {
      return {
        status: 'in-progress',
        isReadOnly: true,
        canResume: false,
        isExpired: true,
        mustAutoSubmit: true,
        remainingSeconds: 0,
        mode,
      };
    }

    return {
      status: 'in-progress',
      isReadOnly: false,
      canResume: true,
      isExpired: false,
      mustAutoSubmit: false,
      remainingSeconds: remaining,
      mode,
    };
  }

  return {
    status: 'in-progress',
    isReadOnly: false,
    canResume: true,
    isExpired: false,
    mustAutoSubmit: false,
    remainingSeconds: null,
    mode,
  };
}
