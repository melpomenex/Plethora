import {
  contentFingerprint,
  createAnalysisVersion,
  digestText128,
} from "./fingerprints";
import {
  confidence,
  isLexicalToken,
  normalizeForLookup,
  scriptMetadata,
  sentenceSegments,
  tokenKind,
  wordSegments,
} from "./unicode";
import type {
  AnalysisChunk,
  AnalysisRequest,
  CapabilityDeclaration,
  LanguageProcessingAdapter,
  LanguageProcessingCapability,
  LanguageProcessingCapabilityManifest,
  LanguageTag,
} from "./types";
import { canonicalizeLanguageTag, LanguageProcessingError } from "./types";

export const BASELINE_ADAPTER_ID = "intl-baseline";
export const EXACT_FORM_ADAPTER_ID = "exact-form-fallback";
export const BASELINE_ADAPTER_VERSION = "1.0.0";

const CORE_CAPABILITIES: readonly LanguageProcessingCapability[] = [
  "sentenceSegment",
  "tokenize",
  "normalize",
  "script",
];

function declarations(
  supported: ReadonlySet<LanguageProcessingCapability>,
  confidenceScore: number | null,
  offline = true,
): Readonly<Record<LanguageProcessingCapability, CapabilityDeclaration>> {
  const all: LanguageProcessingCapability[] = [
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
  return Object.fromEntries(all.map((capability) => [capability, {
    supported: supported.has(capability),
    confidence: confidence(supported.has(capability) ? confidenceScore : null),
    offline,
  }])) as Readonly<Record<LanguageProcessingCapability, CapabilityDeclaration>>;
}

function manifest(
  adapterId: string,
  kind: "local" | "exact-form",
  supported: ReadonlySet<LanguageProcessingCapability>,
  privacyDisclosure: string,
): LanguageProcessingCapabilityManifest {
  return {
    adapterId,
    adapterVersion: BASELINE_ADAPTER_VERSION,
    kind,
    // "*" means every syntactically valid BCP-47 tag gets conservative
    // segmentation; it does not mean advanced linguistic analysis exists.
    supportedLanguageTags: ["*"],
    capabilities: declarations(supported, kind === "local" ? 0.98 : 0.72),
    requiresCredentials: false,
    sendsTextOffDevice: false,
    privacyDisclosure,
  };
}

function spanId(
  versionKey: string,
  kind: "sentence" | "token",
  start: number,
  end: number,
  surface: string,
): string {
  return `${kind}_${digestText128(`${versionKey}|${kind}|${start}|${end}|${surface}`).slice(0, 24)}`;
}

function canonicalLanguage(request: AnalysisRequest): LanguageTag {
  const languageTag = canonicalizeLanguageTag(String(request.languageTag));
  if (!languageTag) {
    throw new LanguageProcessingError("unsupported-language", `Invalid language tag: ${String(request.languageTag)}`, {
      providerId: BASELINE_ADAPTER_ID,
      languageTag: String(request.languageTag),
    });
  }
  return languageTag;
}

function sentenceForToken(
  tokenStart: number,
  tokenEnd: number,
  sentences: readonly { start: number; end: number; id: string }[],
): string | undefined {
  return sentences.find((sentence) => tokenStart >= sentence.start && tokenEnd <= sentence.end)?.id;
}

function createBaselineAdapter(
  kind: "local" | "exact-form",
): LanguageProcessingAdapter {
  const supported = new Set<LanguageProcessingCapability>(CORE_CAPABILITIES);
  const adapterId = kind === "local" ? BASELINE_ADAPTER_ID : EXACT_FORM_ADAPTER_ID;
  const adapterManifest = manifest(
    adapterId,
    kind,
    supported,
    kind === "local"
      ? "Runs on this device using platform Unicode segmentation. No credentials or text upload are required. Lemmas, POS, morphology, phrase candidates, and transliteration are unavailable."
      : "Conservative exact-form fallback runs entirely on this device. It preserves source spans and scripts but does not infer lemmas, POS, morphology, phrases, or transliteration.",
  );

  return {
    id: adapterId,
    version: BASELINE_ADAPTER_VERSION,
    kind,
    manifest: adapterManifest,
    supports(languageTag, capabilities = CORE_CAPABILITIES): boolean {
      if (!canonicalizeLanguageTag(String(languageTag))) return false;
      return capabilities.every((capability) => supported.has(capability));
    },
    async analyze(request, signal): Promise<AnalysisChunk> {
      if (signal?.aborted) {
        throw new LanguageProcessingError("cancelled", "Language analysis was cancelled", {
          retryable: false,
          providerId: adapterId,
        });
      }
      const languageTag = canonicalLanguage(request);
      const sourceOffset = Math.max(0, Math.floor(request.sourceOffset ?? 0));
      const fingerprint = request.contentFingerprint ?? contentFingerprint(request.text);
      const version = createAnalysisVersion({
        contentFingerprint: fingerprint,
        languageTag,
        adapterId,
        adapterVersion: BASELINE_ADAPTER_VERSION,
        providerKind: kind,
        configuration: request.configuration,
      });

      const sentenceParts = sentenceSegments(request.text, String(languageTag));
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
        confidence: confidence(kind === "local" ? 0.98 : 0.75),
      }));

      const tokenSpans = wordSegments(request.text, String(languageTag)).map((part) => {
        const start = sourceOffset + part.start;
        const end = sourceOffset + part.end;
        const kindValue = tokenKind(part.segment, part.isWordLike);
        return {
          id: spanId(version.processingKey, "token", start, end, part.segment),
          start,
          end,
          surface: part.segment,
          sourceAnchor: request.sourceAnchor,
          sentenceId: sentenceForToken(part.start, part.end, sentences),
          kind: kindValue,
          normalized: normalizeForLookup(part.segment, languageTag),
          script: scriptMetadata(part.segment),
          confidence: confidence(kind === "local" ? 0.98 : 0.72),
          isLexical: isLexicalToken(kindValue, part.segment),
        };
      });

      const tokenIdsBySentence = new Map<string, string[]>();
      for (const token of tokenSpans) {
        if (!token.sentenceId) continue;
        const tokenIds = tokenIdsBySentence.get(token.sentenceId) ?? [];
        tokenIds.push(token.id);
        tokenIdsBySentence.set(token.sentenceId, tokenIds);
      }
      const resolvedSentences = sentenceSpans.map((sentence) => ({
        ...sentence,
        tokenIds: tokenIdsBySentence.get(sentence.id) ?? [],
      }));

      return {
        chunkIndex: 0,
        sourceStart: sourceOffset,
        sourceEnd: sourceOffset + request.text.length,
        text: request.text,
        sentences: resolvedSentences,
        tokens: tokenSpans,
        phraseCandidates: [],
        version,
        summary: {
          sentenceCount: resolvedSentences.length,
          tokenCount: tokenSpans.length,
          lexicalTokenCount: tokenSpans.filter((token) => token.isLexical).length,
          characterCount: request.text.length,
          capabilities: adapterManifest.capabilities,
        },
      };
    },
  };
}

/** Deterministic local adapter based only on platform Unicode segmentation. */
export const baselineAdapter = createBaselineAdapter("local");

/** Safe fallback that retains exact forms and source spans without guessing. */
export const exactFormFallbackAdapter = createBaselineAdapter("exact-form");
