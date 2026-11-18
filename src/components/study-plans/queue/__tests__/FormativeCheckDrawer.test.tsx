import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormativeCheckDrawer } from '../FormativeCheckDrawer';
import * as studyTrailsApi from '../../../../api/study-trails';
import type { StudyQueueEntry } from '../../../../lib/study-plans/trail/queueProjection';

vi.mock('../../../../api/study-trails', () => ({
  generateFormativeMultipleChoice: vi.fn(),
  submitFormativeCheck: vi.fn(),
}));

const entry: StudyQueueEntry = {
  item: {
    id: 'sti-1',
    planId: 'plan-1',
    versionId: 'ver-1',
    nodeId: 'n-1',
    objectiveIndex: 0,
    segmentId: 'seg-1',
    trailOrder: 1,
    sessionGroupId: 'session_1',
    status: 'pending',
    readingProgress: 1,
    isRequired: true,
    isRemediation: false,
    plannerRationale: 'Core section',
    updatedAt: '2026-11-18T00:00:00Z',
  },
  node: {
    nodeId: 'n-1',
    conceptId: null,
    conceptLabel: 'Fasting and Autophagy',
    title: 'Fasting and Autophagy',
    summary: '',
    position: 0,
    learningObjectives: ['Define autophagy and explain how fasting supports cellular repair'],
    locked: false,
    included: true,
    userAdded: false,
    userModified: false,
    materialSupport: 'grounded',
    whyHere: null,
    sourceRefIds: [],
  },
  objectiveText: 'Define autophagy and explain how fasting supports cellular repair',
  segment: {
    id: 'seg-1',
    documentId: 'doc-1',
    documentRevision: 'rev-1',
    format: 'epub',
    title: 'Chapter 8',
    parentSectionLabel: 'Chapter 8',
    startLocator: {},
    endLocator: {},
    excerptPreview: 'Autophagy allows cells to break down damaged components during fasting.',
    wordCount: 500,
    estimatedDurationSeconds: 180,
    structuralClass: 'argument',
    instructionalRole: 'core_explanation',
    qualityScore: 0.9,
    qualityRationale: 'Core explanation',
    validationStatus: 'verified',
    readinessStatus: 'ready',
    generatorVersion: 'guided-study-trail-v2',
    schemaVersion: 1,
    provenance: {},
    createdAt: '2026-11-18T00:00:00Z',
    updatedAt: '2026-11-18T00:00:00Z',
  },
  documentTitle: 'The All-Day Energy Diet',
  estimatedMinutes: 3,
  alternatives: [],
  coverageStatus: 'adequately_covered',
  unmetPrerequisites: [],
  isBlocked: false,
  isCompleted: false,
};

describe('FormativeCheckDrawer', () => {
  it('defaults to multiple choice and submits selected option', async () => {
    vi.mocked(studyTrailsApi.generateFormativeMultipleChoice).mockResolvedValue({
      question: 'What does autophagy accomplish during fasting?',
      options: [
        'Cells scavenge and repair damaged components.',
        'The stomach stops producing acid permanently.',
        'Carbohydrate intake increases fat storage.',
        'Muscle tissue is converted directly into glycogen.',
      ],
      correctIndex: 0,
      explanation: 'Autophagy clears dead matter and repairs damaged cells.',
      sourceMode: 'ai',
    });

    vi.mocked(studyTrailsApi.submitFormativeCheck).mockResolvedValue({
      id: 'fcr-1',
      planId: 'plan-1',
      versionId: 'ver-1',
      trailItemId: 'sti-1',
      nodeId: 'n-1',
      objectiveIndex: 0,
      promptFormat: 'explain_own_words',
      promptText: 'What does autophagy accomplish during fasting?',
      learnerResponse: 'Cells scavenge and repair damaged components.',
      outcome: 'understood',
      feedback: 'Autophagy clears dead matter and repairs damaged cells.',
      createdAt: '2026-11-18T00:00:00Z',
    });

    const onCompleted = vi.fn();
    render(
      <FormativeCheckDrawer
        entry={entry}
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('What does autophagy accomplish during fasting?')).toBeInTheDocument();
    });

    const optionA = screen.getByRole('radio', { name: /Cells scavenge and repair damaged components/i });
    fireEvent.click(optionA);
    fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));

    await waitFor(() => {
      expect(screen.getByText('Understanding confirmed')).toBeInTheDocument();
    });

    expect(studyTrailsApi.submitFormativeCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        isCorrectChoice: true,
        learnerResponse: 'Cells scavenge and repair damaged components.',
      }),
    );
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
});
