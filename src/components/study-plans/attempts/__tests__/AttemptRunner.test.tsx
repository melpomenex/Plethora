import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttemptRunner } from '../AttemptRunner';
import * as examApi from '../../../../api/exam-sessions';
import type { AttemptDetail } from '../../../../types/assessmentSessions';
import type { AssessmentQuestionRevision } from '../../../../types/assessmentQuestions';

vi.mock('../../../../api/exam-sessions', () => ({
  saveExamResponse: vi.fn(),
  getExamAttempt: vi.fn(),
  submitExamAttempt: vi.fn(),
  checkPracticeResponse: vi.fn(),
  cancelExamAttempt: vi.fn(),
}));

describe('AttemptRunner Component', () => {
  let mockDetail: AttemptDetail;
  let questions: AssessmentQuestionRevision[];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(examApi.saveExamResponse).mockImplementation(async (input: any) => ({
      id: input.responseId,
      attemptId: input.attemptId,
      questionRevisionId: 'qrev_1',
      draft: input.draft,
      mark: input.mark,
      revision: input.expectedResponseRevision + 1,
      lastClientMutationId: input.lastClientMutationId,
      updatedAt: new Date().toISOString(),
    }));

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
          explanation: 'Maintaining balance.',
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
          difficulty: 2,
        },
      },
    ];

    mockDetail = {
      attempt: {
        id: 'att_run_1',
        blueprintRevisionId: 'bpr_1',
        blueprintTitle: 'Cell Biology Midterm',
        mode: 'exam',
        status: 'in-progress',
        startedAt: new Date(Date.now() - 60000).toISOString(),
        deadlineAt: new Date(Date.now() + 1800000).toISOString(), // 30 mins ahead
        submittedAt: null,
        completedAt: null,
        awardedPoints: null,
        maximumPoints: 6,
        clientStartKey: 'start_run_1',
        revision: 1,
        questionRevisionIds: ['qrev_1', 'qrev_2'],
        submissionReason: null,
        submissionKey: null,
        createdAt: new Date(Date.now() - 60000).toISOString(),
        updatedAt: new Date(Date.now() - 60000).toISOString(),
      },
      responses: [
        {
          id: 'resp_1',
          attemptId: 'att_run_1',
          questionRevisionId: 'qrev_1',
          draft: { kind: 'single-select', optionId: null },
          mark: 'unanswered',
          revision: 1,
          lastClientMutationId: 'mut_1',
          updatedAt: new Date(Date.now() - 60000).toISOString(),
        },
        {
          id: 'resp_2',
          attemptId: 'att_run_1',
          questionRevisionId: 'qrev_2',
          draft: { kind: 'short-answer', text: '' },
          mark: 'unanswered',
          revision: 1,
          lastClientMutationId: 'mut_2',
          updatedAt: new Date(Date.now() - 60000).toISOString(),
        },
      ],
      submissions: [],
      currentGrades: [],
      questions,
    };
  });

  it('renders attempt header, question 1, and progress bar', () => {
    render(<AttemptRunner detail={mockDetail} onComplete={vi.fn()} onExit={vi.fn()} />);

    expect(screen.getByText('Cell Biology Midterm')).toBeInTheDocument();
    expect(screen.getByText('Question 1')).toBeInTheDocument();
    expect(screen.getByText('What organelle produces ATP?')).toBeInTheDocument();
    expect(screen.getByText(/2 Points/i)).toBeInTheDocument();
  });

  it('navigates sequentially using Next button', () => {
    render(<AttemptRunner detail={mockDetail} onComplete={vi.fn()} onExit={vi.fn()} />);

    expect(screen.getByText('What organelle produces ATP?')).toBeInTheDocument();

    const nextBtn = screen.getByRole('button', { name: /Next Question/i });
    fireEvent.click(nextBtn);

    expect(screen.getByText('Define homeostasis.')).toBeInTheDocument();
    expect(screen.getByText('Question 2')).toBeInTheDocument();
  });

  it('toggles skip on a question', () => {
    render(<AttemptRunner detail={mockDetail} onComplete={vi.fn()} onExit={vi.fn()} />);

    const skipBtn = screen.getByRole('button', { name: /Mark as skipped/i });
    fireEvent.click(skipBtn);

    expect(screen.getByRole('button', { name: /Unmark skip/i })).toBeInTheDocument();
  });

  it('opens submit modal and handles confirmation submission', async () => {
    const onComplete = vi.fn();
    const completedDetail: AttemptDetail = {
      ...mockDetail,
      attempt: {
        ...mockDetail.attempt,
        status: 'complete',
        completedAt: new Date().toISOString(),
        awardedPoints: 6,
      },
    };
    vi.mocked(examApi.submitExamAttempt).mockResolvedValueOnce(completedDetail);

    render(<AttemptRunner detail={mockDetail} onComplete={onComplete} onExit={vi.fn()} />);

    // Click header Submit button to open modal
    const submitBtn = screen.getByRole('button', { name: /Submit/i });
    fireEvent.click(submitBtn);

    expect(screen.getByRole('dialog', { name: /Submit Examination/i })).toBeInTheDocument();
    expect(screen.getByText(/You have 2 unanswered/i)).toBeInTheDocument();

    // Confirm submission
    const confirmBtn = screen.getByRole('button', { name: /Confirm & Submit/i });
    fireEvent.click(confirmBtn);

    await vi.waitFor(() => {
      expect(examApi.submitExamAttempt).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(completedDetail);
    });
  });
});
