/**
 * Pure selectors and builders for the palette home model (revamp-command-palette).
 *
 * Everything here is deterministic and dependency-injected (`translate`, `now`)
 * so it can be unit-tested without stores, React, or clocks. The controller
 * (`CommandCenter`) feeds it bounded snapshots (startup progress + cached
 * document summaries) and enriches at most one resume document afterwards.
 *
 * Honesty rules encoded here:
 * - Progress is normalized to a shared 0–100 range.
 * - Completed (>=100), archived, and dismissed documents are never candidates.
 * - A modification timestamp is labeled "Last updated", never "Last read".
 * - Missing covers/pages/passages stay `null`; nothing is fabricated.
 */

import type { Document } from "../types/document";
import type { StartupProgressItem } from "../types/startup";
import type { PaletteResumeItem, PaletteSuggestion } from "./types";
import type { RecentOpenEntry } from "./recentOpens";

/** Structural subset satisfied by `Document` and `StartupDocumentSummary`. */
export interface PaletteDocumentLike {
  id: string;
  title: string;
  fileType: Document["fileType"];
  collectionId?: string | null;
  isArchived?: boolean;
  isDismissed?: boolean;
  progressPercent?: number | null;
  dateModified?: string | null;
  coverImageUrl?: string | null;
  totalPages?: number | null;
  currentPage?: number | null;
  currentScrollPercent?: number | null;
  currentCfi?: string | null;
  currentViewState?: Document["currentViewState"];
  positionJson?: string | null;
  category?: string | null;
  tags?: string[] | null;
  filePath?: string | null;
  metadata?: {
    subject?: string;
    pageCount?: number;
    description?: string;
  } | null;
}

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** Clamp a progress value into the shared 0–100 range. `null` when unknown. */
export function normalizeProgressPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function isEligibleDocument(doc: PaletteDocumentLike | null | undefined): boolean {
  if (!doc) return false;
  return doc.isArchived !== true && doc.isDismissed !== true;
}

export function isUnfinishedProgress(progressPercent: number | null): boolean {
  return progressPercent !== null && progressPercent > 0 && progressPercent < 100;
}

function isActiveCollectionMember(
  doc: PaletteDocumentLike | undefined,
  activeCollectionId: string | null
): boolean {
  if (!doc) return true; // progress projections are already collection-scoped
  if (!activeCollectionId) return true;
  if (doc.collectionId == null) return true; // legacy rows default to the default collection
  return doc.collectionId === activeCollectionId;
}

function toEpochMs(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ------------------------------------------------------------------------- */
/* Resume candidate                                                           */
/* ------------------------------------------------------------------------- */

export interface ResumeCandidate {
  documentId: string;
  title: string;
  fileType: Document["fileType"];
  progressPercent: number | null;
  dateModifiedMs: number | null;
  source: "active-reader" | "continue-reading" | "progress";
}

export interface SelectResumeInput {
  continueReading: StartupProgressItem[] | null | undefined;
  documents: PaletteDocumentLike[];
  activeCollectionId: string | null;
  /** Document id of the active reader tab, when one is focused. */
  activeReaderDocumentId?: string | null;
}

/**
 * The eligible resume candidate: first the active reader with a persisted
 * position, otherwise the most recently active unfinished progress item in
 * the active collection.
 */
export function selectResumeCandidate(
  input: SelectResumeInput
): ResumeCandidate | null {
  const { continueReading, documents, activeCollectionId } = input;
  // One index for every lookup below: the selector runs per palette open with
  // the full bounded document cache (3,000+ at library scale), so repeated
  // linear `documents.find` scans would be quadratic.
  const docsById = new Map(documents.map((doc) => [doc.id, doc]));

  // 1. Active reader (most specific: the user is *in* this document now).
  if (input.activeReaderDocumentId) {
    const activeDoc = docsById.get(input.activeReaderDocumentId);
    const progress = normalizeProgressPercent(activeDoc?.progressPercent);
    const persistedPosition =
      activeDoc?.currentPage != null ||
      activeDoc?.currentScrollPercent != null ||
      Boolean(activeDoc?.currentCfi) ||
      Boolean(activeDoc?.positionJson) ||
      isUnfinishedProgress(progress);
    if (
      activeDoc &&
      isEligibleDocument(activeDoc) &&
      isActiveCollectionMember(activeDoc, activeCollectionId) &&
      persistedPosition &&
      progress !== 100
    ) {
      return {
        documentId: activeDoc.id,
        title: activeDoc.title,
        fileType: activeDoc.fileType,
        progressPercent: progress,
        dateModifiedMs: toEpochMs(activeDoc.dateModified),
        source: "active-reader",
      };
    }
  }

  // 2. Startup progress projection (bounded, already collection-scoped).
  const progressItems = (continueReading ?? [])
    .map((item) => ({
      item,
      progress: normalizeProgressPercent(item.progress),
      modifiedMs: toEpochMs(item.date_modified),
    }))
    .filter(({ item, progress }) => {
      if (!item.id || !item.title) return false;
      if (!isUnfinishedProgress(progress)) return false;
      const doc = docsById.get(item.id);
      if (doc && !isEligibleDocument(doc)) return false;
      if (doc && !isActiveCollectionMember(doc, activeCollectionId)) return false;
      return true;
    })
    .sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));

  if (progressItems.length > 0) {
    const { item, progress, modifiedMs } = progressItems[0];
    const doc = docsById.get(item.id);
    return {
      documentId: item.id,
      title: item.title,
      fileType: doc?.fileType ?? "other",
      progressPercent: progress,
      dateModifiedMs: modifiedMs,
      source: "continue-reading",
    };
  }

  // 3. Cached documents fallback (e.g. snapshot not hydrated yet).
  const docCandidates = documents
    .map((doc) => ({
      doc,
      progress: normalizeProgressPercent(doc.progressPercent),
      modifiedMs: toEpochMs(doc.dateModified),
    }))
    .filter(
      ({ doc, progress }) =>
        isEligibleDocument(doc) &&
        isActiveCollectionMember(doc, activeCollectionId) &&
        isUnfinishedProgress(progress)
    )
    .sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));

  if (docCandidates.length > 0) {
    const { doc, progress, modifiedMs } = docCandidates[0];
    return {
      documentId: doc.id,
      title: doc.title,
      fileType: doc.fileType,
      progressPercent: progress,
      dateModifiedMs: modifiedMs,
      source: "progress",
    };
  }

  return null;
}

/* ------------------------------------------------------------------------- */
/* Recent candidate                                                           */
/* ------------------------------------------------------------------------- */

export interface RecentCandidate {
  documentId: string;
  title: string | null;
  fileType: Document["fileType"] | null;
  openedAt: number | null;
  source: "opened" | "modified";
}

export interface SelectRecentInput {
  documents: PaletteDocumentLike[];
  activeCollectionId: string | null;
  recentOpens: RecentOpenEntry[];
}

/**
 * Prefer the most recently opened eligible document; fall back to the most
 * recently modified eligible document with a `source` the caller must word
 * honestly.
 */
export function selectRecentCandidate(input: SelectRecentInput): RecentCandidate | null {
  const { documents, activeCollectionId, recentOpens } = input;
  const docsById = new Map(documents.map((doc) => [doc.id, doc]));

  for (const entry of recentOpens) {
    const doc = docsById.get(entry.documentId);
    if (doc) {
      if (!isEligibleDocument(doc)) continue;
      if (!isActiveCollectionMember(doc, activeCollectionId)) continue;
      return {
        documentId: doc.id,
        title: doc.title,
        fileType: doc.fileType,
        openedAt: entry.openedAt,
        source: "opened",
      };
    }
    // Not in the bounded cache: trust the recorded open (collection-keyed).
    return {
      documentId: entry.documentId,
      title: entry.title ?? null,
      fileType: entry.fileType ?? null,
      openedAt: entry.openedAt,
      source: "opened",
    };
  }

  const modified = documents
    .filter(
      (doc) =>
        isEligibleDocument(doc) && isActiveCollectionMember(doc, activeCollectionId)
    )
    .map((doc) => ({ doc, modifiedMs: toEpochMs(doc.dateModified) ?? 0 }))
    .sort((a, b) => b.modifiedMs - a.modifiedMs);

  if (modified.length === 0) return null;
  return {
    documentId: modified[0].doc.id,
    title: modified[0].doc.title,
    fileType: modified[0].doc.fileType,
    openedAt: null,
    source: "modified",
  };
}

/* ------------------------------------------------------------------------- */
/* Formatting (dependency-injected translate + clock)                         */
/* ------------------------------------------------------------------------- */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Relative-time label. Translation keys live under `palette.time.*`. */
export function formatRelativeTime(
  epochMs: number,
  translate: TranslateFn,
  now: number = Date.now()
): string {
  const delta = Math.max(0, now - epochMs);
  if (delta < MINUTE_MS) return translate("palette.time.justNow");
  if (delta < HOUR_MS) {
    return translate("palette.time.minutesAgo", { count: Math.floor(delta / MINUTE_MS) });
  }
  if (delta < DAY_MS) {
    return translate("palette.time.hoursAgo", { count: Math.floor(delta / HOUR_MS) });
  }
  if (delta < 30 * DAY_MS) {
    return translate("palette.time.daysAgo", { count: Math.floor(delta / DAY_MS) });
  }
  return new Date(epochMs).toLocaleDateString();
}

const FILE_TYPE_LABEL_KEYS: Record<string, string> = {
  pdf: "palette.fileType.pdf",
  epub: "palette.fileType.epub",
  markdown: "palette.fileType.markdown",
  html: "palette.fileType.html",
  youtube: "palette.fileType.youtube",
  audio: "palette.fileType.audio",
  video: "palette.fileType.video",
  image: "palette.fileType.image",
  other: "palette.fileType.other",
};

export function formatFileTypeLabel(
  fileType: Document["fileType"] | null | undefined,
  translate: TranslateFn
): string | null {
  if (!fileType) return null;
  return translate(FILE_TYPE_LABEL_KEYS[fileType] ?? "palette.fileType.other");
}

function parseMediaTimeSeconds(
  positionJson: string | null | undefined,
  currentViewState: PaletteDocumentLike["currentViewState"]
): number | null {
  if (typeof currentViewState === "object" && currentViewState !== null) {
    const value = currentViewState as unknown as { currentTime?: unknown; timeSeconds?: unknown };
    for (const candidate of [value.currentTime, value.timeSeconds]) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    }
  }
  if (typeof positionJson === "string" && positionJson) {
    try {
      const parsed = JSON.parse(positionJson) as Record<string, unknown>;
      for (const key of ["currentTime", "timeSeconds", "position", "seconds"]) {
        const candidate = parsed[key];
        if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function formatClockSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Persisted location label ("Page 137", "42%", "12:08"). Never derived from a
 * percentage when a real page/CFI/time exists, and never invented.
 */
export function formatResumeLocation(
  doc: PaletteDocumentLike,
  translate: TranslateFn
): string | null {
  const fileType = doc.fileType;
  if (fileType === "pdf" || fileType === "epub") {
    if (typeof doc.currentPage === "number" && doc.currentPage > 0) {
      return translate("palette.locationPage", { page: Math.round(doc.currentPage) });
    }
    const percent = normalizeProgressPercent(doc.currentScrollPercent);
    if (percent !== null) return `${Math.round(percent)}%`;
    return null;
  }
  if (fileType === "youtube" || fileType === "audio" || fileType === "video") {
    const seconds = parseMediaTimeSeconds(doc.positionJson, doc.currentViewState);
    if (seconds !== null) return formatClockSeconds(seconds);
    return null;
  }
  const percent = normalizeProgressPercent(doc.currentScrollPercent);
  if (percent !== null) return `${Math.round(percent)}%`;
  return null;
}

export interface BuildResumeItemOptions {
  candidate: ResumeCandidate;
  document: PaletteDocumentLike;
  translate: TranslateFn;
  now?: number;
  /** Saved passage for the persisted location, when actually available. */
  passage?: string | null;
}

/**
 * Build the display item for the *chosen* resume document. The controller
 * enriches the document first; nothing beyond supported facts is displayed.
 */
export function buildResumeItem(options: BuildResumeItemOptions): PaletteResumeItem {
  const { candidate, document: doc, translate } = options;
  const now = options.now ?? Date.now();
  const progress =
    normalizeProgressPercent(candidate.progressPercent) ??
    normalizeProgressPercent(doc.progressPercent);
  const modifiedMs = candidate.dateModifiedMs;

  return {
    documentId: doc.id,
    title: doc.title,
    fileType: doc.fileType,
    progressPercent: progress,
    coverUrl: doc.coverImageUrl ?? null,
    pageCount:
      (typeof doc.totalPages === "number" && doc.totalPages > 0 ? doc.totalPages : null) ??
      (typeof doc.metadata?.pageCount === "number" && (doc.metadata.pageCount as number) > 0
        ? (doc.metadata.pageCount as number)
        : null),
    formatLabel: formatFileTypeLabel(doc.fileType, translate),
    locationLabel: formatResumeLocation(doc, translate),
    timestampLabel: modifiedMs !== null ? formatRelativeTime(modifiedMs, translate, now) : null,
    // No genuine per-document reading timestamp is persisted today, so a
    // modification time is never presented as reading activity.
    timestampKind: modifiedMs !== null ? "modified" : null,
    timestampLeadKey: modifiedMs !== null ? "lastUpdated" : null,
    passage: options.passage ?? null,
    sourceUrl:
      typeof doc.filePath === "string" && /^https?:\/\//i.test(doc.filePath)
        ? doc.filePath
        : null,
  };
}

/* ------------------------------------------------------------------------- */
/* Suggestions                                                                */
/* ------------------------------------------------------------------------- */

export const SUGGESTION_IDS = {
  themes: "suggestion.themes",
  summary: "suggestion.summary",
  related: "suggestion.related",
  review: "suggestion.review",
} as const;

export interface DeriveSuggestionsInput {
  resume: PaletteResumeItem | null;
  /** Topic derived from eligible user data (tag/subject/category), if any. */
  topic: string | null;
  translate: TranslateFn;
}

/** The four Ask Plethora suggestions, in reference order. */
export function deriveSuggestions(input: DeriveSuggestionsInput): PaletteSuggestion[] {
  const { resume, topic, translate } = input;

  return [
    {
      id: SUGGESTION_IDS.themes,
      role: "themes",
      label: translate("palette.suggest.themes"),
      icon: "sparkle",
      personalized: false,
    },
    {
      id: SUGGESTION_IDS.summary,
      role: "summary",
      label: resume
        ? translate("palette.suggest.summaryDoc", { title: resume.title })
        : translate("palette.suggest.summaryGeneric"),
      icon: "fileText",
      ...(resume ? { documentId: resume.documentId } : {}),
      personalized: Boolean(resume),
    },
    {
      id: SUGGESTION_IDS.related,
      role: "related",
      label: topic
        ? translate("palette.suggest.relatedTopic", { topic })
        : translate("palette.suggest.relatedGeneric"),
      icon: "magnifyingGlass",
      query: topic ?? resume?.title ?? "",
      personalized: Boolean(topic),
    },
    {
      id: SUGGESTION_IDS.review,
      role: "review",
      label: translate("palette.suggest.review"),
      icon: "cards",
      personalized: false,
    },
  ];
}

/** Topic for related-document suggestions, derived from real metadata only. */
export function deriveResumeTopic(doc: PaletteDocumentLike | null): string | null {
  if (!doc) return null;
  const tag = doc.tags?.find((value) => value.trim().length > 0);
  if (tag) return tag;
  if (doc.category && doc.category.trim().length > 0) return doc.category;
  if (doc.metadata?.subject && doc.metadata.subject.trim().length > 0) {
    return doc.metadata.subject;
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Expanded examples                                                          */
/* ------------------------------------------------------------------------- */

export const EXAMPLE_IDS = {
  themesDeep: "example.themesDeep",
  summaryRecent: "example.summaryRecent",
  relatedRecent: "example.relatedRecent",
  reviewFocus: "example.reviewFocus",
  connections: "example.connections",
  gaps: "example.gaps",
} as const;

/**
 * Bounded extra example prompts for See examples. They are honest generic
 * library questions (no fabricated titles/topics) and each routes through the
 * same real outcomes as the primary suggestions: library questions to the
 * grounded composer, the related example to Documents search, and the review
 * example to the review/deck overview.
 */
export function deriveExpandedExamples(translate: TranslateFn): PaletteSuggestion[] {
  return [
    {
      id: EXAMPLE_IDS.themesDeep,
      role: "themes",
      label: translate("palette.example.themesDeep"),
      icon: "sparkle",
      personalized: false,
    },
    {
      id: EXAMPLE_IDS.summaryRecent,
      role: "summary",
      label: translate("palette.example.summaryRecent"),
      icon: "fileText",
      personalized: false,
    },
    {
      id: EXAMPLE_IDS.relatedRecent,
      role: "related",
      label: translate("palette.example.relatedRecent"),
      icon: "magnifyingGlass",
      query: translate("palette.example.relatedRecentQuery"),
      personalized: false,
    },
    {
      id: EXAMPLE_IDS.reviewFocus,
      role: "review",
      label: translate("palette.example.reviewFocus"),
      icon: "cards",
      personalized: false,
    },
    {
      id: EXAMPLE_IDS.connections,
      role: "themes",
      label: translate("palette.example.connections"),
      icon: "sparkle",
      personalized: false,
    },
    {
      id: EXAMPLE_IDS.gaps,
      role: "related",
      label: translate("palette.example.gaps"),
      icon: "magnifyingGlass",
      query: translate("palette.example.gapsQuery"),
      personalized: false,
    },
  ];
}
