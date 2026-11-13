/**
 * Curriculum Generation UI Components Unit & Integration Tests.
 *
 * Implements verification for:
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T09)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GenerationPrivacySummary } from '../GenerationPrivacySummary';
import { GenerationProgress } from '../GenerationProgress';
import { GenerationIssueList } from '../GenerationIssueList';
import { RulesOnlyNotice } from '../RulesOnlyNotice';
import { StudyJobRecoveryList } from '../StudyJobRecoveryList';
import { CurriculumDraftPreview } from '../CurriculumDraftPreview';
import { CurriculumGenerator } from '../CurriculumGenerator';
import type { StudyAiPreflight, StudyJobProgress, StudyGenerationJob } from '../../../lib/study-plans/generation/types';
import type { StudyPlanDetail } from '../../../types/learningPaths';
import { invokeCommand } from '../../../lib/tauri';
import { useLLMProvidersStore } from '../../../stores/llmProvidersStore';
import { useSettingsStore } from '../../../stores/settingsStore';

// Mock Tauri invoke to operate safely in node
vi.mock('../../../lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tauri')>();
  return {
    ...actual,
    isTauri: vi.fn().mockReturnValue(true),
    isNativeMobile: vi.fn().mockReturnValue(false),
    invokeCommand: vi.fn(),
  };
});

vi.mock('../../../api/study-generation', () => ({
  listStudyGenerationJobs: vi.fn().mockResolvedValue([]),
  recoverInterruptedStudyJobs: vi.fn().mockResolvedValue([]),
  cancelStudyGenerationJob: vi.fn().mockResolvedValue(undefined),
  resumeStudyGenerationJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../api/study-plans', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/study-plans')>();
  return {
    ...actual,
    publishStudyPlanVersion: vi.fn().mockResolvedValue({}),
    discardStudyPlanDraft: vi.fn().mockResolvedValue({}),
  };
});

describe('Curriculum Generation UI Components (C2-T09)', () => {
  const mockPlanDetail: StudyPlanDetail = {
    plan: {
      id: 'sp_1',
      title: 'Distributed Consensus',
      goal: 'Understand Raft and Paxos algorithms',
      depth: 'foundational',
      status: 'active',
      currentVersionId: null,
      currentVersion: 0,
      draftVersionId: 'spv_1',
      revision: 1,
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    },
    version: {
      id: 'spv_1',
      planId: 'sp_1',
      version: 1,
      state: 'draft',
      baseVersionId: null,
      sourceScope: {
        schemaVersion: 1,
        selected: { documentIds: ['doc_1'], extractIds: [], collectionIds: [], tagIds: [] },
        resolvedDocuments: [
          {
            documentId: 'doc_1',
            title: 'Paxos Made Simple',
            revision: 'rev_1',
            sourceType: 'pdf',
            revisionKind: 'content-hash',
            extractIds: [],
            isAiExcluded: false,
            isLocalOnly: false,
          },
        ],
        frozenAt: '2026-11-10T00:00:00Z',
        indexCompleteness: 'complete',
        limitations: [],
      },
      knowledgeAuthority: { kind: 'library', policy: 'source-only' },
      nodes: [
        {
          nodeId: 'n1',
          title: 'Replicated State Machines',
          summary: 'State machine replication concept',
          learningObjectives: ['Define consensus', 'Explain deterministic transitions'],
          conceptId: 'c_rsm',
          conceptLabel: 'RSM',
          position: 0,
          included: true,
          locked: false,
          userAdded: false,
          userModified: false,
          materialSupport: 'grounded',
          whyHere: null,
          sourceRefIds: ['ssr_1'],
        },
        {
          nodeId: 'n2',
          title: 'Leader Election',
          summary: 'Electing a coordinator',
          learningObjectives: ['Term progression', 'Split votes'],
          conceptId: null,
          conceptLabel: null,
          position: 1,
          included: true,
          locked: false,
          userAdded: false,
          userModified: false,
          materialSupport: 'grounded',
          whyHere: null,
          sourceRefIds: ['ssr_2'],
        },
      ],
      prerequisites: [
        {
          prerequisiteNodeId: 'n1',
          dependentNodeId: 'n2',
          support: 'inferred',
          rationale: 'Leader election coordinates state machine commands',
          sourceRefIds: [],
        },
      ],
      changeSummary: null,
      createdBy: 'user',
      createdAt: '2026-11-10T00:00:00Z',
      publishedAt: null,
    },
    activityByNodeId: {
      n1: 'not-started',
      n2: 'not-started',
    },
    sourceRefs: {
      ssr_1: {
        ref: {
          schemaVersion: 1,
          id: 'ssr_1',
          documentId: 'doc_1',
          documentTitle: 'Paxos Made Simple',
          excerpt: 'State machine replication...',
          revision: 'rev_1',
          revisionKind: 'content-hash',
          excerptSha256: 'sha256:abc',
          sourceType: 'pdf',
          capturedAt: '2026-11-10T00:00:00Z',
        },
        status: 'current',
        navigation: 'exact',
      },
      ssr_2: {
        ref: {
          schemaVersion: 1,
          id: 'ssr_2',
          documentId: 'doc_1',
          documentTitle: 'Paxos Made Simple',
          excerpt: 'Leader election details...',
          revision: 'rev_1',
          revisionKind: 'content-hash',
          excerptSha256: 'sha256:def',
          sourceType: 'pdf',
          capturedAt: '2026-11-10T00:00:00Z',
        },
        status: 'current',
        navigation: 'exact',
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. GenerationPrivacySummary
  // --------------------------------------------------------------------------
  describe('GenerationPrivacySummary', () => {
    it('renders on-device privacy badge when destination is native', () => {
      const nativePreflight: StudyAiPreflight = {
        providerId: 'apple-foundation-models',
        generationDestination: {
          locality: 'device',
          providerClass: 'apple-native',
          keyless: true,
          sendsOffDevice: false,
          billable: false,
          requiresDisclosure: false,
          requiresCostConsent: false,
        },
        embeddingDestination: null,
        featureAllowed: true,
        documentIds: ['doc_1'],
        sourceExcerptCount: 12,
        sendsSourceOffDevice: false,
        sendsAnswersOffDevice: false,
        billable: false,
        cloudDisclosureAccepted: false,
        costConsentAccepted: false,
        maximumModelCalls: 4,
      };

      render(
        <GenerationPrivacySummary
          preflight={nativePreflight}
          cloudDisclosureAccepted={false}
          costConsentAccepted={false}
        />
      );

      expect(screen.getByText(/On-device/i)).toBeInTheDocument();
      expect(screen.getByText(/apple-foundation-models/i)).toBeInTheDocument();
      expect(screen.getByText(/Up to 4 Model Calls/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/Cloud disclosure acceptance/i)).not.toBeInTheDocument();
    });

    it('renders cloud disclosure and cost consent checkboxes when off-device and billable', () => {
      const cloudPreflight: StudyAiPreflight = {
        providerId: 'openai-gpt4o',
        generationDestination: {
          locality: 'remote',
          providerClass: 'configured-external',
          keyless: false,
          sendsOffDevice: true,
          billable: true,
          requiresDisclosure: true,
          requiresCostConsent: true,
        },
        embeddingDestination: null,
        featureAllowed: true,
        documentIds: ['doc_1'],
        sourceExcerptCount: 12,
        sendsSourceOffDevice: true,
        sendsAnswersOffDevice: true,
        billable: true,
        cloudDisclosureAccepted: false,
        costConsentAccepted: false,
        maximumModelCalls: 4,
      };

      const onCloudChange = vi.fn();
      const onCostChange = vi.fn();

      render(
        <GenerationPrivacySummary
          preflight={cloudPreflight}
          cloudDisclosureAccepted={false}
          onCloudDisclosureChange={onCloudChange}
          costConsentAccepted={false}
          onCostConsentChange={onCostChange}
        />
      );

      expect(screen.getByText(/Model and location/i)).toBeInTheDocument();
      const cloudCb = screen.getByLabelText(/approve the off-device data transfers/i);
      const costCb = screen.getByLabelText(/authorize the disclosed execution budget/i);

      expect(cloudCb).toBeInTheDocument();
      expect(costCb).toBeInTheDocument();

      fireEvent.click(cloudCb);
      expect(onCloudChange).toHaveBeenCalledWith(true);

      fireEvent.click(costCb);
      expect(onCostChange).toHaveBeenCalledWith(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. GenerationProgress
  // --------------------------------------------------------------------------
  describe('GenerationProgress', () => {
    it('renders progress bar and stages with accessible percentage', () => {
      const progress: StudyJobProgress = {
        completed: 1,
        total: 2,
        labelKey: 'study_generation.step.prerequisites',
      };

      render(<GenerationProgress progress={progress} status="running" topicCount={6} />);

      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toBeInTheDocument();
      expect(progressBar).toHaveAttribute('aria-valuenow', '50');
      expect(screen.getByText(/50%/)).toBeInTheDocument();
      expect(screen.getByText(/6 topics/i)).toBeInTheDocument();
      expect(screen.getByText(/Decomposing Topics/i)).toBeInTheDocument();
      expect(screen.getByText('Inferring Prerequisites')).toBeInTheDocument();
    });

    it('identifies the failed prerequisite stage after multiple decomposition batches', () => {
      render(<GenerationProgress status="failed" progress={{
        completed: 2,
        total: 3,
        labelKey: 'study_generation.progress.decomposing_complete',
      }} />);

      expect(screen.getByText('Topics saved to the draft.')).toBeInTheDocument();
      expect(screen.getByText('Inferring Prerequisites').parentElement).toHaveTextContent('Failed');
      expect(screen.getByText('Validating Graph & Ordering').parentElement).toHaveTextContent('Pending');
    });

    it('opens confirmation dialog on cancel and invokes onCancel when confirmed', () => {
      const onCancel = vi.fn();
      render(
        <GenerationProgress
          progress={{ completed: 0, total: 2, labelKey: 'study_generation.step.decompose' }}
          status="running"
          onCancel={onCancel}
        />
      );

      const cancelBtn = screen.getByLabelText(/Cancel generation/i);
      fireEvent.click(cancelBtn);

      // Confirm dialog appears
      expect(screen.getByText(/Stop Outstanding Model Work\?/i)).toBeInTheDocument();
      const confirmBtn = screen.getByRole('button', { name: 'Cancel Generation' });
      fireEvent.click(confirmBtn);

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // 3. GenerationIssueList
  // --------------------------------------------------------------------------
  describe('GenerationIssueList', () => {
    it('displays general error, pruned cyclic edges, and unsupported nodes', () => {
      render(
        <GenerationIssueList
          generalError="Network timeout to provider"
          droppedCycleEdgesCount={2}
          unsupportedNodeCount={1}
          fieldIssues={[{ path: 'topics[0].title', code: 'too_long', messageKey: 'Title exceeds max length' }]}
        />
      );

      expect(screen.getByText(/Network timeout to provider/i)).toBeInTheDocument();
      expect(screen.getByText(/Pruned Cyclic Dependencies/i)).toBeInTheDocument();
      expect(screen.getByText(/2 proposed cyclic prerequisite edge/i)).toBeInTheDocument();
      expect(screen.getByText(/Ungrounded Topics \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Title exceeds max length/i)).toBeInTheDocument();
    });

    it('returns null when no issues exist', () => {
      const { container } = render(<GenerationIssueList />);
      expect(container.firstChild).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 4. RulesOnlyNotice
  // --------------------------------------------------------------------------
  describe('RulesOnlyNotice', () => {
    it('renders metrics chips for confirmed concepts and edges without AI', () => {
      render(<RulesOnlyNotice conceptCount={4} edgeCount={3} sourceCount={2} />);

      expect(screen.getByText(/Deterministic Source Outline \(No AI Inference\)/i)).toBeInTheDocument();
      expect(screen.getByText(/4 Confirmed Concepts/i)).toBeInTheDocument();
      expect(screen.getByText(/3 Verified Prerequisite Links/i)).toBeInTheDocument();
      expect(screen.getByText(/2 Source Documents/i)).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // 5. StudyJobRecoveryList
  // --------------------------------------------------------------------------
  describe('StudyJobRecoveryList', () => {
    it('renders recoverable interrupted jobs with resume and discard controls', () => {
      const mockJobs: StudyGenerationJob[] = [
        {
          id: 'job_rec_1',
          kind: 'curriculum',
          targetId: 'sp_1',
          targetRevision: 1,
          requestHash: 'hash_1',
          creationKey: 'key_1',
          status: 'interrupted',
          nextStepIndex: 1,
          leaseOwner: null,
          leaseExpiresAt: null,
          cancellationEpoch: 0,
          attemptCount: 1,
          preflight: {} as any,
          progress: { completed: 1, total: 4, labelKey: 'testing' },
          lastError: null,
          createdAt: '2026-11-10T00:00:00Z',
          updatedAt: '2026-11-10T00:01:00Z',
        },
      ];

      const onResume = vi.fn();
      const onCancel = vi.fn();

      render(
        <StudyJobRecoveryList
          jobs={mockJobs}
          onResumeJob={onResume}
          onCancelJob={onCancel}
        />
      );

      expect(screen.getByText(/Interrupted Generation Jobs \(1\)/i)).toBeInTheDocument();
      const resumeBtn = screen.getByLabelText(/Resume interrupted job job_rec_1/i);
      const discardBtn = screen.getByLabelText(/Discard interrupted job job_rec_1/i);

      fireEvent.click(resumeBtn);
      expect(onResume).toHaveBeenCalledWith(mockJobs[0]);

      fireEvent.click(discardBtn);
      expect(onCancel).toHaveBeenCalledWith(mockJobs[0]);
    });
  });

  // --------------------------------------------------------------------------
  // 6. CurriculumDraftPreview
  // --------------------------------------------------------------------------
  describe('CurriculumDraftPreview', () => {
    it('renders proposed topics in topological sequence with 1-based numbering', () => {
      const onAccept = vi.fn();
      const onDiscard = vi.fn();

      render(
        <CurriculumDraftPreview
          planDetail={mockPlanDetail}
          onAccept={onAccept}
          onDiscard={onDiscard}
        />
      );

      expect(screen.getAllByText('Replicated State Machines').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Leader Election')).toBeInTheDocument();
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Define consensus/i)).toBeInTheDocument();

      const acceptBtn = screen.getByLabelText(/Accept and publish curriculum draft/i);
      fireEvent.click(acceptBtn);
      expect(onAccept).toHaveBeenCalledTimes(1);
    });

    it('opens confirm dialog on discard and calls onDiscard when confirmed', () => {
      const onDiscard = vi.fn();

      render(
        <CurriculumDraftPreview
          planDetail={mockPlanDetail}
          onAccept={vi.fn()}
          onDiscard={onDiscard}
        />
      );

      const discardBtn = screen.getByLabelText(/Discard generated draft/i);
      fireEvent.click(discardBtn);

      expect(screen.getByText(/Discard Generated Draft\?/i)).toBeInTheDocument();
      const confirmBtn = screen.getByRole('button', { name: 'Discard Draft' });
      fireEvent.click(confirmBtn);

      expect(onDiscard).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // 7. CurriculumGenerator
  // --------------------------------------------------------------------------
  describe('CurriculumGenerator', () => {
    it('allows toggling between AI generation and Rules-Only outline', () => {
      render(
        <CurriculumGenerator
          planDetail={mockPlanDetail}
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(screen.getByText(/Generate Curriculum/i)).toBeInTheDocument();
      const rulesOnlyBtn = screen.getByRole('button', { name: /Source Outline \(No AI\)/i });
      fireEvent.click(rulesOnlyBtn);

      expect(screen.getByRole('button', { name: /Build Deterministic Outline/i })).toBeInTheDocument();
    });

    it('inspects the exact configured OpenRouter model and requires fresh cloud and cost consent', async () => {
      const primaryConfigId = 'synthetic-openrouter-primary-config';
      const alternateConfigId = 'synthetic-openrouter-alternate-config';
      const primaryModelId = 'synthetic-lab/consensus-auditor-v1';
      const alternateModelId = 'synthetic-lab/consensus-auditor-v2';
      const primarySecret = 'synthetic-secret-primary-do-not-leak';
      const alternateSecret = 'synthetic-secret-alternate-do-not-leak';
      useLLMProvidersStore.setState({
        providers: [
          {
            id: primaryConfigId,
            provider: 'openrouter',
            name: 'Synthetic Primary Route',
            apiKey: primarySecret,
            baseUrl: 'https://router.synthetic.example/v1',
            model: primaryModelId,
            enabled: true,
            temperature: 0.1,
            maxTokens: 8192,
          },
          {
            id: alternateConfigId,
            provider: 'openrouter',
            name: 'Synthetic Alternate Route',
            apiKey: alternateSecret,
            baseUrl: 'https://alternate.synthetic.example/v1',
            model: alternateModelId,
            enabled: true,
            temperature: 0.2,
            maxTokens: 4096,
          },
        ],
      });
      useSettingsStore.setState((state) => ({
        settings: {
          ...state.settings,
          ai: { ...state.settings.ai, strictLocalOnly: false },
          embedding: {
            ...state.settings.embedding,
            provider: 'ollama',
            ollamaBaseUrl: 'http://127.0.0.1:11434',
            ollamaModel: 'synthetic-local-embedder',
          },
        },
      }));
      vi.mocked(invokeCommand).mockImplementation(async (command: string) => {
        if (command === 'get_document') {
          return {
            id: 'doc_1',
            title: 'Paxos Made Simple',
            fileType: 'pdf',
            contentHash: 'rev_1',
            dateModified: '2026-11-10T00:00:00Z',
            isAiExcluded: false,
            isLocalOnly: false,
          } as any;
        }
        if (command === 'ai_learning_index_status') {
          return {
            aggregate: {
              totalDocuments: 1,
              indexedDocuments: 1,
              queuedDocuments: 0,
              indexingDocuments: 0,
              staleDocuments: 0,
              failedDocuments: 0,
              totalChunks: 1,
              totalEmbeddings: 0,
              embeddingStorageBytes: 0,
              embeddingModels: [],
              paused: false,
              pendingDocuments: 0,
            },
            documents: [{
              documentId: 'doc_1',
              state: 'indexed',
              chunksIndexed: 0,
              totalChunks: 1,
              updatedAt: '2026-11-10T00:00:00Z',
            }],
          } as any;
        }
        throw new Error(`Unexpected IPC command: ${command}`);
      });

      const launch = vi.fn().mockResolvedValue({
        planDetail: mockPlanDetail,
        mergeResult: { nodes: [], prerequisites: [], diff: {}, droppedEdgesCount: 0 },
        retrieval: undefined,
      });
      render(
        <CurriculumGenerator
          planDetail={mockPlanDetail}
          isOpen
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          jobController={{ startCurriculumJob: launch } as any}
        />
      );

      const generationModel = screen.getByLabelText(/Generation model/i);
      fireEvent.change(generationModel, { target: { value: alternateConfigId } });

      // The exact configured model is visible during inspection before consent.
      await waitFor(() => expect(screen.queryByText(/Checking model/)).not.toBeInTheDocument());
      expect(await screen.findByText(alternateModelId)).toBeInTheDocument();
      expect(await screen.findByText(/1 with indexed chunks/)).toBeInTheDocument();
      const start = screen.getByRole('button', { name: /Start AI Generation/i });
      expect(start).toBeDisabled();
      expect(launch).not.toHaveBeenCalled();

      const cloudConsent = await screen.findByLabelText(/approve the off-device data transfers/i);
      fireEvent.click(cloudConsent);
      expect(start).toBeDisabled();
      expect(launch).not.toHaveBeenCalled();

      const costConsent = screen.getByLabelText(/authorize the disclosed execution budget/i);
      fireEvent.click(costConsent);
      expect(start).toBeEnabled();

      // Changing the selected configuration invalidates both previous consents.
      fireEvent.change(generationModel, { target: { value: primaryConfigId } });
      expect(await screen.findByText(primaryModelId)).toBeInTheDocument();
      expect(screen.getByLabelText(/approve the off-device data transfers/i)).not.toBeChecked();
      expect(screen.getByLabelText(/authorize the disclosed execution budget/i)).not.toBeChecked();
      expect(start).toBeDisabled();
      expect(launch).not.toHaveBeenCalled();

      fireEvent.click(screen.getByLabelText(/approve the off-device data transfers/i));
      expect(start).toBeDisabled();
      fireEvent.click(screen.getByLabelText(/authorize the disclosed execution budget/i));
      expect(start).toBeEnabled();
      fireEvent.click(start);

      await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
      const [request, route] = launch.mock.calls[0] as any[];
      expect(request.rulesOnly).toBe(false);
      expect(route.model).toMatchObject({
        configId: primaryConfigId,
        provider: 'OpenRouter',
        id: primaryModelId,
        endpointOrigin: 'https://router.synthetic.example',
      });
      expect(route.cloudDisclosureAccepted).toBe(true);
      expect(route.costConsentAccepted).toBe(true);
      expect(JSON.stringify(route)).not.toContain(primarySecret);
      expect(JSON.stringify(route)).not.toContain(alternateSecret);
      expect(JSON.stringify(route)).not.toContain('/v1');
      expect(invokeCommand).toHaveBeenCalledWith('get_document', { id: 'doc_1' });
      expect(invokeCommand).toHaveBeenCalledWith('ai_learning_index_status', expect.any(Object));
    });
  });
});
