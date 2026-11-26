import type { SourceAnchor } from "../../types/languageLexicon";
import { canonicalizeLanguageTag } from "../languageProcessing/types";
import { isLexicalToken, scriptMetadata, tokenKind, wordSegments } from "../languageProcessing/unicode";
import type { PhraseCandidateProvider } from "./candidates";
import { selectNonOverlappingPhrases, type PhraseSpan } from "./overlap";
import type {
  LanguagePhrase,
  PhraseCandidate,
  PhraseCandidateInput,
  PhraseConstituent,
  PhraseObjectKind,
} from "./types";

export const LOCAL_PHRASE_PROVIDER_ID = "local-phrase-provider";
export const LOCAL_PHRASE_PROVIDER_VERSION = "1.0.0";
export const DEFAULT_KNOWN_PHRASE_CONFIDENCE = 0.95;
export const DEFAULT_PACK_PHRASE_CONFIDENCE = 0.95;
export const DEFAULT_BUILTIN_PHRASE_CONFIDENCE = 0.85;

export interface PhraseTokenInput {
  id: string;
  start: number;
  end: number;
  surface: string;
  normalized?: string;
  isLexical?: boolean;
  lexicalEntryId?: string;
}

export interface PhraseLookupContext {
  profileId: string;
  languageTag: string;
  text: string;
  signal?: AbortSignal;
}

export type PhraseSourceResolver<T> =
  | readonly T[]
  | ((context: PhraseLookupContext) => readonly T[] | Promise<readonly T[]>);

export interface StructuredKnownPhraseInput {
  phrase?: string;
  canonicalForm?: string;
  surface?: string;
  normalizedForm?: string;
  languageTag?: string;
  objectKind?: PhraseObjectKind;
  lexicalEntryId?: string;
  confidence?: number;
  meaning?: string;
  translation?: string;
  profileId?: string;
}

export type KnownPhraseInput = string | LanguagePhrase | StructuredKnownPhraseInput;

export interface StructuredPackPhraseEntry {
  phrase?: string;
  surface?: string;
  headword?: string;
  term?: string;
  canonicalForm?: string;
  normalizedForm?: string;
  languageTag?: string;
  objectKind?: PhraseObjectKind;
  entryId?: string;
  lexicalEntryId?: string;
  confidence?: number;
  meaning?: string;
  translation?: string;
}

export type PackPhraseEntryInput = string | StructuredPackPhraseEntry;

export interface LocalPhraseProposeInput {
  profileId: string;
  languageTag: string;
  text: string;
  signal?: AbortSignal;
  tokens?: readonly PhraseTokenInput[];
  sourceAnchor?: SourceAnchor;
  sourceOffset?: number;
}

export interface LocalPhraseCandidateInput extends PhraseCandidateInput {
  start: number;
  end: number;
  tokenIds: readonly string[];
  languageTag: string;
  objectKind: PhraseObjectKind;
  sourceKind: "profile" | "pack" | "builtin";
  canonicalForm?: string;
  meaning?: string;
  translation?: string;
}

export interface LocalPhraseCandidateProviderOptions {
  id?: string;
  version?: string;
  supportedLanguages?: readonly string[];
  knownPhrases?: PhraseSourceResolver<KnownPhraseInput>;
  resolveKnownPhrases?: (context: PhraseLookupContext) => readonly KnownPhraseInput[] | Promise<readonly KnownPhraseInput[]>;
  packEntries?: PhraseSourceResolver<PackPhraseEntryInput>;
  resolvePackEntries?: (context: PhraseLookupContext) => readonly PackPhraseEntryInput[] | Promise<readonly PackPhraseEntryInput[]>;
  includeBuiltIns?: boolean;
  builtInConfidence?: number;
  knownConfidence?: number;
  packConfidence?: number;
  tokenize?: (text: string, languageTag: string) => readonly PhraseTokenInput[];
}

export interface LocalPhraseCandidateProvider extends PhraseCandidateProvider {
  propose(input: LocalPhraseProposeInput): Promise<readonly LocalPhraseCandidateInput[]>;
}

export interface BuiltInPhrasePattern {
  phrase: string;
  objectKind: PhraseObjectKind;
}

/** High-frequency multilingual multiword expressions, idioms, and collocations. */
export const BUILTIN_PHRASE_PATTERNS: Readonly<Record<string, readonly BuiltInPhrasePattern[]>> = {
  es: [
    { phrase: "sin embargo", objectKind: "collocation" },
    { phrase: "por favor", objectKind: "phrase" },
    { phrase: "a menudo", objectKind: "collocation" },
    { phrase: "tener que", objectKind: "collocation" },
    { phrase: "echar de menos", objectKind: "idiom" },
    { phrase: "de repente", objectKind: "collocation" },
    { phrase: "en cambio", objectKind: "collocation" },
    { phrase: "por supuesto", objectKind: "phrase" },
    { phrase: "a veces", objectKind: "collocation" },
    { phrase: "de vez en cuando", objectKind: "idiom" },
    { phrase: "en realidad", objectKind: "collocation" },
    { phrase: "darse cuenta", objectKind: "idiom" },
    { phrase: "hacer falta", objectKind: "collocation" },
    { phrase: "por lo tanto", objectKind: "collocation" },
    { phrase: "sin duda", objectKind: "collocation" },
    { phrase: "más o menos", objectKind: "phrase" },
    { phrase: "lo antes posible", objectKind: "phrase" },
    { phrase: "a pesar de", objectKind: "collocation" },
    { phrase: "en lugar de", objectKind: "collocation" },
    { phrase: "por fin", objectKind: "collocation" },
    { phrase: "de todos modos", objectKind: "phrase" },
    { phrase: "es decir", objectKind: "phrase" },
  ],
  fr: [
    { phrase: "par exemple", objectKind: "phrase" },
    { phrase: "tout à fait", objectKind: "collocation" },
    { phrase: "il y a", objectKind: "collocation" },
    { phrase: "avoir besoin de", objectKind: "collocation" },
    { phrase: "en fait", objectKind: "collocation" },
    { phrase: "bien sûr", objectKind: "phrase" },
    { phrase: "de plus", objectKind: "collocation" },
    { phrase: "en effet", objectKind: "collocation" },
    { phrase: "tout de suite", objectKind: "collocation" },
    { phrase: "à propos", objectKind: "phrase" },
    { phrase: "au moins", objectKind: "collocation" },
    { phrase: "en train de", objectKind: "collocation" },
    { phrase: "avoir envie de", objectKind: "collocation" },
    { phrase: "quand même", objectKind: "collocation" },
    { phrase: "tout le monde", objectKind: "phrase" },
    { phrase: "sans doute", objectKind: "collocation" },
    { phrase: "à cause de", objectKind: "collocation" },
    { phrase: "par contre", objectKind: "collocation" },
    { phrase: "du coup", objectKind: "collocation" },
  ],
  de: [
    { phrase: "zum Beispiel", objectKind: "phrase" },
    { phrase: "es gibt", objectKind: "collocation" },
    { phrase: "in der Regel", objectKind: "collocation" },
    { phrase: "auf jeden Fall", objectKind: "phrase" },
    { phrase: "vor allem", objectKind: "collocation" },
    { phrase: "im Grunde", objectKind: "collocation" },
    { phrase: "ab und zu", objectKind: "idiom" },
    { phrase: "hin und wieder", objectKind: "idiom" },
    { phrase: "nach wie vor", objectKind: "collocation" },
    { phrase: "unter anderem", objectKind: "collocation" },
    { phrase: "meiner Meinung nach", objectKind: "phrase" },
    { phrase: "im Allgemeinen", objectKind: "collocation" },
    { phrase: "zum Glück", objectKind: "phrase" },
    { phrase: "auf keinen Fall", objectKind: "phrase" },
    { phrase: "in der Tat", objectKind: "collocation" },
    { phrase: "keine Ahnung", objectKind: "idiom" },
    { phrase: "Bescheid wissen", objectKind: "idiom" },
    { phrase: "zur Verfügung", objectKind: "collocation" },
  ],
  ja: [
    { phrase: "というわけ", objectKind: "phrase" },
    { phrase: "かもしれない", objectKind: "phrase" },
    { phrase: "ようになる", objectKind: "collocation" },
    { phrase: "ということ", objectKind: "phrase" },
    { phrase: "ようにする", objectKind: "collocation" },
    { phrase: "ことができる", objectKind: "collocation" },
    { phrase: "わけではない", objectKind: "phrase" },
    { phrase: "について", objectKind: "collocation" },
    { phrase: "にとって", objectKind: "collocation" },
    { phrase: "によって", objectKind: "collocation" },
    { phrase: "とともに", objectKind: "collocation" },
    { phrase: "なければならない", objectKind: "collocation" },
    { phrase: "それにしても", objectKind: "phrase" },
    { phrase: "しかたがない", objectKind: "idiom" },
    { phrase: "気をつける", objectKind: "idiom" },
    { phrase: "役に立つ", objectKind: "idiom" },
  ],
  zh: [
    { phrase: "因为所以", objectKind: "phrase" },
    { phrase: "换句话说", objectKind: "idiom" },
    { phrase: "越来越", objectKind: "collocation" },
    { phrase: "不管怎样", objectKind: "phrase" },
    { phrase: "与此同时", objectKind: "phrase" },
    { phrase: "总的来说", objectKind: "phrase" },
    { phrase: "事实上", objectKind: "collocation" },
    { phrase: "另一方面", objectKind: "phrase" },
    { phrase: "除此之外", objectKind: "phrase" },
    { phrase: "不仅如此", objectKind: "phrase" },
    { phrase: "也就是说", objectKind: "phrase" },
    { phrase: "一如既往", objectKind: "idiom" },
    { phrase: "无论如何", objectKind: "phrase" },
    { phrase: "总而言之", objectKind: "idiom" },
    { phrase: "顺便说一下", objectKind: "phrase" },
    { phrase: "举个例子", objectKind: "collocation" },
  ],
  ar: [
    { phrase: "على سبيل المثال", objectKind: "phrase" },
    { phrase: "من أجل", objectKind: "phrase" },
    { phrase: "بالإضافة إلى", objectKind: "collocation" },
    { phrase: "في الحقيقة", objectKind: "phrase" },
    { phrase: "بشكل عام", objectKind: "collocation" },
    { phrase: "من ناحية أخرى", objectKind: "phrase" },
    { phrase: "على أي حال", objectKind: "phrase" },
    { phrase: "مع ذلك", objectKind: "collocation" },
    { phrase: "في نفس الوقت", objectKind: "collocation" },
    { phrase: "على الرغم من", objectKind: "collocation" },
    { phrase: "لا بد من", objectKind: "collocation" },
    { phrase: "ما شاء الله", objectKind: "idiom" },
    { phrase: "إن شاء الله", objectKind: "idiom" },
    { phrase: "على الأقل", objectKind: "collocation" },
    { phrase: "بغض النظر", objectKind: "idiom" },
  ],
  en: [
    { phrase: "for example", objectKind: "phrase" },
    { phrase: "in general", objectKind: "collocation" },
    { phrase: "of course", objectKind: "phrase" },
    { phrase: "as well as", objectKind: "collocation" },
    { phrase: "at least", objectKind: "collocation" },
    { phrase: "on the other hand", objectKind: "phrase" },
    { phrase: "by the way", objectKind: "phrase" },
    { phrase: "in fact", objectKind: "collocation" },
    { phrase: "a lot of", objectKind: "collocation" },
    { phrase: "make sense", objectKind: "collocation" },
    { phrase: "take place", objectKind: "collocation" },
  ],
};

interface InternalToken {
  id: string;
  start: number;
  end: number;
  surface: string;
  normalized: string;
  isLexical: boolean;
  lexicalEntryId?: string;
}

interface CompiledPattern {
  canonicalForm: string;
  normalizedTokens: readonly string[];
  normalizedKey: string;
  objectKind: PhraseObjectKind;
  sourceKind: "profile" | "pack" | "builtin";
  confidence: number;
  lexicalEntryId?: string;
  meaning?: string;
  translation?: string;
}

function createAbortError(message = "Phrase candidate extraction aborted"): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  return Object.assign(new Error(message), { name: "AbortError" });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function resolveWithAbort<T>(
  promiseOrValue: T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return await promiseOrValue;
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promiseOrValue).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          reject(createAbortError());
          return;
        }
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function primaryLanguageSubtag(languageTag: string): string {
  return languageTag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

function languageTagMatches(patternTag: string | undefined, targetTag: string): boolean {
  if (!patternTag || !patternTag.trim()) return true;
  const normalizedPattern = patternTag.trim().toLowerCase().replace(/_/g, "-");
  const normalizedTarget = targetTag.trim().toLowerCase().replace(/_/g, "-");
  if (normalizedPattern === normalizedTarget) return true;
  const patternParts = normalizedPattern.split("-");
  const targetParts = normalizedTarget.split("-");
  if (patternParts[0] !== targetParts[0]) return false;
  // Bare primary tags ("es") match regional tags ("es-mx") and vice versa,
  // while distinct regional subtags ("es-mx" vs "es-es") stay separate.
  return patternParts.length === 1 || targetParts.length === 1;
}

function isSplitCjkScript(value: string): boolean {
  const meta = scriptMetadata(value);
  const check = (script: string) => script === "han" || script === "hiragana" || script === "katakana";
  if (check(meta.script)) return true;
  return Boolean(meta.scripts?.some(check));
}

/**
 * Case- and diacritic-fold a token or phrase for matching while keeping
 * Japanese dakuten/handakuten marks intact so voiced kana stay distinct.
 */
export function normalizePhraseMatchText(value: string, languageTag?: string): string {
  const nfc = value.normalize("NFC").replace(/[’‘`]/g, "'").replace(/\u0640/g, "");
  let lowered: string;
  try {
    lowered = languageTag ? nfc.toLocaleLowerCase(languageTag) : nfc.toLocaleLowerCase();
  } catch {
    lowered = nfc.toLowerCase();
  }
  return lowered
    .normalize("NFD")
    .replace(/(?![\u3099\u309A])\p{Mn}/gu, "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
}

function splitCjkSegmentIntoChars(
  segment: string,
  segmentStart: number,
  languageTag: string,
  sourceOffset: number,
  nextIndex: () => number,
): InternalToken[] {
  const tokens: InternalToken[] = [];
  let offset = 0;
  while (offset < segment.length) {
    const codePoint = segment.codePointAt(offset);
    const width = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    const charSurface = segment.slice(offset, offset + width);
    const start = sourceOffset + segmentStart + offset;
    const end = start + width;
    tokens.push({
      id: `tok:${nextIndex()}:${start}-${end}`,
      start,
      end,
      surface: charSurface,
      normalized: normalizePhraseMatchText(charSurface, languageTag),
      isLexical: true,
    });
    offset += width;
  }
  return tokens;
}

function tokenizeText(
  text: string,
  languageTag: string,
  sourceOffset: number,
  splitCjk: boolean,
): InternalToken[] {
  let tokenIndex = 0;
  const nextIndex = () => tokenIndex++;
  const output: InternalToken[] = [];
  for (const part of wordSegments(text, languageTag)) {
    const kind = tokenKind(part.segment, part.isWordLike);
    const lexical = isLexicalToken(kind, part.segment);
    if (lexical && splitCjk && isSplitCjkScript(part.segment)) {
      output.push(...splitCjkSegmentIntoChars(part.segment, part.start, languageTag, sourceOffset, nextIndex));
    } else {
      const start = sourceOffset + part.start;
      const end = sourceOffset + part.end;
      output.push({
        id: `tok:${nextIndex()}:${start}-${end}`,
        start,
        end,
        surface: part.segment,
        normalized: normalizePhraseMatchText(part.segment, languageTag),
        isLexical: lexical,
      });
    }
  }
  return output;
}

function normalizeCallerTokens(
  tokens: readonly PhraseTokenInput[],
  languageTag: string,
): InternalToken[] {
  return tokens.map((token) => {
    const kind = tokenKind(token.surface, token.isLexical ?? true);
    const lexical = token.isLexical ?? isLexicalToken(kind, token.surface);
    return {
      id: token.id,
      start: token.start,
      end: token.end,
      surface: token.surface,
      normalized: normalizePhraseMatchText(token.normalized ?? token.surface, languageTag),
      isLexical: lexical,
      lexicalEntryId: token.lexicalEntryId,
    };
  });
}

function isLanguagePhraseRecord(entry: KnownPhraseInput): entry is LanguagePhrase {
  return typeof entry === "object" && entry !== null && "phraseKey" in entry && "state" in entry;
}

function resolveKnownPhraseText(entry: KnownPhraseInput): string | undefined {
  if (typeof entry === "string") return entry;
  return entry.canonicalForm ?? entry.normalizedForm ?? ("phrase" in entry ? entry.phrase : undefined) ?? ("surface" in entry ? entry.surface : undefined);
}

function resolvePackEntryText(entry: PackPhraseEntryInput): string | undefined {
  if (typeof entry === "string") return entry;
  return entry.canonicalForm ?? entry.phrase ?? entry.surface ?? entry.headword ?? entry.term ?? entry.normalizedForm;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function compilePatternsForText(
  phraseText: string,
  languageTag: string,
  meta: Omit<CompiledPattern, "canonicalForm" | "normalizedTokens" | "normalizedKey">,
  splitCjk: boolean,
): CompiledPattern[] {
  const canonicalForm = phraseText.trim();
  if (!canonicalForm) return [];
  const results: CompiledPattern[] = [];

  const lexicalFromSegmented = tokenizeText(canonicalForm, languageTag, 0, splitCjk)
    .filter((token) => token.isLexical && token.normalized.length > 0)
    .map((token) => token.normalized);

  if (lexicalFromSegmented.length >= 2) {
    results.push({
      ...meta,
      canonicalForm,
      normalizedTokens: lexicalFromSegmented,
      normalizedKey: lexicalFromSegmented.join(" "),
    });
  }

  // When caller supplied explicit tokens (splitCjk=false) that happen to be CJK
  // character tokens, also compile a character-level variant if needed.
  if (!splitCjk && isSplitCjkScript(canonicalForm)) {
    const lexicalChars = tokenizeText(canonicalForm, languageTag, 0, true)
      .filter((token) => token.isLexical && token.normalized.length > 0)
      .map((token) => token.normalized);
    if (lexicalChars.length >= 2 && lexicalChars.join(" ") !== lexicalFromSegmented.join(" ")) {
      results.push({
        ...meta,
        canonicalForm,
        normalizedTokens: lexicalChars,
        normalizedKey: lexicalChars.join(" "),
      });
    }
  }

  return results;
}

async function resolveSource<T>(
  resolver: PhraseSourceResolver<T> | undefined,
  extraResolver: ((context: PhraseLookupContext) => readonly T[] | Promise<readonly T[]>) | undefined,
  context: PhraseLookupContext,
): Promise<T[]> {
  const collected: T[] = [];
  if (resolver) {
    const items = typeof resolver === "function"
      ? await resolveWithAbort(resolver(context), context.signal)
      : resolver;
    collected.push(...items);
  }
  if (extraResolver) {
    const items = await resolveWithAbort(extraResolver(context), context.signal);
    collected.push(...items);
  }
  return collected;
}

function sourcePriority(sourceKind: CompiledPattern["sourceKind"]): number {
  if (sourceKind === "profile") return 3;
  if (sourceKind === "pack") return 2;
  return 1;
}

function buildSourceAnchor(
  base: SourceAnchor | undefined,
  start: number,
  end: number,
  tokenIds: readonly string[],
): SourceAnchor {
  const existingLocator =
    base?.locator && typeof base.locator === "object" && !Array.isArray(base.locator)
      ? (base.locator as Record<string, unknown>)
      : {};
  return {
    sourceType: base?.sourceType ?? "text",
    ...base,
    locator: {
      ...existingLocator,
      start,
      end,
      tokenIds: [...tokenIds],
    },
  };
}

function extractSurface(
  text: string,
  matchedTokens: readonly InternalToken[],
  sourceOffset: number,
): string {
  const rawStart = matchedTokens[0].start - sourceOffset;
  const rawEnd = matchedTokens[matchedTokens.length - 1].end - sourceOffset;
  if (rawStart >= 0 && rawEnd <= text.length && rawStart < rawEnd) {
    return text.slice(rawStart, rawEnd);
  }
  return matchedTokens.map((token) => token.surface).join(" ");
}

/**
 * Create a local offline PhraseCandidateProvider matching profile-saved phrases,
 * optional language-pack dictionary entries, and built-in multilingual idioms/collocations.
 */
export function createLocalPhraseCandidateProvider(
  options: LocalPhraseCandidateProviderOptions = {},
): LocalPhraseCandidateProvider {
  const providerId = options.id ?? LOCAL_PHRASE_PROVIDER_ID;
  const providerVersion = options.version ?? LOCAL_PHRASE_PROVIDER_VERSION;
  const includeBuiltIns = options.includeBuiltIns ?? true;
  const knownConfidence = clampConfidence(options.knownConfidence ?? DEFAULT_KNOWN_PHRASE_CONFIDENCE);
  const packConfidence = clampConfidence(options.packConfidence ?? DEFAULT_PACK_PHRASE_CONFIDENCE);
  const builtInConfidence = clampConfidence(options.builtInConfidence ?? DEFAULT_BUILTIN_PHRASE_CONFIDENCE);

  return {
    id: providerId,
    version: providerVersion,

    supports(languageTag: string): boolean {
      const canonical = canonicalizeLanguageTag(languageTag);
      if (!canonical) return false;
      if (!options.supportedLanguages || options.supportedLanguages.length === 0) {
        return true;
      }
      return options.supportedLanguages.some((supportedTag) => languageTagMatches(supportedTag, canonical));
    },

    async propose(input: LocalPhraseProposeInput): Promise<readonly LocalPhraseCandidateInput[]> {
      throwIfAborted(input.signal);
      if (!input.text || !input.text.trim()) return [];
      if (!this.supports(input.languageTag)) return [];

      const canonicalTag = String(canonicalizeLanguageTag(input.languageTag) ?? input.languageTag);
      const sourceOffset = Math.max(0, Math.floor(input.sourceOffset ?? 0));
      const context: PhraseLookupContext = {
        profileId: input.profileId,
        languageTag: canonicalTag,
        text: input.text,
        signal: input.signal,
      };

      const [knownItems, packItems] = await Promise.all([
        resolveSource(options.knownPhrases, options.resolveKnownPhrases, context),
        resolveSource(options.packEntries, options.resolvePackEntries, context),
      ]);
      throwIfAborted(input.signal);

      const useExternalTokens = Boolean(input.tokens || options.tokenize);
      const tokens = input.tokens
        ? normalizeCallerTokens(input.tokens, canonicalTag)
        : options.tokenize
          ? normalizeCallerTokens(options.tokenize(input.text, canonicalTag), canonicalTag)
          : tokenizeText(input.text, canonicalTag, sourceOffset, true);

      if (tokens.length < 2) return [];

      const compiled: CompiledPattern[] = [];

      for (const entry of knownItems) {
        if (isLanguagePhraseRecord(entry)) {
          if (entry.state === "ignored") continue;
          if (entry.profileId && entry.profileId !== input.profileId) continue;
        } else if (typeof entry === "object" && entry !== null && entry.profileId && entry.profileId !== input.profileId) {
          continue;
        }
        const entryTag = typeof entry === "object" && entry !== null ? entry.languageTag : undefined;
        if (!languageTagMatches(entryTag, canonicalTag)) continue;
        const phraseText = resolveKnownPhraseText(entry);
        if (!phraseText) continue;
        const entryConf =
          typeof entry === "object" && entry !== null && typeof entry.confidence === "number" && Number.isFinite(entry.confidence)
            ? clampConfidence(entry.confidence)
            : knownConfidence;
        const objectKind: PhraseObjectKind =
          typeof entry === "object" && entry !== null && entry.objectKind ? entry.objectKind : "phrase";
        const lexicalEntryId =
          typeof entry === "object" && entry !== null
            ? ("lexicalEntryId" in entry ? entry.lexicalEntryId : undefined)
            : undefined;
        const meaning = typeof entry === "object" && entry !== null ? entry.meaning : undefined;
        const translation = typeof entry === "object" && entry !== null ? entry.translation : undefined;

        compiled.push(
          ...compilePatternsForText(
            phraseText,
            canonicalTag,
            {
              objectKind,
              sourceKind: "profile",
              confidence: entryConf,
              lexicalEntryId,
              meaning,
              translation,
            },
            !useExternalTokens,
          ),
        );
      }

      for (const entry of packItems) {
        const entryTag = typeof entry === "object" && entry !== null ? entry.languageTag : undefined;
        if (!languageTagMatches(entryTag, canonicalTag)) continue;
        const phraseText = resolvePackEntryText(entry);
        if (!phraseText) continue;
        const entryConf =
          typeof entry === "object" && entry !== null && typeof entry.confidence === "number" && Number.isFinite(entry.confidence)
            ? clampConfidence(entry.confidence)
            : packConfidence;
        const objectKind: PhraseObjectKind =
          typeof entry === "object" && entry !== null && entry.objectKind ? entry.objectKind : "phrase";
        const lexicalEntryId =
          typeof entry === "object" && entry !== null ? (entry.lexicalEntryId ?? entry.entryId) : undefined;
        const meaning = typeof entry === "object" && entry !== null ? entry.meaning : undefined;
        const translation = typeof entry === "object" && entry !== null ? entry.translation : undefined;

        compiled.push(
          ...compilePatternsForText(
            phraseText,
            canonicalTag,
            {
              objectKind,
              sourceKind: "pack",
              confidence: entryConf,
              lexicalEntryId,
              meaning,
              translation,
            },
            !useExternalTokens,
          ),
        );
      }

      if (includeBuiltIns) {
        const baseLang = primaryLanguageSubtag(canonicalTag);
        for (const builtIn of BUILTIN_PHRASE_PATTERNS[baseLang] ?? []) {
          compiled.push(
            ...compilePatternsForText(
              builtIn.phrase,
              canonicalTag,
              {
                objectKind: builtIn.objectKind,
                sourceKind: "builtin",
                confidence: builtInConfidence,
              },
              !useExternalTokens,
            ),
          );
        }
      }

      throwIfAborted(input.signal);
      if (compiled.length === 0) return [];

      const byFirstToken = new Map<string, CompiledPattern[]>();
      for (const pattern of compiled) {
        const first = pattern.normalizedTokens[0];
        const bucket = byFirstToken.get(first);
        if (bucket) {
          bucket.push(pattern);
        } else {
          byFirstToken.set(first, [pattern]);
        }
      }

      const bestByExactSpan = new Map<string, { priority: number; candidate: LocalPhraseCandidateInput }>();

      for (let i = 0; i < tokens.length; i += 1) {
        if ((i & 63) === 0) throwIfAborted(input.signal);
        const firstToken = tokens[i];
        if (!firstToken.isLexical) continue;
        const candidates = byFirstToken.get(firstToken.normalized);
        if (!candidates) continue;

        for (const pattern of candidates) {
          const length = pattern.normalizedTokens.length;
          if (i + length > tokens.length) continue;

          let matched = true;
          for (let k = 0; k < length; k += 1) {
            const token = tokens[i + k];
            if (!token.isLexical || token.normalized !== pattern.normalizedTokens[k]) {
              matched = false;
              break;
            }
            if (k > 0) {
              const prevEnd = tokens[i + k - 1].end - sourceOffset;
              const currStart = token.start - sourceOffset;
              if (prevEnd >= 0 && currStart <= input.text.length && prevEnd <= currStart) {
                const between = input.text.slice(prevEnd, currStart);
                if (!/^\s*$/u.test(between)) {
                  matched = false;
                  break;
                }
              }
            }
          }
          if (!matched) continue;

          const matchedTokens = tokens.slice(i, i + length);
          const start = matchedTokens[0].start;
          const end = matchedTokens[matchedTokens.length - 1].end;
          const tokenIds = matchedTokens.map((token) => token.id);
          const surface = extractSurface(input.text, matchedTokens, sourceOffset);
          const constituents: PhraseConstituent[] = matchedTokens.map((token, position) => ({
            position,
            surface: token.surface,
            normalized: token.normalized,
            ...(token.lexicalEntryId ? { lexicalEntryId: token.lexicalEntryId } : {}),
          }));

          const candidate: LocalPhraseCandidateInput = {
            profileId: input.profileId,
            surface,
            constituents,
            sourceAnchor: buildSourceAnchor(input.sourceAnchor, start, end, tokenIds),
            confidence: pattern.confidence,
            providerId,
            providerVersion,
            start,
            end,
            tokenIds,
            languageTag: canonicalTag,
            objectKind: pattern.objectKind,
            sourceKind: pattern.sourceKind,
            canonicalForm: pattern.canonicalForm,
            ...(pattern.meaning !== undefined ? { meaning: pattern.meaning } : {}),
            ...(pattern.translation !== undefined ? { translation: pattern.translation } : {}),
          };

          const dedupeKey = `${start}:${end}:${pattern.normalizedKey}`;
          const priority = sourcePriority(pattern.sourceKind);
          const existing = bestByExactSpan.get(dedupeKey);
          if (
            !existing ||
            candidate.confidence > existing.candidate.confidence ||
            (candidate.confidence === existing.candidate.confidence && priority > existing.priority)
          ) {
            bestByExactSpan.set(dedupeKey, { priority, candidate });
          }
        }
      }

      throwIfAborted(input.signal);

      return [...bestByExactSpan.values()]
        .map((entry) => entry.candidate)
        .sort(
          (left, right) =>
            left.start - right.start ||
            right.end - left.end ||
            right.confidence - left.confidence ||
            left.surface.localeCompare(right.surface),
        );
    },
  };
}

/**
 * Extract a PhraseSpan from an accepted PhraseCandidate (using locator offsets
 * set by localProvider, or falling back to a tokenPositions map).
 */
export function phraseSpanFromCandidate(
  candidate: PhraseCandidate,
  tokenPositions?: ReadonlyMap<string, { start: number; end: number }>,
): PhraseSpan | null {
  const locator =
    candidate.sourceAnchor?.locator &&
    typeof candidate.sourceAnchor.locator === "object" &&
    !Array.isArray(candidate.sourceAnchor.locator)
      ? (candidate.sourceAnchor.locator as Record<string, unknown>)
      : null;
  if (
    locator &&
    typeof locator.start === "number" &&
    Number.isFinite(locator.start) &&
    typeof locator.end === "number" &&
    Number.isFinite(locator.end) &&
    locator.end > locator.start
  ) {
    return {
      candidate,
      start: locator.start,
      end: locator.end,
    };
  }
  if (tokenPositions) {
    const positions = candidate.constituents
      .map((constituent) => tokenPositions.get(`${candidate.id}:${constituent.position}`))
      .filter((position): position is { start: number; end: number } => Boolean(position));
    if (positions.length === candidate.constituents.length && positions.length > 0) {
      return {
        candidate,
        start: Math.min(...positions.map((position) => position.start)),
        end: Math.max(...positions.map((position) => position.end)),
      };
    }
  }
  return null;
}

/**
 * Convert accepted PhraseCandidates into PhraseSpans and resolve overlaps with
 * `selectNonOverlappingPhrases`.
 */
export function selectNonOverlappingCandidatePhrases(
  candidates: readonly PhraseCandidate[],
  tokenPositions?: ReadonlyMap<string, { start: number; end: number }>,
): PhraseSpan[] {
  const spans = candidates
    .map((candidate) => phraseSpanFromCandidate(candidate, tokenPositions))
    .filter((span): span is PhraseSpan => Boolean(span));
  return selectNonOverlappingPhrases(spans);
}
