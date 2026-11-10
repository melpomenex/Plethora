import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SingleSelectInput } from '../SingleSelectInput';
import { MultiSelectInput } from '../MultiSelectInput';
import { ClozeInput } from '../ClozeInput';
import { FreeResponseInput } from '../FreeResponseInput';
import type {
  SingleSelectQuestion,
  MultiSelectQuestion,
  ClozeQuestion,
  ShortAnswerQuestion,
  EssayQuestion,
} from '../../../../types/assessmentQuestions';

describe('Question Input Components', () => {
  it('SingleSelectInput renders radio options and handles selection & confidence', () => {
    const q: SingleSelectQuestion = {
      schemaVersion: 1,
      kind: 'single-select',
      prompt: 'What organelle produces ATP?',
      learningObjectives: [],
      explanation: 'Mitochondria produces ATP.',
      sourceRefIds: [],
      applicationLevel: 'recall',
      hints: [],
      options: [
        { id: 'opt_a', text: 'Mitochondria' },
        { id: 'opt_b', text: 'Ribosome' },
      ],
      correctOptionId: 'opt_a',
      maxPoints: 2,
      difficulty: 2,
    };

    const onChangeOption = vi.fn();
    const onChangeConfidence = vi.fn();

    const { rerender } = render(
      <SingleSelectInput
        question={q}
        selectedOptionId={null}
        onChangeOption={onChangeOption}
        onChangeConfidence={onChangeConfidence}
      />
    );

    expect(screen.getByText('What organelle produces ATP?')).toBeInTheDocument();
    const radioA = screen.getByLabelText(/Mitochondria/i);
    fireEvent.click(radioA);
    expect(onChangeOption).toHaveBeenCalledWith('opt_a');

    // When an option is selected, confidence stops appear
    rerender(
      <SingleSelectInput
        question={q}
        selectedOptionId="opt_a"
        confidence={0.9}
        onChangeOption={onChangeOption}
        onChangeConfidence={onChangeConfidence}
      />
    );

    const confidenceBtn = screen.getByRole('radio', { name: /90% confidence/i });
    expect(confidenceBtn).toBeInTheDocument();
    expect(confidenceBtn).toHaveAttribute('aria-checked', 'true');

    const certainBtn = screen.getByRole('radio', { name: /100% confidence/i });
    fireEvent.click(certainBtn);
    expect(onChangeConfidence).toHaveBeenCalledWith(1);
  });

  it('MultiSelectInput renders checkboxes and all-or-nothing notice', () => {
    const q: MultiSelectQuestion = {
      schemaVersion: 1,
      kind: 'multi-select',
      prompt: 'Which are eukaryotic?',
      learningObjectives: [],
      explanation: 'Plants and Animals are eukaryotes.',
      sourceRefIds: [],
      applicationLevel: 'recall',
      hints: [],
      options: [
        { id: 'opt_1', text: 'Plant Cell' },
        { id: 'opt_2', text: 'Animal Cell' },
        { id: 'opt_3', text: 'Bacterium' },
      ],
      correctOptionIds: ['opt_1', 'opt_2'],
      maxPoints: 3,
      difficulty: 2,
    };

    const onToggleOption = vi.fn();
    const onChangeConfidence = vi.fn();

    render(
      <MultiSelectInput
        question={q}
        selectedOptionIds={['opt_1']}
        confidence={0.7}
        onToggleOption={onToggleOption}
        onChangeConfidence={onChangeConfidence}
      />
    );

    expect(screen.getByText(/all-or-nothing/i)).toBeInTheDocument();
    const check2 = screen.getByLabelText(/Animal Cell/i);
    fireEvent.click(check2);
    expect(onToggleOption).toHaveBeenCalledWith('opt_2');
  });

  it('ClozeInput renders segmented blanks and handles text input', () => {
    const q: ClozeQuestion = {
      schemaVersion: 1,
      kind: 'cloze',
      prompt: 'Complete the statement.',
      learningObjectives: [],
      explanation: 'Mitochondria is powerhouse.',
      sourceRefIds: [],
      applicationLevel: 'recall',
      hints: [],
      segments: [
        { kind: 'text', text: 'The ' },
        { kind: 'blank', blankId: 'blank_1' },
        { kind: 'text', text: ' is the ' },
        { kind: 'blank', blankId: 'blank_2' },
        { kind: 'text', text: '.' },
      ],
      blanks: [
        { id: 'blank_1', acceptedAnswers: ['mitochondria'], caseSensitive: false },
        { id: 'blank_2', acceptedAnswers: ['powerhouse'], caseSensitive: false },
      ],
      maxPoints: 4,
      difficulty: 2,
    };

    const onChangeBlank = vi.fn();
    const onChangeConfidence = vi.fn();

    render(
      <ClozeInput
        question={q}
        answers={{ blank_1: 'mitochondria' }}
        confidence={0.5}
        onChangeBlank={onChangeBlank}
        onChangeConfidence={onChangeConfidence}
      />
    );

    const input2 = screen.getByLabelText('Blank 2');
    fireEvent.change(input2, { target: { value: 'powerhouse' } });
    expect(onChangeBlank).toHaveBeenCalledWith('blank_2', 'powerhouse');
  });

  it('FreeResponseInput renders textarea for short-answer and essay with char limits', () => {
    const qShort: ShortAnswerQuestion = {
      schemaVersion: 1,
      kind: 'short-answer',
      prompt: 'Describe glycolysis.',
      learningObjectives: [],
      explanation: 'Splitting glucose.',
      sourceRefIds: [],
      applicationLevel: 'comprehension',
      hints: [],
      referenceAnswer: 'Breakdown of glucose into pyruvate.',
      keyFacts: [],
      acceptedAnswers: ['glycolysis'],
      rubric: {
        schemaVersion: 1,
        criteria: [],
        expectedConcepts: [],
        gradingConstraints: [],
      },
      maxPoints: 5,
      difficulty: 3,
    };

    const qEssay: EssayQuestion = {
      schemaVersion: 1,
      kind: 'essay',
      prompt: 'Compare mitosis and meiosis.',
      learningObjectives: [],
      explanation: 'Cell division comparison.',
      sourceRefIds: [],
      applicationLevel: 'multi-step-reasoning',
      hints: [],
      expectedReasoning: 'Haploid vs diploid.',
      rubric: {
        schemaVersion: 1,
        criteria: [],
        expectedConcepts: [],
        gradingConstraints: [],
      },
      maxPoints: 10,
      difficulty: 4,
    };

    const onChangeText = vi.fn();
    const onChangeConfidence = vi.fn();

    const { rerender } = render(
      <FreeResponseInput
        question={qShort}
        text="Glucose is split into pyruvate"
        confidence={0.7}
        onChangeText={onChangeText}
        onChangeConfidence={onChangeConfidence}
      />
    );

    expect(screen.getByText('30 / 20,000 characters')).toBeInTheDocument();
    const textarea = screen.getByLabelText('Short answer');
    fireEvent.change(textarea, { target: { value: 'New text' } });
    expect(onChangeText).toHaveBeenCalledWith('New text');

    // Essay mode
    rerender(
      <FreeResponseInput
        question={qEssay}
        text="Mitosis yields two identical diploid cells."
        confidence={0.9}
        onChangeText={onChangeText}
        onChangeConfidence={onChangeConfidence}
      />
    );

    expect(screen.getByLabelText('Essay answer')).toBeInTheDocument();
    expect(screen.getByText('43 / 60,000 characters')).toBeInTheDocument();
  });
});
