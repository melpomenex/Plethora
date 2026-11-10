import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { StudyPlansTab } from '../StudyPlansTab';
import * as tauriLib from '../../../lib/tauri';
import { useLearningPathsStore } from '../../../stores/learningPathsStore';
import * as api from '../../../api/study-plans';

vi.mock('../../../lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tauri')>();
  return {
    ...actual,
    isTauri: vi.fn(),
    isNativeMobile: vi.fn().mockReturnValue(false),
    invokeCommand: vi.fn(),
  };
});

vi.mock('../../../api/study-plans', () => ({
  listStudyPlans: vi.fn(),
  getStudyPlan: vi.fn(),
  createStudyPlan: vi.fn(),
  saveStudyPlanDraft: vi.fn(),
  publishStudyPlanVersion: vi.fn(),
  discardStudyPlanDraft: vi.fn(),
  setStudyPlanNodeActivity: vi.fn(),
  archiveStudyPlan: vi.fn(),
  deleteStudyPlan: vi.fn(),
  importLegacyStudyPlans: vi.fn(),
}));

vi.mock('../../../api/documents', () => ({
  getDocuments: vi.fn().mockResolvedValue([]),
}));

describe('StudyPlansTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLearningPathsStore.getState().clearPaths();
  });

  it('renders unsupported_platform notice when not running in native desktop/mobile', () => {
    vi.mocked(tauriLib.isTauri).mockReturnValue(false);

    render(<StudyPlansTab />);
    expect(
      screen.getByText(/Desktop or Mobile App Required/i)
    ).toBeInTheDocument();
  });

  it('renders StudyPlanList when in native environment', async () => {
    vi.mocked(tauriLib.isTauri).mockReturnValue(true);
    vi.mocked(api.listStudyPlans).mockResolvedValueOnce([]);

    render(<StudyPlansTab />);
    expect(screen.getByText('Study Plans')).toBeInTheDocument();
  });

  it('switches between list, create form, and cancel navigation', async () => {
    vi.mocked(tauriLib.isTauri).mockReturnValue(true);
    vi.mocked(api.listStudyPlans).mockResolvedValue([]);

    render(<StudyPlansTab />);

    // Click Create Study Plan
    const createBtn = await screen.findByTestId('create-study-plan-btn');
    fireEvent.click(createBtn);

    // Verify Create form appears
    expect(screen.getByRole('form', { name: /create study plan form/i })).toBeInTheDocument();

    // Click Cancel
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    // Back on list
    expect(screen.getByText('Study Plans')).toBeInTheDocument();
  });
});
