import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlueprintService } from '../blueprintService';
import * as api from '../../../../api/assessment-blueprints';
import type {
  AssessmentBlueprint,
  AssessmentConfigV1,
  AssessmentQuestionRevision,
  BlueprintDetail,
  BlueprintRevision,
  SingleSelectQuestion,
} from '../../../../types/assessmentQuestions';
import type { StudySourceScopeV1 } from '../../../../types/studySource';

vi.mock('../../../../api/assessment-blueprints', () => ({
  createAssessmentBlueprint: vi.fn(),
  saveAssessmentBlueprintDraft: vi.fn(),
  getAssessmentBlueprintRevision: vi.fn(),
  listAssessmentBlueprints: vi.fn(),
  upsertAssessmentQuestionDraft: vi.fn(),
  publishAssessmentBlueprint: vi.fn(),
  discardAssessmentBlueprintDraft: vi.fn(),
  archiveAssessmentBlueprint: vi.fn(),
  deleteUnusedAssessmentBlueprint: vi.fn(),
}));

describe('BlueprintService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockConfig: AssessmentConfigV1 = {
    schemaVersion: 1,
    mode: 'exam',
    requestedCount: 5,
    typeWeights: { 'single-select': 1 },
    difficultyWeights: { 2: 1 },
    topicTargets: [],
    timeLimitSeconds: null,
    knowledgePolicy: 'source-only',
    excludedQuestionFingerprints: [],
    pointsByKind: {
      'single-select': 1,
      'multi-select': 1,
      cloze: 1,
      'short-answer': 2,
      essay: 8,
    },
  };

  const mockSourceScope: StudySourceScopeV1 = {
    schemaVersion: 1,
    selected: {
      documentIds: [],
      extractIds: [],
      collectionIds: [],
      tagIds: [],
    },
    resolvedDocuments: [],
    frozenAt: '2026-11-10T20:00:00Z',
    indexCompleteness: 'complete',
    limitations: [],
  };

  it('delegates createBlueprint to api with trimmed title', async () => {
    const mockDetail = { blueprint: { id: 'ab_1' } } as BlueprintDetail;
    vi.mocked(api.createAssessmentBlueprint).mockResolvedValueOnce(mockDetail);

    const result = await BlueprintService.createBlueprint({
      title: '  Raft Exam  ',
      config: mockConfig,
      sourceScope: mockSourceScope,
      sourceSnapshotHash: 'sha256:hash',
    });

    expect(result).toBe(mockDetail);
    expect(api.createAssessmentBlueprint).toHaveBeenCalledWith({
      planId: null,
      title: 'Raft Exam',
      planVersionId: null,
      config: mockConfig,
      sourceScope: mockSourceScope,
      sourceSnapshotHash: 'sha256:hash',
    });
  });

  it('validates, encodes, fingerprints and persists question from domain object', async () => {
    const mockQr = { id: 'aqr_1' } as AssessmentQuestionRevision;
    vi.mocked(api.upsertAssessmentQuestionDraft).mockResolvedValueOnce(mockQr);

    const validQuestion: SingleSelectQuestion = {
      schemaVersion: 1,
      kind: 'single-select',
      prompt: 'Which state precedes Candidate in Raft?',
      difficulty: 2,
      learningObjectives: ['Understand Raft state transitions'],
      sourceRefIds: ['ref_raft_1'],
      explanation: 'Follower transitions to Candidate on election timeout.',
      maxPoints: 1,
      applicationLevel: 'recall',
      hints: ['Think of the default state'],
      options: [
        { id: 'opt_1', text: 'Follower' },
        { id: 'opt_2', text: 'Leader' },
      ],
      correctOptionId: 'opt_1',
    };

    const res = await BlueprintService.saveQuestionFromDomain({
      blueprintRevisionId: 'abr_123',
      question: validQuestion,
      slotKey: 'slot_0000',
    });

    expect(res).toBe(mockQr);
    expect(api.upsertAssessmentQuestionDraft).toHaveBeenCalledTimes(1);

    const callArg = vi.mocked(api.upsertAssessmentQuestionDraft).mock.calls[0][0];
    expect(callArg.blueprintRevisionId).toBe('abr_123');
    expect(callArg.slotKey).toBe('slot_0000');
    expect(callArg.kind).toBe('single-select');
    expect(callArg.validation).toBe('valid');
    expect(callArg.maxPoints).toBe(1);
    expect(callArg.fingerprint).toHaveLength(64);

    const payload = JSON.parse(callArg.payloadJson);
    expect(payload.prompt).toBe(validQuestion.prompt);
    expect(payload.options).toHaveLength(2);
    expect(payload.correctOptionId).toBeUndefined(); // Key must not leak into payload!

    const answerKey = JSON.parse(callArg.answerKeyJson);
    expect(answerKey.correctOptionId).toBe('opt_1');
  });

  it('hydrates stored questions using decodeQuestionRevision', () => {
    const detail: BlueprintDetail = {
      blueprint: { id: 'ab_1' } as AssessmentBlueprint,
      revision: { id: 'abr_1' } as BlueprintRevision,
      questions: [
        {
          id: 'aqr_1',
          questionId: 'aq_1',
          blueprintRevisionId: 'abr_1',
          revision: 1,
          slotKey: 'slot_0000',
          fingerprint: 'sha256:fp',
          question: {
            schemaVersion: 1,
            kind: 'single-select',
            prompt: 'Question 1',
            difficulty: 2,
            learningObjectives: [],
            sourceRefIds: [],
            explanation: '',
            maxPoints: 1,
            applicationLevel: 'recall',
            hints: [],
            options: [
              { id: 'o1', text: 'A' },
              { id: 'o2', text: 'B' },
            ],
            correctOptionId: 'o1',
          },
          validation: 'valid',
          validationIssues: [],
          committedAt: null,
          provider: null,
          createdAt: '2026-11-10T20:00:00Z',
        },
      ],
    };

    const hydrated = BlueprintService.hydrateQuestions(detail);
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0].kind).toBe('single-select');
    const mcq = hydrated[0] as SingleSelectQuestion;
    expect(mcq.correctOptionId).toBe('o1');
    expect(mcq.prompt).toBe('Question 1');
  });

  it('delegates publishBlueprint, discard, archive, delete', async () => {
    vi.mocked(api.publishAssessmentBlueprint).mockResolvedValueOnce({} as BlueprintDetail);
    vi.mocked(api.discardAssessmentBlueprintDraft).mockResolvedValueOnce(undefined);
    vi.mocked(api.archiveAssessmentBlueprint).mockResolvedValueOnce(undefined);
    vi.mocked(api.deleteUnusedAssessmentBlueprint).mockResolvedValueOnce(undefined);

    await BlueprintService.publishBlueprint('abr_1', 1, true);
    expect(api.publishAssessmentBlueprint).toHaveBeenCalledWith('abr_1', 1, true);

    await BlueprintService.discardBlueprintDraft('abr_1', 1);
    expect(api.discardAssessmentBlueprintDraft).toHaveBeenCalledWith('abr_1', 1);

    await BlueprintService.archiveBlueprint('ab_1', 2);
    expect(api.archiveAssessmentBlueprint).toHaveBeenCalledWith('ab_1', 2);

    await BlueprintService.deleteUnusedBlueprint('ab_1', 3);
    expect(api.deleteUnusedAssessmentBlueprint).toHaveBeenCalledWith('ab_1', 3);
  });
});
