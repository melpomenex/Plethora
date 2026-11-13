import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanHomeTab } from '../PlanHomeTab';
import type { StudyPlanDetail } from '../../../../types/learningPaths';

vi.mock('../../../../api/analytics', () => ({
  getWorkloadData: vi.fn(),
}));

function detail(): StudyPlanDetail {
  return {
    plan: { id: 'sp_1', title: 'Plan', goal: 'G', depth: 'foundational', status: 'active', currentVersionId: null, currentVersion: 0, draftVersionId: 'spv_1', revision: 1, createdAt: '', updatedAt: '' },
    version: {
      id: 'spv_1', planId: 'sp_1', version: 1, state: 'draft', baseVersionId: null,
      sourceScope: undefined,
      knowledgeAuthority: { kind: 'library', policy: 'source-only' },
      nodes: [{ nodeId: 'n0', title: 'Intro', summary: 's', learningObjectives: ['obj'], conceptId: null, conceptLabel: 'Intro', position: 0, included: true, locked: false, userAdded: false, userModified: false, materialSupport: 'grounded', whyHere: null, sourceRefIds: ['ssr_1'] }],
      prerequisites: [], changeSummary: null, createdBy: 'user', createdAt: '', publishedAt: null,
    },
    activityByNodeId: { n0: 'not-started' },
    sourceRefs: { ssr_1: { status: 'current', navigation: 'exact', ref: { schemaVersion: 1, id: 'ssr_1', documentId: 'd1', excerpt: 'x', revision: 'r', revisionKind: 'content-hash', excerptSha256: 'h', documentTitle: 'D', sourceType: 'pdf', capturedAt: '' } } },
  };
}

describe('PlanHomeTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads today’s workload and shows the summed due-review count', async () => {
    const analytics = await import('../../../../api/analytics');
    vi.mocked(analytics.getWorkloadData).mockResolvedValue([
      { date: '2026-11-13', due_count: 4, reviewed_count: 1, new_count: 0 },
      { date: '2026-11-13', due_count: 3, reviewed_count: 0, new_count: 0 },
    ]);

    render(<PlanHomeTab planDetail={detail()} onBack={vi.fn()} onContinue={vi.fn()} onOpenPath={vi.fn()} onOpenReview={vi.fn()} />);

    expect(await screen.findByText('7 due')).toBeInTheDocument();
  });

  it('routes Continue to the recommended node', async () => {
    const analytics = await import('../../../../api/analytics');
    vi.mocked(analytics.getWorkloadData).mockResolvedValue([]);
    const onContinue = vi.fn();

    render(<PlanHomeTab planDetail={detail()} onBack={vi.fn()} onContinue={onContinue} onOpenPath={vi.fn()} onOpenReview={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));
    expect(onContinue).toHaveBeenCalledWith('n0');
  });
});
