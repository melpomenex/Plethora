import type { NodeActivity, PlanPrerequisite, StudyPlanVersionNode } from '../../../../types/learningPaths';
import type { StudySourceResolution } from '../../../../types/studySource';

export function makeNode(
  nodeId: string,
  title: string,
  position: number,
  overrides: Partial<StudyPlanVersionNode> = {}
): StudyPlanVersionNode {
  return {
    nodeId,
    title,
    summary: `Summary for ${title}`,
    learningObjectives: [`Understand ${title}`],
    conceptId: null,
    conceptLabel: title,
    position,
    included: true,
    locked: false,
    userAdded: false,
    userModified: false,
    materialSupport: 'grounded',
    whyHere: null,
    sourceRefIds: [],
    ...overrides,
  };
}

export function createFutureOfMathFixture(): {
  nodes: StudyPlanVersionNode[];
  prerequisites: PlanPrerequisite[];
  activityByNodeId: Record<string, NodeActivity>;
  sourceRefs: Record<string, StudySourceResolution>;
} {
  const nodes: StudyPlanVersionNode[] = [
    makeNode('t1', 'Framing Questions for the Future of Mathematics', 0, {
      sourceRefIds: ['ref_f1', 'ref_f2', 'ref_f3'],
      learningObjectives: [
        'Identify three fundamental questions about the future of mathematics.',
        'Explain how these questions connect to later topics in the plan.',
        'Evaluate competing views on the long-term role of mathematics.',
      ],
    }),
    makeNode('t2', 'Utility & Abstraction', 1, {
      sourceRefIds: ['ref_f1', 'ref_f2', 'ref_f3', 'ref_f4'],
    }),
    makeNode('t3', 'AI Solves Major Problems', 2, {
      sourceRefIds: ['ref_f1', 'ref_f2', 'ref_f3'],
    }),
    makeNode('t4', 'Mathematical Creativity', 3, {
      sourceRefIds: ['ref_f1', 'ref_f2'],
    }),
    makeNode('t5', 'The Chess Analogy', 4, {
      sourceRefIds: ['ref_f3'],
    }),
    makeNode('t6', 'Accessibility & Mathematical Renaissance', 5, {
      sourceRefIds: ['ref_f1', 'ref_f2', 'ref_f4'],
    }),
    makeNode('t7', 'Predicting the Future', 6, {
      sourceRefIds: ['ref_stale'],
    }),
    makeNode('t8', 'The Human Moat', 7, {
      sourceRefIds: ['ref_f1', 'ref_f2', 'ref_f3', 'ref_f4'],
    }),
    makeNode('t9', 'Toolkits and Traditions', 8, {
      sourceRefIds: ['ref_f1', 'ref_f2', 'ref_f3'],
    }),
    makeNode('t10', 'Why Mathematics Justifies Itself', 9, {
      sourceRefIds: ['ref_f2', 'ref_f3'],
    }),
    makeNode('t11', 'Interdisciplinary Mastery', 10, {
      sourceRefIds: ['ref_f1', 'ref_f2', 'ref_f3'],
    }),
    makeNode('t12', 'The Mathematician and Research Future', 11, {
      locked: true,
      sourceRefIds: ['ref_f1', 'ref_f2', 'ref_f3'],
    }),
    makeNode('t13', 'Mathematics\' "Suicidal Aesthetic"', 12, {
      sourceRefIds: ['ref_f1', 'ref_f3'],
    }),
  ];

  const prerequisites: PlanPrerequisite[] = [
    {
      prerequisiteNodeId: 't1',
      dependentNodeId: 't2',
      support: 'user',
      rationale: 'Framing establishes why utility and abstraction are examined.',
      sourceRefIds: ['ref_f1'],
    },
    {
      prerequisiteNodeId: 't1',
      dependentNodeId: 't3',
      support: 'inferred',
      rationale: 'Connects framing questions to AI problem solving.',
      sourceRefIds: ['ref_f1'],
    },
    {
      prerequisiteNodeId: 't1',
      dependentNodeId: 't4',
      support: 'user',
      rationale: 'Creativity debates build on the initial questions.',
      sourceRefIds: ['ref_f1'],
    },
    {
      prerequisiteNodeId: 't5',
      dependentNodeId: 't2',
      support: 'confirmed-concept-link',
      rationale: 'Chess analogy illustrates AI shifting utility boundaries.',
      sourceRefIds: ['ref_f3'],
    },
    {
      prerequisiteNodeId: 't2',
      dependentNodeId: 't7',
      support: 'user',
      rationale: 'Forecasts depend on understanding abstraction trends.',
      sourceRefIds: ['ref_f2'],
    },
    {
      prerequisiteNodeId: 't3',
      dependentNodeId: 't7',
      support: 'inferred',
      rationale: 'AI milestones inform future trajectory predictions.',
      sourceRefIds: ['ref_f2'],
    },
    {
      prerequisiteNodeId: 't4',
      dependentNodeId: 't7',
      support: 'user',
      rationale: 'Creative limits shape future scenarios.',
      sourceRefIds: ['ref_f2'],
    },
    {
      prerequisiteNodeId: 't4',
      dependentNodeId: 't8',
      support: 'user',
      rationale: 'Human moat contrasts with machine creativity.',
      sourceRefIds: ['ref_f2'],
    },
    {
      prerequisiteNodeId: 't2',
      dependentNodeId: 't9',
      support: 'inferred',
      rationale: 'Toolkits realize abstraction in practice.',
      sourceRefIds: ['ref_f2'],
    },
    {
      prerequisiteNodeId: 't9',
      dependentNodeId: 't10',
      support: 'user',
      rationale: 'Traditions support self-justifying inquiry.',
      sourceRefIds: ['ref_f3'],
    },
    {
      prerequisiteNodeId: 't10',
      dependentNodeId: 't11',
      support: 'user',
      rationale: 'Intrinsic justification bridges into interdisciplinary mastery.',
      sourceRefIds: ['ref_f3'],
    },
    {
      prerequisiteNodeId: 't7',
      dependentNodeId: 't11',
      support: 'inferred',
      rationale: null,
      sourceRefIds: [],
    },
    {
      prerequisiteNodeId: 't8',
      dependentNodeId: 't11',
      support: 'user',
      rationale: 'Human moat informs interdisciplinary collaboration.',
      sourceRefIds: ['ref_f4'],
    },
    {
      prerequisiteNodeId: 't11',
      dependentNodeId: 't12',
      support: 'inferred',
      rationale: 'Research future requires interdisciplinary mastery.',
      sourceRefIds: ['ref_f1'],
    },
    {
      prerequisiteNodeId: 't8',
      dependentNodeId: 't13',
      support: 'unsupported',
      rationale: null,
      sourceRefIds: [],
    },
  ];

  const activityByNodeId: Record<string, NodeActivity> = {
    t1: 'in-progress',
    t2: 'completed',
    t3: 'not-started',
    t4: 'in-progress',
    t5: 'skipped',
    t6: 'not-started',
    t7: 'not-started',
    t8: 'in-progress',
    t9: 'not-started',
    t10: 'completed',
    t11: 'not-started',
    t12: 'not-started',
    t13: 'not-started',
  };

  const makeResolution = (
    id: string,
    documentId: string,
    documentTitle: string,
    status: StudySourceResolution['status'],
    timeSeconds?: number,
    pageNumber?: number
  ): StudySourceResolution => ({
    ref: {
      schemaVersion: 1,
      id,
      documentId,
      excerpt: `Excerpt from ${documentTitle}`,
      revision: 'rev1',
      revisionKind: 'content-hash',
      excerptSha256: 'sha256:0000',
      documentTitle,
      sourceType: timeSeconds !== undefined ? 'youtube' : 'pdf',
      capturedAt: '2026-11-14T00:00:00Z',
      jump:
        timeSeconds !== undefined
          ? { kind: 'youtube', timeSeconds, textQuote: 'quote' }
          : { kind: 'pdf', pageNumber: pageNumber ?? 14 },
    },
    status,
    navigation: status === 'missing' ? 'unavailable' : 'exact',
  });

  const sourceRefs: Record<string, StudySourceResolution> = {
    ref_f1: makeResolution('ref_f1', 'doc_yt', 'Fields Medalist & Eric Weinstein on the Future of Mathematics', 'current', 1184),
    ref_f2: makeResolution('ref_f2', 'doc_chess', 'The Chess Analogy: Humans Directing AI, Then Greater...', 'current', undefined, 22),
    ref_f3: makeResolution('ref_f3', 'doc_why', 'Why Mathematics Justifies Itself: Utility and Unpredictability', 'current', undefined, 78),
    ref_f4: makeResolution('ref_f4', 'doc_ren', 'Mathematical Renaissance Notes', 'current', undefined, 41),
    ref_stale: makeResolution('ref_stale', 'doc_stale', 'Predicting Math Progress Essay', 'stale', undefined, 10),
  };

  return { nodes, prerequisites, activityByNodeId, sourceRefs };
}
