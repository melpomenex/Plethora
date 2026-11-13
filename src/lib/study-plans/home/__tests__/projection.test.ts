import { describe, expect, it } from 'vitest';
import { projectPlanHome } from '../projection';
import type { StudyPlanDetail } from '../../../../types/learningPaths';

function plan(overrides: {
  activities?: Record<string, string>;
  prerequisites?: Array<{ prerequisiteNodeId: string; dependentNodeId: string }>;
  sourceRefs?: Record<string, string[]>;
  authority?: StudyPlanDetail['version']['knowledgeAuthority'];
} = {}): StudyPlanDetail {
  return {
    plan: { id: 'sp_1', title: 'P', goal: 'G', depth: 'foundational', status: 'active', currentVersionId: null, currentVersion: 0, draftVersionId: 'spv_1', revision: 1, createdAt: '', updatedAt: '' },
    version: {
      id: 'spv_1', planId: 'sp_1', version: 1, state: 'draft', baseVersionId: null,
      sourceScope: undefined,
      knowledgeAuthority: overrides.authority ?? { kind: 'library', policy: 'source-only' },
      nodes: ['Intro', 'Core', 'Advanced'].map((title, i) => ({
        nodeId: `n${i}`, title, summary: 's', learningObjectives: ['obj'],
        conceptId: null, conceptLabel: title, position: i, included: true, locked: false,
        userAdded: false, userModified: false, materialSupport: 'grounded',
        whyHere: null, sourceRefIds: overrides.sourceRefs?.[`n${i}`] ?? ['ssr_1'],
      })),
      prerequisites: (overrides.prerequisites ?? []).map((e) => ({ ...e, support: 'confirmed-concept-link', rationale: null, sourceRefIds: [] })),
      changeSummary: null, createdBy: 'user', createdAt: '', publishedAt: null,
    },
    activityByNodeId: { n0: 'not-started', n1: 'not-started', n2: 'not-started', ...(overrides.activities ?? {}) },
    sourceRefs: { ssr_1: { status: 'current', navigation: 'exact', ref: { schemaVersion: 1, id: 'ssr_1', documentId: 'd1', excerpt: 'x', revision: 'r', revisionKind: 'content-hash', excerptSha256: 'h', documentTitle: 'D', sourceType: 'pdf', capturedAt: '' } } },
  };
}

describe('projectPlanHome', () => {
  it('recommends resume for an in-progress objective with a stable reason', () => {
    const p = plan({ activities: { n0: 'completed', n1: 'in-progress' } });
    const projection = projectPlanHome(p, { dueReviewCount: 7 });
    expect(projection.recommendation.reasonKey).toBe('resume');
    expect(projection.recommendation.nodeId).toBe('n1');
    expect(projection.dueReviewCount).toBe(7);
  });

  it('recommends the next topic in order after completion', () => {
    const p = plan({ activities: { n0: 'completed' } });
    const projection = projectPlanHome(p);
    expect(projection.recommendation.reasonKey).toBe('next-topic');
    expect(projection.recommendation.nodeId).toBe('n1');
  });

  it('points Continue at the prerequisite and keeps its dependents visible', () => {
    const p = plan({
      prerequisites: [{ prerequisiteNodeId: 'n0', dependentNodeId: 'n1' }],
    });
    const projection = projectPlanHome(p);
    // Continue identifies the actionable prerequisite (n0)…
    expect(projection.recommendation.nodeId).toBe('n0');
    expect(projection.recommendation.reasonKey).toBe('next-topic');
    // …while the dependent topic stays visible in the path and as a blocked dependent.
    expect(projection.recommendation.blockedDependents).toContainEqual({
      nodeId: 'n1',
      title: 'Core',
    });
    expect(projection.path.some((entry) => entry.nodeId === 'n1')).toBe(true);
  });

  it('flags missing sources for library plans and reports all-complete', () => {
    const noSources = plan({ sourceRefs: { n0: [] } });
    expect(projectPlanHome(noSources).recommendation.reasonKey).toBe('no-sources');

    const done = plan({ activities: { n0: 'completed', n1: 'completed', n2: 'completed' } });
    const projection = projectPlanHome(done);
    expect(projection.recommendation.reasonKey).toBe('all-complete');
    expect(projection.recommendation.nodeId).toBeNull();
  });

  it('surfaces unavailable due-review data as null rather than zero', () => {
    const p = plan();
    expect(projectPlanHome(p, { dueReviewCount: null }).dueReviewCount).toBeNull();
    expect(projectPlanHome(p, { dueReviewCount: 0 }).dueReviewCount).toBe(0);
  });
});
