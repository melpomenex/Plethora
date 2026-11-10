/**
 * Attempt Lifecycle, Mode, and State Transition Policy.
 *
 * Implements attempt policy rules and validation.
 * Specifications: 02-SHARED-CONTRACTS.md §7.
 */

import type { AssessmentMode } from '../../../types/assessmentQuestions';
import type {
  AttemptStatus,
  SubmissionReason,
} from '../../../types/assessmentSessions';

export const VALID_SUBMISSION_REASONS: readonly SubmissionReason[] = [
  'user',
  'timer',
  'timer-recovered',
] as const;

export function isValidSubmissionReason(
  reason: unknown
): reason is SubmissionReason {
  return (
    typeof reason === 'string' &&
    VALID_SUBMISSION_REASONS.includes(reason as SubmissionReason)
  );
}

export function isTerminalAttemptStatus(status: AttemptStatus): boolean {
  return status === 'complete' || status === 'cancelled';
}

export function canSaveAttemptResponse(status: AttemptStatus): boolean {
  return status === 'in-progress';
}

export function canSubmitAttempt(status: AttemptStatus): boolean {
  return status === 'in-progress';
}

export function canCancelAttempt(status: AttemptStatus): boolean {
  return status === 'in-progress';
}

export function canCheckPracticeResponse(
  mode: AssessmentMode,
  status: AttemptStatus
): boolean {
  return mode === 'practice' && status === 'in-progress';
}

export function allowsHints(mode: AssessmentMode): boolean {
  return mode === 'practice';
}

export function allowsImmediateFeedback(mode: AssessmentMode): boolean {
  return mode === 'practice';
}

/**
 * Validates allowed transitions between AttemptStatus states.
 */
export function isValidAttemptTransition(
  from: AttemptStatus,
  to: AttemptStatus
): boolean {
  if (from === to) return true;

  switch (from) {
    case 'in-progress':
      return to === 'submitted' || to === 'cancelled';

    case 'submitted':
      return (
        to === 'grading' ||
        to === 'partially-graded' ||
        to === 'complete' ||
        to === 'grading-failed'
      );

    case 'grading':
      return (
        to === 'partially-graded' ||
        to === 'complete' ||
        to === 'grading-failed'
      );

    case 'partially-graded':
      return (
        to === 'grading' ||
        to === 'complete' ||
        to === 'grading-failed'
      );

    case 'grading-failed':
      return (
        to === 'grading' ||
        to === 'partially-graded' ||
        to === 'complete'
      );

    case 'complete':
    case 'cancelled':
      // Terminal states - no transitions out
      return false;
  }
}
