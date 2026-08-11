/**
 * Pure tag normalization + duplicate-guard helpers shared by every tag editor
 * surface. Tag identity for duplicate prevention is case-insensitive; the
 * entered display casing is preserved for accepted tags.
 */

/** Trim whitespace from raw tag input. Does not alter display casing. */
export function normalizeTagInput(raw: string): string {
  return raw.trim();
}

/** Case-insensitive membership check. */
export function hasTag(tags: readonly string[], candidate: string): boolean {
  const lower = candidate.toLowerCase();
  return tags.some((tag) => tag.toLowerCase() === lower);
}

export type TagRejectionReason = "empty" | "duplicate" | null;

export interface AddTagResult {
  /** The next tag array (unchanged when rejected). */
  tags: string[];
  /** True when the tag was accepted and appended. */
  added: boolean;
  /** Why the input was rejected, when it was. */
  rejected: TagRejectionReason;
}

/**
 * Add a trimmed, non-empty tag preserving the entered display casing. Rejects
 * whitespace-only input and case-insensitive duplicates without mutating.
 */
export function addTag(tags: readonly string[], raw: string): AddTagResult {
  const trimmed = normalizeTagInput(raw);
  if (!trimmed) {
    return { tags: [...tags], added: false, rejected: "empty" };
  }
  if (hasTag(tags, trimmed)) {
    return { tags: [...tags], added: false, rejected: "duplicate" };
  }
  return { tags: [...tags, trimmed], added: true, rejected: null };
}

/** Remove one assigned tag (exact match against the displayed casing). */
export function removeTag(tags: readonly string[], tagToRemove: string): string[] {
  return tags.filter((tag) => tag !== tagToRemove);
}
