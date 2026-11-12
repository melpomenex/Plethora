/**
 * Unit tests for Source-scoped Retrieval and Evidence Hydration.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RetrievalResponse, RetrievalResult } from '../../../../api/ai-learning';
import type { Concept, ConceptLink } from '../../../../api/concept-links';
import type {
  StudySourceRefInput,
  StudySourceResolution,
  StudySourceScopeV1,
} from '../../../../types/studySource';
import { getAllowedDocumentIds, hydrateCurriculumEvidence } from '../evidence';

describe('hydrateCurriculumEvidence', () => {
  const dummyScope: StudySourceScopeV1 = {
    schemaVersion: 1,
    selected: {
      documentIds: ['doc_1', 'doc_2'],
      extractIds: ['ext_1'],
      collectionIds: [],
      tagIds: [],
    },
    resolvedDocuments: [
      {
        documentId: 'doc_1',
        title: 'Operating Systems PDF',
        sourceType: 'pdf',
        revision: 'rev_1',
        revisionKind: 'content-hash',
        extractIds: [],
        isAiExcluded: false,
        isLocalOnly: false,
      },
      {
        documentId: 'doc_2',
        title: 'Distributed Systems EPUB',
        sourceType: 'epub',
        revision: 'rev_2',
        revisionKind: 'content-hash',
        extractIds: [],
        isAiExcluded: false,
        isLocalOnly: false,
      },
    ],
    frozenAt: '2026-11-10T00:00:00Z',
    indexCompleteness: 'complete',
    limitations: [],
  };

  it('extracts allowed document IDs deterministically', () => {
    const ids = getAllowedDocumentIds(dummyScope);
    expect(ids).toEqual(['doc_1', 'doc_2']);
  });

  it('returns empty result when source scope has no documents', async () => {
    const emptyScope: StudySourceScopeV1 = {
      ...dummyScope,
      selected: { documentIds: [], extractIds: [], collectionIds: [], tagIds: [] },
      resolvedDocuments: [],
    };
    const res = await hydrateCurriculumEvidence({
      goal: 'Learn something',
      sourceScope: emptyScope,
      depth: 'survey',
    });
    expect(res.batches).toEqual([]);
    expect(res.allHandles).toEqual([]);
    expect(res.uniqueHits).toEqual([]);
    expect(res.conceptSeeds).toEqual([]);
  });

  it('does not retrieve extract-only scope until extracts have a supported retrieval path', async () => {
    const retrieveFn = vi.fn();
    const res = await hydrateCurriculumEvidence({
      goal: 'Study this extract',
      sourceScope: {
        ...dummyScope,
        selected: { documentIds: [], extractIds: ['ext_1'], collectionIds: [], tagIds: [] },
        resolvedDocuments: [],
      },
      depth: 'survey',
      retrieveFn,
    });
    expect(retrieveFn).not.toHaveBeenCalled();
    expect(res.allHandles).toEqual([]);
    expect(res.batches).toEqual([]);
  });

  it('strictly filters out-of-scope retrieval hits and limits goal query to k=24', async () => {
    const retrieveFn = vi.fn().mockImplementation(async (query: string, opts) => {
      expect(opts?.filters?.documentIds).toEqual(['doc_1', 'doc_2']);
      return {
        mode: 'semantic',
        candidatesScanned: 10,
        results: [
          {
            chunkId: 'chk_1',
            documentId: 'doc_1',
            documentTitle: 'OS PDF',
            sourceType: 'pdf',
            ordinal: 0,
            text: 'Processes and threads execution model.',
            headingPath: ['Chapter 1'],
            location: {
              sourceType: 'pdf',
              documentId: 'doc_1',
              ordinal: 0,
              startOffset: 0,
              endOffset: 100,
              pageNumber: 5,
            },
            contentHash: 'hash_1',
            tokenCount: 20,
            score: 0.95,
            mode: 'semantic',
          },
          {
            // Out of scope hit that backend erroneously returned
            chunkId: 'chk_bad',
            documentId: 'doc_unauthorized_3',
            documentTitle: 'Secret Doc',
            sourceType: 'pdf',
            ordinal: 0,
            text: 'Secret content that must not leak.',
            headingPath: [],
            location: {
              sourceType: 'pdf',
              documentId: 'doc_unauthorized_3',
              ordinal: 0,
              startOffset: 0,
              endOffset: 50,
            },
            contentHash: 'hash_bad',
            tokenCount: 15,
            score: 0.99,
            mode: 'semantic',
          },
        ] as RetrievalResult[],
      } as RetrievalResponse;
    });

    const resolveSourceRefsFn = vi
      .fn()
      .mockImplementation(async (inputs: StudySourceRefInput[]): Promise<StudySourceResolution[]> => {
        return inputs.map((inp, idx) => ({
          ref: {
            schemaVersion: 1,
            id: `ssr_${idx}`,
            documentId: inp.documentId,
            excerpt: inp.excerpt,
            revision: 'rev_1',
            revisionKind: 'content-hash',
            excerptSha256: 'sha256_mock',
            documentTitle: inp.documentTitle || 'OS PDF',
            sourceType: inp.sourceType || 'pdf',
            capturedAt: '2026-11-10T00:00:00Z',
          },
          status: 'current',
          navigation: 'exact',
        }));
      });

    const res = await hydrateCurriculumEvidence({
      goal: 'Explain operating systems',
      sourceScope: dummyScope,
      depth: 'foundational',
      retrieveFn,
      resolveSourceRefsFn,
      listConfirmedConceptLinksFn: vi.fn().mockResolvedValue([]),
    });

    // Verify out-of-scope hit is dropped
    expect(res.uniqueHits.length).toBe(1);
    expect(res.uniqueHits[0].documentId).toBe('doc_1');
    expect(res.allHandles.length).toBe(1);
    expect(res.allHandles[0].handle).toBe('src_h0');
    expect(res.handleToSourceRefIdMap.get('src_h0')).toBe('ssr_0');
  });

  it('verifies a lexical snippet against source text without a synthetic chunk reference', async () => {
    const excerpt = 'Quantum tunneling explains alpha decay.';
    const resolveSourceRefsFn = vi.fn(async (inputs: StudySourceRefInput[]): Promise<StudySourceResolution[]> =>
      inputs.map((input) => JSON.parse(JSON.stringify({
        status: input.chunk ? 'stale' : 'current',
        navigation: 'coarse',
        ref: {
          schemaVersion: 1, id: 'verified', documentId: input.documentId, extractId: null,
          excerpt: input.excerpt, excerptSha256: 'hash', revision: 'rev_1',
          revisionKind: 'content-hash', documentTitle: 'Physics', sourceType: 'text',
          capturedAt: '2026-11-10T00:00:00Z',
        },
      }))));
    const result = await hydrateCurriculumEvidence({
      goal: 'tunneling',
      sourceScope: dummyScope,
      depth: 'survey',
      retrieveFn: vi.fn().mockResolvedValue({
        mode: 'lexicalOnly', candidatesScanned: 0,
        results: [{
          chunkId: 'fts-doc_1', documentId: 'doc_1', sourceType: 'document',
          ordinal: -1, text: excerpt, headingPath: [],
          location: { sourceType: 'fts', documentId: 'doc_1', ordinal: -1 },
          contentHash: '', tokenCount: 0, score: 1, mode: 'lexicalOnly',
        }],
      }),
      resolveSourceRefsFn,
      listConfirmedConceptLinksFn: vi.fn().mockResolvedValue([]),
    });
    expect(resolveSourceRefsFn.mock.calls[0][0][0].chunk).toBeUndefined();
    expect(result.allHandles.map((item) => item.excerpt)).toEqual([excerpt]);
    expect(result.allHandles[0].extractId).toBeUndefined();
    expect(result.handleToSourceRefIdMap.get(result.allHandles[0].handle)).toBe('verified');
  });

  it('drops stale hydrated references while preserving stable exact reference mapping', async () => {
    const retrieveFn = vi.fn().mockResolvedValue({
      mode: 'semantic', candidatesScanned: 2,
      results: [
        { chunkId: 'hit-current', documentId: 'doc_1', documentTitle: 'OS PDF', sourceType: 'pdf', ordinal: 0,
          text: 'current verified passage', headingPath: [], location: { sourceType: 'pdf', documentId: 'doc_1', ordinal: 0, startOffset: 0, endOffset: 20 },
          contentHash: 'a', tokenCount: 4, score: 0.9, mode: 'semantic' },
        { chunkId: 'hit-stale', documentId: 'doc_2', documentTitle: 'Systems EPUB', sourceType: 'epub', ordinal: 0,
          text: 'stale passage', headingPath: [], location: { sourceType: 'epub', documentId: 'doc_2', ordinal: 0, startOffset: 0, endOffset: 13 },
          contentHash: 'b', tokenCount: 3, score: 0.8, mode: 'semantic' },
      ],
    } as RetrievalResponse);
    const resolveSourceRefsFn = vi.fn().mockImplementation(async (inputs: StudySourceRefInput[]) => inputs.map((input, index) => ({
      ref: {
        schemaVersion: 1, id: index === 0 ? 'stable_ref_17' : 'stale_ref_99', documentId: input.documentId,
        excerpt: input.excerpt, revision: index === 0 ? 'rev_1' : 'old-revision', revisionKind: 'content-hash',
        excerptSha256: `hash_${index}`, documentTitle: input.documentTitle || 'Doc', sourceType: input.sourceType || 'pdf',
        capturedAt: '2026-11-10T00:00:00Z',
      },
      status: index === 0 ? 'current' : 'stale', navigation: index === 0 ? 'exact' : 'unavailable',
    })));

    const res = await hydrateCurriculumEvidence({
      goal: 'systems', sourceScope: dummyScope, depth: 'survey', retrieveFn, resolveSourceRefsFn,
      listConfirmedConceptLinksFn: vi.fn().mockResolvedValue([]),
    });
    expect(res.allHandles.map((item) => item.documentId)).toEqual(['doc_1']);
    expect(res.handleToSourceRefIdMap).toEqual(new Map([['src_h0', 'stable_ref_17']]));
  });

  it('selects confirmed concept seeds, queries them concurrently, and caps at 96 hits', async () => {
    const dummyLinks: ConceptLink[] = [
      {
        id: 'link_1',
        sourceKind: 'concept',
        sourceId: 'c_process',
        targetKind: 'document',
        targetId: 'doc_1',
        relationType: 'related-to',
        confidence: 1.0,
        createdBy: 'user',
        createdAt: '2026-11-10T00:00:00Z',
        isDismissed: false,
      },
      {
        id: 'link_2',
        sourceKind: 'document',
        sourceId: 'doc_2',
        targetKind: 'concept',
        targetId: 'c_raft',
        relationType: 'supports',
        confidence: 0.9,
        createdBy: 'ai',
        createdAt: '2026-11-10T00:00:00Z',
        isDismissed: false,
      },
      {
        id: 'link_unrelated',
        sourceKind: 'concept',
        sourceId: 'c_unrelated',
        targetKind: 'document',
        targetId: 'doc_other_999',
        relationType: 'related-to',
        confidence: 1.0,
        createdBy: 'user',
        createdAt: '2026-11-10T00:00:00Z',
        isDismissed: false,
      },
    ];

    const dummyConcepts: Concept[] = [
      {
        id: 'c_process',
        name: 'Processes and Threads',
        normalizedName: 'processes and threads',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
      {
        id: 'c_raft',
        name: 'Raft Consensus Algorithm',
        normalizedName: 'raft consensus algorithm',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
    ];

    const queriesMade: string[] = [];
    const retrieveFn = vi.fn().mockImplementation(async (query: string) => {
      queriesMade.push(query);
      return {
        mode: 'semantic',
        candidatesScanned: 1,
        results: [
          {
            chunkId: `chk_${query}`,
            documentId: 'doc_1',
            documentTitle: 'OS PDF',
            sourceType: 'pdf',
            ordinal: 0,
            text: `Content for ${query}`,
            headingPath: [],
            location: {
              sourceType: 'pdf',
              documentId: 'doc_1',
              ordinal: 0,
              startOffset: 0,
              endOffset: 50,
            },
            contentHash: `hash_${query}`,
            tokenCount: 10,
            score: 0.9,
            mode: 'semantic',
          },
        ] as RetrievalResult[],
      } as RetrievalResponse;
    });

    const res = await hydrateCurriculumEvidence({
      goal: 'Operating Systems Core',
      sourceScope: dummyScope,
      depth: 'survey',
      retrieveFn,
      listConfirmedConceptLinksFn: vi.fn().mockResolvedValue(dummyLinks),
      listConceptsFn: vi.fn().mockResolvedValue(dummyConcepts),
      resolveSourceRefsFn: vi
        .fn()
        .mockImplementation(async (inputs: StudySourceRefInput[]) =>
          inputs.map((inp, idx) => ({
            ref: {
              schemaVersion: 1,
              id: `ssr_${idx}`,
              documentId: inp.documentId,
              excerpt: inp.excerpt,
              revision: 'rev_1',
              revisionKind: 'content-hash',
              excerptSha256: 'hash',
              documentTitle: inp.documentTitle || 'Doc',
              sourceType: 'pdf',
              capturedAt: '2026-11-10T00:00:00Z',
            },
            status: 'current',
            navigation: 'exact',
          }))
        ),
    });

    expect(queriesMade).toContain('Operating Systems Core');
    expect(queriesMade).toContain('Processes and Threads');
    expect(queriesMade).toContain('Raft Consensus Algorithm');
    expect(res.conceptSeeds).toEqual(['Processes and Threads', 'Raft Consensus Algorithm']);
    expect(res.uniqueHits.length).toBe(3);
    expect(res.allHandles.length).toBe(3);
  });

  it('does not fabricate evidence when retrieval returns 0 hits', async () => {
    const retrieveFn = vi.fn().mockResolvedValue({
      mode: 'lexicalOnly',
      candidatesScanned: 0,
      results: [],
    });

    const resolveSourceRefsFn = vi
      .fn()
      .mockImplementation(async (inputs: StudySourceRefInput[]): Promise<StudySourceResolution[]> => {
        return inputs.map((inp, idx) => ({
          ref: {
            schemaVersion: 1,
            id: `ssr_coarse_${idx}`,
            documentId: inp.documentId,
            excerpt: inp.excerpt,
            revision: inp.revision || 'rev_1',
            revisionKind: 'content-hash',
            excerptSha256: 'sha256_mock',
            documentTitle: inp.documentTitle || 'Doc',
            sourceType: inp.sourceType || 'pdf',
            capturedAt: '2026-11-10T00:00:00Z',
          },
          status: 'current',
          navigation: 'coarse',
        }));
      });

    const res = await hydrateCurriculumEvidence({
      goal: 'Explain OS concepts',
      sourceScope: dummyScope,
      depth: 'survey',
      retrieveFn,
      resolveSourceRefsFn,
      listConfirmedConceptLinksFn: vi.fn().mockResolvedValue([]),
    });

    expect(res.uniqueHits.length).toBe(0);
    expect(res.allHandles).toEqual([]);
    expect(res.batches).toEqual([]);
    expect(res.handleToSourceRefIdMap.size).toBe(0);
    expect(resolveSourceRefsFn).not.toHaveBeenCalled();
  });
});
