import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManualCriterionInput } from '../ManualCriterionInput';
import type { RubricCriterion } from '../../../../types/assessmentQuestions';

describe('ManualCriterionInput', () => {
  const sampleCriterion: RubricCriterion = {
    id: 'crit-accuracy',
    title: 'Factual Accuracy',
    assessmentInstruction: 'Assess factual accuracy.',
    weight: 2,
    grounding: 'reasoning',
    sourceRefIds: [],
    keyFactIds: [],
    levels: {
      '0': 'Entirely incorrect or missing facts.',
      '1': 'Significant inaccuracies with minor correct elements.',
      '2': 'Partially correct with noticeable gaps.',
      '3': 'Mostly accurate with minor omissions.',
      '4': 'Completely accurate and precise.',
    },
  };

  it('renders criterion title, weight factor, and all level options', () => {
    render(
      <ManualCriterionInput
        criterion={sampleCriterion}
        selectedLevel={null}
        onLevelChange={vi.fn()}
        onRationaleChange={vi.fn()}
      />
    );

    expect(screen.getByText('Factual Accuracy')).toBeInTheDocument();
    expect(screen.getByText('Weight factor: 2×')).toBeInTheDocument();

    // Verify all 5 levels 0..4 are rendered with their descriptors
    expect(screen.getByText('Completely accurate and precise.')).toBeInTheDocument();
    expect(screen.getByText('Mostly accurate with minor omissions.')).toBeInTheDocument();
    expect(screen.getByText('Partially correct with noticeable gaps.')).toBeInTheDocument();
    expect(screen.getByText('Significant inaccuracies with minor correct elements.')).toBeInTheDocument();
    expect(screen.getByText('Entirely incorrect or missing facts.')).toBeInTheDocument();
  });

  it('triggers onLevelChange when a radio level is selected', () => {
    const handleLevelChange = vi.fn();
    render(
      <ManualCriterionInput
        criterion={sampleCriterion}
        selectedLevel={null}
        onLevelChange={handleLevelChange}
        onRationaleChange={vi.fn()}
      />
    );

    const level4Radio = screen.getByLabelText('Level 4: Completely accurate and precise.');
    fireEvent.click(level4Radio);

    expect(handleLevelChange).toHaveBeenCalledWith(4);
  });

  it('displays active badge and checked radio when level is selected', () => {
    render(
      <ManualCriterionInput
        criterion={sampleCriterion}
        selectedLevel={3}
        onLevelChange={vi.fn()}
        onRationaleChange={vi.fn()}
      />
    );

    expect(screen.getByText('Selected: Level 3/4')).toBeInTheDocument();

    const level3Radio = screen.getByLabelText('Level 3: Mostly accurate with minor omissions.');
    expect(level3Radio).toBeChecked();
  });

  it('updates rationale text when typing in the optional note field', () => {
    const handleRationaleChange = vi.fn();
    render(
      <ManualCriterionInput
        criterion={sampleCriterion}
        selectedLevel={2}
        rationale="Preliminary note"
        onLevelChange={vi.fn()}
        onRationaleChange={handleRationaleChange}
      />
    );

    const noteInput = screen.getByLabelText('Note for Factual Accuracy');
    expect(noteInput).toHaveValue('Preliminary note');

    fireEvent.change(noteInput, { target: { value: 'Updated educator observation' } });
    expect(handleRationaleChange).toHaveBeenCalledWith('Updated educator observation');
  });

  it('displays validation error message when error prop is provided', () => {
    render(
      <ManualCriterionInput
        criterion={sampleCriterion}
        selectedLevel={null}
        error="Please select a level for this criterion."
        onLevelChange={vi.fn()}
        onRationaleChange={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Please select a level for this criterion.');
  });
});
