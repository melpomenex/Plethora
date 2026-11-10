/**
 * Unit tests for Curriculum Proposal Merge & Reconciliation (C2-T02).
 */

import { describe, it, expect } from 'vitest';
import { mergeCurriculumProposals, computeSemanticKey } from '../merge';
import type { StudyPlanVersion } from '../../../../types/learningPaths';
import type { CurriculumEdgeProposal, CurriculumTopicProposal } from '../types';

describe('Curriculum Merge & Reconciliation', () => {
  const dummyBaseVersion: StudyPlanVersion = {
    id: 'spv-1',
    planId: 'plan-1',
    version: 1,
    state: 'published',
    baseVersionId: null,
    sourceScope: {
      schemaVersion: 1,
      selected: { documentIds: ['d1'], extractIds: [], collectionIds: [], tagIds: [] },
      resolvedDocuments: [],
      frozenAt: '2026-03-31T00:00:00Z',
      indexCompleteness: 'complete',
      limitations: [],
    },
    nodes: [
      {
        nodeId: 'node-locked-1',
        title: 'Perceptrons & Linear Classifiers',
        summary: 'Base summary',
        learningObjectives: ['Define linear boundaries'],
        conceptId: 'conc-perceptron',
        conceptLabel: 'Perceptron',
        position: 0,
        included: true,
        locked: true,
        userAdded: false,
        userModified: false,
        materialSupport: 'grounded',
        whyHere: 'Foundations',
        sourceRefIds: ['ssr-base-1'],
      },
      {
        nodeId: 'node-tombstone-2',
        title: 'Deprecated Hardware Acceleration',
        summary: 'Old GPUs',
        learningObjectives: ['Understand CUDA cores'],
        conceptId: null,
        conceptLabel: 'Hardware',
        position: -1,
        included: false, // Tombstone!
        locked: false,
        userAdded: false,
        userModified: false,
        materialSupport: 'unsupported',
        whyHere: null,
        sourceRefIds: [],
      },
      {
        nodeId: 'node-standard-3',
        title: 'Activation Functions',
        summary: 'Sigmoid and ReLU',
        learningObjectives: ['Compare Sigmoid and ReLU'],
        conceptId: null,
        conceptLabel: 'Activation',
        position: 1,
        included: true,
        locked: false,
        userAdded: false,
        userModified: false,
        materialSupport: 'grounded',
        whyHere: 'Non-linearity',
        sourceRefIds: ['ssr-base-2'],
      },
    ],
    prerequisites: [
      {
        prerequisiteNodeId: 'node-locked-1',
        dependentNodeId: 'node-standard-3',
        support: 'inferred',
        rationale: 'Linear classifier before non-linear activations.',
        sourceRefIds: [],
      },
    ],
    changeSummary: null,
    createdBy: 'user',
    createdAt: '2026-03-31T00:00:00Z',
    publishedAt: '2026-03-31T00:00:00Z',
  };

  it('computes stable semantic keys based on conceptId or normalized NFC title + primary objective', () => {
    const k1 = computeSemanticKey('conc-1', 'Different Title', 'Different Obj');
    const k2 = computeSemanticKey('conc-1', 'Another Title', 'Another Obj');
    expect(k1).toBe(k2);

    const k3 = computeSemanticKey(null, '  Activation Functions  ', ' Compare Sigmoid and ReLU ');
    const k4 = computeSemanticKey(null, 'activation functions', 'compare sigmoid and relu');
    expect(k3).toBe(k4);
  });

  it('preserves user locks without overriding locked node content or position', () => {
    const proposals: CurriculumTopicProposal[] = [
      {
        handle: 'h_0',
        title: 'Perceptrons & Linear Classifiers (Model Attempted Rewrite)',
        summary: 'Model overwritten summary',
        learningObjectives: ['Model overwritten objective'],
        conceptName: 'Perceptron',
        materialSupport: 'grounded',
        sourceHandles: ['src_h0'],
        whyHere: 'Model why here',
      },
    ];

    const result = mergeCurriculumProposals({
      baseVersion: dummyBaseVersion,
      proposedTopics: proposals,
      proposedEdges: [],
      depth: 'foundational',
    });

    const lockedNode = result.nodes.find((n) => n.nodeId === 'node-locked-1')!;
    expect(lockedNode.title).toBe('Perceptrons & Linear Classifiers'); // preserved!
    expect(lockedNode.summary).toBe('Base summary'); // preserved!
    expect(lockedNode.locked).toBe(true);
  });

  it('preserves user-removed tombstones: proposal matching tombstone is not resurrected', () => {
    const proposals: CurriculumTopicProposal[] = [
      {
        handle: 'h_tomb',
        title: 'Deprecated Hardware Acceleration',
        summary: 'Resurrected hardware summary',
        learningObjectives: ['Understand CUDA cores'],
        conceptName: 'Hardware',
        materialSupport: 'grounded',
        sourceHandles: ['src_h0'],
        whyHere: null,
      },
    ];

    const result = mergeCurriculumProposals({
      baseVersion: dummyBaseVersion,
      proposedTopics: proposals,
      proposedEdges: [],
      depth: 'foundational',
    });

    const tombstoneNode = result.nodes.find((n) => n.nodeId === 'node-tombstone-2')!;
    expect(tombstoneNode.included).toBe(false); // remained tombstone!
  });

  it('adds newly proposed topics, unions validated sources, and generates valid PlanVersionDiff', () => {
    const proposals: CurriculumTopicProposal[] = [
      {
        handle: 'h_0',
        title: 'Perceptrons & Linear Classifiers',
        summary: 'Base summary',
        learningObjectives: ['Define linear boundaries'],
        conceptName: 'Perceptron',
        materialSupport: 'grounded',
        sourceHandles: [],
        whyHere: 'Foundations',
      },
      {
        handle: 'h_new',
        title: 'Gradient Descent Optimization',
        summary: 'Stochastic and mini-batch GD.',
        learningObjectives: ['Compute loss gradients', 'Update learning rates'],
        conceptName: 'Optimization',
        materialSupport: 'grounded',
        sourceHandles: ['src_h3'],
        whyHere: 'Parameter updates',
      },
    ];

    const handleToSourceRefIdMap = new Map([['src_h3', 'ssr_new_3']]);

    const result = mergeCurriculumProposals({
      baseVersion: dummyBaseVersion,
      proposedTopics: proposals,
      proposedEdges: [
        {
          prerequisiteHandle: 'h_0',
          dependentHandle: 'h_new',
          rationale: 'Must understand classifiers before gradient optimization.',
          sourceHandles: [],
          support: 'inferred',
        },
      ],
      depth: 'foundational',
      handleToSourceRefIdMap,
    });

    // Check newly added node
    const addedNode = result.nodes.find((n) => n.title === 'Gradient Descent Optimization');
    expect(addedNode).toBeDefined();
    expect(addedNode?.sourceRefIds).toContain('ssr_new_3');
    expect(result.diff.addedNodeIds).toContain(addedNode?.nodeId);
    expect(result.diff.addedPrerequisites.length).toBeGreaterThanOrEqual(1);
  });

  it('prunes inferred edges that would create a cycle without failing the entire merge', () => {
    // Current order: node-locked-1 -> node-standard-3
    // Propose an edge: node-standard-3 -> node-locked-1 (creates a 2-node cycle!)
    const proposals: CurriculumTopicProposal[] = [
      {
        handle: 'h_locked',
        title: 'Perceptrons & Linear Classifiers',
        summary: 'Summary',
        learningObjectives: ['Define linear boundaries'],
        conceptName: 'Perceptron',
        materialSupport: 'grounded',
        sourceHandles: [],
        whyHere: null,
      },
      {
        handle: 'h_standard',
        title: 'Activation Functions',
        summary: 'Summary',
        learningObjectives: ['Compare Sigmoid and ReLU'],
        conceptName: 'Activation',
        materialSupport: 'grounded',
        sourceHandles: [],
        whyHere: null,
      },
    ];

    const cyclicEdges: CurriculumEdgeProposal[] = [
      {
        prerequisiteHandle: 'h_standard',
        dependentHandle: 'h_locked', // Backward edge -> cycle!
        rationale: 'Cyclic backward edge',
        sourceHandles: [],
        support: 'inferred',
      },
    ];

    const result = mergeCurriculumProposals({
      baseVersion: dummyBaseVersion,
      proposedTopics: proposals,
      proposedEdges: cyclicEdges,
      depth: 'foundational',
    });

    expect(result.droppedEdgesCount).toBe(1); // Safely dropped!
    // Resulting graph must still be topologically valid
    const finalIncluded = result.nodes.filter((n) => n.included);
    const lockedIdx = finalIncluded.findIndex((n) => n.nodeId === 'node-locked-1');
    const standardIdx = finalIncluded.findIndex((n) => n.nodeId === 'node-standard-3');
    expect(lockedIdx).toBeLessThan(standardIdx);
  });
});
