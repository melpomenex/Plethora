import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QuestionEditor } from '../QuestionEditor';
import type {
  SingleSelectQuestion,
  ClozeQuestion,
  EssayQuestion,
} from '../../../../types/assessmentQuestions';

describe('QuestionEditor Component (C3-T09)', () => {
  const mockSingleSelect: SingleSelectQuestion = {
    schemaVersion: 1,
    kind: 'single-select',
    prompt: 'What is a process control block?',
    difficulty: 3,
    learningObjectives: ['Process management'],
    sourceRefIds: ['s_1'],
    explanation: 'A PCB stores process execution state.',
    maxPoints: 2,
    applicationLevel: 'recall',
    hints: ['Think about OS data structures'],
    options: [
      { id: 'opt_1', text: 'A data structure storing process state' },
      { id: 'opt_2', text: 'A hardware register on the CPU' },
    ],
    correctOptionId: 'opt_1',
  };

  const mockCloze: ClozeQuestion = {
    schemaVersion: 1,
    kind: 'cloze',
    prompt: 'Virtual memory uses {{b1}} to translate addresses.',
    difficulty: 4,
    learningObjectives: ['Memory virtualization'],
    sourceRefIds: ['s_1'],
    explanation: 'Page tables map virtual to physical pages.',
    maxPoints: 1,
    applicationLevel: 'comprehension',
    hints: [],
    segments: [
      { kind: 'text', text: 'Virtual memory uses ' },
      { kind: 'blank', blankId: 'b1' },
      { kind: 'text', text: ' to translate addresses.' },
    ],
    blanks: [
      {
        id: 'b1',
        acceptedAnswers: ['page tables', 'a page table'],
        caseSensitive: false,
      },
    ],
  };

  const mockEssay: EssayQuestion = {
    schemaVersion: 1,
    kind: 'essay',
    prompt: 'Explain how two-phase locking guarantees serializability.',
    difficulty: 5,
    learningObjectives: ['Concurrency control'],
    sourceRefIds: [],
    explanation: 'Growing phase acquires locks, shrinking phase releases.',
    maxPoints: 8,
    applicationLevel: 'multi-step-reasoning',
    hints: [],
    expectedReasoning: 'Growing phase acquires locks, shrinking phase releases them without acquiring new ones.',
    rubric: {
      schemaVersion: 1,
      expectedConcepts: ['Growing phase', 'Shrinking phase', 'Serializability'],
      gradingConstraints: ['Must explain deadlock possibility'],
      criteria: [
        {
          id: 'c1',
          title: 'Two-phase lock discipline',
          assessmentInstruction: 'Explains expansion and contraction phases accurately.',
          weight: 50,
          grounding: 'reasoning',
          sourceRefIds: [],
          keyFactIds: [],
          levels: {
            '0': 'No explanation of phases.',
            '1': 'Confuses growing and shrinking.',
            '2': 'Mentions phases but omits lock rules.',
            '3': 'Accurate description with minor gaps.',
            '4': 'Complete, rigorous explanation.',
          },
        },
        {
          id: 'c2',
          title: 'Proof of serializability',
          assessmentInstruction: 'Connects 2PL to acyclic serialization graph.',
          weight: 50,
          grounding: 'reasoning',
          sourceRefIds: [],
          keyFactIds: [],
          levels: {
            '0': 'No mention of conflict serializability.',
            '1': 'Vague reference to conflicts.',
            '2': 'Partial argument missing graph cycle concept.',
            '3': 'Good connection to serial equivalence.',
            '4': 'Rigorous topological proof sketch.',
          },
        },
      ],
    },
  };

  it('renders single-select question editor with initial values', () => {
    const handleSave = vi.fn();
    const handleClose = vi.fn();
    render(
      <QuestionEditor
        initialQuestion={mockSingleSelect}
        onSave={handleSave}
        onClose={handleClose}
      />
    );

    expect(screen.getByDisplayValue('What is a process control block?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A data structure storing process state')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A hardware register on the CPU')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A PCB stores process execution state.')).toBeInTheDocument();
  });

  it('allows editing prompt and saving valid single-select question', async () => {
    const handleSave = vi.fn();
    const handleClose = vi.fn();
    render(
      <QuestionEditor
        initialQuestion={mockSingleSelect}
        onSave={handleSave}
        onClose={handleClose}
      />
    );

    const promptInput = screen.getByDisplayValue('What is a process control block?');
    fireEvent.change(promptInput, { target: { value: 'Updated prompt: What is a PCB?' } });

    const saveButton = screen.getByRole('button', { name: /save question/i });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledTimes(1);
      expect(handleSave.mock.calls[0][0].prompt).toBe('Updated prompt: What is a PCB?');
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  it('shows validation issues when prompt is cleared', () => {
    const handleSave = vi.fn();
    const handleClose = vi.fn();
    render(
      <QuestionEditor
        initialQuestion={mockSingleSelect}
        onSave={handleSave}
        onClose={handleClose}
      />
    );

    const promptInput = screen.getByDisplayValue('What is a process control block?');
    fireEvent.change(promptInput, { target: { value: '' } });

    const saveButton = screen.getByRole('button', { name: /save question/i });
    expect(saveButton).toBeDisabled();
  });

  it('renders and edits cloze question blanks', () => {
    const handleSave = vi.fn();
    const handleClose = vi.fn();
    render(
      <QuestionEditor
        initialQuestion={mockCloze}
        onSave={handleSave}
        onClose={handleClose}
      />
    );

    expect(screen.getByLabelText('Question prompt')).toHaveValue(
      'Virtual memory uses {{b1}} to translate addresses.'
    );
    expect(screen.getByDisplayValue('page tables, a page table')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /save question/i });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    expect(handleSave).toHaveBeenCalledTimes(1);
    expect(handleSave.mock.calls[0][0].kind).toBe('cloze');
  });

  it('renders and edits essay question with rubric criteria', () => {
    const handleSave = vi.fn();
    const handleClose = vi.fn();
    render(
      <QuestionEditor
        initialQuestion={mockEssay}
        onSave={handleSave}
        onClose={handleClose}
      />
    );

    expect(screen.getByDisplayValue(/two-phase locking guarantees/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Two-phase lock discipline')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Proof of serializability')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /save question/i });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    expect(handleSave).toHaveBeenCalledTimes(1);
    expect(handleSave.mock.calls[0][0].kind).toBe('essay');
  });

  it('disables save when essay rubric criteria count is less than 2', () => {
    const invalidEssay: EssayQuestion = {
      ...mockEssay,
      rubric: {
        ...mockEssay.rubric,
        criteria: [mockEssay.rubric.criteria[0]], // only 1 criterion
      },
    };

    const handleSave = vi.fn();
    const handleClose = vi.fn();
    render(
      <QuestionEditor
        initialQuestion={invalidEssay}
        onSave={handleSave}
        onClose={handleClose}
      />
    );

    const saveButton = screen.getByRole('button', { name: /save question/i });
    expect(saveButton).toBeDisabled();
  });

  it('allows changing difficulty and cognitive level', () => {
    const handleSave = vi.fn();
    const handleClose = vi.fn();
    render(
      <QuestionEditor
        initialQuestion={mockSingleSelect}
        onSave={handleSave}
        onClose={handleClose}
      />
    );

    const diffSelect = screen.getByLabelText(/question difficulty/i);
    fireEvent.change(diffSelect, { target: { value: '5' } });

    const cogSelect = screen.getByLabelText(/cognitive level/i);
    fireEvent.change(cogSelect, { target: { value: 'multi-step-reasoning' } });

    const saveButton = screen.getByRole('button', { name: /save question/i });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    expect(handleSave).toHaveBeenCalledTimes(1);
    expect(handleSave.mock.calls[0][0].difficulty).toBe(5);
    expect(handleSave.mock.calls[0][0].applicationLevel).toBe('multi-step-reasoning');
  });
});
