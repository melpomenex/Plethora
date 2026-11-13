import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { PlanHomeView } from '../PlanHomeView';
import type { StudyPlanDetail } from '../../../../types/learningPaths';

function detail(): StudyPlanDetail {
  return {
    plan: { id: 'sp_1', title: 'P', goal: 'G', depth: 'foundational', status: 'active', currentVersionId: null, currentVersion: 0, draftVersionId: 'spv_1', revision: 1, createdAt: '', updatedAt: '' },
    version: {
      id: 'spv_1', planId: 'sp_1', version: 1, state: 'draft', baseVersionId: null,
      sourceScope: undefined,
      knowledgeAuthority: { kind: 'library', policy: 'source-only' },
      nodes: [
        { nodeId: 'n0', title: 'Intro', summary: 's', learningObjectives: ['obj'], conceptId: null, conceptLabel: 'Intro', position: 0, included: true, locked: false, userAdded: false, userModified: false, materialSupport: 'grounded', whyHere: null, sourceRefIds: ['ssr_1'] },
        { nodeId: 'n1', title: 'Core', summary: 's', learningObjectives: ['obj'], conceptId: null, conceptLabel: 'Core', position: 1, included: true, locked: false, userAdded: false, userModified: false, materialSupport: 'grounded', whyHere: null, sourceRefIds: ['ssr_1'] },
      ],
      prerequisites: [{ prerequisiteNodeId: 'n0', dependentNodeId: 'n1', support: 'confirmed-concept-link', rationale: null, sourceRefIds: [] }],
      changeSummary: null, createdBy: 'user', createdAt: '', publishedAt: null,
    },
    activityByNodeId: { n0: 'not-started', n1: 'not-started' },
    sourceRefs: { ssr_1: { status: 'current', navigation: 'exact', ref: { schemaVersion: 1, id: 'ssr_1', documentId: 'd1', excerpt: 'x', revision: 'r', revisionKind: 'content-hash', excerptSha256: 'h', documentTitle: 'D', sourceType: 'pdf', capturedAt: '' } } },
  };
}

describe('PlanHomeView', () => {
  afterEach(() => {
    fireEvent.keyDown(document, { key: 'Escape' });
    cleanup();
  });

  it('renders Continue with a reason and the blocked dependent visible', () => {
    const onContinue = vi.fn();
    render(<PlanHomeView planDetail={detail()} dueReviewCount={3} onContinue={onContinue} onOpenReview={vi.fn()} onOpenPath={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Intro' })).toBeInTheDocument();
    expect(screen.getByText(/waiting on this topic: core/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onContinue).toHaveBeenCalledWith('n0');
  });

  it('shows the real due-review count and reports unavailable when null', () => {
    const { rerender } = render(<PlanHomeView planDetail={detail()} dueReviewCount={7} onContinue={vi.fn()} onOpenReview={vi.fn()} onOpenPath={vi.fn()} />);
    expect(screen.getByText('7 due')).toBeInTheDocument();

    rerender(<PlanHomeView planDetail={detail()} dueReviewCount={null} onContinue={vi.fn()} onOpenReview={vi.fn()} onOpenPath={vi.fn()} />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('keeps recommendation navigation explicit until a context action is chosen', () => {
    const onContinue = vi.fn();
    const onOpenPath = vi.fn();
    render(<PlanHomeView planDetail={detail()} dueReviewCount={2} onContinue={onContinue} onOpenReview={vi.fn()} onOpenPath={onOpenPath} />);

    const card = screen.getByRole('heading', { name: 'Intro' }).closest('section')!;
    fireEvent.contextMenu(card);
    expect(onContinue).not.toHaveBeenCalled();
    expect(onOpenPath).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Browse path' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith('n0');
    expect(onOpenPath).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(card);
  });

  it('keeps Review available when the due count is unavailable and ignores blank surfaces', () => {
    const onOpenReview = vi.fn();
    render(<PlanHomeView planDetail={detail()} dueReviewCount={null} onContinue={vi.fn()} onOpenReview={onOpenReview} onOpenPath={vi.fn()} />);

    fireEvent.contextMenu(screen.getByLabelText('Plan Home'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    const reviewCard = screen.getByText('Unavailable').closest('section')!;
    fireEvent.contextMenu(reviewCard);
    expect(onOpenReview).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Review' }));
    expect(onOpenReview).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('does not replace a card button interaction with an object menu', () => {
    render(<PlanHomeView planDetail={detail()} onContinue={vi.fn()} onOpenReview={vi.fn()} onOpenPath={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /continue/i }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps one shared menu open while switching between Plan Home cards', () => {
    const props = { planDetail: detail(), dueReviewCount: 3, onContinue: vi.fn(), onOpenReview: vi.fn(), onOpenPath: vi.fn() };
    render(<><PlanHomeView {...props} /><PlanHomeView {...props} /></>);
    fireEvent.contextMenu(screen.getAllByRole('heading', { name: 'Intro' })[0].closest('section')!);
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Continue' })).toBeInTheDocument();

    fireEvent.contextMenu(screen.getAllByText('Due reviews')[1].closest('section')!);
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Review' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Continue' })).not.toBeInTheDocument();
  });
});
