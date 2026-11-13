import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { StudyPlanEditor } from '../StudyPlanEditor';
import { useLearningPathsStore } from '../../../stores/learningPathsStore';
import * as api from '../../../api/study-plans';
import type { StudyPlanDetail } from '../../../types/learningPaths';

vi.mock('../../../lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tauri')>();
  return {
    ...actual,
    isTauri: vi.fn().mockReturnValue(true),
    isNativeMobile: vi.fn().mockReturnValue(false),
    invokeCommand: vi.fn(),
  };
});

vi.mock('../../../api/study-plans', () => ({
  saveStudyPlanDraft: vi.fn(),
  publishStudyPlanVersion: vi.fn(),
  discardStudyPlanDraft: vi.fn(),
  setStudyPlanNodeActivity: vi.fn(),
}));

vi.mock('../../../api/study-lessons', () => ({
  createStudyPlanLesson: vi.fn().mockResolvedValue({
    id: 'spl_1', planId: 'sp_1', planVersionId: 'spv_1', nodeId: 'n1', objectiveIndex: 0,
    style: 'guided', knowledgeAuthorityJson: '{"kind":"manual"}', sourceRevisionSnapshot: '',
    promptText: 'Arithmetic Circuits', answerDraft: '', hintCount: 0, turnCount: 0,
    turnStateJson: '{}', revision: 1, lastTurnRequestId: null,
    createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z',
  }),
  getStudyPlanLesson: vi.fn().mockResolvedValue(null),
  saveStudyPlanLessonCheckpoint: vi.fn().mockResolvedValue({}),
}));

describe('StudyPlanEditor', () => {
  const mockDetail: StudyPlanDetail = {
    plan: {
      id: 'sp_1',
      title: 'Modern Cryptography',
      goal: 'Understand ZKP foundations',
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
      sourceScope: null,
      knowledgeAuthority: { kind: 'manual' },
      nodes: [
        {
          nodeId: 'n1',
          title: 'Arithmetic Circuits',
          summary: 'Circuits representation',
          learningObjectives: ['Compile constraints'],
          conceptId: null,
          conceptLabel: 'Circuits',
          position: 0,
          included: true,
          locked: false,
          userAdded: false,
          userModified: false,
          materialSupport: 'grounded',
          whyHere: null,
          sourceRefIds: [],
        },
      ],
      prerequisites: [],
      changeSummary: null,
      createdBy: 'user',
      createdAt: '2026-11-10T00:00:00Z',
      publishedAt: null,
    },
    activityByNodeId: {
      n1: 'not-started',
    },
    sourceRefs: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useLearningPathsStore.getState().clearPaths();
  });

  it('renders editor header, tabs, and topic details', () => {
    const onBack = vi.fn();
    render(<StudyPlanEditor planDetail={mockDetail} onBack={onBack} />);

    expect(screen.getByText('Modern Cryptography')).toBeInTheDocument();
    expect(screen.getByText('Draft v1')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /curriculum outline/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /source material/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /version diff/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /version history/i })).toBeInTheDocument();
  });

  it('switches tabs and displays source material', () => {
    const onBack = vi.fn();
    render(<StudyPlanEditor planDetail={mockDetail} onBack={onBack} />);

    fireEvent.click(screen.getByRole('tab', { name: /source material/i }));
    expect(screen.getByRole('heading', { name: 'Source Material' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /version diff/i }));
    expect(screen.getByText('Changes from Baseline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /version history/i }));
    expect(screen.getByText('Version Timeline')).toBeInTheDocument();
  });

  it('saves draft when user edits a topic and clicks Save Draft', async () => {
    const onBack = vi.fn();
    vi.mocked(api.saveStudyPlanDraft).mockResolvedValueOnce(mockDetail);

    render(<StudyPlanEditor planDetail={mockDetail} onBack={onBack} />);

    // Edit topic title
    const titleInput = screen.getByDisplayValue('Arithmetic Circuits');
    fireEvent.change(titleInput, { target: { value: 'Advanced Arithmetic Circuits' } });

    // Save Draft button should become enabled
    const saveBtn = screen.getByRole('button', { name: /save draft/i });
    expect(saveBtn).toBeEnabled();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.saveStudyPlanDraft).toHaveBeenCalled();
      expect(screen.getByText(/draft saved successfully/i)).toBeInTheDocument();
    });
  });

  it('publishes version via review dialog', async () => {
    const onBack = vi.fn();
    const publishedDetail = {
      ...mockDetail,
      plan: {
        ...mockDetail.plan,
        currentVersion: 1,
        draftVersionId: null,
      },
      version: {
        ...mockDetail.version,
        state: 'published' as const,
        publishedAt: '2026-11-10T12:00:00Z',
      },
    };

    vi.mocked(api.publishStudyPlanVersion).mockResolvedValueOnce(publishedDetail);

    render(<StudyPlanEditor planDetail={mockDetail} onBack={onBack} />);

    // Click Review & Publish
    fireEvent.click(screen.getByRole('button', { name: /review & publish/i }));

    // Modal appears
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Publish Version 1')).toBeInTheDocument();

    // Confirm
    fireEvent.click(screen.getByRole('button', { name: /confirm & publish/i }));

    await waitFor(() => {
      expect(api.publishStudyPlanVersion).toHaveBeenCalledWith('sp_1', 'spv_1', 1);
      expect(screen.getByText(/plan version published successfully/i)).toBeInTheDocument();
    });
  });

  it('offers Add sources and verify on source-free manual drafts and opens the picker panel', async () => {
    render(<StudyPlanEditor planDetail={mockDetail} onBack={vi.fn()} />);

    const verifyButton = screen.getByRole('button', { name: /add sources and verify/i });
    expect(verifyButton).toBeInTheDocument();

    fireEvent.click(verifyButton);
    expect(screen.getByRole('button', { name: /switch to library only/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close verification/i }));
    expect(screen.queryByRole('button', { name: /switch to library only/i })).not.toBeInTheDocument();
  });

  it('starts a durable lesson for the selected topic', async () => {
    const lessonsApi = await import('../../../api/study-lessons');
    render(<StudyPlanEditor planDetail={mockDetail} onBack={vi.fn()} />);

    // Select the topic node from the outline.
    fireEvent.click(screen.getByText('Arithmetic Circuits'));
    const startLesson = screen.getByRole('button', { name: /start lesson for the selected topic/i });
    expect(startLesson).toBeInTheDocument();

    fireEvent.click(startLesson);
    expect(await screen.findByText(/Arithmetic Circuits/i)).toBeInTheDocument();
    expect(lessonsApi.createStudyPlanLesson).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'sp_1',
      planVersionId: 'spv_1',
      nodeId: 'n1',
    }));
  });

  it('starts the clicked topic from its context menu without opening the lesson on right-click', async () => {
    const lessonsApi = await import('../../../api/study-lessons');
    render(<StudyPlanEditor planDetail={mockDetail} onBack={vi.fn()} />);

    const row = screen.getByText('Arithmetic Circuits').closest('[role="listitem"]')!;
    fireEvent.contextMenu(row);
    expect(screen.queryByText(/Arithmetic Circuits.*lesson/i)).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Start lesson' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Start lesson' }));
    expect(await screen.findByText(/Arithmetic Circuits/i)).toBeInTheDocument();
    expect(lessonsApi.createStudyPlanLesson).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'n1' }));
  });

  it('leaves topic fields and blank editor surfaces out of object context menus', () => {
    render(<StudyPlanEditor planDetail={mockDetail} onBack={vi.fn()} />);

    const titleInput = screen.getByDisplayValue('Arithmetic Circuits');
    fireEvent.contextMenu(titleInput);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByText('Topics (1)'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
