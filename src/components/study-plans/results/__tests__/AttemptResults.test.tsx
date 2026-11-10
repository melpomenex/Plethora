import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttemptResults } from '../AttemptResults';
import * as examApi from '../../../../api/exam-sessions';
import type { AttemptDetail } from '../../../../types/assessmentSessions';
import type { AssessmentQuestionRevision } from '../../../../types/assessmentQuestions';

vi.mock('../../../../api/exam-sessions', () => ({
  startExamAttempt: vi.fn(),
  getExamAttempt: vi.fn(),
}));

vi.mock('../../../../lib/study-plans/openStudySource', () => ({
  openStudySource: vi.fn(),
}));

describe('AttemptResults Component', () => {
  let mockDetail: AttemptDetail;
  let questions: AssessmentQuestionRevision[];

  beforeEach(() => {
    vi.clearAllMocks();

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
          prompt: 'What organelle produces ATP?',
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
          prompt: 'Define homeostasis.',
          learningObjectives: [],
          explanation: 'Dynamic equilibrium.',
          sourceRefIds: [],
          applicationLevel: 'recall',
          hints: [],
          referenceAnswer: 'Maintaining stable internal balance.',
          keyFacts: [],
          acceptedAnswers: ['balance'],
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

    mockDetail = {
      attempt: {
        id: 'att_res_1',
        blueprintRevisionId: 'bpr_1',
        blueprintTitle: 'Biology Exam Final',
        mode: 'exam',
        status: 'complete',
        startedAt: '2026-11-10T12:00:00Z',
        deadlineAt: '2026-11-10T12:45:00Z',
        submittedAt: '2026-11-10T12:35:00Z',
        completedAt: '2026-11-10T12:35:00Z',
        awardedPoints: 6,
        maximumPoints: 6,
        clientStartKey: 'start_key_res',
        revision: 2,
        questionRevisionIds: ['qrev_1', 'qrev_2'],
        submissionReason: 'user',
        submissionKey: 'sub_key_1',
        createdAt: '2026-11-10T12:00:00Z',
        updatedAt: '2026-11-10T12:35:00Z',
      },
      responses: [
        {
          id: 'resp_1',
          attemptId: 'att_res_1',
          questionRevisionId: 'qrev_1',
          draft: { kind: 'single-select', optionId: 'opt_a' },
          mark: 'answered',
          revision: 2,
          lastClientMutationId: 'mut_1',
          updatedAt: '2026-11-10T12:10:00Z',
        },
        {
          id: 'resp_2',
          attemptId: 'att_res_1',
          questionRevisionId: 'qrev_2',
          draft: { kind: 'short-answer', text: 'balance' },
          mark: 'answered',
          revision: 2,
          lastClientMutationId: 'mut_2',
          updatedAt: '2026-11-10T12:20:00Z',
        },
      ],
      submissions: [],
      currentGrades: [
        {
          id: 'grd_1',
          responseSubmissionId: 'subm_1',
          questionRevisionId: 'qrev_1',
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
          createdAt: '2026-11-10T12:35:00Z',
        },
        {
          id: 'grd_2',
          responseSubmissionId: 'subm_2',
          questionRevisionId: 'qrev_2',
          origin: 'deterministic',
          state: 'final',
          points: 4,
          maxPoints: 4,
          outcome: 'correct',
          assessment: null,
          criteria: [],
          provenance: null,
          manualReason: null,
          supersedesGradeId: null,
          isCurrent: true,
          createdAt: '2026-11-10T12:35:00Z',
        },
      ],
      questions,
    };
  });

  it('renders score summary, question cards, and committed explanations', () => {
    render(<AttemptResults detail={mockDetail} onBack={vi.fn()} />);

    expect(screen.getByText('Biology Exam Final — Results')).toBeInTheDocument();
    expect(screen.getByText('(100%)')).toBeInTheDocument();
    expect(screen.getByText('What organelle produces ATP?')).toBeInTheDocument();
    expect(screen.getByText('Define homeostasis.')).toBeInTheDocument();
    expect(screen.getByText('Mitochondria produces ATP.')).toBeInTheDocument();
  });

  it('filters questions by filter tab', () => {
    render(<AttemptResults detail={mockDetail} onBack={vi.fn()} />);

    // Click Incorrect Only filter (both questions are correct, so 0 match)
    const incorrectFilterBtn = screen.getByRole('button', { name: /Incorrect Only/i });
    fireEvent.click(incorrectFilterBtn);

    expect(screen.getByText('No questions match the selected filter.')).toBeInTheDocument();

    // Click All Questions filter
    const allFilterBtn = screen.getByRole('button', { name: /All Questions/i });
    fireEvent.click(allFilterBtn);

    expect(screen.getByText('What organelle produces ATP?')).toBeInTheDocument();
  });

  it('handles retake action generating a fresh attempt', async () => {
    const onRetake = vi.fn();
    const freshAttemptDetail: AttemptDetail = {
      ...mockDetail,
      attempt: {
        ...mockDetail.attempt,
        id: 'att_fresh',
        status: 'in-progress',
        awardedPoints: null,
        clientStartKey: 'new_fresh_key',
      },
    };
    vi.mocked(examApi.startExamAttempt).mockResolvedValueOnce(freshAttemptDetail);

    render(<AttemptResults detail={mockDetail} onBack={vi.fn()} onRetake={onRetake} />);

    const retakeBtn = screen.getByRole('button', { name: /Retake Paper/i });
    fireEvent.click(retakeBtn);

    await vi.waitFor(() => {
      expect(examApi.startExamAttempt).toHaveBeenCalledTimes(1);
      expect(onRetake).toHaveBeenCalledWith(freshAttemptDetail);
    });
  });
});
