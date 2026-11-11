import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RubricCriterionResult } from '../RubricCriterionResult';
import type { RubricCriterion } from '../../../../types/assessmentQuestions';
import type { CriterionResult } from '../../../../types/assessmentSessions';

describe('RubricCriterionResult', () => {
  const mockCriterion: RubricCriterion = {
    id: 'crit_1',
    title: 'Mechanism Precision',
    assessmentInstruction: 'Evaluate precision of mechanism description',
    grounding: 'reasoning',
    sourceRefIds: ['src_doc_1'],
    keyFactIds: ['kf_1'],
    weight: 2,
    levels: {
      '0': 'No mechanism described.',
      '1': 'Vague mention of process.',
      '2': 'Partial mechanism with minor errors.',
      '3': 'Accurate mechanism missing minor details.',
      '4': 'Exemplary, comprehensive mechanism formulation.',
    },
  };

  it('renders assessed criterion with level 4, verbatim quote, rationale and source refs', () => {
    const result: CriterionResult = {
      criterionId: 'crit_1',
      status: 'assessed',
      level: 4,
      answerEvidence: 'water moves across semipermeable membrane down its potential gradient',
      rationale: 'Comprehensive and exact explanation of the potential gradient.',
      missingConcepts: [],
      misconception: null,
      sourceRefIds: ['src_doc_1'],
    };

    render(<RubricCriterionResult criterion={mockCriterion} result={result} />);

    expect(screen.getByText('Mechanism Precision')).toBeInTheDocument();
    expect(screen.getByText('Weight: 2×')).toBeInTheDocument();
    expect(screen.getByText('Level 4/4')).toBeInTheDocument();
    expect(screen.getByText('“Exemplary, comprehensive mechanism formulation.”')).toBeInTheDocument();
    expect(
      screen.getByText('“water moves across semipermeable membrane down its potential gradient”')
    ).toBeInTheDocument();
    expect(screen.getByText(/Comprehensive and exact explanation/)).toBeInTheDocument();
    expect(screen.getByText('src_doc_1')).toBeInTheDocument();
  });

  it('renders missing concepts and misconceptions tags', () => {
    const result: CriterionResult = {
      criterionId: 'crit_1',
      status: 'assessed',
      level: 1,
      answerEvidence: 'water moves',
      rationale: 'Incomplete.',
      missingConcepts: ['semipermeable membrane', 'solute concentration'],
      misconception: 'Confuses osmosis with active transport',
      sourceRefIds: [],
    };

    render(<RubricCriterionResult criterion={mockCriterion} result={result} />);

    expect(screen.getByText('Level 1/4')).toBeInTheDocument();
    expect(screen.getByText('semipermeable membrane, solute concentration')).toBeInTheDocument();
    expect(screen.getByText('Confuses osmosis with active transport')).toBeInTheDocument();
  });

  it('renders not-assessable criterion with alert reason', () => {
    const result: CriterionResult = {
      criterionId: 'crit_1',
      status: 'not-assessable',
      reason: 'The student answer is in Latin and could not be evaluated against English rubric.',
    };

    render(<RubricCriterionResult criterion={mockCriterion} result={result} />);

    expect(screen.getByText('Not Assessable')).toBeInTheDocument();
    expect(
      screen.getByText(/The student answer is in Latin and could not be evaluated/)
    ).toBeInTheDocument();
  });

  it('renders manual evaluation status badge', () => {
    const result: CriterionResult = {
      criterionId: 'crit_1',
      status: 'manual',
      level: 3,
      rationale: 'Manual teacher upgrade based on alternative valid terminology.',
    };

    render(<RubricCriterionResult criterion={mockCriterion} result={result} />);

    expect(screen.getByText('Manual Review')).toBeInTheDocument();
    expect(screen.getByText('Level 3/4')).toBeInTheDocument();
    expect(screen.getByText('“Accurate mechanism missing minor details.”')).toBeInTheDocument();
  });
});
