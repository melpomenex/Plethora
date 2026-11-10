import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { StudyPlanCreateForm } from '../StudyPlanCreateForm';
import { useLearningPathsStore } from '../../../stores/learningPathsStore';
import * as api from '../../../api/study-plans';

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
  createStudyPlan: vi.fn(),
}));

vi.mock('../../../api/documents', () => ({
  getDocuments: vi.fn().mockResolvedValue([
    { id: 'doc1', title: 'Intro to Cryptography' },
  ]),
}));

describe('StudyPlanCreateForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLearningPathsStore.getState().clearPaths();
  });

  it('validates required title and session goal before permitting submit', () => {
    const handleSuccess = vi.fn();
    const handleCancel = vi.fn();

    render(<StudyPlanCreateForm onSuccess={handleSuccess} onCancel={handleCancel} />);

    const submitBtn = screen.getByRole('button', { name: /create draft plan/i });
    expect(submitBtn).toBeDisabled();

    // Fill title
    fireEvent.change(screen.getByLabelText(/plan title/i), {
      target: { value: 'ZK-SNARKs Architecture' },
    });
    expect(submitBtn).toBeDisabled();

    // Fill goal
    fireEvent.change(screen.getByLabelText(/learning objective/i), {
      target: { value: 'Understand arithmetic circuits and polynomial commitments' },
    });
    expect(submitBtn).toBeEnabled();
  });

  it('submits valid plan input and calls onSuccess', async () => {
    const handleSuccess = vi.fn();
    const handleCancel = vi.fn();

    const mockDetail = {
      plan: {
        id: 'sp_new_1',
        title: 'ZK-SNARKs Architecture',
        goal: 'Understand arithmetic circuits',
        depth: 'deep',
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
        planId: 'sp_new_1',
        version: 1,
        state: 'draft',
        baseVersionId: null,
        sourceScope: { schemaVersion: 1 } as any,
        nodes: [],
        prerequisites: [],
        changeSummary: null,
        createdBy: 'user',
        createdAt: '2026-11-10T00:00:00Z',
        publishedAt: null,
      },
      activityByNodeId: {},
      sourceRefs: {},
    };

    vi.mocked(api.createStudyPlan).mockResolvedValueOnce(mockDetail as any);

    render(<StudyPlanCreateForm onSuccess={handleSuccess} onCancel={handleCancel} />);

    fireEvent.change(screen.getByLabelText(/plan title/i), {
      target: { value: 'ZK-SNARKs Architecture' },
    });
    fireEvent.change(screen.getByLabelText(/learning objective/i), {
      target: { value: 'Understand arithmetic circuits' },
    });

    const submitBtn = screen.getByRole('button', { name: /create draft plan/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith(mockDetail);
    });
  });

  it('shows error banner when API creation fails', async () => {
    const handleSuccess = vi.fn();
    const handleCancel = vi.fn();

    vi.mocked(api.createStudyPlan).mockRejectedValueOnce({
      code: 'storage_failed',
      messageKey: 'Database locked during creation',
      retryable: true,
    });

    render(<StudyPlanCreateForm onSuccess={handleSuccess} onCancel={handleCancel} />);

    fireEvent.change(screen.getByLabelText(/plan title/i), {
      target: { value: 'ZK-SNARKs Architecture' },
    });
    fireEvent.change(screen.getByLabelText(/learning objective/i), {
      target: { value: 'Understand arithmetic circuits' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create draft plan/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Database locked during creation/i);
    });
    expect(handleSuccess).not.toHaveBeenCalled();
  });
});
