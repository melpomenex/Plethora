import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDefaultCommands } from '../CommandPalette';
import { useSavedQueueStore } from '../../../stores/savedQueueStore';
import type { SavedQueue } from '../../../types/savedQueue';

const mockQueue: SavedQueue = {
  id: 'q-history',
  name: 'History Sprint',
  isDefault: false,
  filters: {
    tags: ['History'],
    categories: [],
    priorityRange: { min: 0, max: 100 },
    excludeSuspended: true,
  },
  itemTypes: {
    documents: true,
    extracts: true,
    learningItems: false,
  },
  sessionDurationMinutes: 30,
  maxItems: 20,
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('CommandPalette - Saved Queues', () => {
  beforeEach(() => {
    useSavedQueueStore.setState({
      savedQueues: [mockQueue],
      activeQueueId: null,
    });
  });

  it('includes manage, new, and dynamic saved queue commands', () => {
    const commands = getDefaultCommands();
    const manageCmd = commands.find((c) => c.id === 'manage-saved-queues');
    const newCmd = commands.find((c) => c.id === 'new-saved-queue');
    const switchCmd = commands.find((c) => c.id === 'switch-queue-q-history');

    expect(manageCmd).toBeDefined();
    expect(newCmd).toBeDefined();
    expect(switchCmd).toBeDefined();
    expect(switchCmd?.label).toContain('History Sprint');
  });

  it('switches queue when executing the queue switch command', async () => {
    const activateSpy = vi.fn().mockResolvedValue(undefined);
    useSavedQueueStore.setState({ activateSavedQueue: activateSpy });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const commands = getDefaultCommands();
    const switchCmd = commands.find((c) => c.id === 'switch-queue-q-history')!;
    await switchCmd.action();

    expect(activateSpy).toHaveBeenCalledWith('q-history');
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'navigate',
        detail: '/queue',
      })
    );
  });

  it('dispatches manage-saved-queues when executing manage command', () => {
    vi.useFakeTimers();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const commands = getDefaultCommands();
    const manageCmd = commands.find((c) => c.id === 'manage-saved-queues')!;
    manageCmd.action();
    vi.advanceTimersByTime(200);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'navigate', detail: '/queue' })
    );
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'plethora:manage-saved-queues' })
    );
    vi.useRealTimers();
  });
});
