import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { AssessmentBuilder } from '../AssessmentBuilder';
import { BlueprintService } from '../../../../lib/study-plans/assessments/blueprintService';
import * as preflightModule from '../../../../lib/study-plans/generation/preflight';
import * as coordinatorModule from '../../../../lib/study-plans/assessments/generationCoordinator';
import type { BlueprintDetail } from '../../../../types/assessmentQuestions';
import type { StudyPlanDetail } from '../../../../types/learningPaths';
import type { StudyAiPreflight } from '../../../../lib/study-plans/generation/types';
import { planQuotaSlots } from '../../../../lib/study-plans/assessments/quotaPlanner';

vi.mock('../../../../lib/study-plans/assessments/blueprintService', () => ({
  BlueprintService: {
    createBlueprint: vi.fn(),
    getBlueprintRevision: vi.fn(),
    saveBlueprintDraft: vi.fn(),
    saveQuestionFromDomain: vi.fn(),
    publishBlueprint: vi.fn(),
  },
}));

vi.mock('../../../../lib/study-plans/generation/preflight', () => ({
  performStudyAiPreflight: vi.fn(),
}));

vi.mock('../../../../lib/study-plans/generation/curriculumPreflight', () => ({
  refreshCurriculumScope: vi.fn(async (scope) => scope),
}));

vi.mock('../../../../lib/study-plans/assessments/generationCoordinator', () => ({
  runAssessmentGenerationCoordinator: vi.fn(),
}));

describe('AssessmentBuilder Component (C3-T08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockPlanDetail: StudyPlanDetail = {
    plan: {
      id: 'sp_1',
      title: 'Operating Systems',
      goal: 'Understand OS internals',
      depth: 'foundational',
      status: 'active',
      currentVersionId: 'spv_1',
      draftVersionId: 'spv_1',
      currentVersion: 1,
      revision: 1,
      createdAt: '2026-11-10T20:00:00Z',
      updatedAt: '2026-11-10T20:00:00Z',
    },
    version: {
      id: 'spv_1',
      planId: 'sp_1',
      version: 1,
      state: 'published',
      baseVersionId: null,
      sourceScope: {
        schemaVersion: 1,
        selected: {
          documentIds: ['doc_1'],
          extractIds: [],
          collectionIds: [],
          tagIds: [],
        },
        resolvedDocuments: [
          {
            documentId: 'doc_1',
            title: 'OSTEP',
            sourceType: 'pdf',
            revision: 'rev_1',
            revisionKind: 'content-hash',
            extractIds: [],
            isAiExcluded: false,
            isLocalOnly: false,
          },
        ],
        frozenAt: '2026-11-10T20:00:00Z',
        indexCompleteness: 'complete',
        limitations: [],
      },
      changeSummary: null,
      createdBy: 'user',
      createdAt: '2026-11-10T20:00:00Z',
      publishedAt: '2026-11-10T20:00:00Z',
      nodes: [
        {
          nodeId: 'n1',
          position: 0,
          title: 'Virtualization',
          summary: 'CPU and Memory virtualization',
          conceptId: 'c1',
          conceptLabel: 'Virtualization',
          learningObjectives: ['Understand processes'],
          included: true,
          locked: false,
          userAdded: false,
          userModified: false,
          materialSupport: 'grounded',
          whyHere: 'Foundation of OS',
          sourceRefIds: ['s1'],
        },
      ],
      prerequisites: [],
    },
    activityByNodeId: {},
    sourceRefs: {},
  };

  const mockCreatedDetail: BlueprintDetail = {
    blueprint: {
      id: 'ab_1',
      planId: 'sp_1',
      title: 'Operating Systems Examination',
      currentRevisionId: null,
      lifecycle: 'active',
      revision: 1,
      createdAt: '2026-11-10T20:00:00Z',
      updatedAt: '2026-11-10T20:00:00Z',
    },
    revision: {
      id: 'abr_1',
      blueprintId: 'ab_1',
      revision: 1,
      state: 'draft',
      planVersionId: 'spv_1',
      config: {
        schemaVersion: 1,
        mode: 'exam',
        requestedCount: 10,
        typeWeights: { 'single-select': 4 },
        difficultyWeights: { 2: 3 },
        topicTargets: [{ nodeId: 'n1', conceptId: 'Virtualization', weight: 1 }],
        timeLimitSeconds: 1800,
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
      sourceScope: mockPlanDetail.version.sourceScope,
      quota: {
        requested: 10,
        accepted: 0,
        slots: [],
        deficits: [],
        shortfallAccepted: false,
        duplicateQuestionFingerprints: [],
        validationIssues: [],
      },
      generationJobId: null,
      sourceSnapshotHash: 'sha256:test',
      createdAt: '2026-11-10T20:00:00Z',
      publishedAt: null,
    },
    questions: [],
  };

  const mockPreflight: StudyAiPreflight = {
    providerId: 'native',
    generationDestination: 'device-local',
    embeddingDestination: null,
    featureAllowed: true,
    documentIds: ['doc_1'],
    sourceExcerptCount: 1,
    sendsSourceOffDevice: false,
    sendsAnswersOffDevice: false,
    billable: false,
    cloudDisclosureAccepted: true,
    costConsentAccepted: true,
    maximumModelCalls: 6,
  };

  it('initializes draft blueprint on mount and renders sections', async () => {
    vi.mocked(preflightModule.performStudyAiPreflight).mockResolvedValueOnce({
      preflight: mockPreflight,
      route: { provider: { id: 'native' }, task: {} } as any,
    });
    vi.mocked(BlueprintService.createBlueprint).mockResolvedValueOnce(mockCreatedDetail);

    render(<AssessmentBuilder planDetail={mockPlanDetail} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Operating Systems Examination')).toBeInTheDocument();
    });

    expect(screen.getByText('Grounding Source Scope')).toBeInTheDocument();
    expect(screen.getByText('AI Execution & Call Budget')).toBeInTheDocument();
    expect(screen.getByText('Total Questions Quota: 10')).toBeInTheDocument();
  });

  it('saves draft parameters when Save Draft button is clicked', async () => {
    vi.mocked(preflightModule.performStudyAiPreflight).mockResolvedValueOnce(null as any);
    vi.mocked(BlueprintService.createBlueprint).mockResolvedValueOnce(mockCreatedDetail);
    vi.mocked(BlueprintService.saveBlueprintDraft).mockResolvedValueOnce(mockCreatedDetail);

    render(<AssessmentBuilder planDetail={mockPlanDetail} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Save Draft')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Save Draft'));

    await waitFor(() => {
      expect(BlueprintService.saveBlueprintDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          revisionId: 'abr_1',
          title: 'Operating Systems Examination',
        })
      );
    });
  });

  it('triggers coordinator on Generate Questions click', async () => {
    vi.mocked(preflightModule.performStudyAiPreflight).mockResolvedValueOnce({
      preflight: mockPreflight,
      route: { provider: { id: 'native' }, task: {} } as any,
    });
    vi.mocked(BlueprintService.createBlueprint).mockResolvedValueOnce(mockCreatedDetail);
    vi.mocked(BlueprintService.saveBlueprintDraft).mockResolvedValueOnce(mockCreatedDetail);
    vi.mocked(coordinatorModule.runAssessmentGenerationCoordinator).mockResolvedValueOnce({
      jobId: 'job_1',
      blueprintDetail: {
        ...mockCreatedDetail,
        revision: {
          ...mockCreatedDetail.revision,
          state: 'ready',
        },
      },
      quotaReport: mockCreatedDetail.revision.quota,
      acceptedCount: 10,
      deficitsCount: 0,
      callsMade: 3,
    });

    render(<AssessmentBuilder planDetail={mockPlanDetail} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Generate Questions')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Generate Questions'));

    await waitFor(() => {
      expect(coordinatorModule.runAssessmentGenerationCoordinator).toHaveBeenCalledWith(
        expect.objectContaining({
          blueprintRevisionId: 'abr_1',
        }),
        expect.anything(),
        expect.anything()
      );
    });
  });

  it('does not start generation when saving the current draft fails', async () => {
    vi.mocked(preflightModule.performStudyAiPreflight).mockResolvedValueOnce({
      preflight: mockPreflight,
      route: { provider: { id: 'native' }, task: {} } as any,
    });
    vi.mocked(BlueprintService.createBlueprint).mockResolvedValueOnce(mockCreatedDetail);
    vi.mocked(BlueprintService.saveBlueprintDraft).mockRejectedValueOnce(new Error('write failed'));

    render(<AssessmentBuilder planDetail={mockPlanDetail} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Generate Questions')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Generate Questions'));

    await waitFor(() => expect(screen.getByText('Draft could not be saved. Generation was not started.')).toBeInTheDocument());
    expect(coordinatorModule.runAssessmentGenerationCoordinator).not.toHaveBeenCalled();
  });

  it('opens the built-in manual authoring flow and saves to the next unfilled quota slot', async () => {
    vi.mocked(preflightModule.performStudyAiPreflight).mockResolvedValueOnce({
      preflight: mockPreflight,
      route: { provider: { id: 'native' }, task: {} } as any,
    });
    vi.mocked(BlueprintService.createBlueprint).mockResolvedValueOnce(mockCreatedDetail);
    vi.mocked(BlueprintService.saveQuestionFromDomain).mockResolvedValueOnce({} as any);
    vi.mocked(BlueprintService.getBlueprintRevision).mockResolvedValueOnce(mockCreatedDetail);

    render(<AssessmentBuilder planDetail={mockPlanDetail} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Add Manual Question')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Add Manual Question'));
    expect(screen.getByRole('dialog', { name: 'Question Editor' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save question/i }));

    await waitFor(() => expect(BlueprintService.saveQuestionFromDomain).toHaveBeenCalledTimes(1));
    expect(BlueprintService.saveQuestionFromDomain).toHaveBeenCalledWith(expect.objectContaining({
      blueprintRevisionId: mockCreatedDetail.revision.id,
      slotKey: planQuotaSlots(mockCreatedDetail.revision.config, mockCreatedDetail.revision.id)[0].slotKey,
      question: expect.objectContaining({ kind: 'single-select' }),
    }));
  });

  it('keeps manual authoring unavailable for a Ready paper', async () => {
    vi.mocked(preflightModule.performStudyAiPreflight).mockResolvedValueOnce({
      preflight: mockPreflight,
      route: { provider: { id: 'native' }, task: {} } as any,
    });
    vi.mocked(BlueprintService.getBlueprintRevision).mockResolvedValueOnce({
      ...mockCreatedDetail,
      revision: { ...mockCreatedDetail.revision, state: 'ready' },
    });

    render(<AssessmentBuilder blueprintRevisionId="abr_1" planDetail={mockPlanDetail} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Start Assessment')).toBeInTheDocument());
    expect(screen.queryByText('Add Manual Question')).not.toBeInTheDocument();
    expect(screen.queryByText(/Manual Question Editor/)).not.toBeInTheDocument();
  });
});
