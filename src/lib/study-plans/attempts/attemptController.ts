/**
 * Resumable Examination Attempt Controller.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§5–7, §11
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T04)
 */

import type {
  AttemptDetail,
  ExamAttempt,
  ExamResponse,
  SaveResponseInput,
  SubmitAttemptInput,
  CheckPracticeInput,
  PracticeCheckResult,
  SubmissionReason,
  LearnerConfidence,
  ResponseMark,
} from '../../../types/assessmentSessions';
import type {
  AssessmentQuestionRevision,
  AssessmentResponse,
} from '../../../types/assessmentQuestions';
import { gradeQuestionObjective } from './objectiveGrading';
import { deriveAttemptRecoveryState } from './attemptRecovery';
import {
  saveExamResponse,
  getExamAttempt,
  submitExamAttempt,
  checkPracticeResponse,
  cancelExamAttempt,
} from '../../../api/exam-sessions';

export interface ResponseSlotState {
  responseId: string;
  questionRevisionId: string;
  draft: AssessmentResponse;
  mark: ResponseMark;
  revision: number;
  lastSavedRevision: number;
  isDirty: boolean;
  isSaving: boolean;
  error: string | null;
  lastClientMutationId: string;
  runToken: number;
}

export interface AttemptControllerNativeAdapter {
  saveResponse: (input: SaveResponseInput) => Promise<ExamResponse>;
  getAttempt: (attemptId: string) => Promise<AttemptDetail>;
  submitAttempt: (input: SubmitAttemptInput) => Promise<AttemptDetail>;
  checkPractice?: (input: CheckPracticeInput) => Promise<PracticeCheckResult>;
  cancelAttempt?: (attemptId: string, expectedRevision: number) => Promise<AttemptDetail>;
}

export const defaultNativeAdapter: AttemptControllerNativeAdapter = {
  saveResponse: saveExamResponse,
  getAttempt: getExamAttempt,
  submitAttempt: submitExamAttempt,
  checkPractice: checkPracticeResponse,
  cancelAttempt: cancelExamAttempt,
};

export interface AttemptControllerState {
  attempt: ExamAttempt;
  questions: AssessmentQuestionRevision[];
  slots: Record<string, ResponseSlotState>; // keyed by questionRevisionId
  selectedIndex: number;
  isSubmitting: boolean;
  submitError: string | null;
  isReadOnly: boolean;
  remainingSeconds: number | null;
  hasUnsavedChanges: boolean;
}

export class AttemptController {
  private attempt: ExamAttempt;
  private questions: AssessmentQuestionRevision[];
  private slots: Record<string, ResponseSlotState> = {};
  private practiceHintLevels: Record<string, number> = {};
  private selectedIndex: number = 0;
  private isSubmitting: boolean = false;
  private submitError: string | null = null;
  private isReadOnly: boolean = false;
  private remainingSeconds: number | null = null;
  private debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private activeSaves: Record<string, Promise<void>> = {};
  private listeners: Set<() => void> = new Set();
  private readonly adapter: AttemptControllerNativeAdapter;
  private readonly debounceMs: number;

  constructor(
    detail: AttemptDetail,
    adapter: AttemptControllerNativeAdapter = defaultNativeAdapter,
    debounceMs: number = 300,
    nowMs: number = Date.now()
  ) {
    this.adapter = adapter;
    this.debounceMs = debounceMs;
    this.attempt = detail.attempt;
    this.questions = detail.questions ?? [];

    const recovery = deriveAttemptRecoveryState(detail, nowMs);
    this.isReadOnly = recovery.isReadOnly;
    this.remainingSeconds = recovery.remainingSeconds;

    // Initialize slots for each response
    for (const resp of detail.responses) {
      const qRevId = resp.questionRevisionId;
      const question = this.questions.find((q) => q.id === qRevId);
      const defaultDraft = this.createDefaultDraft(question);
      const initialDraft = resp.draft || defaultDraft;

      this.slots[qRevId] = {
        responseId: resp.id,
        questionRevisionId: qRevId,
        draft: initialDraft,
        mark: resp.mark,
        revision: resp.revision,
        lastSavedRevision: resp.revision,
        isDirty: false,
        isSaving: false,
        error: null,
        lastClientMutationId: resp.lastClientMutationId || '',
        runToken: 0,
      };
    }
  }

  private createDefaultDraft(question?: AssessmentQuestionRevision): AssessmentResponse {
    if (!question) return { kind: 'short-answer', text: '' };
    switch (question.question.kind) {
      case 'single-select':
        return { kind: 'single-select', optionId: null };
      case 'multi-select':
        return { kind: 'multi-select', optionIds: [] };
      case 'cloze':
        return { kind: 'cloze', answers: {} };
      case 'short-answer':
        return { kind: 'short-answer', text: '' };
      case 'essay':
        return { kind: 'essay', text: '' };
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): AttemptControllerState {
    let hasUnsavedChanges = false;
    for (const s of Object.values(this.slots)) {
      if (s.isDirty || s.isSaving) {
        hasUnsavedChanges = true;
        break;
      }
    }

    return {
      attempt: this.attempt,
      questions: this.questions,
      slots: { ...this.slots },
      selectedIndex: this.selectedIndex,
      isSubmitting: this.isSubmitting,
      submitError: this.submitError,
      isReadOnly: this.isReadOnly,
      remainingSeconds: this.remainingSeconds,
      hasUnsavedChanges,
    };
  }

  public get currentQuestion(): AssessmentQuestionRevision | undefined {
    return this.questions[this.selectedIndex];
  }

  public get currentSlot(): ResponseSlotState | undefined {
    const q = this.currentQuestion;
    return q ? this.slots[q.id] : undefined;
  }

  public updateRemainingSeconds(seconds: number | null): void {
    this.remainingSeconds = seconds;
    if (seconds !== null && seconds <= 0 && this.attempt.status === 'in-progress') {
      this.isReadOnly = true;
    }
    this.notify();
  }

  /**
   * C7-T02 shared hint level: practice-only 0..3, highest used per question.
   * Exam/Diagnostic never record hints (always 0).
   */
  public setPracticeHintLevel(questionRevisionId: string, level: number): void {
    if (this.attempt.mode !== 'practice') return;
    if (!Number.isInteger(level) || level < 0 || level > 3) return;
    const prev = this.practiceHintLevels[questionRevisionId] ?? 0;
    this.practiceHintLevels[questionRevisionId] = Math.max(prev, level);
    this.notify();
  }

  public getPracticeHintLevel(questionRevisionId: string): number {
    if (this.attempt.mode !== 'practice') return 0;
    return this.practiceHintLevels[questionRevisionId] ?? 0;
  }

  /**
   * Sets the active question index, flushing the previous question before moving.
   */
  public async selectQuestion(index: number): Promise<void> {
    if (index < 0 || index >= this.questions.length) return;
    if (index === this.selectedIndex) return;

    // Flush current question if dirty before moving
    const cur = this.currentSlot;
    if (cur && cur.isDirty) {
      await this.flushResponse(cur.questionRevisionId);
    }

    this.selectedIndex = index;
    this.notify();
  }

  /**
   * Updates learner draft response, marking dirty and queueing debounced save.
   */
  public updateDraft(
    questionRevisionId: string,
    updater: (prev: AssessmentResponse) => AssessmentResponse,
    mark: ResponseMark = 'answered'
  ): void {
    if (this.isReadOnly) return;
    const slot = this.slots[questionRevisionId];
    if (!slot) return;

    slot.draft = updater(slot.draft);
    slot.mark = mark;
    slot.isDirty = true;
    slot.runToken += 1;
    slot.error = null;

    const currentToken = slot.runToken;

    // Clear existing timer
    if (this.debounceTimers[questionRevisionId]) {
      clearTimeout(this.debounceTimers[questionRevisionId]);
    }

    // Schedule 300ms debounce
    this.debounceTimers[questionRevisionId] = setTimeout(() => {
      delete this.debounceTimers[questionRevisionId];
      void this.flushResponse(questionRevisionId, currentToken);
    }, this.debounceMs);

    this.notify();
  }

  /**
   * Sets confidence on current draft while preserving response content.
   */
  public updateConfidence(
    questionRevisionId: string,
    confidence: LearnerConfidence | undefined
  ): void {
    this.updateDraft(
      questionRevisionId,
      (prev) => ({
        ...prev,
        confidence,
      }),
      this.slots[questionRevisionId]?.mark ?? 'answered'
    );
  }

  /**
   * Sets question mark (answered, skipped, unanswered).
   */
  public markQuestion(questionRevisionId: string, mark: ResponseMark): void {
    if (this.isReadOnly) return;
    const slot = this.slots[questionRevisionId];
    if (!slot) return;

    slot.mark = mark;
    slot.isDirty = true;
    slot.runToken += 1;
    slot.error = null;

    const currentToken = slot.runToken;

    if (this.debounceTimers[questionRevisionId]) {
      clearTimeout(this.debounceTimers[questionRevisionId]);
    }

    this.debounceTimers[questionRevisionId] = setTimeout(() => {
      delete this.debounceTimers[questionRevisionId];
      void this.flushResponse(questionRevisionId, currentToken);
    }, this.debounceMs);

    this.notify();
  }

  /**
   * Immediately flushes a single response slot to native storage.
   */
  public async flushResponse(questionRevisionId: string, token?: number): Promise<void> {
    const slot = this.slots[questionRevisionId];
    if (!slot) return;

    // Cancel any pending timer
    if (this.debounceTimers[questionRevisionId]) {
      clearTimeout(this.debounceTimers[questionRevisionId]);
      delete this.debounceTimers[questionRevisionId];
    }

    // If superseded by a newer mutation, skip
    if (token !== undefined && token !== slot.runToken) {
      return;
    }

    // If currently saving, wait for active save then check if still dirty
    if (this.activeSaves[questionRevisionId]) {
      try {
        await this.activeSaves[questionRevisionId];
      } catch {
        // active save error handled below
      }
      if (!slot.isDirty || (token !== undefined && token !== slot.runToken)) {
        return;
      }
    }

    if (!slot.isDirty) return;

    const mutationToken = slot.runToken;
    const mutationId = `mut_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    slot.lastClientMutationId = mutationId;
    slot.isSaving = true;
    slot.error = null;
    this.notify();

    const savePromise = (async () => {
      try {
        const saved = await this.adapter.saveResponse({
          attemptId: this.attempt.id,
          responseId: slot.responseId,
          expectedResponseRevision: slot.revision,
          lastClientMutationId: mutationId,
          draft: slot.draft,
          mark: slot.mark,
        });

        // Only clear dirty if no newer edits occurred while saving
        if (slot.runToken === mutationToken) {
          slot.isDirty = false;
          slot.revision = saved.revision;
          slot.lastSavedRevision = saved.revision;
          slot.error = null;
        } else {
          slot.revision = saved.revision;
          slot.lastSavedRevision = saved.revision;
        }
      } catch (err: any) {
        // Handle stale revision via reconciliation
        if (err?.code === 'stale_revision') {
          await this.reconcileUnknownSave(questionRevisionId);
        } else {
          slot.error = err?.messageKey || err?.message || 'Save failed';
        }
      } finally {
        slot.isSaving = false;
        delete this.activeSaves[questionRevisionId];
        this.notify();
      }
    })();

    this.activeSaves[questionRevisionId] = savePromise;
    await savePromise;
  }

  /**
   * Reconciles response slot state against remote server record.
   */
  public async reconcileUnknownSave(questionRevisionId: string): Promise<void> {
    const slot = this.slots[questionRevisionId];
    if (!slot) return;

    try {
      const detail = await this.adapter.getAttempt(this.attempt.id);
      this.attempt = detail.attempt;
      const remoteResp = detail.responses.find((r) => r.id === slot.responseId);
      if (remoteResp) {
        slot.revision = remoteResp.revision;
        if (remoteResp.lastClientMutationId === slot.lastClientMutationId) {
          slot.lastSavedRevision = remoteResp.revision;
          slot.isDirty = false;
          slot.error = null;
        }
      }
    } catch (err: any) {
      slot.error = err?.messageKey || err?.message || 'Reconciliation failed';
    } finally {
      this.notify();
    }
  }

  /**
   * Flushes all dirty responses.
   * Returns true if all flushes succeeded and no dirty slots remain.
   */
  public async flushAll(): Promise<boolean> {
    const dirtySlotKeys = Object.keys(this.slots).filter(
      (k) => this.slots[k].isDirty || this.debounceTimers[k]
    );

    await Promise.all(dirtySlotKeys.map((k) => this.flushResponse(k)));

    // Verify no slots are dirty or have errors
    let clean = true;
    for (const key of Object.keys(this.slots)) {
      if (this.slots[key].isDirty || this.slots[key].error) {
        clean = false;
        break;
      }
    }

    return clean;
  }

  /**
   * Submits the attempt after ensuring all responses are cleanly flushed.
   * Fails closed if any unacknowledged or unflushed saves remain.
   */
  public async submitAttempt(
    reason: SubmissionReason = 'user'
  ): Promise<AttemptDetail> {
    if (this.isSubmitting) {
      throw new Error('Submission already in progress');
    }

    this.isSubmitting = true;
    this.submitError = null;
    this.notify();

    try {
      // 1. Flush all dirty responses
      const flushed = await this.flushAll();
      if (!flushed) {
        throw new Error('Cannot submit: pending unsaved responses could not be saved');
      }

      // 2. Compute objective grades for all questions
      const objectiveGrades = this.questions.map((q) => {
        const slot = this.slots[q.id];
        const draft = slot ? slot.draft : this.createDefaultDraft(q);
        const mark = slot ? slot.mark : 'unanswered';
        return gradeQuestionObjective(q.question, draft, mark, q.id);
      });

      // 3. Dispatch submit command
      const submissionKey = `sub_${this.attempt.id}_${Date.now()}`;
      const completed = await this.adapter.submitAttempt({
        attemptId: this.attempt.id,
        expectedAttemptRevision: this.attempt.revision,
        submissionKey,
        submissionReason: reason,
        objectiveGrades,
      });

      this.attempt = completed.attempt;
      this.isReadOnly = true;
      return completed;
    } catch (err: any) {
      this.submitError = err?.messageKey || err?.message || 'Submission failed';
      throw err;
    } finally {
      this.isSubmitting = false;
      this.notify();
    }
  }

  /**
   * Cancels in-progress attempt.
   */
  public async cancelAttempt(): Promise<AttemptDetail> {
    if (!this.adapter.cancelAttempt) {
      throw new Error('Cancel not supported by adapter');
    }

    const cancelled = await this.adapter.cancelAttempt(this.attempt.id, this.attempt.revision);
    this.attempt = cancelled.attempt;
    this.isReadOnly = true;
    this.notify();
    return cancelled;
  }

  /**
   * Cleans up all active debounce timers.
   */
  public destroy(): void {
    for (const timer of Object.values(this.debounceTimers)) {
      clearTimeout(timer);
    }
    this.debounceTimers = {};
    this.listeners.clear();
  }
}
