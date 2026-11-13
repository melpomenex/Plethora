import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KnowledgeGapCard } from '../KnowledgeGapCard';
import type { KnowledgeGapView } from '../../../../types/learningEvidence';

function gap(): KnowledgeGapView {
  return {
    id: 'gap1',
    kind: 'repeatedly_failed',
    conceptId: 'c1',
    conceptName: 'TLB',
    planId: 'sp_1',
    nodeId: 'n1',
    ruleId: 'assessment-repeated-failure-v1',
    status: 'active',
    evidence: [],
    demonstrated: {
      conceptId: 'c1',
      level: 'needs-attention',
      observedMean: 0.4,
      evidenceWeight: 1,
      independentSessions: 2,
      distinctDays: 1,
      minimumObserved: 0.4,
      maximumObserved: 0.4,
      latestEvidenceAt: '2026-01-02T00:00:00.000Z',
      uncertainty: [],
      evidenceIds: [],
      policyVersion: 'evidence-v1',
    },
    firstDetectedAt: '2026-01-01T00:00:00.000Z',
    lastDetectedAt: '2026-01-02T00:00:00.000Z',
    evidenceCutoff: '2026-01-02T00:00:00.000Z',
  };
}

describe('KnowledgeGapCard practice options (2.1)', () => {
  it('passes selected emphasis and paper to practice draft creation', () => {
    const onPrepareAssessment = vi.fn();
    render(<KnowledgeGapCard gap={gap()} onPrepareAssessment={onPrepareAssessment} />);

    fireEvent.change(screen.getByLabelText('Practice emphasis'), { target: { value: 'transfer' } });
    fireEvent.change(screen.getByLabelText('Paper selection'), { target: { value: 'same' } });
    fireEvent.click(screen.getByRole('button', { name: /create practice draft/i }));

    expect(onPrepareAssessment).toHaveBeenCalledWith(gap(), 'practice', { emphasis: 'transfer', paper: 'same' });
  });

  it('defaults to fresh recall paper', () => {
    const onPrepareAssessment = vi.fn();
    render(<KnowledgeGapCard gap={gap()} onPrepareAssessment={onPrepareAssessment} />);

    fireEvent.click(screen.getByRole('button', { name: /create practice draft/i }));
    expect(onPrepareAssessment).toHaveBeenCalledWith(gap(), 'practice', { emphasis: 'recall', paper: 'fresh' });
  });

  it('offers Make Cards with plan-linked proposal context (2.3)', () => {
    const onProposeCards = vi.fn();
    render(<KnowledgeGapCard gap={gap()} onProposeCards={onProposeCards} />);

    fireEvent.click(screen.getByRole('button', { name: /make cards/i }));
    expect(onProposeCards).toHaveBeenCalledWith(gap());
  });
});
