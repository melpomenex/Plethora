export interface ChaosOperation {
  id: string;
  key: string;
  value: unknown | null;
  deleted?: boolean;
  clock: string;
}

export function convergeChaosOperations(operations: ChaosOperation[]): Map<string, ChaosOperation> {
  const merged = new Map<string, ChaosOperation>();
  const applied = new Set<string>();
  for (const operation of [...operations].reverse().concat(operations)) {
    if (applied.has(operation.id)) continue;
    applied.add(operation.id);
    const current = merged.get(operation.key);
    if (!current || operation.clock > current.clock) merged.set(operation.key, operation);
  }
  return merged;
}
