import { describe, expect, it } from 'vitest';
import { projectStudyQueue } from '../queueProjection';
import type { StudyPlanDetail } from '../../../../types/learningPaths';
import type { StudyTrailOverview } from '../../../../types/studyTrail';

function makePlanDetail(): StudyPlanDetail {
  return {
    plan: {
      id: 'plan-1',
      title: 'Epistemology',
      goal: 'Master foundational epistemology',
      depth: 'foundational',
      status: 'active',
      createdAt: '2026-11-17T00:00:00Z',
      updatedAt: '2026-11-17T00:00:00Z',
      revision: 1,
      currentVersion: 1,
      currentVersionId: 'ver-1',
      draftVersionId: null,
    },
    version: {
      id: 'ver-1',
      planId: 'plan-1',
      version: 1,
      state: 'published',
      baseVersionId: null,
      changeSummary: null,
      createdBy: 'user',
      knowledgeAuthority: { kind: 'library', policy: 'source-only' },
      sourceScope: null,
      nodes: [
        {
          nodeId: 'n-pre',
          conceptId: null,
          conceptLabel: 'Belief',
          title: 'Belief',
          summary: '',
          position: 0,
          learningObjectives: ['Define belief'],
          locked: false,
          included: true,
          userAdded: false,
          userModified: false,
          materialSupport: 'grounded',
          whyHere: null,
          sourceRefIds: [],
        },
        {
          nodeId: 'n-dep',
          conceptId: null,
          conceptLabel: 'Justified True Belief',
          title: 'Justified True Belief',
          summary: '',
          position: 1,
          learningObjectives: ['Analyze justified true belief'],
          locked: false,
          included: true,
          userAdded: false,
          userModified: false,
          materialSupport: 'grounded',
          whyHere: null,
          sourceRefIds: [],
        },
      ],
      prerequisites: [
        {
          dependentNodeId: 'n-dep',
          prerequisiteNodeId: 'n-pre',
          support: 'user',
          rationale: null,
          sourceRefIds: [],
        },
      ],
      createdAt: '2026-11-17T00:00:00Z',
      publishedAt: '2026-11-17T00:00:00Z',
    },
    sourceRefs: {},
    activityByNodeId: {},
  };
}

function makeOverview(preStatus: 'pending' | 'check_passed' = 'pending'): StudyTrailOverview {
  return {
    planId: 'plan-1',
    versionId: 'ver-1',
    segments: [
      {
        id: 'seg-1',
        documentId: 'doc-1',
        documentRevision: 'rev-1',
        format: 'markdown',
        title: 'Chapter 1: Belief',
        parentSectionLabel: 'Part I › Chapter 1: Belief',
        startLocator: { kind: 'markdown', scrollPercent: 10 },
        endLocator: { kind: 'markdown', scrollPercent: 25 },
        startOffset: 0,
        endOffset: 1200,
        excerptPreview: 'A belief is a cognitive attitude toward a proposition.',
        wordCount: 400,
        estimatedDurationSeconds: 120,
        structuralClass: 'definition',
        instructionalRole: 'core_explanation',
        qualityScore: 0.85,
        qualityRationale: 'Clear definition',
        validationStatus: 'verified',
        readinessStatus: 'ready',
        generatorVersion: 'guided-study-trail-v1',
        schemaVersion: 1,
        provenance: {},
        createdAt: '2026-11-17T00:00:00Z',
        updatedAt: '2026-11-17T00:00:00Z',
      },
      {
        id: 'seg-2',
        documentId: 'doc-1',
        documentRevision: 'rev-1',
        format: 'markdown',
        title: 'Chapter 2: Knowledge',
        parentSectionLabel: 'Part I › Chapter 2: Knowledge',
        startLocator: { kind: 'markdown', scrollPercent: 30 },
        endLocator: { kind: 'markdown', scrollPercent: 50 },
        startOffset: 1300,
        endOffset: 2800,
        excerptPreview: 'Justified true belief requires truth, belief, and justification.',
        wordCount: 600,
        estimatedDurationSeconds: 180,
        structuralClass: 'argument',
        instructionalRole: 'core_explanation',
        qualityScore: 0.9,
        qualityRationale: 'Detailed argument',
        validationStatus: 'verified',
        readinessStatus: 'ready',
        generatorVersion: 'guided-study-trail-v1',
        schemaVersion: 1,
        provenance: {},
        createdAt: '2026-11-17T00:00:00Z',
        updatedAt: '2026-11-17T00:00:00Z',
      },
    ],
    objectiveLinks: [
      {
        id: 'lso-1',
        planId: 'plan-1',
        versionId: 'ver-1',
        nodeId: 'n-pre',
        objectiveIndex: 0,
        segmentId: 'seg-1',
        coverageStatus: 'adequately_covered',
        alignmentScore: 0.85,
        selectionRationale: 'Matches belief definition',
        isPrimary: true,
        isRequired: true,
        authoredOverride: false,
        createdAt: '2026-11-17T00:00:00Z',
        updatedAt: '2026-11-17T00:00:00Z',
      },
      {
        id: 'lso-2',
        planId: 'plan-1',
        versionId: 'ver-1',
        nodeId: 'n-dep',
        objectiveIndex: 0,
        segmentId: 'seg-2',
        coverageStatus: 'adequately_covered',
        alignmentScore: 0.9,
        selectionRationale: 'Matches JTB',
        isPrimary: true,
        isRequired: true,
        authoredOverride: false,
        createdAt: '2026-11-17T00:00:00Z',
        updatedAt: '2026-11-17T00:00:00Z',
      },
    ],
    trailItems: [
      {
        id: 'sti-1',
        planId: 'plan-1',
        versionId: 'ver-1',
        nodeId: 'n-pre',
        objectiveIndex: 0,
        segmentId: 'seg-1',
        trailOrder: 1,
        sessionGroupId: 'session_1',
        status: preStatus,
        readingProgress: preStatus === 'check_passed' ? 1 : 0,
        isRequired: true,
        isRemediation: false,
        plannerRationale: 'Prerequisite concept',
        updatedAt: '2026-11-17T00:00:00Z',
      },
      {
        id: 'sti-2',
        planId: 'plan-1',
        versionId: 'ver-1',
        nodeId: 'n-dep',
        objectiveIndex: 0,
        segmentId: 'seg-2',
        trailOrder: 2,
        sessionGroupId: 'session_1',
        status: 'pending',
        readingProgress: 0,
        isRequired: true,
        isRemediation: false,
        plannerRationale: 'Dependent concept',
        updatedAt: '2026-11-17T00:00:00Z',
      },
    ],
    formativeChecks: [],
    eligibility: {
      policy: 'guided',
      eligible: preStatus === 'check_passed' ? false : false,
      requiredTotal: 2,
      requiredCompleted: preStatus === 'check_passed' ? 1 : 0,
      checksPassed: preStatus === 'check_passed' ? 1 : 0,
      blockingReasons: ['Incomplete assignments'],
      testOutAvailable: false,
    },
    documentTitles: { 'doc-1': 'Problems of Philosophy' },
    diagnostics: [],
  };
}

describe('projectStudyQueue', () => {
  it('recommends prerequisite first and marks dependent as blocked', () => {
    const proj = projectStudyQueue(makePlanDetail(), makeOverview('pending'));
    expect(proj.nextRecommended?.node.nodeId).toBe('n-pre');
    expect(proj.blockedItems).toHaveLength(1);
    expect(proj.blockedItems[0].node.nodeId).toBe('n-dep');
    expect(proj.blockedItems[0].unmetPrerequisites[0].title).toBe('Belief');
  });

  it('unblocks dependent once prerequisite is completed', () => {
    const proj = projectStudyQueue(makePlanDetail(), makeOverview('check_passed'));
    expect(proj.completedItems).toHaveLength(1);
    expect(proj.blockedItems).toHaveLength(0);
    expect(proj.nextRecommended?.node.nodeId).toBe('n-dep');
  });
});
