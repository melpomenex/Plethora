import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAndVerifySources } from '../addSourcesAndVerify';
import * as planApi from '../../../api/study-plans';
import * as sourceApi from '../../../api/study-sources';

vi.mock('../../../api/study-plans', () => ({
  getStudyPlan: vi.fn(),
  saveStudyPlanDraft: vi.fn(),
  StudyApiError: class StudyApiError extends Error { code: string; messageKey: string; retryable: boolean; constructor(opts: { code: string; messageKey: string; retryable: boolean }) { super(opts.messageKey); this.code = opts.code; this.messageKey = opts.messageKey; this.retryable = opts.retryable; } },
}));

vi.mock('../../../api/study-sources', () => ({
  resolveStudySourceScope: vi.fn(),
}));

function modelOnlyPlan() {
  return {
    plan: { id: 'sp_1', revision: 2 },
    version: {
      knowledgeAuthority: { kind: 'model-only' },
      nodes: [{ nodeId: 'n1', title: 'Topic', sourceRefIds: [] }],
      prerequisites: [],
    },
  };
}

describe('resolveAndVerifySources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switches a model-only draft to source-only library authority with a resolved scope', async () => {
    vi.mocked(planApi.getStudyPlan).mockResolvedValue(modelOnlyPlan() as never);
    const scope = {
      schemaVersion: 1 as const,
      selected: { documentIds: ['doc1'], extractIds: [], collectionIds: [], tagIds: [] },
      resolvedDocuments: [{ documentId: 'doc1', title: 'D', sourceType: 'pdf', revision: 'r1', revisionKind: 'content-hash' as const, extractIds: [], isAiExcluded: false, isLocalOnly: false }],
      frozenAt: '2026-11-12T00:00:00Z',
      indexCompleteness: 'complete' as const,
      limitations: [],
    };
    vi.mocked(sourceApi.resolveStudySourceScope).mockResolvedValue(scope as never);
    vi.mocked(planApi.saveStudyPlanDraft).mockResolvedValue({} as never);

    await resolveAndVerifySources('sp_1', 2, {
      documentIds: ['doc1'], extractIds: [], collectionIds: [], tagIds: [],
    });

    expect(planApi.saveStudyPlanDraft).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'sp_1',
      expectedDraftRevision: 2,
      sourceScope: scope,
      knowledgeAuthority: { kind: 'library', policy: 'source-only' },
    }));
  });

  it('refuses when the plan is already library-backed', async () => {
    vi.mocked(planApi.getStudyPlan).mockResolvedValue({
      plan: { id: 'sp_1', revision: 2 },
      version: { knowledgeAuthority: { kind: 'library', policy: 'source-plus-model-knowledge' }, nodes: [], prerequisites: [] },
    } as never);

    await expect(resolveAndVerifySources('sp_1', 2, {
      documentIds: ['doc1'], extractIds: [], collectionIds: [], tagIds: [],
    })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(planApi.saveStudyPlanDraft).not.toHaveBeenCalled();
  });
});
