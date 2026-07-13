export interface CoverageChange {
  domain: string;
  entityKey: string;
  updatedAt: string;
}

export interface CoverageOperation {
  domain: string;
  entityKey: string;
  clock: string;
}

export function findUnjournaledChanges(changes: CoverageChange[], operations: CoverageOperation[]): CoverageChange[] {
  const covered = new Set(operations.map((operation) => `${operation.domain}:${operation.entityKey}:${operation.clock}`));
  return changes.filter((change) => !covered.has(`${change.domain}:${change.entityKey}:${change.updatedAt}`));
}
