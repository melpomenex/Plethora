import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SavedQueueDropdown } from '../SavedQueueDropdown';
import { useSavedQueueStore } from '../../../stores/savedQueueStore';
import type { SavedQueue } from '../../../types/savedQueue';

const sampleQueue: SavedQueue = {
  id: 'q-1',
  name: 'Focus Queue',
  filters: { categories: ['Tech'], tags: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: true },
  itemTypes: { documents: true, extracts: false, learningItems: true },
  sessionDurationMinutes: 30,
  maxItems: 25,
  isDefault: true,
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('SavedQueueDropdown', () => {
  const onOpenNewQueue = vi.fn();
  const onOpenManageQueues = vi.fn();
  const onQueueSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSavedQueueStore.setState({
      savedQueues: [sampleQueue],
      activeQueueId: 'q-1',
      isLoading: false,
      error: null,
    });
  });

  it('renders active queue name on trigger button', () => {
    render(
      <SavedQueueDropdown
        onOpenNewQueue={onOpenNewQueue}
        onOpenManageQueues={onOpenManageQueues}
        onQueueSelect={onQueueSelect}
      />
    );

    expect(screen.getByText('Focus Queue')).toBeInTheDocument();
  });

  it('opens menu on click and displays options', () => {
    render(
      <SavedQueueDropdown
        onOpenNewQueue={onOpenNewQueue}
        onOpenManageQueues={onOpenManageQueues}
        onQueueSelect={onQueueSelect}
      />
    );

    const trigger = screen.getByRole('button', { name: /Focus Queue/i });
    fireEvent.click(trigger);

    expect(screen.getByText('New Queue...')).toBeInTheDocument();
    expect(screen.getByText('Manage Queues...')).toBeInTheDocument();
  });

  it('invokes onOpenNewQueue when clicking New Queue', () => {
    render(
      <SavedQueueDropdown
        onOpenNewQueue={onOpenNewQueue}
        onOpenManageQueues={onOpenManageQueues}
        onQueueSelect={onQueueSelect}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Focus Queue/i }));
    fireEvent.click(screen.getByText('New Queue...'));

    expect(onOpenNewQueue).toHaveBeenCalledTimes(1);
  });

  it('invokes onOpenManageQueues when clicking Manage Queues', () => {
    render(
      <SavedQueueDropdown
        onOpenNewQueue={onOpenNewQueue}
        onOpenManageQueues={onOpenManageQueues}
        onQueueSelect={onQueueSelect}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Focus Queue/i }));
    fireEvent.click(screen.getByText('Manage Queues...'));

    expect(onOpenManageQueues).toHaveBeenCalledTimes(1);
  });
});
