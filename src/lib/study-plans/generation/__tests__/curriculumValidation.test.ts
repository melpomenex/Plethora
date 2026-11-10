/**
 * Unit tests for Curriculum Proposal Schemas and Fail-Closed Validators.
 *
 * Implements specifications from:
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T01)
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3.3
 */

import { describe, it, expect } from 'vitest';
import {
  validateCurriculumDecomposeBatch,
  validateCurriculumPrerequisiteOutput,
  validateCurriculumPriorEvidence,
  validateCurriculumGenerationRequest,
} from '../curriculumValidation';
import type { StudySourceScopeV1 } from '../../../../types/studySource';

describe('Curriculum Generation Validation (C2-T01)', () => {
  const allowedSourceHandles = ['src_h1', 'src_h2', 'src_h3'];

  const sampleValidBatch = {
    schemaVersion: 1,
    topics: [
      {
        handle: 'h_0',
        title: 'Foundations of Neural Networks',
        summary: 'Overview of perceptrons and activation functions.',
        learningObjectives: ['Understand the single layer perceptron', 'Apply sigmoid activation'],
        conceptName: 'Neural Networks',
        materialSupport: 'grounded',
        sourceHandles: ['src_h1'],
        whyHere: 'Starting point for deep learning curriculum',
      },
      {
        handle: 'h_1',
        title: 'Forward Propagation and Matrix Representation',
        summary: 'Matrix multiplication for multi-layer perceptrons.',
        learningObjectives: ['Formulate layer operations as matrix multiplications'],
        conceptName: 'Forward Propagation',
        materialSupport: 'grounded',
        sourceHandles: ['src_h1', 'src_h2'],
        whyHere: 'Enables vectorized computation',
      },
      {
        handle: 'h_2',
        title: 'Gradient Descent and Backpropagation',
        summary: 'Computing analytical gradients via chain rule.',
        learningObjectives: ['Derive gradients using calculus chain rule', 'Implement weight updates'],
        conceptName: 'Backpropagation',
        materialSupport: 'unsupported',
        sourceHandles: [],
        whyHere: 'Core optimization technique',
      },
    ],
  };

  describe('validateCurriculumDecomposeBatch', () => {
    it('accepts valid 3-topic batch with mixed grounded and unsupported topics', () => {
      const res = validateCurriculumDecomposeBatch(sampleValidBatch, allowedSourceHandles);
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.data.topics).toHaveLength(3);
      expect(res.data.topics[0].handle).toBe('h_0');
      expect(res.data.topics[2].materialSupport).toBe('unsupported');
    });

    it('rejects newer or missing schemaVersion with unsupported_version', () => {
      const payload = {
        ...sampleValidBatch,
        schemaVersion: 2,
      };
      const res = validateCurriculumDecomposeBatch(payload, allowedSourceHandles);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.some((i) => i.code === 'unsupported_version')).toBe(true);
    });

    it('rejects batch with fewer than 3 topics with quota_shortfall', () => {
      const payload = {
        ...sampleValidBatch,
        topics: sampleValidBatch.topics.slice(0, 2),
      };
      const res = validateCurriculumDecomposeBatch(payload, allowedSourceHandles);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.some((i) => i.code === 'quota_shortfall')).toBe(true);
    });

    it('rejects batch with more than 8 topics with invalid_input', () => {
      const extraTopics = Array.from({ length: 9 }).map((_, idx) => ({
        handle: `h_${idx}`,
        title: `Topic ${idx}`,
        summary: 'Summary',
        learningObjectives: ['Objective 1'],
        conceptName: `Concept ${idx}`,
        materialSupport: 'unsupported',
        sourceHandles: [],
        whyHere: null,
      }));
      const payload = {
        schemaVersion: 1,
        topics: extraTopics,
      };
      const res = validateCurriculumDecomposeBatch(payload, allowedSourceHandles);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.some((i) => i.path === 'topics')).toBe(true);
    });

    it('rejects duplicate topic handles with duplicate_node', () => {
      const payload = {
        schemaVersion: 1,
        topics: [
          { ...sampleValidBatch.topics[0], handle: 'dup_h' },
          { ...sampleValidBatch.topics[1], handle: 'dup_h' },
          { ...sampleValidBatch.topics[2], handle: 'other_h' },
        ],
      };
      const res = validateCurriculumDecomposeBatch(payload, allowedSourceHandles);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.some((i) => i.code === 'duplicate_node')).toBe(true);
    });

    it('rejects grounded topic with empty sourceHandles with insufficient_evidence', () => {
      const payload = {
        schemaVersion: 1,
        topics: [
          { ...sampleValidBatch.topics[0], materialSupport: 'grounded', sourceHandles: [] },
          sampleValidBatch.topics[1],
          sampleValidBatch.topics[2],
        ],
      };
      const res = validateCurriculumDecomposeBatch(payload, allowedSourceHandles);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.some((i) => i.code === 'insufficient_evidence')).toBe(true);
    });

    it('rejects hallucinated source handles not present in allowedSourceHandles with missing_source', () => {
      const payload = {
        schemaVersion: 1,
        topics: [
          { ...sampleValidBatch.topics[0], sourceHandles: ['src_h1', 'ghost_source_99'] },
          sampleValidBatch.topics[1],
          sampleValidBatch.topics[2],
        ],
      };
      const res = validateCurriculumDecomposeBatch(payload, allowedSourceHandles);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.some((i) => i.code === 'missing_source')).toBe(true);
    });

    it('rejects malformed objective counts (>6 or <1) and empty strings', () => {
      const payload = {
        schemaVersion: 1,
        topics: [
          { ...sampleValidBatch.topics[0], learningObjectives: [] },
          {
            ...sampleValidBatch.topics[1],
            learningObjectives: ['1', '2', '3', '4', '5', '6', '7'],
          },
          sampleValidBatch.topics[2],
        ],
      };
      const res = validateCurriculumDecomposeBatch(payload, allowedSourceHandles);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.length).toBeGreaterThanOrEqual(2);
    });

    it('handles adversarial non-object inputs gracefully without throwing', () => {
      expect(validateCurriculumDecomposeBatch(null, allowedSourceHandles).success).toBe(false);
      expect(validateCurriculumDecomposeBatch(undefined, allowedSourceHandles).success).toBe(false);
      expect(validateCurriculumDecomposeBatch('string', allowedSourceHandles).success).toBe(false);
      expect(validateCurriculumDecomposeBatch([], allowedSourceHandles).success).toBe(false);
      expect(validateCurriculumDecomposeBatch({ topics: 'not an array' }, allowedSourceHandles).success).toBe(false);
    });
  });

  describe('validateCurriculumPrerequisiteOutput', () => {
    const knownHandles = new Set(['h_0', 'h_1', 'h_2']);

    const validEdgeBatch = {
      schemaVersion: 1,
      edges: [
        {
          prerequisiteHandle: 'h_0',
          dependentHandle: 'h_1',
          rationale: 'Forward propagation relies on neural network foundations.',
          sourceHandles: ['src_h1'],
          support: 'inferred',
        },
        {
          prerequisiteHandle: 'h_1',
          dependentHandle: 'h_2',
          rationale: 'Backpropagation calculates error derivatives after the forward pass.',
          sourceHandles: [],
          support: 'inferred',
        },
      ],
    };

    it('accepts valid prerequisite edge proposals between known handles', () => {
      const res = validateCurriculumPrerequisiteOutput(validEdgeBatch, knownHandles, allowedSourceHandles);
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.data.edges).toHaveLength(2);
      expect(res.data.edges[0].support).toBe('inferred');
    });

    it('rejects dangling / unknown prerequisite handles with dangling_prerequisite', () => {
      const payload = {
        schemaVersion: 1,
        edges: [
          {
            prerequisiteHandle: 'unknown_h99',
            dependentHandle: 'h_1',
            rationale: 'Valid rationale here.',
            sourceHandles: [],
            support: 'inferred',
          },
        ],
      };
      const res = validateCurriculumPrerequisiteOutput(payload, knownHandles);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.some((i) => i.code === 'dangling_prerequisite')).toBe(true);
    });

    it('rejects self-edges with dependency_cycle', () => {
      const payload = {
        schemaVersion: 1,
        edges: [
          {
            prerequisiteHandle: 'h_0',
            dependentHandle: 'h_0',
            rationale: 'Self dependency.',
            sourceHandles: [],
            support: 'inferred',
          },
        ],
      };
      const res = validateCurriculumPrerequisiteOutput(payload, knownHandles);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.some((i) => i.code === 'dependency_cycle')).toBe(true);
    });

    it('rejects duplicate directed edges with order_conflict', () => {
      const payload = {
        schemaVersion: 1,
        edges: [
          validEdgeBatch.edges[0],
          { ...validEdgeBatch.edges[0], rationale: 'Alternative explanation' },
        ],
      };
      const res = validateCurriculumPrerequisiteOutput(payload, knownHandles);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.some((i) => i.code === 'order_conflict')).toBe(true);
    });
  });

  describe('validateCurriculumPriorEvidence', () => {
    it('accepts null prior evidence cleanly (C2 default)', () => {
      const res = validateCurriculumPriorEvidence(null);
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.data).toBeNull();
    });

    it('accepts valid diagnostic prior evidence', () => {
      const validEvidence = {
        diagnosticAttemptId: 'diag_att_123',
        concepts: [
          {
            conceptId: 'conc_1',
            level: 'developing',
            observedMean: 0.65,
            uncertainty: ['few-independent-sessions', 'ai-graded'],
            evidenceGroupIds: ['grp_1'],
          },
        ],
      };
      const res = validateCurriculumPriorEvidence(validEvidence);
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.data?.diagnosticAttemptId).toBe('diag_att_123');
      expect(res.data?.concepts[0].level).toBe('developing');
    });

    it('rejects invalid mastery level or out-of-range observedMean', () => {
      const invalid = {
        diagnosticAttemptId: 'att_1',
        concepts: [
          {
            conceptId: 'c1',
            level: 'mastered-perfectly', // invalid!
            observedMean: 1.5, // > 1.0!
            uncertainty: ['unknown-reason'],
            evidenceGroupIds: [],
          },
        ],
      };
      const res = validateCurriculumPriorEvidence(invalid);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('validateCurriculumGenerationRequest', () => {
    const validScope: StudySourceScopeV1 = {
      schemaVersion: 1,
      selected: {
        documentIds: ['doc-1'],
        extractIds: [],
        collectionIds: [],
        tagIds: [],
      },
      resolvedDocuments: [
        {
          documentId: 'doc-1',
          title: 'Deep Learning',
          sourceType: 'pdf',
          revision: 'hash-1',
          revisionKind: 'content-hash',
          extractIds: [],
          isAiExcluded: false,
          isLocalOnly: false,
        },
      ],
      frozenAt: new Date().toISOString(),
      indexCompleteness: 'complete',
      limitations: [],
    };

    it('accepts valid generation request envelope with null priorEvidence', () => {
      const req = {
        planId: 'plan-1',
        baseVersionId: 'spv-1',
        sourceScope: validScope,
        depth: 'foundational',
        knowledgePolicy: 'source-only',
        rulesOnly: false,
        priorEvidence: null,
      };
      const res = validateCurriculumGenerationRequest(req);
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.data.planId).toBe('plan-1');
      expect(res.data.depth).toBe('foundational');
      expect(res.data.priorEvidence).toBeNull();
    });

    it('rejects request with invalid depth or knowledge policy', () => {
      const invalid = {
        planId: 'plan-1',
        baseVersionId: 'spv-1',
        sourceScope: validScope,
        depth: 'extreme', // invalid
        knowledgePolicy: 'unrestricted-web', // invalid
        rulesOnly: 'not-a-bool',
        priorEvidence: null,
      };
      const res = validateCurriculumGenerationRequest(invalid);
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.issues.some((i) => i.path === 'depth')).toBe(true);
      expect(res.issues.some((i) => i.path === 'knowledgePolicy')).toBe(true);
      expect(res.issues.some((i) => i.path === 'rulesOnly')).toBe(true);
    });
  });
});
