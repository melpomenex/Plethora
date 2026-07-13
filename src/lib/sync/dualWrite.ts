import { snapshotHash } from "./shardSnapshot";

export interface DualWriteResult {
  legacyWritten: boolean;
  shardWritten: boolean;
  parity: boolean;
  legacyHash: string;
  shardHash: string;
}

export async function dualWriteWithParity<T>(args: {
  value: T;
  writeLegacy: (value: T) => Promise<void>;
  writeShard: (value: T) => Promise<void>;
  readLegacy: () => Promise<unknown>;
  readShard: () => Promise<unknown>;
}): Promise<DualWriteResult> {
  await args.writeLegacy(args.value);
  await args.writeShard(args.value);
  const [legacy, shard] = await Promise.all([args.readLegacy(), args.readShard()]);
  const [legacyHash, shardHash] = await Promise.all([snapshotHash(legacy), snapshotHash(shard)]);
  return { legacyWritten: true, shardWritten: true, parity: legacyHash === shardHash, legacyHash, shardHash };
}
