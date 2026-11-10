import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudyPlansDashboardCard } from '../StudyPlansDashboardCard';
import * as studyPlansApi from '../../../api/study-plans';
import * as destinationActions from '../../../commandPalette/destinationActions';
import type { StudyPlanSummary } from '../../../types/learningPaths';

vi.mock('../../../lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tauri')>();
  return {
    ...actual,
    isTauri: vi.fn(() => true),
  };
});

vi.mock('../../../api/study-plans', () => ({
  listStudyPlans: vi.fn(),
}));

vi.mock('../../../commandPalette/destinationActions', () => ({
  requestDestinationAction: vi.fn(() => Promise.resolve()),
}));

import { isTauri } from '../../../lib/tauri';

describe('StudyPlansDashboardCard', () => {
  const mockSummaries: StudyPlanSummary[] = [
    {
      id: 'plan-1',
      title: 'Neural Networks 101',
      goal: 'Understand backpropagation',
      depth: 'foundational',
      status: 'active',
      currentVersion: 1,
      nodeCount: 5,
      completedNodeCount: 2,
      sourceDocumentCount: 2,
      hasDraft: false,
      updatedAt: '2026-03-30T11:00:00Z',
    },
    {
      id: 'plan-2',
      title: 'Linear Algebra',
      goal: 'Matrix decompositions',
      depth: 'deep',
      status: 'active',
      currentVersion: 1,
      nodeCount: 8,
      completedNodeCount: 0,
      sourceDocumentCount: 4,
      hasDraft: true,
      updatedAt: '2026-03-30T11:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(studyPlansApi.listStudyPlans).mockResolvedValue(mockSummaries);
  });

  it('renders nothing on non-Tauri browser environments', () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const { container } = render(<StudyPlansDashboardCard />);
    expect(container.firstChild).toBeNull();
  });

  it('renders up to 3 plans and dispatches open-plan when clicked', async () => {
    const user = userEvent.setup();
    render(<StudyPlansDashboardCard />);

    await waitFor(() => {
      expect(screen.getByText('Neural Networks 101')).toBeInTheDocument();
      expect(screen.getByText('Linear Algebra')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Neural Networks 101'));
    expect(destinationActions.requestDestinationAction).toHaveBeenCalledWith({
      destination: 'study-plans',
      action: 'open-plan',
      planId: 'plan-1',
    });
  });

  it('dispatches create when New plan or Create first plan is clicked', async () => {
    const user = userEvent.setup();
    render(<StudyPlansDashboardCard />);

    await waitFor(() => {
      expect(screen.getByLabelText('Create study plan')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Create study plan'));
    expect(destinationActions.requestDestinationAction).toHaveBeenCalledWith({
      destination: 'study-plans',
      action: 'create',
    });
  });

  it('dispatches home when View all study plans is clicked', async () => {
    const user = userEvent.setup();
    render(<StudyPlansDashboardCard />);

    await waitFor(() => {
      expect(screen.getByText('View all study plans')).toBeInTheDocument();
    });

    await user.click(screen.getByText('View all study plans'));
    expect(destinationActions.requestDestinationAction).toHaveBeenCalledWith({
      destination: 'study-plans',
      action: 'home',
    });
  });

  it('shows empty state when no active plans exist', async () => {
    vi.mocked(studyPlansApi.listStudyPlans).mockResolvedValue([]);
    render(<StudyPlansDashboardCard />);

    await waitFor(() => {
      expect(screen.getByText(/No active study plans/i)).toBeInTheDocument();
    });
  });
});
