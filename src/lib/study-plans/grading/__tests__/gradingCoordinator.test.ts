import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runGradingCoordinator } from '../gradingCoordinator';
import type {
  AttemptDetail,
  ResponseSubmission,
  GradeSettlementOutcome,
} from '../../../../types/assessmentSessions';
import type {
  ShortAnswerQuestion,
  EssayQuestion,
  AssessmentQuestionRevision,
} from '../../../../types/assessmentQuestions';
import type {
  StudyGenerationJob,
  StudyGenerationStep,
  StartStudyJobInput,
  CompleteStudyStepInput,
  FailStudyStepInput,
} from '../../generation/types';

describe('gradingCoordinator', () => {
  const shortAnswerQ: ShortAnswerQuestion = {
    schemaVersion: 1,
    kind: 'short-answer',
    prompt: 'What is the role of ATP synthase?',
    maxPoints: 4,
    sourceRefIds: ['ref_1'],
    difficulty: 3,
    applicationLevel: 'recall',
    hints: [],
    explanation: 'ATP synthase',
    learningObjectives: [],
    referenceAnswer: 'Synthesizes ATP from ADP and inorganic phosphate.',
    keyFacts: [{ id: 'kf_1', text: 'Synthesizes ATP', required: true }],
    acceptedAnswers: [],
    rubric: {
      schemaVersion: 1,
      expectedConcepts: ['ATP'],
      gradingConstraints: [],
      criteria: [
        {
          id: 'crit_1',
          title: 'Synthesis Function',
          assessmentInstruction: 'Evaluate function',
          grounding: 'reasoning',
          sourceRefIds: [],
          keyFactIds: [],
          weight: 1,
          levels: {
            0: 'Missing',
            1: 'Vague',
            2: 'Partial',
            3: 'Good',
            4: 'Complete',
          },
        },
      ],
    },
  };

  const essayQ: EssayQuestion = {
    schemaVersion: 1,
    kind: 'essay',
    prompt: 'Describe oxidative phosphorylation.',
    maxPoints: 8,
    sourceRefIds: ['ref_2'],
    difficulty: 4,
    applicationLevel: 'comprehension',
    hints: [],
    explanation: 'Oxidative phosphorylation',
    learningObjectives: [],
    expectedReasoning: 'Electron transport chain creates proton gradient...',
    rubric: {
      schemaVersion: 1,
      expectedConcepts: ['proton gradient'],
      gradingConstraints: [],
      criteria: [
        {
          id: 'crit_2',
          title: 'Proton Gradient Mechanism',
          assessmentInstruction: 'Evaluate mechanism',
          grounding: 'reasoning',
          sourceRefIds: [],
          keyFactIds: [],
          weight: 2,
          levels: {
            0: 'Missing',
            1: 'Minimal',
            2: 'Basic',
            3: 'Proficient',
            4: 'Mastery',
          },
        },
      ],
    },
  };

  const shortAnswerQRev: AssessmentQuestionRevision = {
    id: 'q_sa',
    questionId: 'qid_sa',
    blueprintRevisionId: 'bpr_1',
    revision: 1,
    slotKey: 'slot_1',
    fingerprint: 'fp_sa',
    question: shortAnswerQ,
    validation: 'valid',
    committedAt: '2026-11-10T12:00:00Z',
    provider: null,
    createdAt: '2026-11-10T12:00:00Z',
  };

  const essayQRev: AssessmentQuestionRevision = {
    id: 'q_essay',
    questionId: 'qid_essay',
    blueprintRevisionId: 'bpr_1',
    revision: 1,
    slotKey: 'slot_2',
    fingerprint: 'fp_essay',
    question: essayQ,
    validation: 'valid',
    committedAt: '2026-11-10T12:00:00Z',
    provider: null,
    createdAt: '2026-11-10T12:00:00Z',
  };

  const mockAttemptDetail: AttemptDetail = {
    attempt: {
      id: 'att_100',
      blueprintRevisionId: 'bpr_1',
      blueprintTitle: 'Cell Biology',
      mode: 'exam',
      status: 'submitted',
      startedAt: '2026-11-10T12:00:00Z',
      deadlineAt: null,
      submittedAt: '2026-11-10T12:30:00Z',
      completedAt: null,
      awardedPoints: null,
      maximumPoints: 12,
      clientStartKey: 'k_1',
      revision: 2,
      questionRevisionIds: ['q_sa', 'q_essay'],
      submissionReason: 'user',
      submissionKey: 'subm_1',
      createdAt: '2026-11-10T12:00:00Z',
      updatedAt: '2026-11-10T12:30:00Z',
    },
    responses: [],
    submissions: [
      {
        id: 'sub_1',
        responseId: 'resp_1',
        attemptId: 'att_100',
        questionRevisionId: 'q_sa',
        ordinal: 1,
        kind: 'exam-final',
        mark: 'answered',
        hintLevel: 0,
        response: { kind: 'short-answer', text: 'It synthesizes ATP using the electrochemical proton gradient.' },
        createdAt: '2026-11-10T12:15:00Z',
      },
    ],
    currentGrades: [],
  };

  let mockStartJob: ReturnType<typeof vi.fn>;
  let mockClaimStep: ReturnType<typeof vi.fn>;
  let mockCompleteStep: ReturnType<typeof vi.fn>;
  let mockFailStep: ReturnType<typeof vi.fn>;
  let mockCancelJob: ReturnType<typeof vi.fn>;
  let mockGetAttempt: ReturnType<typeof vi.fn>;
  let mockRecordRubricGrade: ReturnType<typeof vi.fn>;
  let mockRunPinnedTask: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStartJob = vi.fn().mockImplementation(async (input: StartStudyJobInput): Promise<StudyGenerationJob> => ({
      id: 'job_grad_1',
      kind: 'exam-grading',
      targetId: input.targetId,
      targetRevision: input.targetRevision,
      requestHash: input.requestHash,
      creationKey: input.creationKey,
      status: 'running',
      nextStepIndex: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      cancellationEpoch: 1,
      attemptCount: 1,
      preflight: input.preflight,
      progress: { completed: 0, total: input.steps.length, labelKey: 'study.grading.progress.grading' },
      lastError: null,
      createdAt: '2026-11-10T12:30:00Z',
      updatedAt: '2026-11-10T12:30:00Z',
    }));

    mockClaimStep = vi.fn().mockImplementation(async (jobId, stepKey): Promise<StudyGenerationStep> => ({
      jobId,
      stepKey,
      ordinal: 0,
      inputHash: 'hash_1',
      status: 'running',
      outputRefId: null,
      safeError: null,
      completedAt: null,
    }));

    mockCompleteStep = vi.fn().mockResolvedValue({
      completed: 1,
      total: 1,
      labelKey: 'study.grading.progress.grading',
    });

    mockFailStep = vi.fn().mockResolvedValue({
      completed: 0,
      total: 1,
      labelKey: 'study.grading.progress.grading',
    });

    mockCancelJob = vi.fn().mockResolvedValue(undefined);

    mockGetAttempt = vi.fn().mockResolvedValue(mockAttemptDetail);

    mockRecordRubricGrade = vi.fn().mockResolvedValue({
      gradeId: 'grd_10',
      isCurrent: true,
      supersedesGradeId: null,
      attemptStatus: 'complete',
      attemptAwardedPoints: 4,
      attemptRevision: 3,
    } as GradeSettlementOutcome);

    mockRunPinnedTask = vi.fn().mockResolvedValue({
      output: {
        schemaVersion: 1,
        criteria: [
          {
            criterionId: 'crit_1',
            status: 'assessed',
            level: 4,
            answerEvidence: 'synthesizes ATP',
            rationale: 'Identified synthesis function correctly.',
            missingConcepts: [],
            misconception: null,
            sourceRefIds: ['s_0'],
          },
        ],
        assessment: {
          score: 1.0,
          completeness: 'complete',
          confidence: 'high',
          feedback: 'Accurate and concise explanation.',
          missingConcepts: [],
          misconceptions: [],
        },
        limitations: [],
      },
      provenance: {
        provider: 'local',
        model: 'qwen2.5:7b',
        taskType: 'study-rubric-grade',
      },
    });
  });

  it('completes happy path: claims, grades, records rubric grade and completes step', async () => {
    const result = await runGradingCoordinator({
      attemptDetail: mockAttemptDetail,
      questions: [shortAnswerQRev],
      deps: {
        startJobFn: mockStartJob as any,
        claimStepFn: mockClaimStep as any,
        completeStepFn: mockCompleteStep as any,
        failStepFn: mockFailStep as any,
        cancelJobFn: mockCancelJob as any,
        getAttemptFn: mockGetAttempt as any,
        recordRubricGradeFn: mockRecordRubricGrade as any,
        runPinnedTaskFn: mockRunPinnedTask as any,
      },
    });

    expect(result.jobId).toBe('job_grad_1');
    expect(result.completedSteps).toBe(1);
    expect(mockStartJob).toHaveBeenCalledTimes(1);
    expect(mockClaimStep).toHaveBeenCalledWith('job_grad_1', 'grade:sub_1', expect.any(String), 1);
    expect(mockRunPinnedTask).toHaveBeenCalledTimes(1);
    expect(mockRecordRubricGrade).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'att_100',
        responseSubmissionId: 'sub_1',
        questionRevisionId: 'q_sa',
        state: 'final',
        points: 4,
        maxPoints: 4,
        normalizedScore: 1,
      })
    );
    expect(mockCompleteStep).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job_grad_1',
        stepKey: 'grade:sub_1',
        status: 'completed',
      })
    );
  });

  it('flags needs-review when criterion is not-assessable and passes points as null', async () => {
    mockRunPinnedTask.mockResolvedValueOnce({
      output: {
        schemaVersion: 1,
        criteria: [
          {
            criterionId: 'crit_1',
            status: 'not-assessable',
            reason: 'Learner gave an ambiguous phrase not mentioning enzyme function.',
          },
        ],
        assessment: {
          score: 0.2,
          completeness: 'minimal',
          confidence: 'low',
          feedback: 'Ambiguous phrase.',
          missingConcepts: ['synthesis'],
          misconceptions: [],
        },
        limitations: ['ambiguous-answer'],
      },
      provenance: {
        provider: 'local',
        model: 'qwen2.5:7b',
        taskType: 'study-rubric-grade',
      },
    });

    await runGradingCoordinator({
      attemptDetail: mockAttemptDetail,
      questions: [shortAnswerQRev],
      deps: {
        startJobFn: mockStartJob as any,
        claimStepFn: mockClaimStep as any,
        completeStepFn: mockCompleteStep as any,
        failStepFn: mockFailStep as any,
        cancelJobFn: mockCancelJob as any,
        getAttemptFn: mockGetAttempt as any,
        recordRubricGradeFn: mockRecordRubricGrade as any,
        runPinnedTaskFn: mockRunPinnedTask as any,
      },
    });

    expect(mockRecordRubricGrade).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'needs-review',
        points: null,
      })
    );
  });

  it('fails step and records failed grade on task exception', async () => {
    mockRunPinnedTask.mockRejectedValueOnce(new Error('Model timeout after 90s'));

    await runGradingCoordinator({
      attemptDetail: mockAttemptDetail,
      questions: [shortAnswerQRev],
      deps: {
        startJobFn: mockStartJob as any,
        claimStepFn: mockClaimStep as any,
        completeStepFn: mockCompleteStep as any,
        failStepFn: mockFailStep as any,
        cancelJobFn: mockCancelJob as any,
        getAttemptFn: mockGetAttempt as any,
        recordRubricGradeFn: mockRecordRubricGrade as any,
        runPinnedTaskFn: mockRunPinnedTask as any,
      },
    });

    expect(mockFailStep).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job_grad_1',
        stepKey: 'grade:sub_1',
        error: expect.objectContaining({ code: 'grading_unavailable' }),
      })
    );

    expect(mockRecordRubricGrade).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'failed',
        points: null,
      })
    );
  });

  it('aborts and cancels job when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runGradingCoordinator({
        attemptDetail: mockAttemptDetail,
        questions: [shortAnswerQRev],
        signal: controller.signal,
        deps: {
          startJobFn: mockStartJob as any,
          claimStepFn: mockClaimStep as any,
          completeStepFn: mockCompleteStep as any,
          failStepFn: mockFailStep as any,
          cancelJobFn: mockCancelJob as any,
          getAttemptFn: mockGetAttempt as any,
          recordRubricGradeFn: mockRecordRubricGrade as any,
          runPinnedTaskFn: mockRunPinnedTask as any,
        },
      })
    ).rejects.toMatchObject({
      code: 'cancelled',
    });

    expect(mockCancelJob).toHaveBeenCalledWith('job_grad_1', 1);
  });

  it('returns immediately if no subjective questions need grading', async () => {
    const emptyDetail = { ...mockAttemptDetail, submissions: [] };

    const result = await runGradingCoordinator({
      attemptDetail: emptyDetail,
      questions: [shortAnswerQRev],
      deps: {
        startJobFn: mockStartJob as any,
      },
    });

    expect(result.jobId).toBe('');
    expect(mockStartJob).not.toHaveBeenCalled();
  });
});
