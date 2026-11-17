import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStudyReadingChunks, type StudyReadingChunk } from '../../../api/study-reading';
import { resolveStudySourceRefs } from '../../../api/study-sources';
import type { StudyPlanDetail, StudyPlanVersionNode } from '../../../types/learningPaths';
import type { StudySourceRefV1, StudySourceResolution } from '../../../types/studySource';
import { addManualReadingAssignment, generateReadingManifest } from './generateReadingManifest';

vi.mock('../../../api/study-reading', () => ({ getStudyReadingChunks: vi.fn() }));
vi.mock('../../../api/study-sources', () => ({ resolveStudySourceRefs: vi.fn() }));

const excerpt = 'Consensus relies on quorum intersection.';
const surroundingText = `A learner can reason about disagreement. ${excerpt} Intersecting majorities prevent divergent decisions.`;

function sourceRef(id: string, excerptText = excerpt): StudySourceResolution {
  const ref: StudySourceRefV1 = {
    schemaVersion: 1,
    id,
    documentId: 'book',
    documentTitle: 'Consensus',
    excerpt: excerptText,
    excerptSha256: 'sha256:hash',
    sourceType: 'pdf',
    revision: 'rev',
    revisionKind: 'content-hash',
    capturedAt: '2026-11-17',
    jump: { kind: 'pdf', pageNumber: 3, textQuote: excerptText },
    chunk: { chunkId: 'chapter', ordinal: 4, startOffset: 0, endOffset: surroundingText.length },
  };
  return { ref, status: 'current', navigation: 'exact' };
}

function topic(nodeId: string, position: number, sourceRefIds: string[]): StudyPlanVersionNode {
  return {
    nodeId, position, sourceRefIds, title: nodeId, summary: '', conceptId: null, conceptLabel: '',
    whyHere: null, included: true, locked: false, userAdded: false, userModified: false,
    materialSupport: 'grounded',
    learningObjectives: ['Explain quorum intersection', 'Describe timeout escalation'],
  };
}

function detail(): StudyPlanDetail {
  return {
    plan: {
      id: 'plan', title: 'Consensus', goal: 'Learn consensus', depth: 'deep', status: 'active',
      currentVersionId: 'version', currentVersion: 1, draftVersionId: null, revision: 1,
      createdAt: '2026-11-17', updatedAt: '2026-11-17',
    },
    sourceRefs: { primary: sourceRef('primary'), overlap: sourceRef('overlap', 'quorum intersection.') },
    activityByNodeId: {},
    version: {
      id: 'version', planId: 'plan', version: 1, state: 'published', baseVersionId: null,
      nodes: [topic('second', 1, ['primary']), topic('first', 0, ['primary', 'overlap'])],
      prerequisites: [{ prerequisiteNodeId: 'first', dependentNodeId: 'second', support: 'user',
        rationale: null, sourceRefIds: [] }],
      knowledgeAuthority: { kind: 'library', policy: 'source-only' },
      sourceScope: {
        schemaVersion: 1, frozenAt: '2026-11-17', indexCompleteness: 'complete', limitations: [],
        selected: { documentIds: ['book'], extractIds: [], collectionIds: [], tagIds: [] },
        resolvedDocuments: [{ documentId: 'book', title: 'Consensus', sourceType: 'pdf', revision: 'rev',
          revisionKind: 'content-hash', extractIds: [], isAiExcluded: false, isLocalOnly: true }],
      },
      changeSummary: null, createdBy: 'user', createdAt: '2026-11-17', publishedAt: '2026-11-17',
    },
  };
}

const chapter: StudyReadingChunk = {
  chunkId: 'chapter', text: surroundingText,
  position: { sourceType: 'pdf', documentId: 'book', ordinal: 4, pageNumber: 3,
    startOffset: 0, endOffset: surroundingText.length },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getStudyReadingChunks).mockResolvedValue([chapter]);
  vi.mocked(resolveStudySourceRefs).mockImplementation(async (inputs) => inputs.map((input) => ({
    ...sourceRef('derived', input.excerpt),
    ref: { ...sourceRef('derived', input.excerpt).ref, extractId: input.extractId },
  })));
});

describe('generateReadingManifest', () => {
  it('expands and deduplicates current passages in saved topic order with stable IDs and partial objective coverage', async () => {
    const input = detail();
    const result = await generateReadingManifest(input);
    expect(result.assignments.map(({ topicId }) => topicId)).toEqual(['first', 'second']);
    expect(result.assignments[0]).toMatchObject({
      sourceRefIds: ['overlap', 'primary'], objectiveIndexes: [0],
      segments: [{ quote: { exact: surroundingText }, location: { kind: 'pdf', pageNumber: 3 } }],
    });
    input.version.nodes.reverse();
    expect(await generateReadingManifest(input)).toEqual(result);
  });

  it('keeps verified seed passages when canonical expansion cannot be proved', async () => {
    vi.mocked(resolveStudySourceRefs).mockResolvedValue([{ ...sourceRef('invalid'), status: 'stale' }]);
    const result = await generateReadingManifest(detail());
    expect(result.assignments[0].segments[0].quote.exact).toBe(excerpt);
  });

  it('restricts extract-scoped generation to eligible evidence and skips stale refs', async () => {
    const input = detail();
    const scope = input.version.sourceScope!;
    scope.selected.documentIds = [];
    scope.selected.extractIds = ['extract'];
    scope.resolvedDocuments[0].extractIds = ['extract'];
    input.sourceRefs.primary.ref.extractId = 'extract';
    input.sourceRefs.overlap.status = 'stale';
    const result = await generateReadingManifest(input);
    expect(getStudyReadingChunks).not.toHaveBeenCalled();
    expect(result.assignments.map((item) => item.segments[0].quote.exact)).toEqual([excerpt, excerpt]);
    scope.resolvedDocuments[0].isAiExcluded = true;
    expect((await generateReadingManifest(input)).assignments).toEqual([]);
  });

  it('discards results when cancelled during local retrieval', async () => {
    const controller = new AbortController();
    vi.mocked(getStudyReadingChunks).mockImplementationOnce(async () => {
      controller.abort();
      return [chapter];
    });
    await expect(generateReadingManifest(detail(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolveStudySourceRefs).not.toHaveBeenCalled();
  });
});

describe('addManualReadingAssignment', () => {
  it('verifies a selected local passage and treats repeated additions as idempotent', async () => {
    const input = detail();
    const manifest = await addManualReadingAssignment(input, { assignments: [] }, 'first', 'primary', surroundingText);
    expect(manifest.assignments[0]).toMatchObject({ sourceRefIds: ['primary'],
      segments: [{ quote: { exact: surroundingText } }] });
    expect(await addManualReadingAssignment(input, manifest, 'first', 'primary', surroundingText)).toBe(manifest);
  });

  it('rejects manual passage text outside the extract excerpt', async () => {
    const input = detail();
    const scope = input.version.sourceScope!;
    scope.selected.documentIds = [];
    scope.selected.extractIds = ['extract'];
    scope.resolvedDocuments[0].extractIds = ['extract'];
    input.sourceRefs.primary.ref.extractId = 'extract';
    await expect(addManualReadingAssignment(input, { assignments: [] }, 'first', 'primary', surroundingText))
      .rejects.toMatchObject({ code: 'stale_source' });
    expect(resolveStudySourceRefs).not.toHaveBeenCalled();
  });
});
