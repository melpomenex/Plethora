import type { ExactSearchHitLocation } from "../../../types/searchHit";
import type { StudyModeScopeKind } from "../../../types/studyMode";

export interface StudyScopeKeyInput {
  scopeKind: StudyModeScopeKind;
  documentId: string;
  /** Canonical target inside the document (e.g. "pdf:p11-13", "epub:sec:ch3", "entire_document"). */
  scopeIdentity?: string | null;
  /** Optional revision tag (omitted by default so stale-artifact detection works across revisions). */
  sourceRevision?: string | null;
  includeRevision?: boolean;
  studyPlanId?: string | null;
  topicId?: string | null;
  segmentId?: string | null;
  selectionText?: string | null;
  locator?: ExactSearchHitLocation | null;
}

/**
 * Deterministic FNV-1a 32-bit hash encoded as base-36 for compact, collision-resistant
 * scope key segments.
 */
export function hashScopeSegment(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Produces a stable, compact locator signature from Plethora's ExactSearchHitLocation
 * so passages, pages, EPUB CFIs, and media timestamps never collide.
 */
export function serializeLocatorSignature(locator?: ExactSearchHitLocation | null): string | null {
  if (!locator) return null;
  switch (locator.kind) {
    case "pdf": {
      const offsetPart =
        typeof locator.textOffsetHint === "number" ? `o${locator.textOffsetHint}` : "";
      return `pdf:p${locator.pageNumber}${offsetPart}`;
    }
    case "epub": {
      const target = locator.cfiRange || locator.cfi;
      return `epub:${hashScopeSegment(target)}`;
    }
    case "youtube":
    case "audio":
    case "video": {
      const sec = Math.max(0, Math.floor(locator.timeSeconds));
      const seg = locator.segmentId ? `:s${hashScopeSegment(locator.segmentId)}` : "";
      return `${locator.kind}:t${sec}${seg}`;
    }
    case "html": {
      if (locator.selector) return `html:${hashScopeSegment(locator.selector)}`;
      if (typeof locator.scrollPercent === "number") {
        return `html:p${Math.round(locator.scrollPercent * 100)}`;
      }
      return locator.textQuote ? `html:q${hashScopeSegment(locator.textQuote)}` : null;
    }
    case "markdown":
    case "text": {
      if (typeof locator.scrollPercent === "number") {
        return `${locator.kind}:p${Math.round(locator.scrollPercent * 100)}`;
      }
      return locator.textQuote ? `${locator.kind}:q${hashScopeSegment(locator.textQuote)}` : null;
    }
    case "image":
      return locator.textQuote ? `image:q${hashScopeSegment(locator.textQuote)}` : "image";
  }
}

/**
 * Computes a collision-free deterministic scope key incorporating scope kind,
 * document/plan/topic/segment identifiers, locator/timestamp, text selection,
 * and document sourceRevision.
 */
export function buildStudyScopeKey(input: StudyScopeKeyInput): string {
  const parts: string[] = [];

  if (input.studyPlanId && input.topicId) {
    parts.push(`plan:${input.studyPlanId}:${input.topicId}`);
    if (input.documentId) {
      parts.push(`doc:${input.documentId}`);
    }
  } else {
    parts.push(`doc:${input.documentId}`);
  }

  if (input.segmentId) {
    parts.push(`seg:${input.segmentId}`);
  }

  const scopeId = input.scopeIdentity?.trim();
  if (scopeId && scopeId.length > 0) {
    parts.push(`scope:${scopeId}`);
  }

  const locatorSig = serializeLocatorSignature(input.locator);
  if (locatorSig && !scopeId) {
    parts.push(`loc:${locatorSig}`);
  }

  const trimmedSelection = input.selectionText?.trim();
  if (trimmedSelection && trimmedSelection.length > 0) {
    parts.push(`sel:${hashScopeSegment(trimmedSelection)}`);
  }

  if (input.includeRevision) {
    const rev = input.sourceRevision?.trim();
    if (rev && rev.length > 0) {
      parts.push(`rev:${rev.length > 16 ? hashScopeSegment(rev) : rev}`);
    }
  }

  return parts.join("|");
}
