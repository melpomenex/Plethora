import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudyQueueView } from '../StudyQueueView';
import * as studyTrailsApi from '../../../../api/study-trails';
import type { StudyPlanDetail } from '../../../../types/learningPaths';
import type { StudyTrailOverview } from '../../../../types/studyTrail';

vi.mock('../../../../api/study-trails', () => ({
  getStudyTrailOverview: vi.fn(),
  getRemediationTrailItems: vi.fn(),
  generateStudyTrailSegments: vi.fn(),
  overrideStudyTrailAssignment: vi.fn(),
  updateStudyTrailItemProgress: vi.fn(),
  submitFormativeCheck: vi.fn(),
}));

const planDetail: StudyPlanDetail = {
  plan: {
    id: 'plan-1',
    title: 'Philosophy 101',
    goal: 'Understand epistemology',
    depth: 'foundational',
    status: 'active',
    createdAt: '2026-11-17T00:00:00Z',
    updatedAt: '2026-11-17T00:00:00Z',
    revision: 1,
    currentVersion: 1,
    currentVersionId: 'ver-1',
    draftVersionId: null,
  },
  version: {
    id: 'ver-1',
    planId: 'plan-1',
    version: 1,
    state: 'published',
    baseVersionId: null,
    changeSummary: null,
    createdBy: 'user',
    knowledgeAuthority: { kind: 'library', policy: 'source-only' },
    sourceScope: null,
    nodes: [
      {
        nodeId: 'n-1',
        conceptId: null,
        conceptLabel: 'Appearance and Reality',
        title: 'Appearance and Reality',
        summary: '',
        position: 0,
        learningObjectives: ['Understand the distinction between appearance and reality'],
        locked: false,
        included: true,
        userAdded: false,
        userModified: false,
        materialSupport: 'grounded',
        whyHere: null,
        sourceRefIds: [],
      },
    ],
    prerequisites: [],
    createdAt: '2026-11-17T00:00:00Z',
    publishedAt: '2026-11-17T00:00:00Z',
  },
  sourceRefs: {},
  activityByNodeId: {},
};

const overview: StudyTrailOverview = {
  planId: 'plan-1',
  versionId: 'ver-1',
  segments: [
    {
      id: 'seg-1',
      documentId: 'doc-1',
      documentRevision: 'rev-1',
      format: 'epub',
      title: 'Chapter 1',
      parentSectionLabel: 'Chapter 1: Appearance and Reality',
      startLocator: { kind: 'epub', cfi: '' },
      endLocator: { kind: 'epub', cfi: '' },
      excerptPreview: 'The table appears brown under normal light.',
      wordCount: 1600,
      estimatedDurationSeconds: 480,
      structuralClass: 'argument',
      instructionalRole: 'core_explanation',
      qualityScore: 0.92,
      qualityRationale: 'Explains appearance vs reality with table example',
      validationStatus: 'verified',
      readinessStatus: 'ready',
      generatorVersion: 'guided-study-trail-v1',
      schemaVersion: 1,
      provenance: {},
      createdAt: '2026-11-17T00:00:00Z',
      updatedAt: '2026-11-17T00:00:00Z',
    },
  ],
  objectiveLinks: [
    {
      id: 'lso-1',
      planId: 'plan-1',
      versionId: 'ver-1',
      nodeId: 'n-1',
      objectiveIndex: 0,
      segmentId: 'seg-1',
      coverageStatus: 'adequately_covered',
      alignmentScore: 0.92,
      selectionRationale: 'Directly explains appearance vs reality',
      isPrimary: true,
      isRequired: true,
      authoredOverride: false,
      createdAt: '2026-11-17T00:00:00Z',
      updatedAt: '2026-11-17T00:00:00Z',
    },
  ],
  trailItems: [
    {
      id: 'sti-1',
      planId: 'plan-1',
      versionId: 'ver-1',
      nodeId: 'n-1',
      objectiveIndex: 0,
      segmentId: 'seg-1',
      trailOrder: 1,
      sessionGroupId: 'session_1',
      status: 'pending',
      readingProgress: 0,
      isRequired: true,
      isRemediation: false,
      plannerRationale: 'Foundational chapter',
      updatedAt: '2026-11-17T00:00:00Z',
    },
  ],
  formativeChecks: [],
  eligibility: {
    policy: 'guided',
    eligible: false,
    requiredTotal: 1,
    requiredCompleted: 0,
    checksPassed: 0,
    blockingReasons: ['0 of 1 required reading assignments completed'],
    testOutAvailable: false,
  },
  documentTitles: { 'doc-1': 'The Problems of Philosophy' },
  diagnostics: [],
};

describe('StudyQueueView', () => {
  it('renders Continue Learning card with source, duration, and Start Guided Reading action', async () => {
    vi.mocked(studyTrailsApi.getStudyTrailOverview).mockResolvedValue(overview);
    vi.mocked(studyTrailsApi.getRemediationTrailItems).mockResolvedValue([]);

    const onStartGuidedReading = vi.fn();
    render(
      <StudyQueueView
        planDetail={planDetail}
        onStartGuidedReading={onStartGuidedReading}
        onInspectNode={vi.fn()}
        onOpenGraph={vi.fn()}
        onOpenAssessments={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('study-queue-continue-card')).toBeInTheDocument();
    });
    expect(screen.getByText('Appearance and Reality')).toBeInTheDocument();
    expect(screen.getByText(/The Problems of Philosophy/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated time: 8 min/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Guided Reading/i })).toBeInTheDocument();
  });
});
