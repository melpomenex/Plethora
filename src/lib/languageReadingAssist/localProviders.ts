import { createDefaultLanguageProcessingRegistry, type LanguageProcessingAdapterRegistry } from "../languageProcessing/registry";
import {
  arabicRtlAdapter,
  chineseAdapter,
  getLanguageAdapterPackResolver,
  japaneseAdapter,
  koreanAdapter,
  romanizeKorean,
  toPinyin,
} from "../languageProcessing/adapters";
import { baseLanguageCode } from "../languageProcessing/adapters/shared";
import { scriptMetadata, wordSegments } from "../languageProcessing/unicode";
import { matchesReadingAssistLanguage } from "./registry";
import type {
  AssistSpan,
  ReadingAssistCapabilities,
  ReadingAssistDirection,
  ReadingAssistProvider,
  ReadingAssistRequest,
  ReadingAssistResult,
} from "./types";

const LOCAL_MAX_CODE_UNITS = 20_000;
const KANJI_RE = /[\u4e00-\u9faf\u3400-\u4dbf々]/u;
const HAN_RE = /\p{Script=Han}/u;
const HANGUL_RE = /[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/u;
const RTL_RE = /[\p{Script=Arabic}\p{Script=Hebrew}\u0590-\u08ff\u200f\ufb1d-\ufdff\ufe70-\ufefc]/u;
const LTR_ALNUM_RE = /[A-Za-z0-9]/u;

function cancelledResult(request: ReadingAssistRequest, capabilities: ReadingAssistCapabilities, direction: ReadingAssistDirection): ReadingAssistResult {
  return {
    sourceId: request.sourceId,
    contentFingerprint: request.contentFingerprint,
    profileId: request.profileId,
    kind: request.kind,
    direction,
    status: "failed",
    providerId: capabilities.providerId,
    providerVersion: capabilities.providerVersion,
    spans: [],
    createdAt: Date.now(),
    error: "cancelled",
  };
}

function readyResult(
  request: ReadingAssistRequest,
  capabilities: ReadingAssistCapabilities,
  spans: readonly AssistSpan[],
  direction: ReadingAssistDirection,
  script?: string,
): ReadingAssistResult {
  return {
    sourceId: request.sourceId,
    contentFingerprint: request.contentFingerprint,
    profileId: request.profileId,
    kind: request.kind,
    direction,
    script,
    status: "ready",
    providerId: capabilities.providerId,
    providerVersion: capabilities.providerVersion,
    spans,
    createdAt: Date.now(),
  };
}

function getProcessingRegistry(): LanguageProcessingAdapterRegistry {
  return createDefaultLanguageProcessingRegistry();
}

async function lookupPackReading(surface: string, normalized: string, languageTag: string) {
  const resolver = getLanguageAdapterPackResolver();
  if (!resolver?.lookupToken) return null;
  const entry = await resolver.lookupToken(surface, normalized, languageTag);
  return entry ?? null;
}

function validSpanBounds(text: string, start: number, end: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length;
}

/** Offline Japanese furigana (ruby) provider backed by japaneseAdapter + local pack dictionaries. */
export function createJapaneseRubyProvider(): ReadingAssistProvider {
  const capabilities: ReadingAssistCapabilities = {
    providerId: "plethora-local-japanese-ruby",
    providerVersion: "1.0.0",
    kinds: ["ruby"],
    languages: ["ja"],
    offline: true,
    maxCodeUnits: LOCAL_MAX_CODE_UNITS,
    preservesSource: true,
  };

  return {
    capabilities,
    async assist(request, signal) {
      const direction = request.direction ?? "ltr";
      if (signal?.aborted) return cancelledResult(request, capabilities, direction);

      const registry = getProcessingRegistry();
      const { adapter } = registry.select({
        languageTag: request.languageTag,
        requiredCapabilities: ["tokenize"],
      });
      const chunk = await (adapter.supports(request.languageTag as never, ["tokenize"])
        ? adapter
        : japaneseAdapter
      ).analyze(
        {
          text: request.text,
          languageTag: request.languageTag,
          contentFingerprint: request.contentFingerprint,
        },
        signal,
      );

      const spans: AssistSpan[] = [];
      for (const token of chunk.tokens) {
        if (signal?.aborted) return cancelledResult(request, capabilities, direction);
        if (token.kind !== "word" || !validSpanBounds(request.text, token.start, token.end)) continue;
        const sourceText = request.text.slice(token.start, token.end);
        if (!KANJI_RE.test(sourceText)) continue;

        const pack = await lookupPackReading(sourceText, token.normalized, request.languageTag);
        const reading = pack?.reading ?? token.morphology?.features?.reading;
        if (!reading || reading === sourceText) continue;

        spans.push({
          id: `${request.sourceId}:${token.start}:${token.end}:${spans.length}`,
          sourceStart: token.start,
          sourceEnd: token.end,
          sourceText,
          renderedText: reading,
          annotation: reading,
          confidence: token.confidence.score ?? undefined,
        });
      }

      return readyResult(request, capabilities, spans, direction, "kanji");
    },
  };
}

/** Offline Chinese Pinyin & Korean Revised Romanization transliteration provider. */
export function createCjkTransliterationProvider(): ReadingAssistProvider {
  const capabilities: ReadingAssistCapabilities = {
    providerId: "plethora-local-cjk-transliteration",
    providerVersion: "1.0.0",
    kinds: ["transliteration"],
    languages: ["zh", "ko"],
    offline: true,
    maxCodeUnits: LOCAL_MAX_CODE_UNITS,
    preservesSource: true,
  };

  return {
    capabilities,
    async assist(request, signal) {
      const direction = request.direction ?? "ltr";
      if (signal?.aborted) return cancelledResult(request, capabilities, direction);

      const base = baseLanguageCode(request.languageTag);
      const registry = getProcessingRegistry();
      const { adapter } = registry.select({
        languageTag: request.languageTag,
        requiredCapabilities: ["tokenize", "transliteration"],
      });
      const targetAdapter = adapter.supports(request.languageTag as never, ["tokenize", "transliteration"])
        ? adapter
        : base === "ko"
          ? koreanAdapter
          : chineseAdapter;

      const chunk = await targetAdapter.analyze(
        {
          text: request.text,
          languageTag: request.languageTag,
          contentFingerprint: request.contentFingerprint,
        },
        signal,
      );

      const spans: AssistSpan[] = [];
      for (const token of chunk.tokens) {
        if (signal?.aborted) return cancelledResult(request, capabilities, direction);
        if (token.kind !== "word" || !validSpanBounds(request.text, token.start, token.end)) continue;
        const sourceText = request.text.slice(token.start, token.end);
        const pack = await lookupPackReading(sourceText, token.normalized, request.languageTag);

        let transliteration: string | undefined;
        if (base === "zh") {
          if (!HAN_RE.test(sourceText) && !pack?.transliteration && !pack?.reading) continue;
          transliteration = pack?.transliteration ?? pack?.reading ?? token.morphology?.features?.pinyin ?? toPinyin(sourceText);
        } else if (base === "ko") {
          if (!HANGUL_RE.test(sourceText) && !pack?.transliteration && !pack?.reading) continue;
          transliteration =
            pack?.transliteration ??
            pack?.reading ??
            token.morphology?.features?.romanization ??
            (/[\uac00-\ud7a3]/u.test(sourceText) ? romanizeKorean(sourceText) : undefined);
        }

        if (!transliteration || transliteration === sourceText) continue;
        spans.push({
          id: `${request.sourceId}:${token.start}:${token.end}:${spans.length}`,
          sourceStart: token.start,
          sourceEnd: token.end,
          sourceText,
          renderedText: transliteration,
          annotation: transliteration,
          confidence: token.confidence.score ?? undefined,
        });
      }

      return readyResult(request, capabilities, spans, direction, base === "ko" ? "hangul" : "han");
    },
  };
}

/** Offline RTL bidi direction and clitic/boundary hint provider for Arabic, Hebrew, Persian, and Urdu. */
export function createRtlBidiProvider(): ReadingAssistProvider {
  const capabilities: ReadingAssistCapabilities = {
    providerId: "plethora-local-rtl-bidi",
    providerVersion: "1.0.0",
    kinds: ["bidi"],
    languages: ["ar", "he", "fa", "ur"],
    offline: true,
    maxCodeUnits: LOCAL_MAX_CODE_UNITS,
    preservesSource: true,
  };

  return {
    capabilities,
    async assist(request, signal) {
      const direction: ReadingAssistDirection = request.direction ?? "rtl";
      if (signal?.aborted) return cancelledResult(request, capabilities, direction);

      const registry = getProcessingRegistry();
      const { adapter } = registry.select({
        languageTag: request.languageTag,
        requiredCapabilities: ["tokenize", "script"],
      });
      const targetAdapter = adapter.supports(request.languageTag as never, ["tokenize", "script"])
        ? adapter
        : arabicRtlAdapter;

      const chunk = await targetAdapter.analyze(
        {
          text: request.text,
          languageTag: request.languageTag,
          contentFingerprint: request.contentFingerprint,
        },
        signal,
      );

      const spans: AssistSpan[] = [];
      let detectedScript: string | undefined;

      for (const token of chunk.tokens) {
        if (signal?.aborted) return cancelledResult(request, capabilities, direction);
        if ((token.kind !== "word" && token.kind !== "number") || !validSpanBounds(request.text, token.start, token.end)) {
          continue;
        }
        const sourceText = request.text.slice(token.start, token.end);
        const tokenScript = token.script ?? scriptMetadata(sourceText);
        if (!detectedScript && tokenScript.script !== "unknown") {
          detectedScript = tokenScript.script;
        }

        const isRtlToken = tokenScript.direction === "rtl" || RTL_RE.test(sourceText);
        const isLtrToken = !isRtlToken && (tokenScript.direction === "ltr" || LTR_ALNUM_RE.test(sourceText));
        const pack = await lookupPackReading(sourceText, token.normalized, request.languageTag);
        const packHint = pack?.transliteration ?? pack?.reading;

        const proclitic = token.morphology?.features?.proclitic;
        const enclitic = token.morphology?.features?.enclitic;
        let annotation: string;
        if (proclitic || enclitic) {
          const stem = token.lemma || token.normalized || sourceText;
          annotation = [
            proclitic ? `${proclitic}+` : null,
            stem,
            enclitic ? `+${enclitic}` : null,
          ]
            .filter(Boolean)
            .join(" ");
        } else if (packHint) {
          annotation = packHint;
        } else if (isLtrToken) {
          annotation = "LTR";
        } else if (token.lemma && token.lemma !== sourceText && token.lemma !== token.normalized) {
          annotation = token.lemma;
        } else if (token.morphology?.features?.hasDiacritics === "true" && token.normalized !== sourceText) {
          annotation = token.normalized;
        } else {
          annotation = "RTL";
        }

        spans.push({
          id: `${request.sourceId}:${token.start}:${token.end}:${spans.length}`,
          sourceStart: token.start,
          sourceEnd: token.end,
          sourceText,
          annotation,
          confidence: token.confidence.score ?? undefined,
        });
      }

      return readyResult(request, capabilities, spans, direction, detectedScript ?? "arabic");
    },
  };
}

/** Offline CJK word-boundary segmentation provider using language adapters + Intl.Segmenter. */
export function createCjkSegmentationProvider(): ReadingAssistProvider {
  const capabilities: ReadingAssistCapabilities = {
    providerId: "plethora-local-cjk-segmentation",
    providerVersion: "1.0.0",
    kinds: ["segmentation"],
    languages: ["ja", "zh", "ko"],
    offline: true,
    maxCodeUnits: LOCAL_MAX_CODE_UNITS,
    preservesSource: true,
  };

  return {
    capabilities,
    async assist(request, signal) {
      const direction = request.direction ?? "ltr";
      if (signal?.aborted) return cancelledResult(request, capabilities, direction);

      const registry = getProcessingRegistry();
      const { adapter } = registry.select({
        languageTag: request.languageTag,
        requiredCapabilities: ["tokenize"],
      });

      const spans: AssistSpan[] = [];
      if (adapter.supports(request.languageTag as never, ["tokenize"])) {
        const chunk = await adapter.analyze(
          {
            text: request.text,
            languageTag: request.languageTag,
            contentFingerprint: request.contentFingerprint,
          },
          signal,
        );
        for (const token of chunk.tokens) {
          if (signal?.aborted) return cancelledResult(request, capabilities, direction);
          if ((token.kind !== "word" && token.kind !== "number") || !validSpanBounds(request.text, token.start, token.end)) {
            continue;
          }
          const sourceText = request.text.slice(token.start, token.end);
          spans.push({
            id: `${request.sourceId}:${token.start}:${token.end}:${spans.length}`,
            sourceStart: token.start,
            sourceEnd: token.end,
            sourceText,
            annotation: token.pos && token.pos !== "other" ? token.pos : undefined,
            confidence: token.confidence.score ?? undefined,
          });
        }
      } else {
        for (const part of wordSegments(request.text, request.languageTag)) {
          if (!part.isWordLike || !validSpanBounds(request.text, part.start, part.end)) continue;
          spans.push({
            id: `${request.sourceId}:${part.start}:${part.end}:${spans.length}`,
            sourceStart: part.start,
            sourceEnd: part.end,
            sourceText: request.text.slice(part.start, part.end),
          });
        }
      }

      const base = baseLanguageCode(request.languageTag);
      const script = base === "ja" ? "kanji-kana" : base === "ko" ? "hangul" : "han";
      return readyResult(request, capabilities, spans, direction, script);
    },
  };
}

export function createLocalReadingAssistProviders(): readonly ReadingAssistProvider[] {
  return [
    createJapaneseRubyProvider(),
    createCjkTransliterationProvider(),
    createRtlBidiProvider(),
    createCjkSegmentationProvider(),
  ];
}

export function hasLocalReadingAssistProvider(languageTag?: string): boolean {
  const providers = createLocalReadingAssistProviders();
  if (!languageTag) return providers.length > 0;
  return providers.some((provider) =>
    provider.capabilities.languages.some((language) => matchesReadingAssistLanguage(languageTag, language)),
  );
}
