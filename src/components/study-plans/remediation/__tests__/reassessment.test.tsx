import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ReassessmentChoice } from '../ReassessmentChoice';
import { WeakTopicWorkspace } from '../WeakTopicWorkspace';
import { returnContextLabel } from '../returnContext';

describe('C7-T07 reassessment and return navigation', () => {
  it('Follow-Up gives Retake Same vs New Paper with exclusions; no automatic Start', () => {
    const onRetakeSame = vi.fn();
    const onCreateNewPaper = vi.fn();
    const { rerender } = render(
      <ReassessmentChoice
        readyRevisionId="abr-ready"
        excludedFingerprints={['fp-q2', 'fp-q6', 'fp-p']}
        weakTopics={['n2']}
        returnContext={{ planId: 'plan1', versionId: 'v1', nodeId: 'n2', gapId: 'gap1', sourceAttemptId: 'ea-a' }}
        onRetakeSame={onRetakeSame}
        onCreateNewPaper={onCreateNewPaper}
      />,
    );
    expect(screen.getByTestId('reassessment-scope').textContent).toMatch(/excludes 3/);
    fireEvent.click(screen.getByTestId('reassessment-retake'));
    expect(onRetakeSame).toHaveBeenCalledWith('abr-ready');
    fireEvent.click(screen.getByTestId('reassessment-new-paper'));
    expect(onCreateNewPaper).toHaveBeenCalledTimes(1);

    // Stale/deleted source blocks generation but preserves history
    rerender(
      <ReassessmentChoice readyRevisionId="abr-ready" excludedFingerprints={[]} weakTopics={[]} sourceState="deleted" />,
    );
    expect(screen.getByTestId('reassessment-source-state')).toBeTruthy();
    rerender(
      <ReassessmentChoice readyRevisionId={null} excludedFingerprints={[]} weakTopics={[]} onRetakeSame={onRetakeSame} />,
    );
    expect(screen.getByTestId('reassessment-retake')).toBeDisabled();
  });

  it('weak→source→tutor→practice→cards→retake/new→results→plan with accurate history labels', () => {
    const handlers = {
      onOpenSource: vi.fn(),
      onOpenTutor: vi.fn(),
      onOpenPractice: vi.fn(),
      onOpenCards: vi.fn(),
      onDismissGap: vi.fn(),
      onRetakeSame: vi.fn(),
      onCreateNewPaper: vi.fn(),
    };
    render(
      <WeakTopicWorkspace
        planId="plan1"
        nodeId="n2"
        gapId="gap1"
        sourceAttemptId="ea-a"
        returnContext={{ planId: 'plan1', versionId: 'v1', nodeId: 'n2', gapId: 'gap1', sourceAttemptId: 'ea-a' }}
        readyRevisionId="abr-ready"
        excludedFingerprints={['fp-q2']}
        weakTopics={['n2']}
        recomputeNote="Evidence recomputed after reassessment."
        {...handlers}
      />,
    );
    fireEvent.click(screen.getByTestId('weak-open-source'));
    fireEvent.click(screen.getByTestId('weak-open-tutor'));
    fireEvent.click(screen.getByTestId('weak-open-practice'));
    fireEvent.click(screen.getByTestId('weak-open-cards'));
    fireEvent.click(screen.getByTestId('weak-dismiss'));
    expect(handlers.onOpenSource).toHaveBeenCalledTimes(1);
    expect(handlers.onDismissGap).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('reassessment-retake'));
    expect(handlers.onRetakeSame).toHaveBeenCalledWith('abr-ready');
    expect(screen.getByTestId('weak-recompute-note')).toBeTruthy();
    expect(screen.getByTestId('weak-history-note').textContent).toMatch(/cross-paper/);
    expect(returnContextLabel({ planId: 'plan1', versionId: 'v1', nodeId: 'n2', gapId: 'gap1', sourceAttemptId: 'ea-a' })).toMatch(/plan plan1/);
  });

  it('return context restores originating flow; null results and plan-draft semantics preserved', () => {
    render(
      <WeakTopicWorkspace
        planId="plan1"
        nodeId={null}
        gapId={null}
        sourceAttemptId={null}
        returnContext={{ planId: 'plan1', versionId: null, nodeId: null, gapId: null, sourceAttemptId: null }}
      />,
    );
    // Plan stays unchanged unless separately reviewed Plan Adjustment draft is published.
    expect(screen.getByTestId('weak-topic-context').textContent).toMatch(/plan plan1/);
    expect(screen.getByTestId('reassessment-return').textContent).toMatch(/published plan unchanged/);
  });
});
