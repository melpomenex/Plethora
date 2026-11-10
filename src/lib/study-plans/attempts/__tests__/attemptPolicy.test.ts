import { describe, expect, it } from 'vitest';
import {
  allowsHints,
  allowsImmediateFeedback,
  canCancelAttempt,
  canCheckPracticeResponse,
  canSaveAttemptResponse,
  canSubmitAttempt,
  isTerminalAttemptStatus,
  isValidAttemptTransition,
  isValidSubmissionReason,
} from '../attemptPolicy';
import type { AttemptStatus } from '../../../../types/assessmentSessions';

describe('attemptPolicy', () => {
  describe('state transitions', () => {
    it('allows valid in-progress transitions', () => {
      expect(isValidAttemptTransition('in-progress', 'submitted')).toBe(true);
      expect(isValidAttemptTransition('in-progress', 'cancelled')).toBe(true);
      expect(isValidAttemptTransition('in-progress', 'in-progress')).toBe(true);
      expect(isValidAttemptTransition('in-progress', 'complete')).toBe(false);
    });

    it('allows valid submitted transitions', () => {
      expect(isValidAttemptTransition('submitted', 'grading')).toBe(true);
      expect(isValidAttemptTransition('submitted', 'partially-graded')).toBe(true);
      expect(isValidAttemptTransition('submitted', 'complete')).toBe(true);
      expect(isValidAttemptTransition('submitted', 'grading-failed')).toBe(true);
      expect(isValidAttemptTransition('submitted', 'in-progress')).toBe(false);
    });

    it('allows valid grading transitions', () => {
      expect(isValidAttemptTransition('grading', 'partially-graded')).toBe(true);
      expect(isValidAttemptTransition('grading', 'complete')).toBe(true);
      expect(isValidAttemptTransition('grading', 'grading-failed')).toBe(true);
      expect(isValidAttemptTransition('grading', 'in-progress')).toBe(false);
    });

    it('prevents transitions out of terminal states (complete, cancelled)', () => {
      const nonTerminal: AttemptStatus[] = [
        'in-progress',
        'submitted',
        'grading',
        'partially-graded',
        'grading-failed',
      ];
      for (const target of nonTerminal) {
        expect(isValidAttemptTransition('complete', target)).toBe(false);
        expect(isValidAttemptTransition('cancelled', target)).toBe(false);
      }
    });

    it('identifies terminal statuses', () => {
      expect(isTerminalAttemptStatus('complete')).toBe(true);
      expect(isTerminalAttemptStatus('cancelled')).toBe(true);
      expect(isTerminalAttemptStatus('in-progress')).toBe(false);
      expect(isTerminalAttemptStatus('submitted')).toBe(false);
      expect(isTerminalAttemptStatus('grading')).toBe(false);
    });
  });

  describe('action permissions', () => {
    it('allows saving, submitting, and cancelling only while in-progress', () => {
      expect(canSaveAttemptResponse('in-progress')).toBe(true);
      expect(canSaveAttemptResponse('submitted')).toBe(false);
      expect(canSaveAttemptResponse('complete')).toBe(false);

      expect(canSubmitAttempt('in-progress')).toBe(true);
      expect(canSubmitAttempt('submitted')).toBe(false);

      expect(canCancelAttempt('in-progress')).toBe(true);
      expect(canCancelAttempt('complete')).toBe(false);
    });

    it('allows practice check only in practice mode while in-progress', () => {
      expect(canCheckPracticeResponse('practice', 'in-progress')).toBe(true);
      expect(canCheckPracticeResponse('practice', 'submitted')).toBe(false);
      expect(canCheckPracticeResponse('practice', 'complete')).toBe(false);

      expect(canCheckPracticeResponse('exam', 'in-progress')).toBe(false);
      expect(canCheckPracticeResponse('diagnostic', 'in-progress')).toBe(false);
    });

    it('enforces mode-specific hint and feedback policy', () => {
      expect(allowsHints('practice')).toBe(true);
      expect(allowsHints('exam')).toBe(false);
      expect(allowsHints('diagnostic')).toBe(false);

      expect(allowsImmediateFeedback('practice')).toBe(true);
      expect(allowsImmediateFeedback('exam')).toBe(false);
      expect(allowsImmediateFeedback('diagnostic')).toBe(false);
    });
  });

  describe('submission reasons', () => {
    it('validates allowed submission reasons', () => {
      expect(isValidSubmissionReason('user')).toBe(true);
      expect(isValidSubmissionReason('timer')).toBe(true);
      expect(isValidSubmissionReason('timer-recovered')).toBe(true);

      expect(isValidSubmissionReason('manual')).toBe(false);
      expect(isValidSubmissionReason('')).toBe(false);
      expect(isValidSubmissionReason(null)).toBe(false);
      expect(isValidSubmissionReason(undefined)).toBe(false);
    });
  });
});
