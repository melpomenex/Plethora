import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PracticeCheckPanel } from '../PracticeCheckPanel';
import { AttemptRunner } from '../AttemptRunner';
import * as examApi from '../../../../api/exam-sessions';
import type { AssessmentQuestionRevision } from '../../../../types/assessmentQuestions';
import type { ResponseSlotState } from '../../../../lib/study-plans/attempts/attemptController';
import type { AttemptDetail, PracticeCheckResult } from '../../../../types/assessmentSessions';

vi.mock('../../../../api/exam-sessions', () => ({
  saveExamResponse: vi.fn(),
  getExamAttempt: vi.fn(),
  submitExamAttempt: vi.fn(),
  checkPracticeResponse: vi.fn(),
  cancelExamAttempt: vi.fn(),
}));

describe('PracticeCheck Component & Integration', () => {
  let questionRevision: AssessmentQuestionRevision;
  let slot: ResponseSlotState;

  beforeEach(() => {
    vi.clearAllMocks();

    questionRevision = {
      id: 'qrev_prac_1',
      questionId: 'q_p1',
      blueprintRevisionId: 'bpr_p1',
      revision: 1,
      slotKey: 'slot_0',
      fingerprint: 'fp_p1',
      validation: 'valid',
      committedAt: '2026-11-10T12:00:00Z',
      provider: null,
      createdAt: '2026-11-10T12:00:00Z',
      question: {
        schemaVersion: 1,
        kind: 'single-select',
        prompt: 'What organelle produces ATP?',
        learningObjectives: [],
        explanation: 'Mitochondria generates ATP through oxidative phosphorylation.',
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
    };

    slot = {
      responseId: 'resp_p1',
      questionRevisionId: 'qrev_prac_1',
      draft: { kind: 'single-select', optionId: 'opt_a' },
      mark: 'answered',
      revision: 1,
      lastSavedRevision: 1,
      isDirty: false,
      isSaving: false,
      error: null,
      lastClientMutationId: 'mut_init',
      runToken: 0,
    };
  });

  it('checks practice response and reveals correct feedback & explanation', async () => {
    const mockCheckResult: PracticeCheckResult = {
      submission: {
        id: 'subm_p1',
        responseId: 'resp_p1',
        questionRevisionId: 'qrev_prac_1',
        attemptId: 'att_p1',
        ordinal: 1,
        kind: 'practice-check',
        response: { kind: 'single-select', optionId: 'opt_a' },
        mark: 'answered',
        hintLevel: 0,
        createdAt: '2026-11-10T12:05:00Z',
      },
      grade: {
        id: 'grd_p1',
        responseSubmissionId: 'subm_p1',
        questionRevisionId: 'qrev_prac_1',
        origin: 'deterministic',
        state: 'final',
        points: 2,
        maxPoints: 2,
        outcome: 'correct',
        assessment: null,
        criteria: [],
        provenance: null,
        manualReason: null,
        supersedesGradeId: null,
        isCurrent: true,
        createdAt: '2026-11-10T12:05:00Z',
      },
      attemptRevision: 2,
    };

    vi.mocked(examApi.checkPracticeResponse).mockResolvedValueOnce(mockCheckResult);
    const onCheckSuccess = vi.fn();

    render(
      <PracticeCheckPanel
        questionRevision={questionRevision}
        attemptId="att_p1"
        attemptRevision={1}
        slot={slot}
        onCheckSuccess={onCheckSuccess}
      />
    );

    const checkBtn = screen.getByRole('button', { name: /Check Answer/i });
    fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(examApi.checkPracticeResponse).toHaveBeenCalledTimes(1);
      expect(onCheckSuccess).toHaveBeenCalledWith(mockCheckResult);
    });

    expect(screen.getByText('Correct!')).toBeInTheDocument();
    expect(screen.getByText(/Great work! You scored full credit/i)).toBeInTheDocument();
    expect(screen.getByText(/Committed Explanation/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Mitochondria generates ATP through oxidative phosphorylation/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Round 1')).toBeInTheDocument();
  });

  it('handles repeat rounds with incremental ordinals', async () => {
    const round1Result: PracticeCheckResult = {
      submission: {
        id: 'subm_r1',
        responseId: 'resp_p1',
        questionRevisionId: 'qrev_prac_1',
        attemptId: 'att_p1',
        ordinal: 1,
        kind: 'practice-check',
        response: { kind: 'single-select', optionId: 'opt_b' },
        mark: 'answered',
        hintLevel: 0,
        createdAt: '2026-11-10T12:05:00Z',
      },
      grade: {
        id: 'grd_r1',
        responseSubmissionId: 'subm_r1',
        questionRevisionId: 'qrev_prac_1',
        origin: 'deterministic',
        state: 'final',
        points: 0,
        maxPoints: 2,
        outcome: 'incorrect',
        assessment: null,
        criteria: [],
        provenance: null,
        manualReason: null,
        supersedesGradeId: null,
        isCurrent: true,
        createdAt: '2026-11-10T12:05:00Z',
      },
      attemptRevision: 2,
    };

    const round2Result: PracticeCheckResult = {
      submission: {
        id: 'subm_r2',
        responseId: 'resp_p1',
        questionRevisionId: 'qrev_prac_1',
        attemptId: 'att_p1',
        ordinal: 2,
        kind: 'practice-check',
        response: { kind: 'single-select', optionId: 'opt_a' },
        mark: 'answered',
        hintLevel: 0,
        createdAt: '2026-11-10T12:06:00Z',
      },
      grade: {
        id: 'grd_r2',
        responseSubmissionId: 'subm_r2',
        questionRevisionId: 'qrev_prac_1',
        origin: 'deterministic',
        state: 'final',
        points: 2,
        maxPoints: 2,
        outcome: 'correct',
        assessment: null,
        criteria: [],
        provenance: null,
        manualReason: null,
        supersedesGradeId: null,
        isCurrent: true,
        createdAt: '2026-11-10T12:06:00Z',
      },
      attemptRevision: 3,
    };

    vi.mocked(examApi.checkPracticeResponse)
      .mockResolvedValueOnce(round1Result)
      .mockResolvedValueOnce(round2Result);

    const { rerender } = render(
      <PracticeCheckPanel
        questionRevision={questionRevision}
        attemptId="att_p1"
        attemptRevision={1}
        slot={{ ...slot, draft: { kind: 'single-select', optionId: 'opt_b' } }}
      />
    );

    // Round 1 (incorrect)
    fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));

    await waitFor(() => {
      expect(screen.getByText('Not Quite')).toBeInTheDocument();
      expect(screen.getByText('Round 1')).toBeInTheDocument();
    });

    // Rerender with revised slot answer
    rerender(
      <PracticeCheckPanel
        questionRevision={questionRevision}
        attemptId="att_p1"
        attemptRevision={2}
        slot={{ ...slot, draft: { kind: 'single-select', optionId: 'opt_a' } }}
      />
    );

    // Round 2 (correct)
    fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));

    await waitFor(() => {
      expect(screen.getByText('Correct!')).toBeInTheDocument();
      expect(screen.getByText('Round 2')).toBeInTheDocument();
    });
  });

  it('AttemptRunner in Exam mode strictly conceals Practice Check and explanations', () => {
    const examDetail: AttemptDetail = {
      attempt: {
        id: 'att_exam_mode',
        blueprintRevisionId: 'bpr_p1',
        blueprintTitle: 'Cell Biology Strict Exam',
        mode: 'exam',
        status: 'in-progress',
        startedAt: new Date().toISOString(),
        deadlineAt: null,
        submittedAt: null,
        completedAt: null,
        awardedPoints: null,
        maximumPoints: 2,
        clientStartKey: 'start_strict',
        revision: 1,
        questionRevisionIds: ['qrev_prac_1'],
        submissionReason: null,
        submissionKey: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      responses: [
        {
          id: 'resp_p1',
          attemptId: 'att_exam_mode',
          questionRevisionId: 'qrev_prac_1',
          draft: { kind: 'single-select', optionId: 'opt_a' },
          mark: 'answered',
          revision: 1,
          lastClientMutationId: 'mut_1',
          updatedAt: new Date().toISOString(),
        },
      ],
      submissions: [],
      currentGrades: [],
      questions: [questionRevision],
    };

    render(<AttemptRunner detail={examDetail} onComplete={vi.fn()} onExit={vi.fn()} />);

    // In exam mode, Check Answer button and explanations MUST NOT exist!
    expect(screen.queryByRole('button', { name: /Check Answer/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Committed Explanation/i)).not.toBeInTheDocument();
  });
});
