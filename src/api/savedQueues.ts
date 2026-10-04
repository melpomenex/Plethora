import { invokeCommand, isTauri } from '../lib/tauri';
import type {
  SavedQueue,
  CreateSavedQueueInput,
  UpdateSavedQueueInput,
} from '../types/savedQueue';

const LOCAL_STORAGE_KEY = 'plethora_saved_queues';
const LOCAL_STORAGE_ACTIVE_KEY = 'plethora_active_saved_queue_id';

export const STARTER_SAVED_QUEUES: SavedQueue[] = [
  {
    id: 'default-all-due',
    name: 'All Due',
    icon: 'Stack',
    collectionId: null,
    filters: {
      categories: [],
      tags: [],
      priorityRange: { min: 0, max: 100 },
      excludeSuspended: true,
    },
    itemTypes: {
      documents: true,
      extracts: true,
      learningItems: true,
    },
    sessionDurationMinutes: 60,
    maxItems: 50,
    daqePresetId: 'balanced-discovery',
    isDefault: true,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'default-quick-review',
    name: 'Quick Review',
    icon: 'Lightning',
    collectionId: null,
    filters: {
      categories: [],
      tags: [],
      priorityRange: { min: 40, max: 100 },
      excludeSuspended: true,
    },
    itemTypes: {
      documents: false,
      extracts: false,
      learningItems: true,
    },
    sessionDurationMinutes: 15,
    maxItems: 25,
    daqePresetId: 'tired-mobile-commute',
    isDefault: false,
    sortOrder: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'default-deep-dive',
    name: 'Deep Dive',
    icon: 'Target',
    collectionId: null,
    filters: {
      categories: [],
      tags: [],
      priorityRange: { min: 60, max: 100 },
      excludeSuspended: true,
    },
    itemTypes: {
      documents: true,
      extracts: true,
      learningItems: false,
    },
    sessionDurationMinutes: 60,
    maxItems: 30,
    daqePresetId: 'deep-work-sprint',
    isDefault: false,
    sortOrder: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

function getLocalQueues(): SavedQueue[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(STARTER_SAVED_QUEUES));
      return [...STARTER_SAVED_QUEUES];
    }
    return JSON.parse(raw);
  } catch {
    return [...STARTER_SAVED_QUEUES];
  }
}

function saveLocalQueues(queues: SavedQueue[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(queues));
  } catch (e) {
    console.error('Failed to save queues to localStorage', e);
  }
}

export async function getSavedQueues(collectionId?: string | null): Promise<SavedQueue[]> {
  if (isTauri()) {
    try {
      const res = await invokeCommand<SavedQueue[]>('get_saved_queues', {
        collectionId: collectionId || null,
      });
      if (Array.isArray(res) && res.length > 0) return res;
      if (Array.isArray(res)) {
        // If native returned 0 queues (e.g. fresh install), seed starters
        for (const starter of STARTER_SAVED_QUEUES) {
          await invokeCommand('create_saved_queue', {
            input: {
              name: starter.name,
              icon: starter.icon,
              collectionId: starter.collectionId,
              filters: starter.filters,
              itemTypes: starter.itemTypes,
              sessionDurationMinutes: starter.sessionDurationMinutes,
              maxItems: starter.maxItems,
              daqePresetId: starter.daqePresetId,
              isDefault: starter.isDefault,
            },
          }).catch(() => {});
        }
        const seeded = await invokeCommand<SavedQueue[]>('get_saved_queues', {
          collectionId: collectionId || null,
        });
        if (Array.isArray(seeded)) return seeded;
      }
    } catch (e) {
      console.error('Tauri get_saved_queues failed, falling back to localStorage', e);
    }
  }

  const all = getLocalQueues();
  if (!collectionId) return all;
  return all.filter((q) => !q.collectionId || q.collectionId === collectionId);
}

export async function getSavedQueue(id: string): Promise<SavedQueue> {
  if (isTauri()) {
    try {
      const res = await invokeCommand<SavedQueue>('get_saved_queue', { id });
      if (res && res.id) return res;
    } catch (e) {
      console.error('Tauri get_saved_queue failed, falling back to localStorage', e);
    }
  }

  const found = getLocalQueues().find((q) => q.id === id);
  if (!found) throw new Error(`Saved queue ${id} not found`);
  return found;
}

export async function createSavedQueue(input: CreateSavedQueueInput): Promise<SavedQueue> {
  if (isTauri()) {
    try {
      const res = await invokeCommand<SavedQueue>('create_saved_queue', { input });
      if (res && res.id) return res;
    } catch (e) {
      console.error('Tauri create_saved_queue failed, falling back to localStorage', e);
    }
  }

  const queues = getLocalQueues();
  const now = new Date().toISOString();
  const id = `sq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const isDefault = input.isDefault ?? false;

  if (isDefault) {
    for (const q of queues) {
      if (!input.collectionId || !q.collectionId || q.collectionId === input.collectionId) {
        q.isDefault = false;
      }
    }
  }

  const newQueue: SavedQueue = {
    id,
    name: input.name,
    icon: input.icon,
    collectionId: input.collectionId ?? null,
    filters: {
      categories: input.filters?.categories ?? [],
      tags: input.filters?.tags ?? [],
      priorityRange: input.filters?.priorityRange ?? { min: 0, max: 100 },
      excludeSuspended: input.filters?.excludeSuspended ?? true,
    },
    itemTypes: {
      documents: input.itemTypes?.documents ?? true,
      extracts: input.itemTypes?.extracts ?? true,
      learningItems: input.itemTypes?.learningItems ?? true,
    },
    sessionDurationMinutes: input.sessionDurationMinutes ?? 60,
    maxItems: input.maxItems ?? 50,
    daqePresetId: input.daqePresetId,
    sessionGoal: input.sessionGoal,
    isDefault,
    sortOrder: queues.length + 1,
    createdAt: now,
    updatedAt: now,
  };

  queues.push(newQueue);
  saveLocalQueues(queues);
  return newQueue;
}

export async function updateSavedQueue(
  id: string,
  input: UpdateSavedQueueInput
): Promise<SavedQueue> {
  if (isTauri()) {
    try {
      const res = await invokeCommand<SavedQueue>('update_saved_queue', { id, input });
      if (res && res.id) return res;
    } catch (e) {
      console.error('Tauri update_saved_queue failed, falling back to localStorage', e);
    }
  }

  const queues = getLocalQueues();
  const index = queues.findIndex((q) => q.id === id);
  if (index === -1) throw new Error(`Saved queue ${id} not found`);

  const existing = queues[index];
  const isDefault = input.isDefault ?? existing.isDefault;

  if (isDefault && !existing.isDefault) {
    for (const q of queues) {
      if (q.id !== id) {
        if (!existing.collectionId || !q.collectionId || q.collectionId === existing.collectionId) {
          q.isDefault = false;
        }
      }
    }
  }

  const updated: SavedQueue = {
    ...existing,
    name: input.name ?? existing.name,
    icon: input.icon !== undefined ? input.icon : existing.icon,
    collectionId: input.collectionId !== undefined ? input.collectionId : existing.collectionId,
    filters: {
      categories: input.filters?.categories ?? existing.filters.categories,
      tags: input.filters?.tags ?? existing.filters.tags,
      priorityRange: input.filters?.priorityRange ?? existing.filters.priorityRange,
      excludeSuspended: input.filters?.excludeSuspended ?? existing.filters.excludeSuspended,
    },
    itemTypes: {
      documents: input.itemTypes?.documents ?? existing.itemTypes.documents,
      extracts: input.itemTypes?.extracts ?? existing.itemTypes.extracts,
      learningItems: input.itemTypes?.learningItems ?? existing.itemTypes.learningItems,
    },
    sessionDurationMinutes: input.sessionDurationMinutes ?? existing.sessionDurationMinutes,
    maxItems: input.maxItems ?? existing.maxItems,
    daqePresetId: input.daqePresetId !== undefined ? input.daqePresetId : existing.daqePresetId,
    sessionGoal: input.sessionGoal !== undefined ? input.sessionGoal : existing.sessionGoal,
    isDefault,
    sortOrder: input.sortOrder ?? existing.sortOrder,
    updatedAt: new Date().toISOString(),
  };

  queues[index] = updated;
  saveLocalQueues(queues);
  return updated;
}

export async function deleteSavedQueue(id: string): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCommand('delete_saved_queue', { id });
      return;
    } catch (e) {
      console.error('Tauri delete_saved_queue failed, falling back to localStorage', e);
    }
  }

  const queues = getLocalQueues().filter((q) => q.id !== id);
  saveLocalQueues(queues);
}

export async function getActiveSavedQueueId(): Promise<string | null> {
  if (isTauri()) {
    try {
      const res = await invokeCommand<string | null>('get_active_saved_queue_id');
      if (res !== undefined) return res;
    } catch (e) {
      console.error('Tauri get_active_saved_queue_id failed, falling back to localStorage', e);
    }
  }

  return localStorage.getItem(LOCAL_STORAGE_ACTIVE_KEY);
}

export async function setActiveSavedQueueId(id: string | null): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCommand('set_active_saved_queue_id', { id });
      return;
    } catch (e) {
      console.error('Tauri set_active_saved_queue_id failed, falling back to localStorage', e);
    }
  }

  if (id) {
    localStorage.setItem(LOCAL_STORAGE_ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(LOCAL_STORAGE_ACTIVE_KEY);
  }
}
