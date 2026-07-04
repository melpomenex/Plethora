import { createReplicatedMap, type ReplicatedMap } from "../replicatedMap";
import { invokeCommand, isTauri } from "../../tauri";
import type { Collection } from "../../../types/collection";

export interface SyncedCollection {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

let collectionsMap: ReplicatedMap<SyncedCollection> | null = null;

function getCollectionsMap(): ReplicatedMap<SyncedCollection> {
  if (!collectionsMap) {
    collectionsMap = createReplicatedMap<SyncedCollection>({
      name: "collections",
      label: "collections",
      mode: "row-lww",
      clockField: "updatedAt",
      getLocal: async (key) => {
        try {
          const raw = await invokeCommand<Collection | null>("get_synced_collection", { id: key });
          if (!raw) return null;
          return toSyncedCollection(raw);
        } catch {
          return null;
        }
      },
      apply: async (_key, row) => {
        await invokeCommand("upsert_synced_collection", { collection: row });
        try {
          window.dispatchEvent(new CustomEvent("incrementum:synced-collection", { detail: { id: row.id } }));
        } catch {
          /* ignore */
        }
      },
      applyDelete: async (key) => {
        await invokeCommand("delete_synced_collection", { id: key });
        try {
          window.dispatchEvent(new CustomEvent("incrementum:synced-collection-deleted", { detail: { id: key } }));
        } catch {
          /* ignore */
        }
      },
    });
  }
  return collectionsMap;
}

export function toSyncedCollection(raw: Collection): SyncedCollection {
  return {
    id: raw.id,
    name: raw.name,
    icon: raw.icon || undefined,
    color: raw.color || undefined,
    isDefault: !!raw.isDefault,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

export async function publishCollection(raw: Collection): Promise<void> {
  if (!isTauri()) return;
  const synced = toSyncedCollection(raw);
  await getCollectionsMap().publish(synced.id, synced);
}

export async function publishCollectionDeleted(id: string): Promise<void> {
  if (!isTauri()) return;
  await getCollectionsMap().delete(id);
}

export async function ensureCollectionSyncReady(): Promise<void> {
  if (!isTauri()) return;
  await getCollectionsMap().ensureReady();
}
