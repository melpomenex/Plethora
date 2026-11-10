import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { StudyPlanList } from '../StudyPlanList';
import { useLearningPathsStore } from '../../../stores/learningPathsStore';
import * as api from '../../../api/study-plans';
import type { StudyPlanSummary } from '../../../types/learningPaths';

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
  listStudyPlans: vi.fn(),
  archiveStudyPlan: vi.fn(),
  deleteStudyPlan: vi.fn(),
  importLegacyStudyPlans: vi.fn(),
}));

describe('StudyPlanList', () => {
  const mockPlans: StudyPlanSummary[] = [
    {
      id: 'sp_1',
      title: 'Modern Cryptography',
      goal: 'ZKP and Symmetric ciphers',
      depth: 'foundational',
      status: 'active',
      currentVersion: 1,
      nodeCount: 5,
      completedNodeCount: 2,
      sourceDocumentCount: 2,
      hasDraft: false,
      updatedAt: '2026-11-10T00:00:00Z',
    },
    {
      id: 'sp_2',
      title: 'Distributed Databases',
      goal: 'Consensus protocols and replication',
      depth: 'deep',
      status: 'archived',
      currentVersion: 2,
      nodeCount: 8,
      completedNodeCount: 8,
      sourceDocumentCount: 4,
      hasDraft: false,
      updatedAt: '2026-11-09T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useLearningPathsStore.getState().clearPaths();
    window.localStorage.clear();
  });

  it('renders plan cards and filters by active vs archived', async () => {
    vi.mocked(api.listStudyPlans).mockResolvedValue(mockPlans);
    const onOpen = vi.fn();
    const onCreate = vi.fn();

    render(<StudyPlanList onCreateClick={onCreate} onOpenPlan={onOpen} />);

    // Initially active plans tab is selected
    await waitFor(() => {
      expect(screen.getByText('Modern Cryptography')).toBeInTheDocument();
    });
    expect(screen.queryByText('Distributed Databases')).not.toBeInTheDocument();

    // Switch to Archived tab
    fireEvent.click(screen.getByRole('button', { name: /archived/i }));

    await waitFor(() => {
      expect(screen.getByText('Distributed Databases')).toBeInTheDocument();
    });
    expect(screen.queryByText('Modern Cryptography')).not.toBeInTheDocument();
  });

  it('filters plans by search query', async () => {
    vi.mocked(api.listStudyPlans).mockResolvedValue(mockPlans);

    render(<StudyPlanList onCreateClick={vi.fn()} onOpenPlan={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Modern Cryptography')).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText(/search study plans/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistent topic' } });

    expect(screen.getByText(/no study plans match/i)).toBeInTheDocument();

    // Clear search
    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));
    expect(screen.getByText('Modern Cryptography')).toBeInTheDocument();
  });
});
