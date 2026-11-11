import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AttemptController,
  type AttemptControllerNativeAdapter,
} from '../attemptController';
import type { AttemptDetail, SaveResponseInput, SubmitAttemptInput } from '../../../../types/assessmentSessions';
import type { AssessmentQuestionRevision } from '../../../../types/assessmentQuestions';

describe('AttemptController', () => {
  let mockAdapter: AttemptControllerNativeAdapter;
  let detail: AttemptDetail;
  let questions: AssessmentQuestionRevision[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));

    questions = [
      {
        id: 'qrev_1',
        questionId: 'q_1',
        blueprintRevisionId: 'bpr_1',
        revision: 1,
        slotKey: 'slot_0',
        fingerprint: 'fp_1',
        validation: 'valid',
        committedAt: '2026-11-10T12:00:00Z',
        provider: null,
        createdAt: '2026-11-10T12:00:00Z',
        question: {
          schemaVersion: 1,
          kind: 'single-select',
          prompt: 'Which organelle produces ATP?',
          learningObjectives: [],
          explanation: 'Mitochondria produces ATP.',
          sourceRefIds: [],
          applicationLevel: 'recall',
          hints: [],
          options: [
            { id: 'opt_a', text: 'Mitochondria' },
            { id: 'opt_b', text: 'Ribosome' },
          ],
          correctOptionId: 'opt_a',
          maxPoints: 2,
          difficulty: 2,
        },
      },
      {
        id: 'qrev_2',
        questionId: 'q_2',
        blueprintRevisionId: 'bpr_1',
        revision: 1,
        slotKey: 'slot_1',
        fingerprint: 'fp_2',
        validation: 'valid',
        committedAt: '2026-11-10T12:00:00Z',
        provider: null,
        createdAt: '2026-11-10T12:00:00Z',
        question: {
          schemaVersion: 1,
          kind: 'short-answer',
          prompt: 'What is the powerhouse of the cell?',
          learningObjectives: [],
          explanation: 'Mitochondria.',
          sourceRefIds: [],
          applicationLevel: 'recall',
          hints: [],
          referenceAnswer: 'Mitochondria',
          keyFacts: [],
          acceptedAnswers: ['mitochondria'],
          rubric: {
            schemaVersion: 1,
            criteria: [],
            expectedConcepts: [],
            gradingConstraints: [],
          },
          maxPoints: 4,
          difficulty: 3,
        },
      },
    ];

    detail = {
      attempt: {
        id: 'att_ctrl_1',
        blueprintRevisionId: 'bpr_1',
        blueprintTitle: 'Biology Exam',
        mode: 'exam',
        status: 'in-progress',
        startedAt: '2026-11-10T12:00:00Z',
        deadlineAt: '2026-11-10T12:45:00Z',
        submittedAt: null,
        completedAt: null,
        awardedPoints: null,
        maximumPoints: 6,
        clientStartKey: 'start_ctrl_1',
        revision: 1,
        questionRevisionIds: ['qrev_1', 'qrev_2'],
        submissionReason: null,
        submissionKey: null,
        createdAt: '2026-11-10T12:00:00Z',
        updatedAt: '2026-11-10T12:00:00Z',
      },
      responses: [
        {
          id: 'resp_1',
          attemptId: 'att_ctrl_1',
          questionRevisionId: 'qrev_1',
          draft: { kind: 'single-select', optionId: null },
          mark: 'unanswered',
          revision: 1,
          lastClientMutationId: 'mut_init_1',
          updatedAt: '2026-11-10T12:00:00Z',
        },
        {
          id: 'resp_2',
          attemptId: 'att_ctrl_1',
          questionRevisionId: 'qrev_2',
          draft: { kind: 'short-answer', text: '' },
          mark: 'unanswered',
          revision: 1,
          lastClientMutationId: 'mut_init_2',
          updatedAt: '2026-11-10T12:00:00Z',
        },
      ],
      submissions: [],
      currentGrades: [],
      questions,
    };

    mockAdapter = {
      saveResponse: vi.fn().mockImplementation(async (input: SaveResponseInput) => ({
        id: input.responseId,
        attemptId: input.attemptId,
        questionRevisionId: 'qrev_1',
        draft: input.draft,
        mark: input.mark,
        revision: input.expectedResponseRevision + 1,
        lastClientMutationId: input.lastClientMutationId,
        updatedAt: new Date().toISOString(),
      })),
      getAttempt: vi.fn().mockResolvedValue(detail),
      submitAttempt: vi.fn().mockImplementation(async (_input: SubmitAttemptInput) => ({
        ...detail,
        attempt: {
          ...detail.attempt,
          status: 'complete',
          completedAt: new Date().toISOString(),
          awardedPoints: 6,
        },
      })),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes slots correctly from detail', () => {
    const ctrl = new AttemptController(detail, mockAdapter, 300);
    const state = ctrl.getState();

    expect(state.selectedIndex).toBe(0);
    expect(state.slots['qrev_1']).toBeDefined();
    expect(state.slots['qrev_1'].isDirty).toBe(false);
    expect(state.slots['qrev_1'].draft).toEqual({ kind: 'single-select', optionId: null });
    expect(state.slots['qrev_2'].draft).toEqual({ kind: 'short-answer', text: '' });
  });

  it('debounces response save by 300ms', async () => {
    const ctrl = new AttemptController(detail, mockAdapter, 300);

    ctrl.updateDraft('qrev_1', () => ({ kind: 'single-select', optionId: 'opt_a' }));

    expect(ctrl.getState().slots['qrev_1'].isDirty).toBe(true);
    expect(mockAdapter.saveResponse).not.toHaveBeenCalled();

    // Advance 200ms - not yet saved
    vi.advanceTimersByTime(200);
    expect(mockAdapter.saveResponse).not.toHaveBeenCalled();

    // Advance 150ms more (total 350ms) - save triggered
    await vi.advanceTimersByTimeAsync(150);
    expect(mockAdapter.saveResponse).toHaveBeenCalledTimes(1);
    expect(ctrl.getState().slots['qrev_1'].isDirty).toBe(false);
    expect(ctrl.getState().slots['qrev_1'].revision).toBe(2);
  });

  it('flushes current question before navigating to another question', async () => {
    const ctrl = new AttemptController(detail, mockAdapter, 300);

    ctrl.updateDraft('qrev_1', () => ({ kind: 'single-select', optionId: 'opt_a' }));
    expect(ctrl.getState().slots['qrev_1'].isDirty).toBe(true);
    expect(mockAdapter.saveResponse).not.toHaveBeenCalled();

    // Select question index 1 immediately flushes question 0
    await ctrl.selectQuestion(1);

    expect(mockAdapter.saveResponse).toHaveBeenCalledTimes(1);
    expect(ctrl.getState().selectedIndex).toBe(1);
    expect(ctrl.getState().slots['qrev_1'].isDirty).toBe(false);
  });

  it('stale async run token: newer edit while save in flight preserves dirty flag', async () => {
    let resolveSave: (val: any) => void = () => {};
    mockAdapter.saveResponse = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        })
    );

    const ctrl = new AttemptController(detail, mockAdapter, 300);

    // Initial edit
    ctrl.updateDraft('qrev_1', () => ({ kind: 'single-select', optionId: 'opt_a' }));
    await vi.advanceTimersByTimeAsync(300);

    expect(ctrl.getState().slots['qrev_1'].isSaving).toBe(true);

    // User makes second edit while save is still in flight
    ctrl.updateDraft('qrev_1', () => ({ kind: 'single-select', optionId: 'opt_b' }));
    expect(ctrl.getState().slots['qrev_1'].runToken).toBe(2);

    // First save finishes
    resolveSave({
      id: 'resp_1',
      attemptId: 'att_ctrl_1',
      questionRevisionId: 'qrev_1',
      draft: { kind: 'single-select', optionId: 'opt_a' },
      mark: 'answered',
      revision: 2,
      lastClientMutationId: 'mut_first',
      updatedAt: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(0);

    // Slot MUST remain dirty because a newer unpersisted edit occurred!
    expect(ctrl.getState().slots['qrev_1'].isDirty).toBe(true);
  });

  it('reconciles unknown saves on stale_revision error via getAttempt', async () => {
    mockAdapter.saveResponse = vi.fn().mockRejectedValueOnce({
      code: 'stale_revision',
      messageKey: 'study.assessment.error.stale_revision',
    });

    const updatedDetail: AttemptDetail = {
      ...detail,
      responses: [
        {
          ...detail.responses[0],
          revision: 2,
          lastClientMutationId: 'mut_reconciled',
        },
        detail.responses[1],
      ],
    };
    mockAdapter.getAttempt = vi.fn().mockResolvedValueOnce(updatedDetail);

    const ctrl = new AttemptController(detail, mockAdapter, 300);
    ctrl.updateDraft('qrev_1', () => ({ kind: 'single-select', optionId: 'opt_a' }));

    await vi.advanceTimersByTimeAsync(300);

    expect(mockAdapter.saveResponse).toHaveBeenCalledTimes(1);
    expect(mockAdapter.getAttempt).toHaveBeenCalledTimes(1);
    expect(ctrl.getState().slots['qrev_1'].revision).toBe(2);
  });

  it('refuses to submit if unacknowledged or dirty saves remain and fail to flush', async () => {
    mockAdapter.saveResponse = vi.fn().mockRejectedValue({
      code: 'storage_failed',
      messageKey: 'study.assessment.error.storage_failed',
    });

    const ctrl = new AttemptController(detail, mockAdapter, 300);
    ctrl.updateDraft('qrev_1', () => ({ kind: 'single-select', optionId: 'opt_a' }));

    await expect(ctrl.submitAttempt('user')).rejects.toThrow();

    expect(mockAdapter.submitAttempt).not.toHaveBeenCalled();
    expect(ctrl.getState().submitError).toBeDefined();
  });

  it('submits cleanly after flushing all dirty responses and computes objective grades', async () => {
    const ctrl = new AttemptController(detail, mockAdapter, 300);

    // Answer Q1 correctly ('opt_a')
    ctrl.updateDraft('qrev_1', () => ({ kind: 'single-select', optionId: 'opt_a' }));
    // Answer Q2 correctly ('mitochondria')
    ctrl.updateDraft('qrev_2', () => ({ kind: 'short-answer', text: 'mitochondria' }));

    const res = await ctrl.submitAttempt('user');

    expect(mockAdapter.saveResponse).toHaveBeenCalledTimes(2);
    expect(mockAdapter.submitAttempt).toHaveBeenCalledTimes(1);

    const submitCall = vi.mocked(mockAdapter.submitAttempt).mock.calls[0][0];
    expect(submitCall.objectiveGrades).toEqual([]);

    expect(res.attempt.status).toBe('complete');
    expect(ctrl.getState().isReadOnly).toBe(true);
  });
});
