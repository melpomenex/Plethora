/**
 * Passage scoring contracts (change
 * `complete-reader-extract-worthiness-integration`, task 1.1).
 *
 * One adapter per reader surface supplies *encountered* passages and stable
 * source locators. Screen geometry is deliberately ephemeral: it is projected
 * from the mounted source on demand and never participates in identity.
 *
 * Identity inputs:
 *   normalization version + normalized text + classifier prompt/schema version
 *   + the provider/model revision actually serving the classifier.
 * Anchor identity stays source-specific (PDF page+offsets, EPUB CFI, HTML/
 * Markdown source anchor+quote) so duplicate text at different anchors never
 * collapses into one passage.
 */

import type { ChunkLocation } from "../../../api/ai-learning";

/* ------------------------------------------------------------------------- */
/* Locators                                                                  */
/* ------------------------------------------------------------------------- */

/** Page-normalized rectangle (0..1 of the PDF page box). */
export interface PassageNormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPassageLocator {
  kind: "pdf";
  sourceType: "pdf";
  documentId: string;
  /** 1-based PDF page number. */
  pageNumber: number;
  /** Character offsets into the mounted page text sequence for this revision. */
  startOffset: number;
  endOffset: number;
  /** Exact normalized source quote (bounded). */
  quote: string;
  /** Page-normalized geometry; identity never depends on it. */
  rects: PassageNormalizedRect[];
}

export interface EpubPassageLocator {
  kind: "epub";
  sourceType: "epub";
  documentId: string;
  spineIndex: number;
  spineHref?: string;
  /** EPUB CFI range captured from the rendition content document. */
  cfiRange: string;
  quote: string;
}

export interface RenderedTextPassageLocator {
  kind: "html" | "markdown" | "text";
  sourceType: "html" | "markdown" | "text";
  documentId: string;
  /**
   * Content-derived source anchor (never a generated DOM child index). For
   * rendered sources this is the source character offset when the source is
   * available, otherwise a quote+occurrence digest.
   */
  anchorId: string;
  /** Source character offsets when known, otherwise offsets in the block. */
  startOffset: number;
  endOffset: number;
  quote: string;
}

export interface RssPassageLocator {
  kind: "rss";
  sourceType: "html";
  /** Present only when the article already has a real library document. */
  documentId?: string;
  /** Feed item id — never presented as a library document id. */
  articleId: string;
  /** Article content revision (mode switch creates a new owner revision). */
  articleRevision: string;
  anchorId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
}

export type PassageLocator =
  | PdfPassageLocator
  | EpubPassageLocator
  | RenderedTextPassageLocator
  | RssPassageLocator;

export type PassageLocatorKind = PassageLocator["kind"];

/**
 * Project a passage locator onto the existing navigation payload. Optional
 * fields are populated only where the source really provides them — an
 * unavailable mapping is `undefined`, never a guessed anchor.
 */
export function passageLocatorToChunkLocation(
  locator: PassageLocator,
  fallbackDocumentId?: string
): ChunkLocation {
  const documentId =
    ("documentId" in locator && locator.documentId) || fallbackDocumentId || "";
  switch (locator.kind) {
    case "pdf":
      return {
        sourceType: "pdf",
        documentId,
        ordinal: 0,
        startOffset: locator.startOffset,
        endOffset: locator.endOffset,
        pageNumber: locator.pageNumber,
        pageRects: locator.rects,
      };
    case "epub":
      return {
        sourceType: "epub",
        documentId,
        ordinal: locator.spineIndex,
        startOffset: 0,
        endOffset: 0,
        spineIndex: locator.spineIndex,
        cfiRange: locator.cfiRange,
      };
    case "html":
    case "markdown":
    case "text":
      return {
        sourceType: locator.sourceType,
        documentId,
        ordinal: 0,
        startOffset: locator.startOffset,
        endOffset: locator.endOffset,
        anchorId: locator.anchorId,
      };
    case "rss":
      return {
        sourceType: "html",
        documentId: locator.documentId ?? fallbackDocumentId ?? "",
        ordinal: 0,
        startOffset: locator.startOffset,
        endOffset: locator.endOffset,
        anchorId: locator.anchorId,
      };
  }
}

/* ------------------------------------------------------------------------- */
/* Snapshots                                                                 */
/* ------------------------------------------------------------------------- */

/** Classifier/serving policy that participates in the content digest. */
export interface PassagePolicyIdentity {
  /** Prompt + schema + output-envelope revision. */
  classifierVersion: string;
  /** Actual serving provider/model revision (never inferred from provider kind). */
  servingRevision: string;
  /** Coarse provider class for diagnostics only. */
  providerClass?: string;
  /** Capability/configuration revision for D0 observations. */
  capabilityRevision?: string;
}

/**
 * What an adapter returns for one anchored passage. `contentHash` is computed
 * from the candidate text and the configured policy identity.
 */
export interface PassageSnapshot {
  /** Reader surface / controller owner. */
  ownerToken: string;
  /** Real library document id; absent for ephemeral sources (live RSS). */
  documentId?: string;
  /** Source revision; edits change it, reflow/zoom do not. */
  sourceRevision: string;
  /** Stable within one owner + source revision. */
  passageId: string;
  /** SHA-256 identity (see `identity.ts`). */
  contentHash: string;
  locator: PassageLocator;
  /** Exact passage text (bounded 60–2,400 chars by the adapter). */
  text: string;
}

/** What the adapter knows before policy is resolved. */
export type PassageSnapshotInput = Omit<PassageSnapshot, "contentHash">;

export interface PassageEncounterEnterEvent {
  kind: "enter";
  passageId: string;
}

export interface PassageEncounterExitEvent {
  kind: "exit";
  passageId: string;
}

export type PassageEncounterEvent = PassageEncounterEnterEvent | PassageEncounterExitEvent;

export interface PassageProjectedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Source-specific adapter contract. Implementations must:
 *  - only enumerate mounted/encountered content (no whole-document innerText),
 *  - emit `enter`/`exit` for visibility, never classification,
 *  - return `null` from `projectRects` when the source is detached,
 *  - drop all listeners/elements in `dispose`.
 */
export interface PassageAdapter {
  readonly ownerToken: string;
  /** Called by the controller before snapshots; stores policy for digests. */
  configure(policy: PassagePolicyIdentity): void;
  subscribeEncountered(listener: (event: PassageEncounterEvent) => void): () => void;
  /** Read and return the anchored passage. Text is read off the idle path. */
  snapshot(passageId: string): PassageSnapshot | null;
  /** Current viewport rectangles for the mounted passage, or null. */
  projectRects(passageId: string): PassageProjectedRect[] | null;
  /** Navigate the reader to the passage source. False when unavailable. */
  resolveLocator(locator: PassageLocator): boolean;
  dispose(): void;
}

/* ------------------------------------------------------------------------- */
/* Controller results                                                        */
/* ------------------------------------------------------------------------- */

export interface PassageScoringCounters {
  encounters: number;
  dwelled: number;
  enqueued: number;
  dequeued: number;
  cacheHits: number;
  classifications: number;
  cacheWrites: number;
  skippedDisabled: number;
  skippedHidden: number;
  skippedQueueFull: number;
  skippedVisitQuota: number;
  skippedHourQuota: number;
  skippedRemote: number;
  skippedDismissed: number;
  cancelled: number;
  failures: number;
  queueLength: number;
  inFlight: number;
}

export interface PassageScoringResult {
  passageId: string;
  contentHash: string;
  classification: import("../../../lib/ai/schemas/passageClassification").PassageClassification;
  reason: string;
  fromCache: boolean;
  classifierVersion: string;
  modelRevision: string;
  createdAt?: string;
}

export type PassageScoringStatus =
  | "idle"
  | "disabled"
  | "suspended"
  | "unavailable"
  | "denied-remote"
  | "working";

export interface PassageScoringControllerEvents {
  onResult(result: PassageScoringResult): void;
  onRemove(passageId: string): void;
  onClear(): void;
  onCounters(counters: PassageScoringCounters): void;
  onStatus(status: PassageScoringStatus, reasonKey?: string): void;
}

/* ------------------------------------------------------------------------- */
/* Scheduling constants (documented guardrails, not measured results)        */
/* ------------------------------------------------------------------------- */

export const PASSAGE_DWELL_MS = 1_000;
export const PASSAGE_IDLE_MS = 750;
export const PASSAGE_QUEUE_LIMIT = 8;
export const PASSAGE_VISIT_CLASSIFICATION_LIMIT = 12;
export const PASSAGE_HOUR_CLASSIFICATION_LIMIT = 60;
export const PASSAGE_RECENT_CACHE_LIMIT = 128;
export const PASSAGE_PERSISTENT_CACHE_LIMIT = 10_000;
export const PASSAGE_MIN_TEXT_LENGTH = 60;
export const PASSAGE_MAX_TEXT_LENGTH = 2_400;
export const PASSAGE_COOPERATIVE_SLICE_MS = 4;

/** Strict indicator threshold: exactly 0.75 stays quiet. */
export const PASSAGE_WORTHINESS_THRESHOLD = 0.75;
