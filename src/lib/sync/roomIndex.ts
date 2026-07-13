export const ROOM_INDEX_SCHEMA_VERSION = 1;

export interface SyncShardDescriptor {
  domain: string;
  shard: string;
  epoch: number;
  lane: "P0" | "P1" | "P2" | "P3";
  snapshotHash: string | null;
  itemCount: number;
  encodedBytes: number;
  acknowledgedDevices: string[];
}

export interface SyncRoomIndex {
  schemaVersion: number;
  room: string;
  generatedAt: string;
  shards: SyncShardDescriptor[];
  capabilities: string[];
  migration: Record<string, string>;
}

export function hashBucket(entityKey: string, bucketCount = 16): string {
  let hash = 2166136261;
  for (let i = 0; i < entityKey.length; i += 1) {
    hash ^= entityKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % Math.max(1, bucketCount)).padStart(2, "0");
}

export function shardName(domain: string, entityKey: string, epoch = 0, bucketCount = 16): string {
  return `${domain}:${hashBucket(entityKey, bucketCount)}:${epoch}`;
}

export function epochShardName(domain: string, epoch: number): string {
  return `${domain}:epoch:${Math.max(0, Math.floor(epoch))}`;
}

export function isValidRoomIndex(index: SyncRoomIndex): boolean {
  return index.schemaVersion > 0 && Boolean(index.room) && index.shards.every((shard) =>
    shard.domain && shard.shard && shard.epoch >= 0 && shard.itemCount >= 0 && shard.encodedBytes >= 0,
  );
}
