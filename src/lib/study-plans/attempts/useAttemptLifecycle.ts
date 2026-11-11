/**
 * React Hook for Examination Attempt Lifecycle.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§5–7, §11
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T04)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AttemptController,
  type AttemptControllerState,
  type AttemptControllerNativeAdapter,
  defaultNativeAdapter,
} from './attemptController';
import type { AttemptDetail, PracticeCheckResult } from '../../../types/assessmentSessions';
import { getRemainingTimeSeconds } from './attemptRecovery';

export interface UseAttemptLifecycleOptions {
  detail: AttemptDetail;
  adapter?: AttemptControllerNativeAdapter;
  debounceMs?: number;
  onAutoSubmit?: (completed: AttemptDetail) => void;
}

export function useAttemptLifecycle({
  detail,
  adapter = defaultNativeAdapter,
  debounceMs = 300,
  onAutoSubmit,
}: UseAttemptLifecycleOptions) {
  const controllerRef = useRef<AttemptController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new AttemptController(detail, adapter, debounceMs);
  }

  const controller = controllerRef.current;
  const [state, setState] = useState<AttemptControllerState>(() => controller.getState());
  const autoSubmittedRef = useRef(false);

  // Subscribe to controller state changes
  useEffect(() => {
    const unsubscribe = controller.subscribe(() => {
      setState(controller.getState());
    });
    return unsubscribe;
  }, [controller]);

  // Page lifecycle events: flush on hide / beforeunload
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void controller.flushAll();
      }
    };

    const handleBeforeUnload = () => {
      void controller.flushAll();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      void controller.flushAll();
      controller.destroy();
    };
  }, [controller]);

  const autoSubmitCallback = useRef(onAutoSubmit);
  autoSubmitCallback.current = onAutoSubmit;

  useEffect(() => {
    const deadlineAt = state.attempt.deadlineAt;
    if (!deadlineAt || state.attempt.status !== 'in-progress') return;

    const autoSubmit = (reason: 'timer' | 'timer-recovered') => {
      if (autoSubmittedRef.current) return;
      autoSubmittedRef.current = true;
      void controller.submitAttempt(reason).then(
        (completed) => autoSubmitCallback.current?.(completed),
        () => { autoSubmittedRef.current = false; },
      );
    };
    if (state.isReadOnly && getRemainingTimeSeconds(deadlineAt) === 0) {
      autoSubmit('timer-recovered');
      return;
    }

    const interval = setInterval(() => {
      const remaining = getRemainingTimeSeconds(deadlineAt);
      controller.updateRemainingSeconds(remaining);
      if (remaining !== null && remaining <= 0) {
        clearInterval(interval);
        autoSubmit('timer');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [state.attempt.deadlineAt, state.attempt.status, state.isReadOnly, controller]);

  const acknowledgePracticeCheck = useCallback(
    (result: PracticeCheckResult) => controller.acknowledgePracticeCheck(result),
    [controller],
  );

  const selectQuestion = useCallback(
    (index: number) => controller.selectQuestion(index),
    [controller]
  );

  const updateDraft = useCallback(
    (questionRevisionId: string, updater: any, mark?: any) =>
      controller.updateDraft(questionRevisionId, updater, mark),
    [controller]
  );

  const updateConfidence = useCallback(
    (questionRevisionId: string, confidence: any) =>
      controller.updateConfidence(questionRevisionId, confidence),
    [controller]
  );

  const markQuestion = useCallback(
    (questionRevisionId: string, mark: any) =>
      controller.markQuestion(questionRevisionId, mark),
    [controller]
  );

  const flushResponse = useCallback(
    (questionRevisionId: string) => controller.flushResponse(questionRevisionId),
    [controller]
  );

  const flushAll = useCallback(() => controller.flushAll(), [controller]);

  const submitAttempt = useCallback(
    (reason?: any) => controller.submitAttempt(reason),
    [controller]
  );

  const cancelAttempt = useCallback(() => controller.cancelAttempt(), [controller]);

  return {
    acknowledgePracticeCheck,
    state,
    controller,
    selectQuestion,
    updateDraft,
    updateConfidence,
    markQuestion,
    flushResponse,
    flushAll,
    submitAttempt,
    cancelAttempt,
  };
}
