import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssessmentBlueprintRevision } from '../../../../api/assessment-blueprints';
import { getStudyAttemptSources, getStudyReadingTrail } from '../../../../api/study-reading';
import type { AssessmentQuestionRevision, BlueprintDetail } from '../../../../types/assessmentQuestions';
import type { ExamAttempt, GradeRecord } from '../../../../types/assessmentSessions';
import type { StudyReadingAssignment } from '../../../../types/studyReading';
import type { StudySourceResolution } from '../../../../types/studySource';
import { questionReadingProps, useAttemptReadingContext } from '../useAttemptReadingContext';

vi.mock('../../../../api/assessment-blueprints', () => ({ getAssessmentBlueprintRevision: vi.fn() }));
vi.mock('../../../../api/study-reading', () => ({
  getStudyAttemptSources: vi.fn(), getStudyReadingTrail: vi.fn(),
}));

const attempt = {
  id: 'attempt', status: 'complete', blueprintRevisionId: 'original-blueprint',
  submittedAt: '2026-11-17T00:00:00Z',
} as ExamAttempt;
const assignment: StudyReadingAssignment = {
  schemaVersion: 1, id: 'reading', topicId: 'topic',
  documentId: 'doc', documentTitle: 'Document', documentRevision: 'original-revision',
  segments: [{ quote: { exact: 'A verified passage.' } }], format: 'markdown',
  sourceRefIds: ['ref'], objectiveIndexes: [0],
};
const evidence = {
  status: 'current', navigation: 'exact',
  ref: { id: 'ref', documentId: 'doc', revision: 'original-revision' },
} as StudySourceResolution;
const question = {
  committedAt: attempt.submittedAt, question: { sourceRefIds: ['ref'] },
} as AssessmentQuestionRevision;
const incorrect = { state: 'final', outcome: 'incorrect' } as GradeRecord;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAssessmentBlueprintRevision).mockResolvedValue({
    blueprint: { planId: 'plan' },
    revision: { planVersionId: 'original-version', config: { knowledgePolicy: 'source-only' } },
  } as BlueprintDetail);
  vi.mocked(getStudyReadingTrail).mockResolvedValue({
    planId: 'plan', versionId: 'original-version', manifest: { assignments: [assignment] }, revision: 1, session: null,
  });
  vi.mocked(getStudyAttemptSources).mockResolvedValue([evidence]);
});

describe('assessment passage review', () => {
  it('loads the historical plan version from the attempt blueprint', async () => {
    const { result } = renderHook(() => useAttemptReadingContext(attempt));
    await waitFor(() => expect(result.current?.assignments).toEqual([assignment]));
    expect(getStudyReadingTrail).toHaveBeenCalledWith('plan', 'original-version');
    expect(getStudyAttemptSources).toHaveBeenCalledWith('attempt');
    expect(questionReadingProps(result.current, question, incorrect)).toEqual({ evidence: [evidence], readingAssignment: assignment });
  });

  it('keeps conventional evidence for verified finalized questions without a current matching passage', async () => {
    vi.mocked(getStudyReadingTrail).mockResolvedValue({
      planId: 'plan', versionId: 'original-version',
      manifest: { assignments: [{ ...assignment, documentRevision: 'unrelated-revision' }] },
      revision: 1, session: null,
    });
    const { result } = renderHook(() => useAttemptReadingContext(attempt));
    await waitFor(() => expect(result.current?.sources).toEqual([evidence]));
    expect(questionReadingProps(result.current, question, incorrect)).toEqual({ evidence: [evidence], readingAssignment: undefined });
    expect(questionReadingProps(result.current, question, null)).toEqual({});
  });

  it('does not request attempt evidence when the question is still active', async () => {
    const { result } = renderHook(() => useAttemptReadingContext({ ...attempt, status: 'in-progress', submittedAt: null }));
    await waitFor(() => expect(result.current?.sources).toEqual([]));
    expect(getStudyAttemptSources).not.toHaveBeenCalled();
    expect(getStudyReadingTrail).not.toHaveBeenCalled();
  });
});
