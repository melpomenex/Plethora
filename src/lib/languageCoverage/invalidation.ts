import type {
  CoverageChunkReference,
  CoverageInvalidationPlan,
} from "./types";

function referenceKey(reference: CoverageChunkReference): string {
  return `${reference.profileId}:${reference.documentId}:${reference.chunkId}:${reference.coverageKey}`;
}

function orderedReferences(references: Iterable<CoverageChunkReference>): CoverageChunkReference[] {
  const deduplicated = new Map<string, CoverageChunkReference>();
  for (const reference of references) deduplicated.set(referenceKey(reference), reference);
  return [...deduplicated.values()].sort((left, right) =>
    left.profileId.localeCompare(right.profileId) ||
    left.documentId.localeCompare(right.documentId) ||
    left.chunkIndex - right.chunkIndex ||
    left.chunkId.localeCompare(right.chunkId) ||
    left.coverageKey.localeCompare(right.coverageKey));
}

/**
 * Compute the smallest invalidation set for a lexical state change. The
 * caller supplies chunk references produced while calculating coverage; no
 * document-wide rescan is implied.
 */
export function reverseInvalidateChunks(
  references: readonly CoverageChunkReference[],
  lexicalEntryId: string,
  profileId?: string,
): CoverageInvalidationPlan {
  const chunks = orderedReferences(references.filter((reference) =>
    reference.lexicalEntryIds.includes(lexicalEntryId) &&
    (profileId === undefined || reference.profileId === profileId)));
  return {
    lexicalEntryId,
    chunks,
    documentIds: [...new Set(chunks.map((chunk) => chunk.documentId))].sort(),
    coverageKeys: [...new Set(chunks.map((chunk) => chunk.coverageKey))].sort(),
  };
}

/** Small in-memory reverse index suitable for a store adapter or tests. */
export class CoverageReverseIndex {
  private readonly byEntry = new Map<string, Map<string, CoverageChunkReference>>();

  indexChunk(reference: CoverageChunkReference): void {
    const key = referenceKey(reference);
    for (const entryId of new Set(reference.lexicalEntryIds)) {
      const references = this.byEntry.get(entryId) ?? new Map<string, CoverageChunkReference>();
      references.set(key, reference);
      this.byEntry.set(entryId, references);
    }
  }

  removeChunk(reference: CoverageChunkReference): void {
    const key = referenceKey(reference);
    for (const entryId of reference.lexicalEntryIds) {
      const references = this.byEntry.get(entryId);
      references?.delete(key);
      if (references?.size === 0) this.byEntry.delete(entryId);
    }
  }

  invalidate(lexicalEntryId: string, profileId?: string): CoverageInvalidationPlan {
    return reverseInvalidateChunks(
      [...(this.byEntry.get(lexicalEntryId)?.values() ?? [])],
      lexicalEntryId,
      profileId,
    );
  }

  clear(): void {
    this.byEntry.clear();
  }
}
