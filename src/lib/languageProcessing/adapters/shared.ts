import {
  contentFingerprint,
  createAnalysisVersion,
  digestText128,
} from "../fingerprints";
import {
  confidence,
  isLexicalToken,
  scriptMetadata,
  sentenceSegments,
  type TextSegment,
} from "../unicode";
import type {
  AnalysisChunk,
  AnalysisRequest,
  CapabilityDeclaration,
  LanguageProcessingAdapter,
  LanguageProcessingCapability,
  LanguageProcessingCapabilityManifest,
  LanguageTag,
  Morphology,
  PhraseCandidate,
  ScriptMetadata,
  TokenKind,
} from "../types";
import { canonicalizeLanguageTag, LanguageProcessingError } from "../types";

export interface PackLexiconEntry {
  lemma?: string;
  pos?: string;
  reading?: string;
  transliteration?: string;
  morphology?: Readonly<Record<string, string>>;
  compoundParts?: readonly string[];
  confidence?: number;
}

export interface PackSegment {
  start: number;
  end: number;
  surface: string;
  isWordLike?: boolean;
}

export interface LanguageAdapterPackResolver {
  lookupToken?(
    surface: string,
    normalized: string,
    languageTag: string,
  ): PackLexiconEntry | null | undefined | Promise<PackLexiconEntry | null | undefined>;
  segmentText?(
    text: string,
    languageTag: string,
  ): readonly PackSegment[] | null | undefined | Promise<readonly PackSegment[] | null | undefined>;
}

let activePackResolver: LanguageAdapterPackResolver | null = null;

/**
 * Registers an optional runtime resolver (e.g. backed by Wave 1B-2 SQLite packs)
 * so local adapters can enhance lemmas, readings, compounds, and segmentation
 * without coupling `languageProcessing` statically to Tauri.
 */
export function setLanguageAdapterPackResolver(resolver: LanguageAdapterPackResolver | null): void {
  activePackResolver = resolver;
}

export function getLanguageAdapterPackResolver(): LanguageAdapterPackResolver | null {
  return activePackResolver;
}

export async function resolvePackEntry(
  surface: string,
  normalized: string,
  languageTag: string,
): Promise<PackLexiconEntry | null> {
  if (!activePackResolver?.lookupToken) return null;
  const entry = await activePackResolver.lookupToken(surface, normalized, languageTag);
  return entry ?? null;
}

export async function resolvePackSegments(
  text: string,
  languageTag: string,
): Promise<TextSegment[] | null> {
  if (!activePackResolver?.segmentText) return null;
  const segments = await activePackResolver.segmentText(text, languageTag);
  if (!segments || segments.length === 0) return null;

  const validated: TextSegment[] = [];
  let cursor = 0;
  for (const part of segments) {
    if (
      part.start < cursor ||
      part.end < part.start ||
      part.end > text.length ||
      text.slice(part.start, part.end) !== part.surface
    ) {
      return null;
    }
    cursor = part.end;
    if (!/^\s+$/u.test(part.surface)) {
      validated.push({
        start: part.start,
        end: part.end,
        segment: part.surface,
        isWordLike: part.isWordLike ?? /[\p{L}\p{M}\p{N}]/u.test(part.surface),
      });
    }
  }
  return validated;
}

export function throwIfAborted(signal: AbortSignal | undefined, adapterId: string): void {
  if (signal?.aborted) {
    throw new LanguageProcessingError("cancelled", "Language analysis was cancelled", {
      retryable: false,
      providerId: adapterId,
    });
  }
}

export function resolveCanonicalLanguage(request: AnalysisRequest, adapterId: string): LanguageTag {
  const languageTag = canonicalizeLanguageTag(String(request.languageTag));
  if (!languageTag) {
    throw new LanguageProcessingError("unsupported-language", `Invalid language tag: ${String(request.languageTag)}`, {
      providerId: adapterId,
      languageTag: String(request.languageTag),
    });
  }
  return languageTag;
}

export function baseLanguageCode(languageTag: LanguageTag | string): string {
  return String(languageTag).trim().toLowerCase().split("-")[0] ?? "";
}

const ALL_CAPABILITIES: readonly LanguageProcessingCapability[] = [
  "detect",
  "sentenceSegment",
  "tokenize",
  "normalize",
  "lemma",
  "pos",
  "morphology",
  "phraseCandidates",
  "transliteration",
  "script",
];

export function createCapabilityDeclarations(
  supportedScores: Partial<Record<LanguageProcessingCapability, number | null>>,
  offline = true,
): Readonly<Record<LanguageProcessingCapability, CapabilityDeclaration>> {
  return Object.fromEntries(
    ALL_CAPABILITIES.map((capability) => {
      const hasScore = Object.prototype.hasOwnProperty.call(supportedScores, capability);
      const score = hasScore ? (supportedScores[capability] ?? null) : null;
      return [
        capability,
        {
          supported: hasScore,
          confidence: confidence(hasScore ? score : null),
          offline,
        },
      ];
    }),
  ) as Readonly<Record<LanguageProcessingCapability, CapabilityDeclaration>>;
}

export function buildLocalManifest(options: {
  adapterId: string;
  adapterVersion: string;
  supportedLanguageTags: readonly string[];
  capabilities: Readonly<Record<LanguageProcessingCapability, CapabilityDeclaration>>;
  privacyDisclosure: string;
  maxChunkCodeUnits?: number;
}): LanguageProcessingCapabilityManifest {
  return {
    adapterId: options.adapterId,
    adapterVersion: options.adapterVersion,
    kind: "local",
    supportedLanguageTags: options.supportedLanguageTags,
    capabilities: options.capabilities,
    requiresCredentials: false,
    sendsTextOffDevice: false,
    maxChunkCodeUnits: options.maxChunkCodeUnits,
    privacyDisclosure: options.privacyDisclosure,
  };
}

export function supportsAdapterRequest(
  manifest: LanguageProcessingCapabilityManifest,
  languageTag: LanguageTag | string,
  capabilities?: readonly LanguageProcessingCapability[],
): boolean {
  const canonical = canonicalizeLanguageTag(String(languageTag));
  if (!canonical) return false;
  const lower = canonical.toLowerCase();
  const languageSupported = manifest.supportedLanguageTags.some(
    (supported) =>
      supported === "*" ||
      supported.toLowerCase() === lower ||
      lower.startsWith(`${supported.toLowerCase()}-`),
  );
  if (!languageSupported) return false;
  if (!capabilities || capabilities.length === 0) return true;
  return capabilities.every((capability) => manifest.capabilities[capability]?.supported === true);
}

const SENTENCE_TERMINATOR_RE = /[.!?。！？؟]/u;
const SENTENCE_TRAILER_RE = /[\s»”’"')\]」』】〉》]/u;

function splitSegmentOnMultilingualTerminators(text: string, baseStart: number): TextSegment[] {
  const output: TextSegment[] = [];
  let start = 0;
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    const width = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    const char = text.slice(index, index + width);
    index += width;
    if (SENTENCE_TERMINATOR_RE.test(char) || char === "\n") {
      while (index < text.length) {
        const nextCp = text.codePointAt(index);
        const nextWidth = nextCp !== undefined && nextCp > 0xffff ? 2 : 1;
        const nextChar = text.slice(index, index + nextWidth);
        if (!SENTENCE_TRAILER_RE.test(nextChar)) break;
        index += nextWidth;
      }
      const slice = text.slice(start, index);
      if (slice.length > 0) {
        output.push({
          start: baseStart + start,
          end: baseStart + index,
          segment: slice,
          isWordLike: true,
        });
      }
      start = index;
    }
  }
  if (start < text.length) {
    output.push({
      start: baseStart + start,
      end: baseStart + text.length,
      segment: text.slice(start),
      isWordLike: true,
    });
  }
  return output;
}

/**
 * Sentence segmentation that preserves UTF-16 offsets and cleanly splits
 * CJK (`。！？`), Arabic (`؟`), and Latin sentence terminators.
 */
export function segmentSentencesMultilingual(text: string, languageTag: string): TextSegment[] {
  if (!text) return [];
  const baseSegments = sentenceSegments(text, languageTag);
  const refined: TextSegment[] = [];
  for (const part of baseSegments) {
    const splits = splitSegmentOnMultilingualTerminators(part.segment, part.start);
    if (splits.length > 0) {
      refined.push(...splits);
    } else {
      refined.push(part);
    }
  }
  return refined;
}

export function spanId(
  versionKey: string,
  kind: "sentence" | "token" | "phrase",
  start: number,
  end: number,
  surface: string,
): string {
  return `${kind}_${digestText128(`${versionKey}|${kind}|${start}|${end}|${surface}`).slice(0, 24)}`;
}

export interface RawTokenInput {
  start: number;
  end: number;
  surface: string;
  kind: TokenKind;
  normalized: string;
  lemma?: string;
  pos?: string;
  morphology?: Morphology;
  script?: ScriptMetadata;
  confidenceScore: number | null;
  isLexical?: boolean;
}

function sentenceIdForRange(
  start: number,
  end: number,
  sentences: readonly { start: number; end: number; id: string }[],
): string | undefined {
  const exact = sentences.find((sentence) => start >= sentence.start && end <= sentence.end);
  if (exact) return exact.id;
  return sentences.find((sentence) => start < sentence.end && end > sentence.start)?.id;
}

export function buildChunkFromAnalysis(params: {
  adapterId: string;
  adapterVersion: string;
  manifest: LanguageProcessingCapabilityManifest;
  request: AnalysisRequest;
  languageTag: LanguageTag;
  sentenceParts: readonly TextSegment[];
  rawTokens: readonly RawTokenInput[];
  phraseCandidates?: readonly PhraseCandidate[];
}): AnalysisChunk {
  const { adapterId, adapterVersion, manifest, request, languageTag, sentenceParts, rawTokens } = params;
  const sourceOffset = Math.max(0, Math.floor(request.sourceOffset ?? 0));
  const fingerprint = request.contentFingerprint ?? contentFingerprint(request.text);
  const version = createAnalysisVersion({
    contentFingerprint: fingerprint,
    languageTag,
    adapterId,
    adapterVersion,
    providerKind: "local",
    configuration: request.configuration,
  });

  const sentences = sentenceParts.map((part) => ({
    start: part.start,
    end: part.end,
    id: spanId(version.processingKey, "sentence", sourceOffset + part.start, sourceOffset + part.end, part.segment),
  }));

  const sentenceSpans = sentenceParts.map((part, index) => ({
    id: sentences[index].id,
    start: sourceOffset + part.start,
    end: sourceOffset + part.end,
    surface: part.segment,
    sourceAnchor: request.sourceAnchor,
    tokenIds: [] as string[],
    confidence: confidence(manifest.capabilities.sentenceSegment.confidence.score ?? 0.95),
  }));

  const tokens = rawTokens.map((raw) => {
    const start = sourceOffset + raw.start;
    const end = sourceOffset + raw.end;
    const isLexical = raw.isLexical ?? isLexicalToken(raw.kind, raw.surface);
    return {
      id: spanId(version.processingKey, "token", start, end, raw.surface),
      start,
      end,
      surface: raw.surface,
      sourceAnchor: request.sourceAnchor,
      sentenceId: sentenceIdForRange(raw.start, raw.end, sentences),
      kind: raw.kind,
      normalized: raw.normalized,
      lemma: raw.lemma,
      pos: raw.pos,
      morphology: raw.morphology,
      script: raw.script ?? scriptMetadata(raw.surface),
      confidence: confidence(raw.confidenceScore),
      isLexical,
    };
  });

  const tokenIdsBySentence = new Map<string, string[]>();
  for (const token of tokens) {
    if (!token.sentenceId) continue;
    const list = tokenIdsBySentence.get(token.sentenceId) ?? [];
    list.push(token.id);
    tokenIdsBySentence.set(token.sentenceId, list);
  }

  const resolvedSentences = sentenceSpans.map((sentence) => ({
    ...sentence,
    tokenIds: tokenIdsBySentence.get(sentence.id) ?? [],
  }));

  const phraseCandidates = params.phraseCandidates ?? [];

  return {
    chunkIndex: 0,
    sourceStart: sourceOffset,
    sourceEnd: sourceOffset + request.text.length,
    text: request.text,
    sentences: resolvedSentences,
    tokens,
    phraseCandidates,
    version,
    summary: {
      sentenceCount: resolvedSentences.length,
      tokenCount: tokens.length,
      lexicalTokenCount: tokens.filter((token) => token.isLexical).length,
      characterCount: request.text.length,
      capabilities: manifest.capabilities,
    },
  };
}

export function createSimpleAdapter(config: {
  id: string;
  version: string;
  supportedLanguageTags: readonly string[];
  capabilities: Readonly<Record<LanguageProcessingCapability, CapabilityDeclaration>>;
  privacyDisclosure: string;
  analyze: (
    request: AnalysisRequest,
    languageTag: LanguageTag,
    manifest: LanguageProcessingCapabilityManifest,
    signal?: AbortSignal,
  ) => Promise<AnalysisChunk>;
}): LanguageProcessingAdapter {
  const manifest = buildLocalManifest({
    adapterId: config.id,
    adapterVersion: config.version,
    supportedLanguageTags: config.supportedLanguageTags,
    capabilities: config.capabilities,
    privacyDisclosure: config.privacyDisclosure,
  });
  return {
    id: config.id,
    version: config.version,
    kind: "local",
    manifest,
    supports(languageTag, capabilities): boolean {
      return supportsAdapterRequest(manifest, languageTag, capabilities);
    },
    async analyze(request, signal): Promise<AnalysisChunk> {
      throwIfAborted(signal, config.id);
      const languageTag = resolveCanonicalLanguage(request, config.id);
      return config.analyze(request, languageTag, manifest, signal);
    },
  };
}
