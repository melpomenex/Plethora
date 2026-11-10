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
      sourceScope: { schemaVersion: 1 } as any,
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
    expect(screen.getByText('Grounded Material References')).toBeInTheDocument();

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
});
