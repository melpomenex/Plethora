import { canAnnotateAnchor } from "./annotations";
import type {
  AnnotationVersions,
  LanguageReaderToken,
  VisibleRange,
} from "./types";

export interface AnalysisReplacement {
  profileId: string;
  analysisVersion: number;
  lexicalStateVersion: number;
  tokens: readonly LanguageReaderToken[];
}

export interface StateInvalidation {
  profileId: string;
  lexicalStateVersion: number;
  changedLexicalEntryIds?: readonly string[];
}

export interface InvalidationPlan {
  accepted: boolean;
  stale: boolean;
  reason: "none" | "analysis" | "profile" | "lexical-state";
  versions: AnnotationVersions;
  ranges: VisibleRange[];
}

export interface VisibleTokenQuery {
  profileId: string;
  analysisVersion: number;
  lexicalStateVersion: number;
  visibleRange: VisibleRange;
  enabled: boolean;
}

function normalizeRange(range: VisibleRange): VisibleRange {
  const start = Number.isFinite(range.start) ? Math.max(0, range.start) : 0;
  const end = Number.isFinite(range.end) ? Math.max(start, range.end) : start;
  return { start, end };
}

function mergeRanges(ranges: readonly VisibleRange[]): VisibleRange[] {
  const sorted = ranges
    .map(normalizeRange)
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: VisibleRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function fullRange(tokens: readonly LanguageReaderToken[]): VisibleRange[] {
  if (tokens.length === 0) return [];
  const end = Math.max(...tokens.map((token) => token.range.end));
  return end > 0 ? [{ start: 0, end }] : [];
}

/**
 * A small interval index for reader-owned visible-range decoration. It never
 * mutates source DOM and ignores stale profile, analysis, or state-map writes.
 */
export class VisibleLanguageAnnotationIndex {
  private tokens: LanguageReaderToken[] = [];
  private versions: AnnotationVersions = {
    profileId: "",
    analysisVersion: -1,
    lexicalStateVersion: -1,
  };

  replaceAnalysis(replacement: AnalysisReplacement): InvalidationPlan {
    const profileChanged = replacement.profileId !== this.versions.profileId;
    if (
      !profileChanged &&
      replacement.analysisVersion < this.versions.analysisVersion
    ) {
      return this.plan(false, true, "none", []);
    }
    if (
      !profileChanged &&
      replacement.analysisVersion === this.versions.analysisVersion &&
      replacement.lexicalStateVersion < this.versions.lexicalStateVersion
    ) {
      return this.plan(false, true, "none", []);
    }

    this.tokens = [...replacement.tokens]
      .filter((token) => token.profileId === replacement.profileId)
      .sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end || a.id.localeCompare(b.id));
    this.versions = {
      profileId: replacement.profileId,
      analysisVersion: replacement.analysisVersion,
      lexicalStateVersion: replacement.lexicalStateVersion,
    };
    return this.plan(true, false, profileChanged ? "profile" : "analysis", fullRange(this.tokens));
  }

  invalidateLexicalStates(invalidation: StateInvalidation): InvalidationPlan {
    if (invalidation.profileId !== this.versions.profileId) {
      return this.plan(false, true, "none", []);
    }
    if (invalidation.lexicalStateVersion < this.versions.lexicalStateVersion) {
      return this.plan(false, true, "none", []);
    }
    if (invalidation.lexicalStateVersion === this.versions.lexicalStateVersion) {
      return this.plan(false, false, "none", []);
    }

    const changedIds = invalidation.changedLexicalEntryIds;
    const ranges = changedIds && changedIds.length > 0
      ? mergeRanges(this.tokens
        .filter((token) => changedIds.includes(token.lexicalEntryId))
        .map((token) => token.range))
      : fullRange(this.tokens);
    this.versions = { ...this.versions, lexicalStateVersion: invalidation.lexicalStateVersion };
    return this.plan(true, false, "lexical-state", ranges);
  }

  queryVisible(query: VisibleTokenQuery): LanguageReaderToken[] {
    if (
      !query.enabled ||
      query.profileId !== this.versions.profileId ||
      query.analysisVersion !== this.versions.analysisVersion ||
      query.lexicalStateVersion !== this.versions.lexicalStateVersion
    ) {
      return [];
    }
    const range = normalizeRange(query.visibleRange);
    if (range.end <= range.start || this.tokens.length === 0) return [];

    // Binary search to the first token that might overlap the visible range,
    // then walk only the local interval rather than rescanning the document.
    let low = 0;
    let high = this.tokens.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.tokens[middle].range.end < range.start) low = middle + 1;
      else high = middle;
    }
    const result: LanguageReaderToken[] = [];
    for (let index = low; index < this.tokens.length; index++) {
      const token = this.tokens[index];
      if (token.range.start >= range.end) break;
      if (token.range.end > range.start && canAnnotateAnchor(token.anchor)) result.push(token);
    }
    return result;
  }

  getVersions(): AnnotationVersions {
    return { ...this.versions };
  }

  getTokenCount(): number {
    return this.tokens.length;
  }

  private plan(
    accepted: boolean,
    stale: boolean,
    reason: InvalidationPlan["reason"],
    ranges: VisibleRange[],
  ): InvalidationPlan {
    return { accepted, stale, reason, versions: this.getVersions(), ranges };
  }
}

export { mergeRanges };
