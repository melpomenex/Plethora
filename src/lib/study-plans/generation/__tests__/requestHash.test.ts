/**
 * Unit tests for deterministic request hashing (C2-T02).
 */

import { describe, it, expect } from 'vitest';
import { sha256, computeCurriculumRequestHash } from '../requestHash';
import type { CurriculumGenerationRequest } from '../types';
import type { StudySourceScopeV1 } from '../../../../types/studySource';

describe('Curriculum Request Hashing', () => {
  it('computes correct sha256 for known standard test vectors', () => {
    // Empty string
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    // "abc"
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // Message longer than 55 bytes (tests 2-block padding)
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });

  it('produces identical hash regardless of key order or input document order', () => {
    const scope1: StudySourceScopeV1 = {
      schemaVersion: 1,
      selected: {
        documentIds: ['doc-2', 'doc-1'],
        extractIds: [],
        collectionIds: [],
        tagIds: [],
      },
      resolvedDocuments: [
        {
          documentId: 'doc-2',
          title: 'Algorithms',
          sourceType: 'pdf',
          revision: 'hash-alg',
          revisionKind: 'content-hash',
          extractIds: [],
          isAiExcluded: false,
          isLocalOnly: false,
        },
        {
          documentId: 'doc-1',
          title: 'Deep Learning',
          sourceType: 'pdf',
          revision: 'hash-dl',
          revisionKind: 'content-hash',
          extractIds: [],
          isAiExcluded: false,
          isLocalOnly: false,
        },
      ],
      frozenAt: '2026-03-31T00:00:00Z',
      indexCompleteness: 'complete',
      limitations: [],
    };

    const scope2: StudySourceScopeV1 = {
      schemaVersion: 1,
      selected: {
        documentIds: ['doc-1', 'doc-2'],
        extractIds: [],
        collectionIds: [],
        tagIds: [],
      },
      resolvedDocuments: [
        scope1.resolvedDocuments[1],
        scope1.resolvedDocuments[0],
      ],
      frozenAt: '2026-03-31T00:00:00Z',
      indexCompleteness: 'complete',
      limitations: [],
    };

    const req1: CurriculumGenerationRequest = {
      planId: 'plan-1',
      baseVersionId: 'spv-1',
      sourceScope: scope1,
      depth: 'foundational',
      knowledgePolicy: 'source-only',
      rulesOnly: false,
      priorEvidence: null,
    };

    const req2: CurriculumGenerationRequest = {
      planId: 'plan-1',
      baseVersionId: 'spv-1',
      sourceScope: scope2,
      depth: 'foundational',
      knowledgePolicy: 'source-only',
      rulesOnly: false,
      priorEvidence: null,
    };

    const hash1 = computeCurriculumRequestHash(req1);
    const hash2 = computeCurriculumRequestHash(req2);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes hash when any output-affecting field changes', () => {
    const baseReq: CurriculumGenerationRequest = {
      planId: 'plan-1',
      baseVersionId: 'spv-1',
      sourceScope: {
        schemaVersion: 1,
        selected: { documentIds: ['doc-1'], extractIds: [], collectionIds: [], tagIds: [] },
        resolvedDocuments: [
          {
            documentId: 'doc-1',
            title: 'Deep Learning',
            sourceType: 'pdf',
            revision: 'hash-dl',
            revisionKind: 'content-hash',
            extractIds: [],
            isAiExcluded: false,
            isLocalOnly: false,
          },
        ],
        frozenAt: '2026-03-31T00:00:00Z',
        indexCompleteness: 'complete',
        limitations: [],
      },
      depth: 'foundational',
      knowledgePolicy: 'source-only',
      rulesOnly: false,
      priorEvidence: null,
    };

    const baseHash = computeCurriculumRequestHash(baseReq);

    // Change depth
    expect(computeCurriculumRequestHash({ ...baseReq, depth: 'deep' })).not.toBe(baseHash);

    // Change knowledgePolicy
    expect(
      computeCurriculumRequestHash({
        ...baseReq,
        knowledgePolicy: 'source-plus-model-knowledge',
      })
    ).not.toBe(baseHash);

    // Change source revision
    const changedDocReq: CurriculumGenerationRequest = {
      ...baseReq,
      sourceScope: {
        ...baseReq.sourceScope,
        resolvedDocuments: [
          {
            ...baseReq.sourceScope.resolvedDocuments[0],
            revision: 'new-hash-dl-v2',
          },
        ],
      },
    };
    expect(computeCurriculumRequestHash(changedDocReq)).not.toBe(baseHash);

    // Add prior evidence
    const withPriorReq: CurriculumGenerationRequest = {
      ...baseReq,
      priorEvidence: {
        diagnosticAttemptId: 'att-1',
        concepts: [
          {
            conceptId: 'conc-1',
            level: 'developing',
            observedMean: 0.5,
            uncertainty: ['hints-used'],
            evidenceGroupIds: ['grp-1'],
          },
        ],
      },
    };
    expect(computeCurriculumRequestHash(withPriorReq)).not.toBe(baseHash);
  });
});
