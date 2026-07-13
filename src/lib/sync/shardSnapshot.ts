export interface ShardSnapshot<T = unknown> {
  schemaVersion: number;
  domain: string;
  shard: string;
  epoch: number;
  records: T[];
  tombstoneFrontier: string;
  payloadHash: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function snapshotHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value));
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (const part of bytes) hash = Math.imul(hash ^ part, 16777619);
  return (hash >>> 0).toString(16);
}

export async function createShardSnapshot<T>(args: Omit<ShardSnapshot<T>, "payloadHash">): Promise<ShardSnapshot<T>> {
  return { ...args, payloadHash: await snapshotHash(args) };
}

export async function verifyShardSnapshot<T>(snapshot: ShardSnapshot<T>): Promise<boolean> {
  if (!snapshot.domain || !snapshot.shard || snapshot.epoch < 0 || !snapshot.tombstoneFrontier) return false;
  return snapshot.payloadHash === await snapshotHash({
    schemaVersion: snapshot.schemaVersion,
    domain: snapshot.domain,
    shard: snapshot.shard,
    epoch: snapshot.epoch,
    records: snapshot.records,
    tombstoneFrontier: snapshot.tombstoneFrontier,
  });
}
