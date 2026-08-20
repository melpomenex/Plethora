import { compareAnalysisVersions } from "./fingerprints";
import type {
  AnalysisPage,
  AnalysisVersion,
  LanguageAnalysisResult,
  LanguageProcessingCapability,
  LanguageTag,
  LexiconAnalysisRecord,
  ReaderAnalysisQuery,
  SearchAnalysisQuery,
  SourceAnchor,
  Span,
  TokenSpan,
  TranscriptAnalysisAnchor,
} from "./types";

export interface LanguageProcessingProfileConfig {
  languageTag: LanguageTag | string;
  adapterId?: string;
  requiredCapabilities?: readonly LanguageProcessingCapability[];
  allowCloud: boolean;
  /** Profile consumers can use this to explain why a cloud provider is off. */
  online: boolean;
}

export interface ReaderAnalysisProjection {
  processingKey: string;
  stale: boolean;
  tokens: readonly TokenSpan[];
  sentences: readonly Span[];
}

export interface TranscriptAnalysisRequest {
  languageTag: LanguageTag | string;
  segment: TranscriptAnalysisAnchor;
  text: string;
  contentFingerprint?: string;
}

export function sourceTextForSpan(text: string, span: Span, sourceOffset = 0): string | null {
  const start = span.start - sourceOffset;
  const end = span.end - sourceOffset;
  if (start < 0 || end < start || end > text.length) return null;
  return text.slice(start, end);
}

export function readerQueryForRange(
  processingKey: string,
  sourceStart: number,
  sourceEnd: number,
  sourceAnchor?: SourceAnchor,
): ReaderAnalysisQuery {
  return { processingKey, sourceStart, sourceEnd, sourceAnchor };
}

export function tokensForReaderRange(
  page: AnalysisPage,
  query: ReaderAnalysisQuery,
): readonly TokenSpan[] {
  if (page.processingKey !== query.processingKey) return [];
  return page.tokens.filter((token) => token.end > query.sourceStart && token.start < query.sourceEnd);
}

export function projectReaderAnalysis(
  result: LanguageAnalysisResult,
  currentVersion: AnalysisVersion,
): ReaderAnalysisProjection {
  const stale = compareAnalysisVersions(result.version, currentVersion).status !== "fresh";
  return {
    processingKey: result.version.processingKey,
    stale,
    tokens: result.tokens,
    sentences: result.sentences,
  };
}

export function transcriptRequestForSegment(
  languageTag: LanguageTag | string,
  text: string,
  segment: TranscriptAnalysisAnchor,
  contentFingerprint?: string,
): TranscriptAnalysisRequest {
  return { languageTag, text, segment, contentFingerprint };
}

export function searchQueryForToken(
  processingKey: string,
  query: Pick<SearchAnalysisQuery, "normalized" | "lemma" | "pos">,
): SearchAnalysisQuery {
  return { processingKey, ...query };
}

export function searchTokens(tokens: readonly TokenSpan[], query: SearchAnalysisQuery): readonly TokenSpan[] {
  return tokens.filter((token) => {
    if (query.normalized && token.normalized !== query.normalized) return false;
    if (query.lemma && token.lemma !== query.lemma) return false;
    if (query.pos && token.pos !== query.pos) return false;
    return true;
  }).slice(0, query.limit ?? Number.POSITIVE_INFINITY);
}

export function lexiconRecords(
  result: Pick<LanguageAnalysisResult, "tokens" | "version">,
  languageTag: LanguageTag,
): LexiconAnalysisRecord[] {
  return result.tokens.filter((token) => token.isLexical).map((token) => ({
    tokenId: token.id,
    surface: token.surface,
    normalized: token.normalized,
    lemma: token.lemma,
    languageTag,
    processingKey: result.version.processingKey,
    sourceAnchor: token.sourceAnchor,
  }));
}

export function anchorForText(
  documentId: string,
  contentFingerprint: string,
  sourceType: "text" | "html" | "markdown",
): SourceAnchor {
  return { sourceType, documentId, contentFingerprint };
}

export function anchorForEpub(
  documentId: string,
  cfiRange: string,
  contentFingerprint?: string,
): SourceAnchor {
  return { sourceType: "epub", documentId, contentFingerprint, locator: { cfiRange } };
}

export function anchorForPdf(
  documentId: string,
  page: number,
  canonicalWordStart?: number,
  canonicalWordEnd?: number,
): SourceAnchor {
  return {
    sourceType: "pdf",
    documentId,
    locator: { page, canonicalWordStart: canonicalWordStart ?? null, canonicalWordEnd: canonicalWordEnd ?? null },
  };
}

export function anchorForTranscript(
  documentId: string,
  segmentId: string,
  startMs: number,
  endMs: number,
): SourceAnchor {
  return { sourceType: "transcript", documentId, sourceId: segmentId, locator: { startMs, endMs } };
}
