/**
 * Retrieval authorization guards (task 2.4 / defect A2).
 *
 * Every retrieval path funnels its restrictions through here so a strict
 * Document/Library request cannot degrade into an unrestricted search:
 *
 *  - `resolveRetrievalFilters` turns the frozen authorized source set into
 *    concrete `RetrievalFilters`.
 *  - It THROWS for an empty explicit set (the caller keeps the draft and shows
 *    an unavailable-source reason) instead of returning `undefined`, because
 *    `undefined` means "whole authorized library" by contract.
 *  - `assertFrozenFilters` re-checks the filters at the retrieval boundary so
 *    a later refactor cannot silently drop them.
 */

import type { SemanticSourceType } from "../../../api/ai-learning";
import type { AssistantScope } from "./scopes";

/** Mirrors `RetrievalFilters` from `src/api/ai-learning.ts` structurally. */
export interface RetrievalFiltersLike {
  documentIds?: string[];
  sourceTypes?: SemanticSourceType[];
}

/** The frozen authorized source set for one turn. */
export type FrozenSourceSet =
  | { kind: "library" }
  | { kind: "documents"; documentIds: string[]; sourceTypes?: SemanticSourceType[] }
  | { kind: "collection"; documentIds: string[]; sourceTypes?: SemanticSourceType[] };

export class RetrievalDeniedError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "empty_restricted_set"
      | "scope_requires_restriction"
      | "filters_dropped",
  ) {
    super(message);
    this.name = "RetrievalDeniedError";
  }
}

/**
 * Build the filters a retrieval call MUST use. Chat scope never retrieves.
 * A strict scope without an explicit, non-empty set is denied (fail closed).
 */
export function resolveRetrievalFilters(
  scope: AssistantScope,
  frozen: FrozenSourceSet,
): RetrievalFiltersLike | undefined {
  if (scope === "chat") {
    throw new RetrievalDeniedError(
      "Chat scope must not perform library retrieval",
      "scope_requires_restriction",
    );
  }
  if (frozen.kind === "library") {
    // Whole-library retrieval is the authorized behavior for Library scope
    // with no restriction; Document scope always names its sources.
    if (scope === "document") {
      throw new RetrievalDeniedError(
        "Document scope requires explicit document ids",
        "scope_requires_restriction",
      );
    }
    return undefined;
  }
  if (frozen.documentIds.length === 0) {
    throw new RetrievalDeniedError(
      "restricted retrieval set is empty; refusing to widen",
      "empty_restricted_set",
    );
  }
  return {
    documentIds: [...frozen.documentIds],
    ...(frozen.sourceTypes?.length ? { sourceTypes: [...frozen.sourceTypes] } : {}),
  };
}

/** Re-check at the retrieval boundary; never let restrictions vanish. */
export function assertFrozenFilters(
  scope: AssistantScope,
  frozen: FrozenSourceSet,
  filters: RetrievalFiltersLike | undefined,
): void {
  if (scope === "chat") return;
  if (frozen.kind === "library") {
    if (scope === "document" && !filters?.documentIds?.length) {
      throw new RetrievalDeniedError(
        "Document retrieval lost its document restriction",
        "filters_dropped",
      );
    }
    return;
  }
  const expected = [...frozen.documentIds].sort();
  const actual = [...(filters?.documentIds ?? [])].sort();
  const same =
    expected.length === actual.length && expected.every((id, index) => id === actual[index]);
  if (!same) {
    throw new RetrievalDeniedError(
      "retrieval filters do not match the frozen authorized set",
      "filters_dropped",
    );
  }
}

/**
 * Convenience for the sidebar/panel adapter: derive the frozen set from the
 * effective scope and the ids the surface actually holds. Returns `null` when
 * nothing restricts or identifies the scope, in which case the caller must
 * NOT retrieve.
 */
export function frozenSetForScope(
  scope: AssistantScope,
  options: { documentId?: string; selectionDocumentId?: string; collectionDocumentIds?: string[] },
): FrozenSourceSet | null {
  if (scope === "library") {
    if (options.collectionDocumentIds) {
      return { kind: "collection", documentIds: options.collectionDocumentIds };
    }
    return { kind: "library" };
  }
  if (scope === "document") {
    const ids = [
      ...new Set(
        [options.selectionDocumentId, options.documentId].filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      ),
    ];
    if (!ids.length) return null;
    return { kind: "documents", documentIds: ids };
  }
  return null;
}
