import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockIsTauri = vi.fn(() => false);
const mockInvokeCommand = vi.fn();

vi.mock('../../lib/tauri', () => ({
  isTauri: () => mockIsTauri(),
  invokeCommand: (...args: any[]) => mockInvokeCommand(...args),
}));

import {
  getSavedQueues,
  getSavedQueue,
  createSavedQueue,
  updateSavedQueue,
  deleteSavedQueue,
  getActiveSavedQueueId,
  setActiveSavedQueueId,
  STARTER_SAVED_QUEUES,
} from '../savedQueues';

describe('savedQueues API', () => {
  beforeEach(() => {
    localStorage.clear();
    mockIsTauri.mockReturnValue(false);
    mockInvokeCommand.mockReset();
  });

  describe('browser / localStorage mode', () => {
    it('returns starter default queues on clean state', async () => {
      const queues = await getSavedQueues();
      expect(queues.length).toBe(STARTER_SAVED_QUEUES.length);
      expect(queues.map((q) => q.name)).toEqual(['All Due', 'Quick Review', 'Deep Dive']);
    });

    it('creates a new saved queue with specified filters', async () => {
      const created = await createSavedQueue({
        name: 'Biology Exam',
        filters: {
          categories: ['Biology'],
          priorityRange: { min: 50, max: 100 },
        },
        itemTypes: {
          documents: false,
          extracts: true,
          learningItems: true,
        },
        sessionDurationMinutes: 45,
        maxItems: 30,
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Biology Exam');
      expect(created.filters.categories).toEqual(['Biology']);
      expect(created.filters.priorityRange).toEqual({ min: 50, max: 100 });
      expect(created.itemTypes.documents).toBe(false);
      expect(created.itemTypes.learningItems).toBe(true);

      const fetched = await getSavedQueue(created.id);
      expect(fetched.name).toBe('Biology Exam');
    });

    it('updates a saved queue and unsets other defaults when setting isDefault: true', async () => {
      const created1 = await createSavedQueue({ name: 'Queue 1', isDefault: true });
      const created2 = await createSavedQueue({ name: 'Queue 2', isDefault: false });

      expect((await getSavedQueue(created1.id)).isDefault).toBe(true);
      expect((await getSavedQueue(created2.id)).isDefault).toBe(false);

      await updateSavedQueue(created2.id, { isDefault: true, name: 'Queue 2 Updated' });

      expect((await getSavedQueue(created1.id)).isDefault).toBe(false);
      const updated2 = await getSavedQueue(created2.id);
      expect(updated2.isDefault).toBe(true);
      expect(updated2.name).toBe('Queue 2 Updated');
    });

    it('deletes a saved queue', async () => {
      const created = await createSavedQueue({ name: 'To Delete' });
      const initialList = await getSavedQueues();
      expect(initialList.some((q) => q.id === created.id)).toBe(true);

      await deleteSavedQueue(created.id);
      const updatedList = await getSavedQueues();
      expect(updatedList.some((q) => q.id === created.id)).toBe(false);
    });

    it('gets and sets active saved queue id', async () => {
      expect(await getActiveSavedQueueId()).toBeNull();
      await setActiveSavedQueueId('test-queue-id');
      expect(await getActiveSavedQueueId()).toBe('test-queue-id');
      await setActiveSavedQueueId(null);
      expect(await getActiveSavedQueueId()).toBeNull();
    });
  });

  describe('tauri mode', () => {
    beforeEach(() => {
      mockIsTauri.mockReturnValue(true);
    });

    it('delegates getSavedQueues to Tauri invoke', async () => {
      mockInvokeCommand.mockResolvedValueOnce(STARTER_SAVED_QUEUES);
      const res = await getSavedQueues('col-1');
      expect(mockInvokeCommand).toHaveBeenCalledWith('get_saved_queues', { collectionId: 'col-1' });
      expect(res).toEqual(STARTER_SAVED_QUEUES);
    });

    it('delegates createSavedQueue to Tauri invoke', async () => {
      const sample = { ...STARTER_SAVED_QUEUES[0], id: 'new-id', name: 'Custom' };
      mockInvokeCommand.mockResolvedValueOnce(sample);
      const res = await createSavedQueue({ name: 'Custom' });
      expect(mockInvokeCommand).toHaveBeenCalledWith('create_saved_queue', { input: { name: 'Custom' } });
      expect(res.name).toBe('Custom');
    });

    it('delegates updateSavedQueue to Tauri invoke', async () => {
      const sample = { ...STARTER_SAVED_QUEUES[0], name: 'Updated' };
      mockInvokeCommand.mockResolvedValueOnce(sample);
      const res = await updateSavedQueue('sq-1', { name: 'Updated' });
      expect(mockInvokeCommand).toHaveBeenCalledWith('update_saved_queue', { id: 'sq-1', input: { name: 'Updated' } });
      expect(res.name).toBe('Updated');
    });

    it('delegates deleteSavedQueue to Tauri invoke', async () => {
      mockInvokeCommand.mockResolvedValueOnce(undefined);
      await deleteSavedQueue('sq-1');
      expect(mockInvokeCommand).toHaveBeenCalledWith('delete_saved_queue', { id: 'sq-1' });
    });
  });
});
