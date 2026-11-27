import type { ExactSearchHitLocation } from "../../../types/searchHit";
import type { SectionNode } from "../../../utils/sectionIndex";
import type { StudyModeScopeKind } from "../../../types/studyMode";

export type StudyScopeOptionId =
  | "selected_passage"
  | "study_plan_assignment"
  | "current_section"
  | "current_chapter"
  | "pdf_page_range"
  | "media_segment"
  | "entire_document";

export interface StudyScopeOption {
  id: StudyScopeOptionId;
  scopeKind: StudyModeScopeKind;
  label: string;
  description: string;
  /** Stable canonical identifier for this scope target (revision-independent). */
  scopeIdentity: string;
  /** Bounded passage text ready for Study Mode AI tasks. */
  passageText: string;
  /** Canonical locator for citation anchoring and jump-to-source. */
  locator: ExactSearchHitLocation | null;
  /** True when the full source exceeded the context budget and was deterministically bounded. */
  isPartialCoverage: boolean;
  /** Total raw characters before bounding (for honest coverage disclosure). */
  totalSourceChars: number;
}

export interface ResolveStudyScopesInput {
  documentId: string;
  documentTitle: string;
  docType: string;
  /** Best available live text for the current viewport (PDF window / OCR / transcript / section). */
  liveContextText?: string | null;
  /** Stored document text (HTML/Markdown/plain text/extracted text). */
  documentContent?: string | null;
  /** Active text selection, if any. */
  selectionText?: string | null;
  /** Current canonical reader locator. */
  currentLocator?: ExactSearchHitLocation | null;
  /** Current PDF page number (1-based) when docType === "pdf". */
  pdfPageNumber?: number | null;
  /** Total PDF pages when docType === "pdf". */
  pdfTotalPages?: number | null;
  /** Outline / TOC / media sections from useDocumentOutlineStore. */
  sections?: SectionNode[];
  /** Current media playback time in seconds (YouTube / video / audio). */
  mediaCurrentTimeSeconds?: number | null;
  /** Active Study Plan context, if launched from a Study Plan or Study Trail. */
  studyPlanContext?: {
    planId: string;
    versionId: string;
    topicId: string;
    segmentId?: string;
    topicTitle?: string;
  } | null;
  /** Maximum characters to include in bounded model context (default 6000). */
  maxContextChars?: number;
}

export interface ResolvedStudyScopes {
  defaultScopeId: StudyScopeOptionId;
  options: StudyScopeOption[];
}

const DEFAULT_MAX_CONTEXT_CHARS = 6000;

/**
 * Strips basic HTML tags if raw HTML slipped into documentContent so AI tasks
 * receive clean readable prose without markup noise.
 */
function normalizeSourceText(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/<(html|body|div|p|article|section|h[1-6]|script|style)\b/i.test(trimmed)) {
    return trimmed
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return trimmed;
}

/**
 * Deterministically bounds text to `maxChars` centered around an optional
 * progress ratio (0..1) so large books/transcripts stay within model context budgets.
 */
export function boundSourcePassage(
  text: string,
  maxChars = DEFAULT_MAX_CONTEXT_CHARS,
  focusRatio = 0,
): { bounded: string; isPartial: boolean; totalChars: number } {
  const clean = normalizeSourceText(text);
  const totalChars = clean.length;
  if (totalChars <= maxChars) {
    return { bounded: clean, isPartial: false, totalChars };
  }

  const clampedRatio = Math.max(0, Math.min(1, focusRatio));
  const half = Math.floor(maxChars / 2);
  let start = Math.floor(clampedRatio * totalChars) - half;
  if (start < 0) start = 0;
  if (start + maxChars > totalChars) start = Math.max(0, totalChars - maxChars);

  // Snap to nearest whitespace boundary when possible
  if (start > 0) {
    const nextSpace = clean.indexOf(" ", start);
    if (nextSpace > start && nextSpace - start < 80) {
      start = nextSpace + 1;
    }
  }
  let end = Math.min(totalChars, start + maxChars);
  if (end < totalChars) {
    const prevSpace = clean.lastIndexOf(" ", end);
    if (prevSpace > start + maxChars - 120) {
      end = prevSpace;
    }
  }

  return {
    bounded: clean.slice(start, end).trim(),
    isPartial: true,
    totalChars,
  };
}

function formatSecondsCompact(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem.toString().padStart(2, "0")}`;
}

function findActiveSection(
  sections: SectionNode[],
  pdfPageNumber?: number | null,
): SectionNode | null {
  if (!sections.length) return null;
  if (typeof pdfPageNumber === "number" && pdfPageNumber > 0) {
    let best: SectionNode | null = null;
    for (const sec of sections) {
      if (typeof sec.page === "number" && sec.page <= pdfPageNumber) {
        best = sec;
      }
    }
    if (best) return best;
  }
  return sections[0] ?? null;
}

/**
 * Resolves the meaningful, source-aware study scopes for the active document,
 * enforcing bounded context budgets and canonical locators.
 */
export function resolveStudyScopes(input: ResolveStudyScopesInput): ResolvedStudyScopes {
  const maxChars = input.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const options: StudyScopeOption[] = [];
  const docType = (input.docType || "text").toLowerCase();
  const normalizedLive = normalizeSourceText(input.liveContextText);
  const normalizedDoc = normalizeSourceText(input.documentContent);
  const primaryText = normalizedLive || normalizedDoc;

  const scrollRatio =
    input.currentLocator &&
    "scrollPercent" in input.currentLocator &&
    typeof input.currentLocator.scrollPercent === "number"
      ? input.currentLocator.scrollPercent > 1
        ? input.currentLocator.scrollPercent / 100
        : input.currentLocator.scrollPercent
      : 0;

  // 1. Selected passage (when text is selected)
  const trimmedSelection = input.selectionText?.trim() ?? "";
  if (trimmedSelection.length >= 6) {
    const selBounded = boundSourcePassage(trimmedSelection, maxChars, 0);
    options.push({
      id: "selected_passage",
      scopeKind: "standalone_selection",
      label: "Selected passage",
      description: `${selBounded.bounded.length} characters selected from the reader`,
      scopeIdentity: "selection",
      passageText: selBounded.bounded,
      locator: input.currentLocator ?? { kind: "text", scrollPercent: scrollRatio * 100, textQuote: selBounded.bounded.slice(0, 120) },
      isPartialCoverage: selBounded.isPartial,
      totalSourceChars: selBounded.totalChars,
    });
  }

  // 2. Study Plan assignment (when launched from a Study Plan / Study Trail)
  if (input.studyPlanContext) {
    const planBounded = boundSourcePassage(primaryText, maxChars, scrollRatio);
    const topicLabel = input.studyPlanContext.topicTitle || input.studyPlanContext.topicId;
    options.push({
      id: "study_plan_assignment",
      scopeKind: input.studyPlanContext.segmentId ? "study_plan_segment" : "study_plan_topic",
      label: `Assigned: ${topicLabel}`,
      description: input.studyPlanContext.segmentId
        ? "Assigned Study Plan segment"
        : "Assigned Study Plan topic",
      scopeIdentity: input.studyPlanContext.segmentId
        ? `plan:${input.studyPlanContext.planId}:seg:${input.studyPlanContext.segmentId}`
        : `plan:${input.studyPlanContext.planId}:topic:${input.studyPlanContext.topicId}`,
      passageText: planBounded.bounded,
      locator: input.currentLocator ?? null,
      isPartialCoverage: planBounded.isPartial,
      totalSourceChars: planBounded.totalChars,
    });
  }

  const sections = input.sections ?? [];
  const activeSection = findActiveSection(sections, input.pdfPageNumber);

  // 3. Format-specific meaningful local scope
  if (docType === "pdf") {
    const page = Math.max(1, input.pdfPageNumber ?? 1);
    const rangeStart = Math.max(1, page - 1);
    const rangeEnd = input.pdfTotalPages ? Math.min(input.pdfTotalPages, page + 1) : page + 1;
    const pdfBounded = boundSourcePassage(normalizedLive || normalizedDoc, maxChars, 0);
    options.push({
      id: "pdf_page_range",
      scopeKind: "standalone_document",
      label:
        rangeStart === rangeEnd
          ? `Page ${page}`
          : `Pages ${rangeStart}–${rangeEnd} (around p. ${page})`,
      description: activeSection?.title
        ? `Section: ${activeSection.title}`
        : "Current PDF page window",
      scopeIdentity: `pdf:p${rangeStart}-${rangeEnd}`,
      passageText: pdfBounded.bounded,
      locator: input.currentLocator ?? { kind: "pdf", pageNumber: page },
      isPartialCoverage: pdfBounded.isPartial,
      totalSourceChars: pdfBounded.totalChars,
    });
  } else if (docType === "youtube" || docType === "video" || docType === "audio") {
    const currentSec = Math.max(0, Math.floor(input.mediaCurrentTimeSeconds ?? 0));
    const windowStart = Math.max(0, currentSec - 90);
    const windowEnd = currentSec + 180;
    const mediaBounded = boundSourcePassage(primaryText, maxChars, 0);
    options.push({
      id: "media_segment",
      scopeKind: "standalone_document",
      label: activeSection?.title
        ? `${activeSection.title} (${formatSecondsCompact(currentSec)})`
        : `Segment around ${formatSecondsCompact(currentSec)}`,
      description: `Transcript window ${formatSecondsCompact(windowStart)}–${formatSecondsCompact(windowEnd)}`,
      scopeIdentity: `media:t${Math.floor(currentSec / 60)}m`,
      passageText: mediaBounded.bounded,
      locator:
        input.currentLocator ?? {
          kind: docType === "youtube" ? "youtube" : docType === "audio" ? "audio" : "video",
          timeSeconds: currentSec,
        },
      isPartialCoverage: mediaBounded.isPartial,
      totalSourceChars: mediaBounded.totalChars,
    });
  } else if (docType === "epub") {
    const epubBounded = boundSourcePassage(primaryText, maxChars, scrollRatio);
    options.push({
      id: "current_chapter",
      scopeKind: "standalone_document",
      label: activeSection?.title ? `Chapter: ${activeSection.title}` : "Current chapter",
      description: "Focused around your current EPUB reading position",
      scopeIdentity: activeSection?.id ? `epub:sec:${activeSection.id}` : `epub:pos:${Math.round(scrollRatio * 20)}`,
      passageText: epubBounded.bounded,
      locator: input.currentLocator ?? { kind: "text", scrollPercent: scrollRatio * 100 },
      isPartialCoverage: epubBounded.isPartial,
      totalSourceChars: epubBounded.totalChars,
    });
  } else if (sections.length > 1 || primaryText.length > maxChars) {
    const secBounded = boundSourcePassage(primaryText, maxChars, scrollRatio);
    options.push({
      id: "current_section",
      scopeKind: "standalone_document",
      label: activeSection?.title ? `Section: ${activeSection.title}` : "Current section",
      description: "Focused around your current reading position",
      scopeIdentity: activeSection?.id ? `sec:${activeSection.id}` : `sec:pos:${Math.round(scrollRatio * 10)}`,
      passageText: secBounded.bounded,
      locator: input.currentLocator ?? { kind: "text", scrollPercent: scrollRatio * 100 },
      isPartialCoverage: secBounded.isPartial,
      totalSourceChars: secBounded.totalChars,
    });
  }

  // 4. Entire document (always available, honestly bounded if large)
  const fullSource = normalizedDoc || normalizedLive;
  const fullBounded = boundSourcePassage(fullSource, maxChars, 0);
  options.push({
    id: "entire_document",
    scopeKind: "standalone_document",
    label: "Entire document",
    description: fullBounded.isPartial
      ? `Representative bounded excerpt (${fullBounded.bounded.length.toLocaleString()} of ${fullBounded.totalChars.toLocaleString()} chars)`
      : `Full document (${fullBounded.totalChars.toLocaleString()} chars)`,
    scopeIdentity: "entire_document",
    passageText: fullBounded.bounded,
    locator: input.currentLocator ?? null,
    isPartialCoverage: fullBounded.isPartial,
    totalSourceChars: fullBounded.totalChars,
  });

  // Determine sensible default based on entry context
  let defaultScopeId: StudyScopeOptionId = "entire_document";
  if (trimmedSelection.length >= 6) {
    defaultScopeId = "selected_passage";
  } else if (input.studyPlanContext) {
    defaultScopeId = "study_plan_assignment";
  } else if (options.some((o) => o.id === "pdf_page_range")) {
    defaultScopeId = "pdf_page_range";
  } else if (options.some((o) => o.id === "media_segment")) {
    defaultScopeId = "media_segment";
  } else if (options.some((o) => o.id === "current_chapter")) {
    defaultScopeId = "current_chapter";
  } else if (options.some((o) => o.id === "current_section")) {
    defaultScopeId = "current_section";
  }

  return { defaultScopeId, options };
}
