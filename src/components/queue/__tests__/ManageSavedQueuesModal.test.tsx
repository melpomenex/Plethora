import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManageSavedQueuesModal } from '../ManageSavedQueuesModal';
import { useSavedQueueStore } from '../../../stores/savedQueueStore';
import type { SavedQueue } from '../../../types/savedQueue';

const sampleQueue1: SavedQueue = {
  id: 'q-1',
  name: 'Default Queue',
  filters: { categories: [], tags: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: true },
  itemTypes: { documents: true, extracts: true, learningItems: true },
  sessionDurationMinutes: 60,
  maxItems: 50,
  isDefault: true,
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const sampleQueue2: SavedQueue = {
  id: 'q-2',
  name: 'Study Queue',
  filters: { categories: ['Bio'], tags: [], priorityRange: { min: 50, max: 100 }, excludeSuspended: true },
  itemTypes: { documents: false, extracts: true, learningItems: true },
  sessionDurationMinutes: 30,
  maxItems: 25,
  isDefault: false,
  sortOrder: 2,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ManageSavedQueuesModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSavedQueueStore.setState({
      savedQueues: [sampleQueue1, sampleQueue2],
      activeQueueId: 'q-1',
      isLoading: false,
      error: null,
    });
  });

  it('renders nothing when closed', () => {
    render(<ManageSavedQueuesModal isOpen={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders queue list when open', () => {
    render(<ManageSavedQueuesModal isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Default Queue')).toBeInTheDocument();
    expect(screen.getByText('Study Queue')).toBeInTheDocument();
  });

  it('sets queue as default', async () => {
    const updateSpy = vi.fn().mockResolvedValue(sampleQueue2);
    useSavedQueueStore.setState({ updateSavedQueue: updateSpy });

    render(<ManageSavedQueuesModal isOpen={true} onClose={onClose} />);

    const setDefaultButtons = screen.getAllByTitle(/Set as Default/i);
    expect(setDefaultButtons.length).toBeGreaterThan(0);
    fireEvent.click(setDefaultButtons[0]);

    expect(updateSpy).toHaveBeenCalledWith('q-2', { isDefault: true });
  });

  it('deletes queue with confirmation', async () => {
    const deleteSpy = vi.fn().mockResolvedValue(undefined);
    useSavedQueueStore.setState({ deleteSavedQueue: deleteSpy });

    render(<ManageSavedQueuesModal isOpen={true} onClose={onClose} />);

    const deleteButtons = screen.getAllByTitle(/^Delete/i);
    fireEvent.click(deleteButtons[1]); // First click arms confirmation
    expect(deleteSpy).not.toHaveBeenCalled();

    // Second click confirms
    const confirmButton = screen.getByTitle(/Confirm/i);
    fireEvent.click(confirmButton);
    expect(deleteSpy).toHaveBeenCalledWith('q-2');
  });
});
