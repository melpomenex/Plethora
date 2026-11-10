import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  previewLegacyLearningPathsImport,
  executeLegacyLearningPathsImport,
  LEGACY_STORAGE_KEY,
  LEGACY_BACKUP_KEY,
} from '../legacyLearningPathsImport';
import * as api from '../../../api/study-plans';

vi.mock('../../../api/study-plans', () => ({
  importLegacyStudyPlans: vi.fn(),
}));

class MockStorage implements Storage {
  private store: Map<string, string> = new Map();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

describe('legacyLearningPathsImport', () => {
  let storage: MockStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new MockStorage();
  });

  describe('previewLegacyLearningPathsImport', () => {
    it('returns hasData: false when storage is empty', () => {
      const preview = previewLegacyLearningPathsImport(storage);
      expect(preview.hasData).toBe(false);
      expect(preview.canImport).toBe(false);
    });

    it('returns malformed_structure defect on invalid JSON', () => {
      storage.setItem(LEGACY_STORAGE_KEY, 'not-valid-json{');
      const preview = previewLegacyLearningPathsImport(storage);
      expect(preview.hasData).toBe(true);
      expect(preview.canImport).toBe(false);
      expect(preview.defects[0].code).toBe('malformed_structure');
    });

    it('refuses newer major version with newer_version defect', () => {
      const payload = JSON.stringify({
        version: 2,
        state: { goals: [], paths: [] },
      });
      storage.setItem(LEGACY_STORAGE_KEY, payload);
      const preview = previewLegacyLearningPathsImport(storage);
      expect(preview.canImport).toBe(false);
      expect(preview.defects[0].code).toBe('newer_version');
    });

    it('flags unknown goal referenced by path', () => {
      const payload = JSON.stringify({
        version: 0,
        state: {
          goals: [{ id: 'goal_1', title: 'Goal 1', status: 'active' }],
          paths: [
            {
              id: 'path_1',
              goalId: 'goal_unknown',
              title: 'Path 1',
              nodes: [],
            },
          ],
        },
      });
      storage.setItem(LEGACY_STORAGE_KEY, payload);
      const preview = previewLegacyLearningPathsImport(storage);
      expect(preview.invalidPaths).toHaveLength(1);
      expect(preview.defects.some((d) => d.code === 'unknown_goal')).toBe(true);
      expect(preview.canImport).toBe(false);
    });

    it('detects duplicate node ids within a path and repairs mismatched pathId', () => {
      const payload = JSON.stringify({
        version: 0,
        state: {
          goals: [{ id: 'goal_1', title: 'Goal 1', status: 'active' }],
          paths: [
            {
              id: 'path_1',
              goalId: 'goal_1',
              title: 'Path 1',
              nodes: [
                { id: 'n1', pathId: 'mismatched_p', title: 'Node 1', prerequisiteNodeIds: [] },
                { id: 'n1', pathId: 'path_1', title: 'Duplicate Node 1', prerequisiteNodeIds: [] },
              ],
            },
          ],
        },
      });
      storage.setItem(LEGACY_STORAGE_KEY, payload);
      const preview = previewLegacyLearningPathsImport(storage);
      expect(preview.defects.some((d) => d.code === 'duplicate_node')).toBe(true);
      expect(preview.canImport).toBe(false);
    });

    it('detects dangling prerequisite references', () => {
      const payload = JSON.stringify({
        version: 0,
        state: {
          goals: [{ id: 'goal_1', title: 'Goal 1', status: 'active' }],
          paths: [
            {
              id: 'path_1',
              goalId: 'goal_1',
              title: 'Path 1',
              nodes: [
                { id: 'n1', pathId: 'path_1', title: 'Node 1', prerequisiteNodeIds: ['nonexistent_n0'] },
              ],
            },
          ],
        },
      });
      storage.setItem(LEGACY_STORAGE_KEY, payload);
      const preview = previewLegacyLearningPathsImport(storage);
      expect(preview.defects.some((d) => d.code === 'dangling_prerequisite')).toBe(true);
      expect(preview.canImport).toBe(false);
    });

    it('detects dependency cycles in legacy paths', () => {
      const payload = JSON.stringify({
        version: 0,
        state: {
          goals: [{ id: 'goal_1', title: 'Goal 1', status: 'active' }],
          paths: [
            {
              id: 'path_1',
              goalId: 'goal_1',
              title: 'Path 1',
              nodes: [
                { id: 'n1', pathId: 'path_1', title: 'Node 1', prerequisiteNodeIds: ['n2'] },
                { id: 'n2', pathId: 'path_1', title: 'Node 2', prerequisiteNodeIds: ['n1'] },
              ],
            },
          ],
        },
      });
      storage.setItem(LEGACY_STORAGE_KEY, payload);
      const preview = previewLegacyLearningPathsImport(storage);
      expect(preview.defects.some((d) => d.code === 'cycle')).toBe(true);
      expect(preview.canImport).toBe(false);
    });

    it('successfully validates a clean legacy envelope and repairs mismatched pathId', () => {
      const payload = JSON.stringify({
        version: 0,
        state: {
          goals: [{ id: 'goal_1', title: 'Goal 1', description: 'Master Cryptography', status: 'active' }],
          paths: [
            {
              id: 'path_1',
              goalId: 'goal_1',
              title: 'Path 1',
              nodes: [
                { id: 'n1', pathId: 'old_path_temp', title: 'Discrete Logs', prerequisiteNodeIds: [] },
                { id: 'n2', pathId: 'path_1', title: 'Diffie-Hellman', prerequisiteNodeIds: ['n1'] },
              ],
            },
          ],
        },
      });
      storage.setItem(LEGACY_STORAGE_KEY, payload);
      const preview = previewLegacyLearningPathsImport(storage);
      expect(preview.canImport).toBe(true);
      expect(preview.validPaths).toHaveLength(1);
      expect(preview.invalidPaths).toHaveLength(0);
      expect(preview.validPaths[0].nodes[0].pathId).toBe('path_1');
    });
  });

  describe('executeLegacyLearningPathsImport', () => {
    it('renames storage key to backup key on successful commit', async () => {
      const payload = JSON.stringify({
        version: 0,
        state: {
          goals: [{ id: 'goal_1', title: 'Goal 1', status: 'active' }],
          paths: [
            {
              id: 'path_1',
              goalId: 'goal_1',
              title: 'Path 1',
              nodes: [{ id: 'n1', pathId: 'path_1', title: 'Topic 1', prerequisiteNodeIds: [] }],
            },
          ],
        },
      });
      storage.setItem(LEGACY_STORAGE_KEY, payload);

      vi.mocked(api.importLegacyStudyPlans).mockResolvedValueOnce({
        planId: 'sp_imported_1',
        importedNodeCount: 1,
        importedVersion: 1,
        isRetry: false,
      });

      const res = await executeLegacyLearningPathsImport(storage);
      expect(res.ok).toBe(true);
      expect(res.importedPlanId).toBe('sp_imported_1');
      expect(res.backupKeyCreated).toBe(true);

      // Verify storage mutation: original removed, backup created
      expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
      expect(storage.getItem(LEGACY_BACKUP_KEY)).toBe(payload);
    });

    it('leaves original key intact when API call fails', async () => {
      const payload = JSON.stringify({
        version: 0,
        state: {
          goals: [{ id: 'goal_1', title: 'Goal 1', status: 'active' }],
          paths: [
            {
              id: 'path_1',
              goalId: 'goal_1',
              title: 'Path 1',
              nodes: [{ id: 'n1', pathId: 'path_1', title: 'Topic 1', prerequisiteNodeIds: [] }],
            },
          ],
        },
      });
      storage.setItem(LEGACY_STORAGE_KEY, payload);

      vi.mocked(api.importLegacyStudyPlans).mockRejectedValueOnce(new Error('Backend offline'));

      const res = await executeLegacyLearningPathsImport(storage);
      expect(res.ok).toBe(false);
      expect(res.backupKeyCreated).toBe(false);

      // Original remains untouched for retry
      expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(payload);
      expect(storage.getItem(LEGACY_BACKUP_KEY)).toBeNull();
    });

    it('handles idempotent retries when replaying the same import', async () => {
      const payload = JSON.stringify({
        version: 0,
        state: {
          goals: [{ id: 'goal_1', title: 'Goal 1', status: 'active' }],
          paths: [
            {
              id: 'path_1',
              goalId: 'goal_1',
              title: 'Path 1',
              nodes: [{ id: 'n1', pathId: 'path_1', title: 'Topic 1', prerequisiteNodeIds: [] }],
            },
          ],
        },
      });
      storage.setItem(LEGACY_STORAGE_KEY, payload);

      vi.mocked(api.importLegacyStudyPlans).mockResolvedValueOnce({
        planId: 'sp_imported_1',
        importedNodeCount: 1,
        importedVersion: 1,
        isRetry: true,
      });

      const res = await executeLegacyLearningPathsImport(storage);
      expect(res.ok).toBe(true);
      expect(res.isRetry).toBe(true);
      expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
      expect(storage.getItem(LEGACY_BACKUP_KEY)).toBe(payload);
    });
  });
});
