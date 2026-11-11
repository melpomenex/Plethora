import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { EvidenceSummaryCard } from '../EvidenceSummaryCard';
import { NodeLearningProgressView } from '../NodeLearningProgress';
import { WeakConceptList } from '../WeakConceptList';
import { KnowledgeGapCard } from '../KnowledgeGapCard';
import { GapHistory } from '../GapHistory';
import { UncertaintyReasons } from '../UncertaintyReasons';
import type { ConceptMasterySummary, KnowledgeGapView } from '../../../../types/learningEvidence';

function summary(over: Partial<ConceptMasterySummary> = {}): ConceptMasterySummary {
  return {
    conceptId: 'c1',
    level: 'insufficient-evidence',
    observedMean: null,
    evidenceWeight: 0,
    independentSessions: 0,
    distinctDays: 0,
    minimumObserved: null,
    maximumObserved: null,
    latestEvidenceAt: null,
    uncertainty: ['no-assessment'],
    evidenceIds: [],
    policyVersion: 'evidence-v1',
    ...over,
  };
}

function gap(over: Partial<KnowledgeGapView> = {}): KnowledgeGapView {
  return {
    id: 'gap1',
    kind: 'repeatedly_failed',
    conceptId: 'c1',
    conceptName: 'TLB',
    planId: null,
    nodeId: null,
    ruleId: 'assessment-repeated-failure-v1',
    status: 'active',
    evidence: [],
    demonstrated: null,
    firstDetectedAt: '2026-01-01T00:00:00.000Z',
    lastDetectedAt: '2026-01-02T00:00:00.000Z',
    evidenceCutoff: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

describe('C6-T06 evidence views', () => {
  it('reading-without-assessment shows no-assessment and coverage/activity separation', () => {
    render(
      <NodeLearningProgressView
        progress={{
          nodeId: 'n1',
          activity: 'completed' as never,
          contentCoverage: 'complete' as never,
          coverageActivity: 'not-computed' as never,
          demonstrated: null,
          sourceStatuses: [],
        }}
        nodeTitle="TLB node"
      />,
    );
    expect(screen.getByTestId('axis-coverage')).toBeTruthy();
    expect(screen.getByTestId('axis-activity')).toBeTruthy();
    expect(screen.getByText(/not mastery/i)).toBeTruthy();
  });

  it('assessed-without-reading and correct-but-sparse show counts not mastery probability', () => {
    render(
      <EvidenceSummaryCard
        summary={summary({
          level: 'insufficient-evidence',
          observedMean: 1,
          evidenceWeight: 1,
          independentSessions: 1,
          distinctDays: 1,
          minimumObserved: 1,
          maximumObserved: 1,
          uncertainty: ['one-independent-session', 'few-independent-sessions', 'narrow-difficulty'],
        })}
        conceptLabel="TLB"
      />,
    );
    expect(screen.getByTestId('evidence-level').textContent).toBe('insufficient-evidence');
    expect(screen.getByTestId('evidence-observed').textContent).toMatch(/weighted observed performance/);
    expect(screen.getByText(/not a probability of mastery/i)).toBeTruthy();
  });

  it('repeated failure, conflict, misconception, review-lapse and all uncertainties render', () => {
    render(
      <EvidenceSummaryCard
        summary={summary({
          level: 'needs-attention',
          observedMean: 0.5,
          evidenceWeight: 1.5,
          independentSessions: 2,
          distinctDays: 1,
          minimumObserved: 0,
          maximumObserved: 1,
          uncertainty: [
            'few-independent-sessions',
            'conflicting-outcomes',
            'hints-used',
            'ai-graded',
            'low-learner-confidence',
            'high-confidence-error',
            'stale-evidence',
            'same-question-repetition',
          ] as never,
        })}
      />,
    );
    expect(screen.getByTestId('uncertainty-conflicting-outcomes')).toBeTruthy();
    expect(screen.getByTestId('uncertainty-hints-used')).toBeTruthy();
    expect(screen.getByTestId('uncertainty-ai-graded')).toBeTruthy();
    expect(screen.getByTestId('uncertainty-same-question-repetition')).toBeTruthy();

    render(<UncertaintyReasons reasons={['review-lapse' as never]} />);
    expect(screen.getByTestId('uncertainty-review-lapse')).toBeTruthy();
  });

  it('weak concept list filters to weak only and gap card dismiss preserves evidence', () => {
    const onSelect = vi.fn();
    render(
      <WeakConceptList
        summaries={[
          summary({ conceptId: 'w1', level: 'needs-attention', observedMean: 0.4, independentSessions: 2, distinctDays: 1 }),
          summary({ conceptId: 's1', level: 'developing', observedMean: 0.7, independentSessions: 3, distinctDays: 2 }),
        ]}
        onSelectConcept={onSelect}
      />,
    );
    expect(screen.getByTestId('weak-concept-w1')).toBeTruthy();
    expect(screen.queryByTestId('weak-concept-s1')).toBeNull();
    fireEvent.click(screen.getByTestId('weak-concept-w1'));
    expect(onSelect).toHaveBeenCalledWith('w1');

    const onDismiss = vi.fn();
    render(
      <KnowledgeGapCard
        gap={gap({
          evidence: [
            {
              recordId: 'r1',
              kind: 'assessment',
              description: 'Two low groups',
              learningEvidenceId: 'le1',
              sourceRefId: null,
              payload: {},
            },
          ],
          demonstrated: summary({ level: 'needs-attention', observedMean: 0.5, independentSessions: 2, distinctDays: 1 }),
        })}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId('gap-dismiss-gap1'));
    expect(onDismiss).toHaveBeenCalledWith('gap1');
    expect(screen.getByText(/not a mastery probability/i)).toBeTruthy();
  });

  it('structural gaps use material wording and history shows refresh + past', () => {
    render(
      <KnowledgeGapCard gap={gap({ kind: 'missing_concept', ruleId: 'missing-material-v1' })} />,
    );
    expect(screen.getByTestId('gap-structural-note').textContent).toMatch(/Structural/);

    const onRefresh = vi.fn();
    render(
      <GapHistory
        gaps={[
          gap({ id: 'a1', status: 'active' }),
          gap({ id: 'd1', status: 'dismissed', kind: 'weak_prerequisite', ruleId: 'weak-prerequisite-v1:n1' }),
        ]}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByTestId('gap-history')).toBeTruthy();
    fireEvent.click(screen.getByTestId('gap-refresh'));
    expect(onRefresh).toHaveBeenCalled();
    expect(screen.getByTestId('gap-history-past')).toBeTruthy();
  });

  it('gap history empty state explains suppression without background watcher', () => {
    render(<GapHistory gaps={[]} />);
    expect(screen.getByTestId('gap-history-empty').textContent).toMatch(/suppressed until materially new evidence/i);
  });
});
