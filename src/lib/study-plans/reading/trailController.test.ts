import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocument } from '../../../api/documents';
import { saveStudyTrailSession } from '../../../api/study-reading';
import type { Document } from '../../../types/document';
import type { StudyPlanDetail, StudyPlanVersionNode } from '../../../types/learningPaths';
import type { StudyReadingAssignment, StudyReadingTrail } from '../../../types/studyReading';
import { openDocumentAtLocation } from '../../../utils/openDocumentAtLocation';
import {
  acknowledgeStudyPassage, exitStudyTrail, finishStudyPassage, moveStudyPassage, readingTopicComplete,
  reviewStudyPassage, startStudyTrail, useStudyTrail,
} from './trailController';

vi.mock('../../../api/documents', () => ({ getDocument: vi.fn() }));
vi.mock('../../../api/study-reading', () => ({ saveStudyTrailSession: vi.fn() }));
vi.mock('../../../utils/openDocumentAtLocation', () => ({ openDocumentAtLocation: vi.fn() }));
vi.mock('../../../stores/tabsStore', () => ({
  useTabsStore: { getState: () => ({ addTab: vi.fn(), getWorkspaceTabs: () => [], setNavigationPane: vi.fn() }) },
}));

function topic(id: string, position: number): StudyPlanVersionNode {
  return {
    nodeId: id, title: id, position, included: true, summary: '', learningObjectives: ['Find relevant text'],
    conceptId: null, conceptLabel: '', whyHere: null, locked: false, userAdded: false, userModified: false,
    materialSupport: 'grounded', sourceRefIds: [id + '-ref'],
  };
}

function assignment(topicId: string, documentId: string): StudyReadingAssignment {
  return {
    schemaVersion: 1, id: topicId + '-passage', topicId, documentId, documentTitle: documentId,
    documentRevision: 'v1', format: 'markdown', segments: [{ quote: { exact: 'Find relevant text.' } }],
    objectiveIndexes: [0], sourceRefIds: [topicId + '-ref'],
  };
}

const plan = {
  plan: { id: 'plan', title: 'Reading', status: 'active', currentVersionId: 'version', revision: 5 },
  version: {
    id: 'version', state: 'published', nodes: [topic('first', 0), topic('second', 1)],
    prerequisites: [{ prerequisiteNodeId: 'first', dependentNodeId: 'second', support: 'user',
      rationale: null, sourceRefIds: [] }],
  },
  activityByNodeId: {}, sourceRefs: {},
} as unknown as StudyPlanDetail;

let persisted: StudyReadingTrail;
beforeEach(() => {
  vi.resetAllMocks();
  persisted = {
    planId: 'plan', versionId: 'version', revision: 1,
    manifest: { assignments: [assignment('second', 'doc-b'), assignment('first', 'doc-a')] }, session: null,
  };
  vi.mocked(getDocument).mockImplementation(async (id) => ({
    id, fileType: 'markdown', contentHash: 'v1',
  } as Document));
  vi.mocked(openDocumentAtLocation).mockImplementation(async (id, options) => {
    if (options.signal?.aborted) return false;
    options.onOpened?.(id + '-tab');
    return true;
  });
  vi.mocked(saveStudyTrailSession).mockImplementation(async (planId, versionId, expectedRevision, session) => {
    if (persisted.planId !== planId || persisted.versionId !== versionId || persisted.revision !== expectedRevision) {
      throw new Error('stale revision');
    }
    persisted = { ...persisted, revision: expectedRevision + 1, session };
    return persisted;
  });
});
afterEach(() => exitStudyTrail());

function acknowledge(status: 'exact' | 'ambiguous' = 'exact') {
  const { request } = useStudyTrail.getState();
  acknowledgeStudyPassage({ status, requestId: request!.id, assignmentId: request!.assignment.id });
}

describe('guided trail session', () => {
  it('requires acknowledgment and completion before following a prerequisite across documents, then resumes', async () => {
    await startStudyTrail(plan, persisted, {});
    expect(useStudyTrail.getState().request?.assignment.documentId).toBe('doc-a');
    expect(useStudyTrail.getState().status).toBe('loading');
    await finishStudyPassage(false);
    await moveStudyPassage(1);
    expect(persisted.session?.completedAssignmentIds).toEqual([]);
    expect(openDocumentAtLocation).toHaveBeenCalledTimes(1);

    acknowledge();
    await finishStudyPassage(false);
    expect(readingTopicComplete(useStudyTrail.getState().active!, 'first')).toBe(true);
    expect(plan.activityByNodeId).toEqual({});
    const old = useStudyTrail.getState().request!;
    await moveStudyPassage(1);
    expect(useStudyTrail.getState().request?.assignment.documentId).toBe('doc-b');
    acknowledgeStudyPassage({ status: 'exact', requestId: old.id, assignmentId: old.assignment.id });
    expect(useStudyTrail.getState().status).toBe('loading');
    exitStudyTrail();
    await startStudyTrail(plan, persisted, {});
    expect(useStudyTrail.getState().request?.assignment.documentId).toBe('doc-b');
    expect(persisted.session?.completedAssignmentIds).toEqual(['first-passage']);
  });

  it('does not open changed content or allow ambiguous passages to count as read', async () => {
    vi.mocked(getDocument).mockResolvedValueOnce({ id: 'doc-a', fileType: 'markdown', contentHash: 'v2' } as Document);
    await startStudyTrail(plan, persisted, { originTabId: 'plan-tab' });
    expect(useStudyTrail.getState().status).toBe('stale');
    expect(openDocumentAtLocation).not.toHaveBeenCalled();
    await finishStudyPassage(false);
    expect(persisted.session?.completedAssignmentIds).toEqual([]);
    await finishStudyPassage(true);
    expect(persisted.session?.skippedAssignmentIds).toEqual(['first-passage']);
    expect(readingTopicComplete(useStudyTrail.getState().active!, 'first')).toBe(false);
  });

  it('assessment review uses a transient request without writing plan progress', async () => {
    await reviewStudyPassage(assignment('first', 'doc-a'), 'result-tab');
    expect(useStudyTrail.getState().originTabId).toBe('result-tab');
    expect(useStudyTrail.getState().active).toBeNull();
    expect(saveStudyTrailSession).not.toHaveBeenCalled();
  });

  it('a superseded lookup cannot open its document after another passage has opened', async () => {
    let resolveDocument!: (document: Document) => void;
    vi.mocked(getDocument).mockImplementationOnce(() => new Promise((resolve) => { resolveDocument = resolve; }));
    const first = reviewStudyPassage(assignment('first', 'doc-a'));
    await reviewStudyPassage(assignment('second', 'doc-b'));
    resolveDocument({ id: 'doc-a', fileType: 'markdown', contentHash: 'v1' } as Document);
    await first;
    expect(openDocumentAtLocation).toHaveBeenCalledTimes(1);
    expect(useStudyTrail.getState().tabId).toBe('doc-b-tab');
  });
});
