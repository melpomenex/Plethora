import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getExamAttempt } from '../../../../api/exam-sessions';
import { StudyApiError } from '../../../../api/study-plans';
import { runGradingCoordinator } from '../../../../lib/study-plans/grading/gradingCoordinator';
import { prepareRubricGrading } from '../../../../lib/study-plans/grading/gradingPreflight';
import type { AttemptDetail } from '../../../../types/assessmentSessions';
import { RubricGradingControls } from '../RubricGradingControls';

vi.mock('../../../../api/exam-sessions', () => ({
  getExamAttempt: vi.fn(),
}));

vi.mock('../../../../lib/study-plans/grading/gradingPreflight', () => ({
  prepareRubricGrading: vi.fn(),
}));

vi.mock('../../../../lib/study-plans/grading/gradingCoordinator', () => ({
  runGradingCoordinator: vi.fn(),
}));

describe('RubricGradingControls', () => {
  const sourceRef = {
    schemaVersion: 1 as const,
    id: 'source-ref-current',
    documentId: 'doc-current',
    excerpt: 'A checked source passage.',
    revision: 'revision-current',
    revisionKind: 'content-hash' as const,
    excerptSha256: 'sha256:source-current',
    documentTitle: 'Current Source',
    sourceType: 'pdf',
    capturedAt: '2026-11-10T00:00:00Z',
  };
  const sourceRefs = new Map([[sourceRef.id, sourceRef]]);

  function attemptDetail(revision: number, responseText: string): AttemptDetail {
    return {
      attempt: {
        id: 'attempt-current',
        blueprintRevisionId: 'blueprint-revision-current',
        clientStartKey: 'start-key',
        mode: 'exam',
        status: 'submitted',
        questionRevisionIds: ['question-revision-current'],
        revision,
        startedAt: '2026-11-10T00:00:00Z',
        deadlineAt: null,
        submittedAt: '2026-11-10T00:10:00Z',
        completedAt: null,
        submissionReason: 'user',
        submissionKey: 'submission-key',
        awardedPoints: null,
        maximumPoints: 10,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:10:00Z',
      },
      responses: [],
      submissions: [{
        id: 'submission-current',
        attemptId: 'attempt-current',
        questionRevisionId: 'question-revision-current',
        ordinal: 1,
        kind: 'exam-final',
        response: { text: responseText },
        mark: 'unmarked',
        hintLevel: 0,
        createdAt: '2026-11-10T00:10:00Z',
      }],
      currentGrades: [],
      questions: [{
        id: 'question-revision-current',
        questionId: 'question-current',
        blueprintRevisionId: 'blueprint-revision-current',
        revision: 1,
        slotKey: 'essay-slot',
        fingerprint: 'question-fingerprint',
        question: {
          kind: 'essay',
          prompt: 'Explain the current source evidence.',
          maxPoints: 10,
          rubric: [],
          sourceRefIds: [sourceRef.id],
        },
        validation: 'valid',
        committedAt: '2026-11-10T00:00:00Z',
        provider: null,
        createdAt: '2026-11-10T00:00:00Z',
      }],
    } as unknown as AttemptDetail;
  }

  const initialDetail = attemptDetail(2, 'submitted nonblank answer');
  const currentDetail = attemptDetail(3, 'newly fetched current answer');
  const updatedDetail = attemptDetail(4, 'newly fetched current answer');
  const preflight = {
    providerId: 'synthetic-rubric-route',
    model: {
      configId: 'synthetic-rubric-config',
      provider: 'Synthetic Cloud Provider',
      name: 'Synthetic Rubric Model',
      id: 'synthetic/rubric-model-v3',
      endpointOrigin: 'https://rubric.synthetic.example',
      endpointHash: 'endpoint-hash',
    },
    generationDestination: {
      locality: 'remote' as const,
      providerClass: 'configured-external' as const,
      keyless: false,
      sendsOffDevice: true,
      billable: true,
      requiresDisclosure: true,
      requiresCostConsent: true,
    },
    embeddingDestination: null,
    featureAllowed: true,
    documentIds: ['doc-current'],
    sourceExcerptCount: 1,
    sendsSourceOffDevice: true,
    sendsAnswersOffDevice: true,
    billable: true,
    cloudDisclosureAccepted: false,
    costConsentAccepted: false,
    maximumModelCalls: 2,
  } as any;
  const route = { provider: { id: 'synthetic-rubric-route' } } as any;
  const prepared = { preflight, route, sourceRefs };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows inspection first, gates independently, then grades the current attempt with current sources', async () => {
    vi.mocked(prepareRubricGrading).mockResolvedValue(prepared);
    vi.mocked(getExamAttempt).mockResolvedValue(currentDetail);
    vi.mocked(runGradingCoordinator).mockImplementation(async (options: any) => {
      await options.revalidateSources();
      return { latestAttemptDetail: updatedDetail } as any;
    });
    const onUpdate = vi.fn();

    render(<RubricGradingControls detail={initialDetail} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: /Review AI grading options/i }));

    expect(await screen.findByLabelText('Generation details')).toBeInTheDocument();
    expect(screen.getByText(/Submitted written answers, committed rubrics, and their source excerpts/i)).toBeInTheDocument();
    expect(screen.getByText('synthetic/rubric-model-v3')).toBeInTheDocument();
    const gradeButton = screen.getByRole('button', { name: /Grade written answers/i });
    expect(gradeButton).toBeDisabled();
    expect(prepareRubricGrading).toHaveBeenCalledWith(initialDetail);

    fireEvent.click(screen.getByLabelText(/approve the off-device data transfers/i));
    expect(gradeButton).toBeDisabled();
    expect(runGradingCoordinator).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/authorize the disclosed execution budget/i));
    expect(gradeButton).toBeEnabled();
    fireEvent.click(gradeButton);

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(updatedDetail));
    expect(getExamAttempt).toHaveBeenCalledWith('attempt-current');
    expect(prepareRubricGrading).toHaveBeenCalledWith(currentDetail, expect.objectContaining({
      cloudDisclosureAccepted: true,
      costConsentAccepted: true,
    }));
    const coordinatorOptions = vi.mocked(runGradingCoordinator).mock.calls[0][0];
    expect(coordinatorOptions.attemptDetail).toBe(currentDetail);
    expect(coordinatorOptions.questions).toBe(currentDetail.questions);
    expect(coordinatorOptions.sourceRefs).toBe(sourceRefs);
    expect(coordinatorOptions.preflightRoute).toBe(route);
    expect(prepareRubricGrading).toHaveBeenCalledTimes(3); // inspection, authorization, fresh coordinator revalidation
  });

  it('fails closed when fresh authorization revalidation detects route drift', async () => {
    vi.mocked(prepareRubricGrading)
      .mockResolvedValueOnce(prepared)
      .mockResolvedValueOnce(prepared)
      .mockRejectedValueOnce(new StudyApiError({
        code: 'invalid_state',
        messageKey: 'study_generation.error.provider_changed_on_resume',
        retryable: false,
      }));
    vi.mocked(getExamAttempt).mockResolvedValue(currentDetail);
    vi.mocked(runGradingCoordinator).mockImplementation(async (options: any) => {
      await options.revalidateSources();
      return { latestAttemptDetail: updatedDetail } as any;
    });
    const onUpdate = vi.fn();

    render(<RubricGradingControls detail={initialDetail} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: /Review AI grading options/i }));
    await screen.findByLabelText('Generation details');
    fireEvent.click(screen.getByLabelText(/approve the off-device data transfers/i));
    fireEvent.click(screen.getByLabelText(/authorize the disclosed execution budget/i));
    fireEvent.click(screen.getByRole('button', { name: /Grade written answers/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/model, endpoint, or embedding settings changed/i);
    expect(runGradingCoordinator).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(prepareRubricGrading).toHaveBeenCalledTimes(3);
  });
});
