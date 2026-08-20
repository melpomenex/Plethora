/**
 * Provider-independent language processing contracts.
 *
 * This module is deliberately framework-free. Readers, transcripts, search,
 * and the lexicon consume these records; they do not know which adapter
 * produced them. Offsets use JavaScript/DOM UTF-16 code units so a stored span
 * can always recover the exact source substring with `text.slice(start, end)`.
 */

export const LANGUAGE_PROCESSING_CONTRACT_VERSION = "1.0.0" as const;
export const LANGUAGE_PROCESSING_SCHEMA_VERSION = 1 as const;

export type LanguageTag = string & { readonly __brand: "LanguageTag" };

/** Canonicalize and validate a BCP-47-compatible tag without coupling it to a profile. */
export function canonicalizeLanguageTag(value: string): LanguageTag | null {
  const raw = value.trim();
  if (!raw || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(raw)) return null;
  try {
    const LocaleCtor = (Intl as unknown as { Locale?: new (tag: string) => { toString(): string } }).Locale;
    if (LocaleCtor) return new LocaleCtor(raw).toString() as LanguageTag;
  } catch {
    return null;
  }
  return raw.replace(/^[A-Za-z]+/, (part) => part.toLowerCase()) as LanguageTag;
}

export type LanguageProcessingCapability =
  | "detect"
  | "sentenceSegment"
  | "tokenize"
  | "normalize"
  | "lemma"
  | "pos"
  | "morphology"
  | "phraseCandidates"
  | "transliteration"
  | "script";

export type AdapterKind = "local" | "bundled" | "cloud" | "exact-form";

export type ConfidenceLabel = "high" | "medium" | "low" | "unknown";

export interface Confidence {
  /** A value in [0, 1]. `null` is used when a provider cannot assess confidence. */
  score: number | null;
  label: ConfidenceLabel;
}

export interface CapabilityDeclaration {
  supported: boolean;
  confidence: Confidence;
  /** True when a capability can be used without network access or credentials. */
  offline: boolean;
}

export interface LanguageProcessingCapabilityManifest {
  adapterId: string;
  adapterVersion: string;
  kind: AdapterKind;
  supportedLanguageTags: readonly string[];
  capabilities: Readonly<Record<LanguageProcessingCapability, CapabilityDeclaration>>;
  requiresCredentials: boolean;
  sendsTextOffDevice: boolean;
  maxChunkCodeUnits?: number;
  /** Human-readable provider disclosure suitable for diagnostics/settings. */
  privacyDisclosure: string;
}

export type ProviderErrorCode =
  | "unsupported-language"
  | "unsupported-capability"
  | "offline"
  | "credentials-required"
  | "rate-limited"
  | "network"
  | "invalid-response"
  | "cancelled"
  | "storage"
  | "unknown";

export class LanguageProcessingError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly providerId?: string;
  readonly languageTag?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      providerId?: string;
      languageTag?: string;
      details?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    super(message);
    this.name = "LanguageProcessingError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerId = options.providerId;
    this.languageTag = options.languageTag;
    this.details = options.details;
  }
}

export type ScriptName =
  | "arabic"
  | "armenian"
  | "bengali"
  | "cyrillic"
  | "devanagari"
  | "georgian"
  | "greek"
  | "hebrew"
  | "han"
  | "hangul"
  | "hiragana"
  | "katakana"
  | "latin"
  | "thai"
  | "other"
  | "mixed"
  | "unknown";

export type TextDirection = "ltr" | "rtl" | "mixed" | "unknown";

export interface ScriptMetadata {
  script: ScriptName;
  direction: TextDirection;
  /** The scripts observed when `script` is `mixed`, in stable order. */
  scripts?: readonly ScriptName[];
}

export type TokenKind = "word" | "number" | "punctuation" | "symbol" | "other";

export interface Morphology {
  /** Provider-defined feature names, e.g. `tense=gerund`. */
  features: Readonly<Record<string, string>>;
  isPartial?: boolean;
}

export interface SourceAnchor {
  /** Stable source identity understood by a reader-specific resolver. */
  sourceType: "epub" | "pdf" | "text" | "html" | "markdown" | "transcript" | "media";
  documentId?: string;
  sourceId?: string;
  contentFingerprint?: string;
  /** Existing CFI/canonical/page/text/timestamp information is kept opaque. */
  locator?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface Span {
  id: string;
  /** UTF-16 source offset, inclusive. */
  start: number;
  /** UTF-16 source offset, exclusive. */
  end: number;
  surface: string;
  sourceAnchor?: SourceAnchor;
}

export interface SentenceSpan extends Span {
  tokenIds: readonly string[];
  confidence: Confidence;
}

export interface TokenSpan extends Span {
  sentenceId?: string;
  kind: TokenKind;
  normalized: string;
  lemma?: string;
  pos?: string;
  morphology?: Morphology;
  script: ScriptMetadata;
  confidence: Confidence;
  /** False for punctuation/whitespace-like tokens that are not lexical items. */
  isLexical: boolean;
}

export interface PhraseCandidate extends Span {
  tokenIds: readonly string[];
  normalized: string;
  confidence: Confidence;
}

export interface AnalysisRequest {
  text: string;
  languageTag: LanguageTag | string;
  /** UTF-16 offset of `text` within the canonical source. */
  sourceOffset?: number;
  sourceAnchor?: SourceAnchor;
  contentFingerprint?: string;
  configuration?: Readonly<Record<string, unknown>>;
  requestedCapabilities?: readonly LanguageProcessingCapability[];
}

export interface AnalysisRequestOptions {
  /** A stable job identity is useful when a caller cancels and later resumes. */
  jobId?: string;
  /** Maximum UTF-16 code units submitted to one adapter invocation. */
  chunkCodeUnits?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface AnalysisVersion {
  contractVersion: string;
  schemaVersion: number;
  adapterId: string;
  adapterVersion: string;
  providerKind: AdapterKind;
  languageTag: LanguageTag;
  contentFingerprint: string;
  configurationFingerprint: string;
  processingKey: string;
}

export interface AnalysisSummary {
  sentenceCount: number;
  tokenCount: number;
  lexicalTokenCount: number;
  characterCount: number;
  capabilities: Readonly<Record<LanguageProcessingCapability, CapabilityDeclaration>>;
}

export interface AnalysisChunk {
  chunkIndex: number;
  sourceStart: number;
  sourceEnd: number;
  text: string;
  sentences: readonly SentenceSpan[];
  tokens: readonly TokenSpan[];
  phraseCandidates: readonly PhraseCandidate[];
  version: AnalysisVersion;
  summary: AnalysisSummary;
}

export interface LanguageAnalysisResult extends AnalysisChunk {
  chunks: readonly AnalysisChunk[];
}

export type JobState = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface ProcessingJobCheckpoint {
  jobId: string;
  processingKey: string;
  state: JobState;
  nextChunkIndex: number;
  totalChunks: number;
  completedChunks: number;
  retryCount: number;
  error?: ProviderErrorCode;
  message?: string;
  updatedAt: number;
}

export interface ProcessingProgress {
  jobId: string;
  state: JobState;
  completedChunks: number;
  totalChunks: number;
  completedTokens: number;
  percent: number;
  retryCount: number;
  processingKey: string;
  error?: LanguageProcessingError;
}

export interface AnalysisPage {
  processingKey: string;
  offset: number;
  limit: number;
  total: number;
  tokens: readonly TokenSpan[];
  hasMore: boolean;
  version: AnalysisVersion;
}

export interface StaleAnalysis {
  status: "fresh" | "stale" | "missing";
  reason?: "content" | "language" | "provider" | "adapter-version" | "configuration" | "contract";
  currentKey: string;
  previousKey?: string;
}

export interface LanguageProcessingAdapter {
  readonly id: string;
  readonly version: string;
  readonly kind: AdapterKind;
  readonly manifest: LanguageProcessingCapabilityManifest;
  supports(languageTag: LanguageTag, capabilities?: readonly LanguageProcessingCapability[]): boolean;
  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisChunk>;
}

export interface AdapterContext {
  online: boolean;
  allowCloud: boolean;
  hasCredentials?: (adapter: LanguageProcessingAdapter) => boolean;
}

export interface AdapterSelectionRequest {
  languageTag: LanguageTag | string;
  requiredCapabilities?: readonly LanguageProcessingCapability[];
  allowCloud?: boolean;
  online?: boolean;
}

export interface AdapterSelection {
  adapter: LanguageProcessingAdapter;
  considered: readonly {
    adapterId: string;
    available: boolean;
    reason?: ProviderErrorCode;
  }[];
  fallbackUsed: boolean;
}

export interface ProviderPrivacyPolicy {
  adapterId: string;
  kind: AdapterKind;
  sendsTextOffDevice: boolean;
  requiresCredentials: boolean;
  disclosure: string;
  userActionRequired?: "none" | "configure-credentials" | "enable-cloud" | "go-online";
}

export interface ProviderDiagnostic {
  adapterId: string;
  kind: AdapterKind;
  languageTag: LanguageTag;
  selected: boolean;
  available: boolean;
  offlineAvailable: boolean;
  requiresCredentials: boolean;
  sendsTextOffDevice: boolean;
  capabilities: LanguageProcessingCapabilityManifest["capabilities"];
  privacyDisclosure: string;
  unavailableReason?: ProviderErrorCode;
}

export interface ReaderAnalysisQuery {
  processingKey: string;
  sourceStart: number;
  sourceEnd: number;
  sourceAnchor?: SourceAnchor;
}

export interface TranscriptAnalysisAnchor {
  segmentId: string;
  startMs: number;
  endMs: number;
  sourceAnchor: SourceAnchor;
}

export interface SearchAnalysisQuery {
  processingKey: string;
  normalized?: string;
  lemma?: string;
  pos?: string;
  limit?: number;
}

export interface LexiconAnalysisRecord {
  tokenId: string;
  surface: string;
  normalized: string;
  lemma?: string;
  languageTag: LanguageTag;
  processingKey: string;
  sourceAnchor?: SourceAnchor;
}
