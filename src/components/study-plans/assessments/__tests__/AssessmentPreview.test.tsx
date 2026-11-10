import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { AssessmentPreview } from '../AssessmentPreview';
import type { BlueprintDetail } from '../../../../types/assessmentQuestions';

describe('AssessmentPreview Component (C3-T09)', () => {
  const mockDetailReady: BlueprintDetail = {
    blueprint: {
      id: 'ab_1',
      planId: 'sp_1',
      title: 'Operating Systems Midterm',
      currentRevisionId: 'abr_1',
      lifecycle: 'active',
      revision: 1,
      createdAt: '2026-11-10T20:00:00Z',
      updatedAt: '2026-11-10T20:00:00Z',
    },
    revision: {
      id: 'abr_1',
      blueprintId: 'ab_1',
      revision: 1,
      state: 'ready',
      planVersionId: 'spv_1',
      config: {
        schemaVersion: 1,
        mode: 'exam',
        requestedCount: 2,
        timeLimitSeconds: 1800,
        typeWeights: {
          'single-select': 1,
          'multi-select': 0,
          cloze: 0,
          'short-answer': 0,
          essay: 1,
        },
        difficultyWeights: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 },
        topicTargets: [],
        knowledgePolicy: 'source-only',
        excludedQuestionFingerprints: [],
        pointsByKind: {
          'single-select': 1,
          'multi-select': 1,
          cloze: 1,
          'short-answer': 2,
          essay: 8,
        },
      },
      scoring: {
        schemaVersion: 1,
        singleSelect: 'exact-option',
        multiSelect: 'exact-set-all-or-nothing',
        cloze: 'equal-per-blank',
        shortAnswer: 'accepted-exact-then-rubric',
        essay: 'analytic-rubric',
        unanswered: 'zero',
        skipped: 'zero',
        negativeMarking: false,
      },
      sourceScope: {
        schemaVersion: 1,
        selected: { documentIds: ['doc_1'], extractIds: [], collectionIds: [], tagIds: [] },
        resolvedDocuments: [],
        frozenAt: '2026-11-10T20:00:00Z',
        indexCompleteness: 'complete',
        limitations: [],
      },
      quota: {
        requested: 2,
        accepted: 2,
        slots: [],
        deficits: [],
        shortfallAccepted: false,
        duplicateQuestionFingerprints: [],
        validationIssues: [],
      },
      generationJobId: null,
      sourceSnapshotHash: 'hash_123',
      createdAt: '2026-11-10T20:00:00Z',
      publishedAt: '2026-11-10T20:05:00Z',
    },
    questions: [
      {
        id: 'aqr_1',
        questionId: 'aq_1',
        blueprintRevisionId: 'abr_1',
        revision: 1,
        slotKey: 'slot_1',
        fingerprint: 'fp_1',
        validation: 'valid',
        committedAt: '2026-11-10T20:05:00Z',
        provider: null,
        createdAt: '2026-11-10T20:01:00Z',
        question: {
          schemaVersion: 1,
          kind: 'single-select',
          prompt: 'What is the role of the CPU scheduler?',
          difficulty: 3,
          learningObjectives: ['Scheduling'],
          sourceRefIds: [],
          explanation: 'It selects from among processes in ready queue.',
          maxPoints: 1,
          applicationLevel: 'recall',
          hints: [],
          options: [
            { id: 'opt_1', text: 'Selects ready processes for execution' },
            { id: 'opt_2', text: 'Allocates memory pages' },
          ],
          correctOptionId: 'opt_1',
        },
      },
      {
        id: 'aqr_2',
        questionId: 'aq_2',
        blueprintRevisionId: 'abr_1',
        revision: 1,
        slotKey: 'slot_2',
        fingerprint: 'fp_2',
        validation: 'valid',
        committedAt: '2026-11-10T20:05:00Z',
        provider: null,
        createdAt: '2026-11-10T20:02:00Z',
        question: {
          schemaVersion: 1,
          kind: 'essay',
          prompt: 'Discuss starvation vs deadlock.',
          difficulty: 5,
          learningObjectives: ['Concurrency'],
          sourceRefIds: [],
          explanation: 'Starvation is indefinite delay; deadlock is circular wait.',
          maxPoints: 8,
          applicationLevel: 'multi-step-reasoning',
          hints: [],
          expectedReasoning: 'Deadlock involves circular hold and wait; starvation is priority bias.',
          rubric: {
            schemaVersion: 1,
            expectedConcepts: ['Deadlock', 'Starvation'],
            gradingConstraints: [],
            criteria: [
              {
                id: 'c1',
                title: 'Deadlock Definition',
                assessmentInstruction: 'Explains Coffman conditions.',
                weight: 50,
                grounding: 'reasoning',
                sourceRefIds: [],
                keyFactIds: [],
                levels: { '0': 'None', '1': 'Poor', '2': 'Fair', '3': 'Good', '4': 'Complete' },
              },
              {
                id: 'c2',
                title: 'Starvation Contrast',
                assessmentInstruction: 'Contrasts starvation and indefinite delay.',
                weight: 50,
                grounding: 'reasoning',
                sourceRefIds: [],
                keyFactIds: [],
                levels: { '0': 'None', '1': 'Poor', '2': 'Fair', '3': 'Good', '4': 'Complete' },
              },
            ],
          },
        },
      },
    ],
  };

  it('renders preview with questions list and metadata', () => {
    const handlePublish = vi.fn();
    render(<AssessmentPreview blueprintDetail={mockDetailReady} onPublish={handlePublish} />);

    expect(screen.getByText('Operating Systems Midterm')).toBeInTheDocument();
    expect(screen.getByText('What is the role of the CPU scheduler?')).toBeInTheDocument();
    expect(screen.getByText('Discuss starvation vs deadlock.')).toBeInTheDocument();
    expect(screen.getByText(/30 Minutes/i)).toBeInTheDocument();
  });

  it('toggles expansion to reveal private answers and rubrics', () => {
    const handlePublish = vi.fn();
    render(<AssessmentPreview blueprintDetail={mockDetailReady} onPublish={handlePublish} />);

    // Initially, options or private answers might be hidden/collapsed
    const toggleButton = screen.getAllByRole('button', { name: /view answer key/i })[0];
    expect(toggleButton).toBeInTheDocument();
    fireEvent.click(toggleButton);

    expect(screen.getByText('Selects ready processes for execution')).toBeInTheDocument();
    expect(screen.getByText('It selects from among processes in ready queue.')).toBeInTheDocument();
  });

  it('enables Start Examination button when blueprint state is ready', () => {
    const handlePublish = vi.fn();
    const handleStart = vi.fn();
    render(
      <AssessmentPreview
        blueprintDetail={mockDetailReady}
        onPublish={handlePublish}
        onStartAssessment={handleStart}
      />
    );

    const startButton = screen.getByRole('button', { name: /start examination/i });
    expect(startButton).toBeInTheDocument();
    expect(startButton).not.toBeDisabled();

    fireEvent.click(startButton);
    expect(handleStart).toHaveBeenCalledWith('abr_1');
  });

  it('handles draft state with quota shortfall gate', async () => {
    const handlePublish = vi.fn().mockResolvedValue(undefined);
    const mockDetailDraftShortfall: BlueprintDetail = {
      ...mockDetailReady,
      revision: {
        ...mockDetailReady.revision,
        state: 'draft',
        config: {
          ...mockDetailReady.revision.config,
          requestedCount: 3, // 3 requested, but only 2 questions present
        },
      },
    };

    render(
      <AssessmentPreview
        blueprintDetail={mockDetailDraftShortfall}
        onPublish={handlePublish}
      />
    );

    // Shortfall notice should appear
    expect(screen.getByText(/Shortfall Notice/i)).toBeInTheDocument();

    const publishButton = screen.getByRole('button', { name: /publish examination paper/i });
    // Before checking acknowledgment, button is disabled
    expect(publishButton).toBeDisabled();

    // Check the shortfall acknowledgment checkbox
    const shortfallCheckbox = screen.getByRole('checkbox');
    expect(shortfallCheckbox).not.toBeChecked();
    fireEvent.click(shortfallCheckbox);

    // Now button should be enabled
    expect(publishButton).not.toBeDisabled();

    fireEvent.click(publishButton);
    await waitFor(() => {
      expect(handlePublish).toHaveBeenCalledWith(true);
    });
  });

  it('calls onEditQuestion when edit button is clicked on draft revision', () => {
    const handlePublish = vi.fn();
    const handleEdit = vi.fn();
    const mockDetailDraft: BlueprintDetail = {
      ...mockDetailReady,
      revision: {
        ...mockDetailReady.revision,
        state: 'draft',
      },
    };

    render(
      <AssessmentPreview
        blueprintDetail={mockDetailDraft}
        onPublish={handlePublish}
        onEditQuestion={handleEdit}
      />
    );

    const editButtons = screen.getAllByRole('button', { name: /edit question/i });
    expect(editButtons.length).toBe(2);
    fireEvent.click(editButtons[0]);

    expect(handleEdit).toHaveBeenCalledWith(mockDetailDraft.questions[0]);
  });
});
