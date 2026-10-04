import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSavedQueueStore } from '../savedQueueStore';
import * as api from '../../api/savedQueues';
import type { SavedQueue } from '../../types/savedQueue';

const sampleQueue1: SavedQueue = {
  id: 'sq-1',
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
  id: 'sq-2',
  name: 'Quick Flashcards',
  filters: { categories: ['Med'], tags: [], priorityRange: { min: 50, max: 100 }, excludeSuspended: true },
  itemTypes: { documents: false, extracts: false, learningItems: true },
  sessionDurationMinutes: 15,
  maxItems: 20,
  isDefault: false,
  sortOrder: 2,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('savedQueueStore', () => {
  beforeEach(() => {
    useSavedQueueStore.setState({
      savedQueues: [],
      activeQueueId: null,
      isLoading: false,
      error: null,
    });
    vi.restoreAllMocks();
  });

  it('loads saved queues and auto-activates default if none active', async () => {
    vi.spyOn(api, 'getSavedQueues').mockResolvedValueOnce([sampleQueue1, sampleQueue2]);
    vi.spyOn(api, 'getActiveSavedQueueId').mockResolvedValueOnce(null);

    await useSavedQueueStore.getState().loadSavedQueues();

    const state = useSavedQueueStore.getState();
    expect(state.savedQueues).toHaveLength(2);
    expect(state.activeQueueId).toBe('sq-1');
    expect(state.getActiveSavedQueue()?.name).toBe('Default Queue');
  });

  it('preserves valid stored activeQueueId on load', async () => {
    vi.spyOn(api, 'getSavedQueues').mockResolvedValueOnce([sampleQueue1, sampleQueue2]);
    vi.spyOn(api, 'getActiveSavedQueueId').mockResolvedValueOnce('sq-2');

    await useSavedQueueStore.getState().loadSavedQueues();

    const state = useSavedQueueStore.getState();
    expect(state.activeQueueId).toBe('sq-2');
    expect(state.getActiveSavedQueue()?.name).toBe('Quick Flashcards');
  });

  it('creates and immediately activates new queue', async () => {
    const newQueue: SavedQueue = {
      ...sampleQueue2,
      id: 'sq-3',
      name: 'New Custom Queue',
    };
    vi.spyOn(api, 'createSavedQueue').mockResolvedValueOnce(newQueue);
    const setActiveSpy = vi.spyOn(api, 'setActiveSavedQueueId').mockResolvedValue();

    const result = await useSavedQueueStore.getState().createSavedQueue({
      name: 'New Custom Queue',
    });

    expect(result.id).toBe('sq-3');
    const state = useSavedQueueStore.getState();
    expect(state.savedQueues).toContainEqual(newQueue);
    expect(state.activeQueueId).toBe('sq-3');
    expect(setActiveSpy).toHaveBeenCalledWith('sq-3');
  });

  it('updates a saved queue', async () => {
    useSavedQueueStore.setState({
      savedQueues: [sampleQueue1, sampleQueue2],
      activeQueueId: 'sq-1',
    });

    const updatedQueue: SavedQueue = {
      ...sampleQueue1,
      name: 'Renamed Default',
    };
    vi.spyOn(api, 'updateSavedQueue').mockResolvedValueOnce(updatedQueue);

    await useSavedQueueStore.getState().updateSavedQueue('sq-1', {
      name: 'Renamed Default',
    });

    const state = useSavedQueueStore.getState();
    expect(state.savedQueues.find((q) => q.id === 'sq-1')?.name).toBe('Renamed Default');
  });

  it('deletes a queue and falls back to default if deleted queue was active', async () => {
    useSavedQueueStore.setState({
      savedQueues: [sampleQueue1, sampleQueue2],
      activeQueueId: 'sq-2',
    });

    vi.spyOn(api, 'deleteSavedQueue').mockResolvedValueOnce();
    const setActiveSpy = vi.spyOn(api, 'setActiveSavedQueueId').mockResolvedValue();

    await useSavedQueueStore.getState().deleteSavedQueue('sq-2');

    const state = useSavedQueueStore.getState();
    expect(state.savedQueues).toHaveLength(1);
    expect(state.savedQueues[0].id).toBe('sq-1');
    expect(state.activeQueueId).toBe('sq-1');
    expect(setActiveSpy).toHaveBeenCalledWith('sq-1');
  });

  it('activates a queue explicitly', async () => {
    useSavedQueueStore.setState({
      savedQueues: [sampleQueue1, sampleQueue2],
      activeQueueId: 'sq-1',
    });

    const setActiveSpy = vi.spyOn(api, 'setActiveSavedQueueId').mockResolvedValue();

    await useSavedQueueStore.getState().activateSavedQueue('sq-2');

    const state = useSavedQueueStore.getState();
    expect(state.activeQueueId).toBe('sq-2');
    expect(setActiveSpy).toHaveBeenCalledWith('sq-2');
  });
});
