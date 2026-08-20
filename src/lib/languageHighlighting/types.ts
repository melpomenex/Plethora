import type { LanguageKnowledgeState } from "../../types/languageKnowledge";

/** The density setting is intentionally independent from ordinary reader highlights. */
export type VocabularyAnnotationMode = "off" | "minimal" | "full";
export type LanguageHighlightTheme = "light" | "dark" | "high-contrast" | "e-ink";
export type ReaderSurface =
  | "plain-text"
  | "epub"
  | "pdf-reflow"
  | "pdf-fixed"
  | "html"
  | "markdown"
  | "queue"
  | "transcript";

export type AnchorConfidence = "exact" | "high" | "medium" | "low" | "ambiguous" | "unsupported";
export type LanguageHighlightVersion = number;

export interface VisibleRange {
  /** Logical source offsets. `end` is exclusive. */
  start: number;
  end: number;
}

export interface AnnotationVersions {
  profileId: string;
  analysisVersion: LanguageHighlightVersion;
  lexicalStateVersion: LanguageHighlightVersion;
}

interface BaseAnchor {
  sourceId: string;
  confidence: AnchorConfidence;
  confidenceScore: number;
}

export interface TextRangeAnchor extends BaseAnchor {
  kind: "text-range";
  start: number;
  end: number;
}

export interface DomTextAnchor extends BaseAnchor {
  kind: "dom-text";
  node: Text;
  startOffset: number;
  endOffset: number;
}

export interface EpubTextAnchor extends BaseAnchor {
  kind: "epub-text";
  sectionId: string;
  node: Text;
  startOffset: number;
  endOffset: number;
}

export interface PdfReflowAnchor extends BaseAnchor {
  kind: "pdf-reflow-range";
  pageNumber: number;
  blockId: string;
  start: number;
  end: number;
}

export interface PdfCanonicalWordAnchor extends BaseAnchor {
  kind: "pdf-canonical-word";
  pageNumber: number;
  wordId: string;
  source: "native-pdf-text" | "ocr" | "graphical";
  bboxExact: boolean;
}

export interface QueueItemAnchor extends BaseAnchor {
  kind: "queue-item";
  itemId: string;
  start: number;
  end: number;
}

export interface TranscriptSegmentAnchor extends BaseAnchor {
  kind: "transcript-segment";
  segmentId: string;
  startMs: number;
  endMs: number;
  start: number;
  end: number;
}

export type LanguageHighlightAnchor =
  | TextRangeAnchor
  | DomTextAnchor
  | EpubTextAnchor
  | PdfReflowAnchor
  | PdfCanonicalWordAnchor
  | QueueItemAnchor
  | TranscriptSegmentAnchor;

/** An adapter's source anchor before language analysis resolves a lexical entry. */
export interface ReaderTokenAnchor {
  id: string;
  sourceId: string;
  surface: string;
  range: VisibleRange;
  anchor: LanguageHighlightAnchor;
}

/** A token after the processing layer has associated it with a profile entry. */
export interface LanguageReaderToken {
  id: string;
  profileId: string;
  lexicalEntryId: string;
  surface: string;
  normalized: string;
  sourceId: string;
  range: VisibleRange;
  anchor: LanguageHighlightAnchor;
  analysisVersion: LanguageHighlightVersion;
  analysisAvailable: boolean;
}

export type VocabularyVisualCue = "none" | "dotted" | "dashed" | "solid" | "wavy" | "double";
export type VocabularyVisualTreatment = "none" | "underline" | "background" | "muted";

export interface KnowledgeStateSummary {
  state: LanguageKnowledgeState;
  label: string;
  description: string;
  isKnown: boolean;
  isIgnored: boolean;
  defaultTreatment: VocabularyVisualTreatment;
  defaultCue: VocabularyVisualCue;
}

export interface LanguageHighlightSettings {
  profileId: string;
  mode: VocabularyAnnotationMode;
  theme: LanguageHighlightTheme;
  highContrast: boolean;
  reducedMotion: boolean;
  eInk: boolean;
  /** False by default so normal screen-reader reading is not noisy. */
  announceState: boolean;
}

export interface VocabularyAnnotation {
  tokenId: string;
  profileId: string;
  lexicalEntryId: string;
  surface: string;
  range: VisibleRange;
  anchor: LanguageHighlightAnchor;
  summary: KnowledgeStateSummary;
  treatment: VocabularyVisualTreatment;
  cue: VocabularyVisualCue;
  className: string;
  dataAttributes: {
    state: LanguageKnowledgeState;
    lexicalEntryId: string;
  };
  ariaLabel?: string;
}
