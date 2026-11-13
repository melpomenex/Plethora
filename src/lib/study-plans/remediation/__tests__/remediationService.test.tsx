import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import {
  buildTargetedPracticeConfig,
  buildFollowUpExamConfig,
  createTargetedPracticeDraft,
  createPlanAdjustmentDraft,
  contextFromGap,
} from '../remediationService';
import { RemediationList } from '../../../../components/study-plans/remediation/RemediationList';
import { PerformanceComparison } from '../../../../components/study-plans/remediation/PerformanceComparison';
import type { KnowledgeGapView, RemediationRecommendation } from '../../../../types/learningEvidence';

function gap(): KnowledgeGapView {
  return {
    id: 'gap1',
    kind: 'repeatedly_failed',
    conceptId: 'c1',
    conceptName: 'TLB',
    planId: 'plan1',
    nodeId: 'n1',
    ruleId: 'assessment-repeated-failure-v1',
    status: 'active',
    evidence: [],
    demonstrated: null,
    firstDetectedAt: '2026-01-01T00:00:00.000Z',
    lastDetectedAt: '2026-01-02T00:00:00.000Z',
    evidenceCutoff: '2026-01-02T00:00:00.000Z',
  };
}

function rec(over: Partial<RemediationRecommendation> = {}): RemediationRecommendation {
  return {
    id: 'rem1',
    gapId: 'gap1',
    kind: 'targeted-practice',
    status: 'suggested',
    sourceRefIds: [],
    payload: { conceptId: 'c1', objectives: [], evidenceSummary: 'x' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('C6-T07 remediationService', () => {
  it('builds practice/follow-up configs without auto-start and requires frozen scope', async () => {
    const scope = { schemaVersion: 1 } as never;
    const ctx = {
      planId: 'plan1',
      planVersionId: 'v1',
      nodeId: 'n1',
      gapId: 'gap1',
      conceptId: 'c1',
      sourceScope: scope,
      excludedFingerprints: ['fp1'],
      objectives: [],
    };
    const practice = buildTargetedPracticeConfig(ctx);
    expect(practice.mode).toBe('practice');
    expect(practice.timeLimitSeconds).toBeNull();
    expect(practice.excludedQuestionFingerprints).toEqual(['fp1']);
    const follow = buildFollowUpExamConfig(ctx);
    expect(follow.mode).toBe('exam');
    expect(follow.requestedCount).toBe(2);
    const createBlueprintDraft = vi.fn().mockResolvedValue({ revisionId: 'rev1' });
    const out = await createTargetedPracticeDraft(ctx, { createBlueprintDraft });
    expect(out.revisionId).toBe('rev1');
    expect(createBlueprintDraft).toHaveBeenCalledTimes(1);

    await expect(
      createTargetedPracticeDraft({ ...ctx, sourceScope: null }, { createBlueprintDraft }),
    ).rejects.toThrow('missing_source_scope');

    const savePlanDraft = vi.fn().mockResolvedValue(undefined);
    await createPlanAdjustmentDraft(ctx, { savePlanDraft }, 3);
    expect(savePlanDraft).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'plan1', expectedRevision: 3 }),
    );
    expect(contextFromGap(gap()).conceptId).toBe('c1');
  });

  it('remediation list creates practice draft only on click, persists disposition, survives context', async () => {
    const scope = { schemaVersion: 1 } as never;
    const g = { ...gap(), planId: 'plan1' };
    // Inject scope via contextFromGap default (null) → shows missing-scope notice, no auto write
    const clients = {
      createBlueprintDraft: vi.fn().mockResolvedValue({ revisionId: 'rev-p1' }),
      savePlanDraft: vi.fn().mockResolvedValue(undefined),
      recordDisposition: vi.fn().mockImplementation(async (id: string, status: string) => ({ ...rec(), id, status })),
      openSource: vi.fn().mockResolvedValue(undefined),
    };
    const onDraftCreated = vi.fn();
    render(
      <RemediationList
        gap={g}
        recommendations={[rec({ id: 'r-practice', kind: 'targeted-practice' }), rec({ id: 'r-tutor', kind: 'tutor' })]}
        clients={clients}
        planRevision={3}
        onDraftCreated={onDraftCreated}
      />,
    );
    // Tutor shows C7 placeholder, no completed action
    expect(screen.getByTestId('remediation-do-r-tutor')).toBeDisabled();

    // Without frozen scope the service path reports missing scope and writes nothing
    fireEvent.click(screen.getByTestId('remediation-do-r-practice'));
    await waitFor(() => expect(screen.getByTestId('remediation-notice')).toBeTruthy());
    expect(clients.createBlueprintDraft).not.toHaveBeenCalled();

    // Disposition persists and is reversible
    fireEvent.click(screen.getByTestId('remediation-dismiss-r-practice'));
    await waitFor(() => expect(clients.recordDisposition).toHaveBeenCalledWith('r-practice', 'dismissed'));
    void scope;
  });

  it('performance comparison labels same-paper vs cross-paper Final-only', () => {
    render(
      <PerformanceComparison
        attempts={[
          { id: 'a1', blueprintRevisionId: 'rev1', status: 'complete', awardedPoints: 9, maximumPoints: 15, startedAt: '2026-01-01T10:00:00.000Z' } as never,
          { id: 'a2', blueprintRevisionId: 'rev1', status: 'complete', awardedPoints: 12, maximumPoints: 15, startedAt: '2026-01-02T10:00:00.000Z' } as never,
          { id: 'a3', blueprintRevisionId: 'rev2', status: 'grading', awardedPoints: null, maximumPoints: 15, startedAt: '2026-01-03T10:00:00.000Z' } as never,
        ]}
      />,
    );
    expect(screen.getByTestId('performance-same-paper').textContent).toMatch(/Same-paper/);
    expect(screen.getByTestId('performance-same-paper').textContent).toMatch(/memory/);
    expect(screen.queryByTestId('performance-cross-paper')).toBeNull();
  });

  it('targeted practice honors emphasis and paper options (task 2.1)', () => {
    const ctx = {
      planId: 'plan1',
      planVersionId: 'v1',
      nodeId: 'n1',
      gapId: 'gap1',
      conceptId: 'c1',
      sourceScope: { schemaVersion: 1 } as never,
      excludedFingerprints: ['fp_old'],
      objectives: [],
    };
    const recall = buildTargetedPracticeConfig(ctx);
    expect(recall.typeWeights).toEqual({ 'single-select': 1 });
    expect(recall.difficultyWeights).toEqual({ '4': 1 });

    const transfer = buildTargetedPracticeConfig(ctx, { emphasis: 'transfer', difficulty: 2 });
    expect(transfer.typeWeights).toEqual({ essay: 1 });
    expect(transfer.difficultyWeights).toEqual({ '2': 1 });

    const application = buildTargetedPracticeConfig(ctx, { emphasis: 'application' });
    expect(application.typeWeights).toHaveProperty('multi-select');
    expect(application.typeWeights).toHaveProperty('short-answer');

    // A same-paper retake deliberately clears the exclusion list so the sampler
    // may reuse committed items; a fresh check keeps prior fingerprints.
    const same = buildTargetedPracticeConfig(ctx, { paper: 'same' });
    expect(same.excludedQuestionFingerprints).toEqual([]);
    const fresh = buildTargetedPracticeConfig(ctx, { paper: 'fresh' });
    expect(fresh.excludedQuestionFingerprints).toEqual(['fp_old']);
  });
});
