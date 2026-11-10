/**
 * Unit tests for Rules-Only Curriculum Outline Generation (C2-T02).
 */

import { describe, it, expect } from 'vitest';
import { generateRulesOnlyCurriculumOutline } from '../rulesOutline';
import type { StudySourceScopeV1 } from '../../../../types/studySource';

describe('Rules-Only Curriculum Outline Generator (No-AI)', () => {
  const sampleScope: StudySourceScopeV1 = {
    schemaVersion: 1,
    selected: {
      documentIds: ['doc-1', 'doc-2'],
      extractIds: ['ext-1'],
      collectionIds: [],
      tagIds: [],
    },
    resolvedDocuments: [
      {
        documentId: 'doc-1',
        title: 'Introduction to Operating Systems',
        sourceType: 'pdf',
        revision: 'rev-os',
        revisionKind: 'content-hash',
        extractIds: [],
        isAiExcluded: false,
        isLocalOnly: false,
      },
      {
        documentId: 'doc-2',
        title: 'Virtual Memory & Paging Algorithms',
        sourceType: 'pdf',
        revision: 'rev-vm',
        revisionKind: 'content-hash',
        extractIds: ['ext-1'],
        isAiExcluded: false,
        isLocalOnly: false,
      },
    ],
    frozenAt: '2026-03-31T00:00:00Z',
    indexCompleteness: 'complete',
    limitations: [],
  };

  it('generates a valid, deterministic grounded outline from documents without concepts', () => {
    const result = generateRulesOnlyCurriculumOutline({
      sourceScope: sampleScope,
      depth: 'foundational',
      goal: 'Understand OS virtual memory',
    });

    expect(result.decomposeBatch.topics.length).toBeGreaterThanOrEqual(3);
    expect(result.decomposeBatch.schemaVersion).toBe(1);
    expect(result.prerequisiteBatch.schemaVersion).toBe(1);

    // Each topic is grounded and points to a valid source handle
    for (const t of result.decomposeBatch.topics) {
      expect(t.materialSupport).toBe('grounded');
      expect(t.sourceHandles.length).toBeGreaterThanOrEqual(1);
      expect(result.sourceHandleMap.has(t.sourceHandles[0])).toBe(true);
    }

    // Prerequisite edges form a sequential progression
    expect(result.prerequisiteBatch.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('incorporates confirmed concepts and confirmed prerequisite links when present', () => {
    const confirmedConcepts = [
      { conceptId: 'c-process', conceptName: 'Process Lifecycle', documentId: 'doc-1' },
      { conceptId: 'c-threads', conceptName: 'Kernel Threads', documentId: 'doc-1' },
      { conceptId: 'c-paging', conceptName: 'Page Table Management', documentId: 'doc-2' },
    ];

    const confirmedLinks = [
      { prerequisiteConceptId: 'c-process', dependentConceptId: 'c-threads' },
      { prerequisiteConceptId: 'c-threads', dependentConceptId: 'c-paging' },
    ];

    const result = generateRulesOnlyCurriculumOutline({
      sourceScope: sampleScope,
      depth: 'survey',
      confirmedConcepts,
      confirmedLinks,
    });

    const topics = result.decomposeBatch.topics;
    expect(topics.some((t) => t.title === 'Process Lifecycle')).toBe(true);
    expect(topics.some((t) => t.title === 'Kernel Threads')).toBe(true);
    expect(topics.some((t) => t.title === 'Page Table Management')).toBe(true);

    const edges = result.prerequisiteBatch.edges;
    expect(edges.length).toBeGreaterThanOrEqual(2);
    expect(edges[0].rationale).toContain('Confirmed conceptual prerequisite');
  });

  it('is completely deterministic and yields identical output across repeated runs', () => {
    const run1 = generateRulesOnlyCurriculumOutline({
      sourceScope: sampleScope,
      depth: 'deep',
    });
    const run2 = generateRulesOnlyCurriculumOutline({
      sourceScope: sampleScope,
      depth: 'deep',
    });

    expect(run1).toEqual(run2);
  });
});
