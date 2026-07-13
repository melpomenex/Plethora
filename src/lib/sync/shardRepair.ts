import { verifyShardSnapshot, type ShardSnapshot } from "./shardSnapshot";

export async function repairShardFromSnapshot<T>(args: {
  snapshot: ShardSnapshot<T>;
  replace: (records: T[]) => Promise<void>;
}): Promise<{ repaired: boolean; recordCount: number }> {
  if (!await verifyShardSnapshot(args.snapshot)) return { repaired: false, recordCount: 0 };
  await args.replace(args.snapshot.records);
  return { repaired: true, recordCount: args.snapshot.records.length };
}
