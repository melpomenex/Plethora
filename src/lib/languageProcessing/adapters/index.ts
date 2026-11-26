import type { LanguageProcessingAdapter } from "../types";
import { arabicRtlAdapter } from "./arabicRtlAdapter";
import { chineseAdapter } from "./chineseAdapter";
import { germanicAdapter } from "./germanicAdapter";
import { japaneseAdapter } from "./japaneseAdapter";
import { koreanAdapter } from "./koreanAdapter";
import { romanceAdapter } from "./romanceAdapter";

export {
  getLanguageAdapterPackResolver,
  setLanguageAdapterPackResolver,
  type LanguageAdapterPackResolver,
  type PackLexiconEntry,
  type PackSegment,
} from "./shared";
export { romanceAdapter, ROMANCE_ADAPTER_ID } from "./romanceAdapter";
export {
  germanicAdapter,
  GERMANIC_ADAPTER_ID,
  normalizeGermanicLookup,
} from "./germanicAdapter";
export {
  japaneseAdapter,
  JAPANESE_ADAPTER_ID,
  detectJapaneseScriptDetail,
  deinflectJapanese,
  hiraganaToKatakana,
  katakanaToHiragana,
} from "./japaneseAdapter";
export {
  chineseAdapter,
  CHINESE_ADAPTER_ID,
  detectChineseScriptTag,
  toPinyin,
  toSimplifiedChinese,
  toTraditionalChinese,
} from "./chineseAdapter";
export {
  koreanAdapter,
  KOREAN_ADAPTER_ID,
  composeHangul,
  composeHangulSyllable,
  decomposeHangul,
  decomposeHangulSyllable,
  romanizeKorean,
  type HangulJamoIndices,
} from "./koreanAdapter";
export {
  arabicRtlAdapter,
  ARABIC_RTL_ADAPTER_ID,
  normalizeArabicLookup,
} from "./arabicRtlAdapter";

export const MULTILINGUAL_LANGUAGE_ADAPTERS: readonly LanguageProcessingAdapter[] = [
  romanceAdapter,
  germanicAdapter,
  japaneseAdapter,
  chineseAdapter,
  koreanAdapter,
  arabicRtlAdapter,
];
