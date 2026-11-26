import { afterEach, describe, expect, it } from "vitest";
import {
  ARABIC_RTL_ADAPTER_ID,
  CHINESE_ADAPTER_ID,
  GERMANIC_ADAPTER_ID,
  JAPANESE_ADAPTER_ID,
  KOREAN_ADAPTER_ID,
  ROMANCE_ADAPTER_ID,
  arabicRtlAdapter,
  chineseAdapter,
  composeHangul,
  createDefaultLanguageProcessingRegistry,
  decomposeHangul,
  germanicAdapter,
  hiraganaToKatakana,
  japaneseAdapter,
  katakanaToHiragana,
  koreanAdapter,
  normalizeArabicLookup,
  normalizeGermanicLookup,
  romanizeKorean,
  romanceAdapter,
  setLanguageAdapterPackResolver,
  toPinyin,
  toSimplifiedChinese,
  toTraditionalChinese,
  type AnalysisChunk,
  type LanguageProcessingAdapter,
} from "../index";

afterEach(() => {
  setLanguageAdapterPackResolver(null);
});

function assertExactSourceSpans(text: string, chunk: AnalysisChunk, sourceOffset = 0): void {
  expect(chunk.text).toBe(text);
  for (const sentence of chunk.sentences) {
    expect(text.slice(sentence.start - sourceOffset, sentence.end - sourceOffset)).toBe(sentence.surface);
  }
  for (const token of chunk.tokens) {
    expect(text.slice(token.start - sourceOffset, token.end - sourceOffset)).toBe(token.surface);
  }
}

describe("multilingual language processing adapters", () => {
  it("registers all multilingual adapters in the default registry ahead of baseline", () => {
    const registry = createDefaultLanguageProcessingRegistry();
    expect(registry.select({ languageTag: "es-MX", requiredCapabilities: ["lemma", "pos", "morphology"] }).adapter.id).toBe(ROMANCE_ADAPTER_ID);
    expect(registry.select({ languageTag: "fr", requiredCapabilities: ["lemma"] }).adapter.id).toBe(ROMANCE_ADAPTER_ID);
    expect(registry.select({ languageTag: "pt-BR", requiredCapabilities: ["lemma"] }).adapter.id).toBe(ROMANCE_ADAPTER_ID);
    expect(registry.select({ languageTag: "it", requiredCapabilities: ["lemma"] }).adapter.id).toBe(ROMANCE_ADAPTER_ID);
    expect(registry.select({ languageTag: "de-AT", requiredCapabilities: ["lemma", "morphology"] }).adapter.id).toBe(GERMANIC_ADAPTER_ID);
    expect(registry.select({ languageTag: "nl", requiredCapabilities: ["lemma"] }).adapter.id).toBe(GERMANIC_ADAPTER_ID);
    expect(registry.select({ languageTag: "ja", requiredCapabilities: ["lemma", "transliteration"] }).adapter.id).toBe(JAPANESE_ADAPTER_ID);
    expect(registry.select({ languageTag: "zh-Hant", requiredCapabilities: ["transliteration", "script"] }).adapter.id).toBe(CHINESE_ADAPTER_ID);
    expect(registry.select({ languageTag: "ko", requiredCapabilities: ["lemma", "transliteration"] }).adapter.id).toBe(KOREAN_ADAPTER_ID);
    expect(registry.select({ languageTag: "ar-EG", requiredCapabilities: ["lemma", "script"] }).adapter.id).toBe(ARABIC_RTL_ADAPTER_ID);
    expect(registry.select({ languageTag: "he", requiredCapabilities: ["script"] }).adapter.id).toBe(ARABIC_RTL_ADAPTER_ID);
    expect(registry.select({ languageTag: "fa" }).adapter.id).toBe(ARABIC_RTL_ADAPTER_ID);
    expect(registry.select({ languageTag: "ur" }).adapter.id).toBe(ARABIC_RTL_ADAPTER_ID);
    // Uncovered languages still resolve to intl-baseline
    expect(registry.select({ languageTag: "en" }).adapter.id).toBe("intl-baseline");
  });

  it("declares truthful capabilities and honors AbortSignal cancellation across all adapters", async () => {
    const adapters: [LanguageProcessingAdapter, string][] = [
      [romanceAdapter, "es"],
      [germanicAdapter, "de"],
      [japaneseAdapter, "ja"],
      [chineseAdapter, "zh"],
      [koreanAdapter, "ko"],
      [arabicRtlAdapter, "ar"],
    ];

    // Chinese truthfully does not claim lemma/morphology
    expect(chineseAdapter.manifest.capabilities.lemma.supported).toBe(false);
    expect(chineseAdapter.manifest.capabilities.morphology.supported).toBe(false);
    expect(chineseAdapter.manifest.capabilities.transliteration.supported).toBe(true);
    expect(romanceAdapter.manifest.capabilities.transliteration.supported).toBe(false);
    expect(romanceAdapter.manifest.capabilities.lemma.supported).toBe(true);

    const controller = new AbortController();
    controller.abort();
    for (const [adapter, languageTag] of adapters) {
      expect(adapter.kind).toBe("local");
      expect(adapter.manifest.sendsTextOffDevice).toBe(false);
      await expect(
        adapter.analyze({ text: "test", languageTag }, controller.signal),
      ).rejects.toMatchObject({ code: "cancelled" });
    }
  });

  describe("romanceAdapter", () => {
    it("lemmatizes Spanish irregulars, regular verbs, and plurals with higher confidence for table hits", async () => {
      const text = "Hablo español, pero ayer habló mucho y caminando caminaré. Soy feliz y tuve luces.";
      const chunk = await romanceAdapter.analyze({ text, languageTag: "es", sourceOffset: 10 });
      assertExactSourceSpans(text, chunk, 10);
      expect(chunk.sentences.length).toBe(2);

      const bySurface = new Map(chunk.tokens.map((t) => [t.surface, t]));
      expect(bySurface.get("Hablo")).toMatchObject({ lemma: "hablar", pos: "verb" });
      expect(bySurface.get("Hablo")?.confidence.score).toBe(0.94);
      expect(bySurface.get("habló")).toMatchObject({
        lemma: "hablar",
        pos: "verb",
        morphology: { features: expect.objectContaining({ tense: "preterite", person: "3", number: "singular" }) },
      });
      expect(bySurface.get("caminando")).toMatchObject({
        lemma: "caminar",
        pos: "verb",
        morphology: { features: expect.objectContaining({ verbForm: "gerund" }) },
      });
      expect(bySurface.get("caminando")?.confidence.score).toBe(0.76);
      expect(bySurface.get("caminaré")).toMatchObject({
        lemma: "caminar",
        pos: "verb",
        morphology: { features: expect.objectContaining({ tense: "future", person: "1", number: "singular" }) },
      });
      expect(bySurface.get("Soy")).toMatchObject({ lemma: "ser", pos: "verb" });
      expect(bySurface.get("tuve")).toMatchObject({ lemma: "tener", pos: "verb" });
      expect(bySurface.get("luces")).toMatchObject({ lemma: "luz", pos: "noun" });
    });

    it("never merges distinct homographs with conflicting POS when disambiguated by context", async () => {
      const text = "El vino blanco. Él vino ayer. Yo trabajo mucho. El trabajo es duro.";
      const chunk = await romanceAdapter.analyze({ text, languageTag: "es" });
      assertExactSourceSpans(text, chunk);

      const vinoTokens = chunk.tokens.filter((t) => t.surface === "vino");
      expect(vinoTokens).toHaveLength(2);
      expect(vinoTokens[0]).toMatchObject({ lemma: "vino", pos: "noun" });
      expect(vinoTokens[1]).toMatchObject({ lemma: "venir", pos: "verb" });

      const trabajoTokens = chunk.tokens.filter((t) => t.surface === "trabajo");
      expect(trabajoTokens).toHaveLength(2);
      expect(trabajoTokens[0]).toMatchObject({ lemma: "trabajar", pos: "verb" });
      expect(trabajoTokens[1]).toMatchObject({ lemma: "trabajo", pos: "noun" });
    });

    it("supports French, Portuguese, and Italian paradigms", async () => {
      const fr = await romanceAdapter.analyze({ text: "Je suis heureux et nous parlons.", languageTag: "fr" });
      expect(fr.tokens.find((t) => t.surface === "suis")).toMatchObject({ lemma: "être", pos: "verb" });
      expect(fr.tokens.find((t) => t.surface === "parlons")).toMatchObject({ lemma: "parler", pos: "verb" });

      const pt = await romanceAdapter.analyze({ text: "Eu vou e eles fizeram.", languageTag: "pt" });
      expect(pt.tokens.find((t) => t.surface === "vou")).toMatchObject({ lemma: "ir", pos: "verb" });
      expect(pt.tokens.find((t) => t.surface === "fizeram")).toMatchObject({ lemma: "fazer", pos: "verb" });

      const itChunk = await romanceAdapter.analyze({ text: "Io sono qui e parliamo.", languageTag: "it" });
      expect(itChunk.tokens.find((t) => t.surface === "sono")).toMatchObject({ lemma: "essere", pos: "verb" });
      expect(itChunk.tokens.find((t) => t.surface === "parliamo")).toMatchObject({ lemma: "parlare", pos: "verb" });
    });
  });

  describe("germanicAdapter", () => {
    it("handles German strong verbs, separable prefixes, compounds, and umlaut/ß normalization", async () => {
      const text = "Ich sprach auf der Straße. Ich stehe früh auf. Das Wörterbuch und der Handschuh liegen im Bahnhof.";
      const chunk = await germanicAdapter.analyze({ text, languageTag: "de" });
      assertExactSourceSpans(text, chunk);
      expect(chunk.sentences.length).toBe(3);

      const bySurface = new Map(chunk.tokens.map((t) => [t.surface, t]));
      expect(bySurface.get("sprach")).toMatchObject({ lemma: "sprechen", pos: "verb" });
      expect(bySurface.get("Straße")?.surface).toBe("Straße");
      expect(bySurface.get("Straße")?.normalized).toBe("strasse");
      expect(normalizeGermanicLookup("Straße")).toBe(normalizeGermanicLookup("Strasse"));

      expect(bySurface.get("stehe")).toMatchObject({
        lemma: "aufstehen",
        pos: "verb",
        morphology: { features: expect.objectContaining({ separablePrefix: "auf", baseLemma: "stehen" }) },
      });
      expect(bySurface.get("auf")).toMatchObject({ pos: "particle" });

      expect(bySurface.get("Wörterbuch")?.morphology?.features.compoundParts).toBe("Wort+Buch");
      expect(bySurface.get("Handschuh")?.morphology?.features.compoundParts).toBe("Hand+Schuh");
      expect(bySurface.get("Bahnhof")?.morphology?.features.compoundParts).toBe("Bahn+Hof");
      expect(chunk.tokens.find((t) => t.surface === "der")?.morphology?.features.case).toBe("dative");
    });

    it("handles Dutch strong verbs and separable prefixes", async () => {
      const text = "Ik sprak en ik sta vroeg op.";
      const chunk = await germanicAdapter.analyze({ text, languageTag: "nl" });
      assertExactSourceSpans(text, chunk);
      expect(chunk.tokens.find((t) => t.surface === "sprak")).toMatchObject({ lemma: "spreken", pos: "verb" });
      expect(chunk.tokens.find((t) => t.surface === "sta")).toMatchObject({ lemma: "opstaan", pos: "verb" });
    });
  });

  describe("japaneseAdapter", () => {
    it("deinflects verbs/adjectives, detects scripts, converts kana, and handles CJK sentences", async () => {
      const text = "食べました。食べて、食べない。読みました。読んで。高かった。しました。来ました。日本語を読む。";
      const chunk = await japaneseAdapter.analyze({ text, languageTag: "ja" });
      assertExactSourceSpans(text, chunk);
      expect(chunk.sentences.length).toBe(8);

      const bySurface = new Map(chunk.tokens.map((t) => [t.surface, t]));
      expect(bySurface.get("食べました")).toMatchObject({
        lemma: "食べる",
        pos: "verb",
        morphology: { features: expect.objectContaining({ reading: "たべました", tense: "past", politeness: "polite" }) },
      });
      expect(bySurface.get("食べて")).toMatchObject({ lemma: "食べる", pos: "verb" });
      expect(bySurface.get("食べない")).toMatchObject({ lemma: "食べる", pos: "verb" });
      expect(bySurface.get("読みました")).toMatchObject({ lemma: "読む", pos: "verb" });
      expect(bySurface.get("読んで")).toMatchObject({ lemma: "読む", pos: "verb" });
      expect(bySurface.get("高かった")).toMatchObject({ lemma: "高い", pos: "adjective" });
      expect(bySurface.get("しました")).toMatchObject({ lemma: "する", pos: "verb" });
      expect(bySurface.get("来ました")).toMatchObject({ lemma: "くる", pos: "verb" });
      expect(bySurface.get("日本語")?.morphology?.features.reading).toBe("にほんご");

      expect(hiraganaToKatakana("たべる")).toBe("タベル");
      expect(katakanaToHiragana("タベル")).toBe("たべる");
    });

    it("supports optional pack longest-match and reading enhancement", async () => {
      setLanguageAdapterPackResolver({
        lookupToken(surface) {
          if (surface === "日本語学校") {
            return { lemma: "日本語学校", pos: "noun", reading: "にほんごがっこう", confidence: 0.99 };
          }
          return null;
        },
      });
      const text = "日本語学校です。";
      const chunk = await japaneseAdapter.analyze({ text, languageTag: "ja" });
      assertExactSourceSpans(text, chunk);
      const token = chunk.tokens.find((t) => t.surface === "日本語学校");
      expect(token).toMatchObject({
        lemma: "日本語学校",
        pos: "noun",
        morphology: { features: expect.objectContaining({ reading: "にほんごがっこう" }) },
      });
    });
  });

  describe("chineseAdapter", () => {
    it("segments text, transliterates tone-marked Pinyin, maps Simplified/Traditional, and tags script", async () => {
      const text = "我喜欢学习中文！繁體字很好。";
      const chunk = await chineseAdapter.analyze({ text, languageTag: "zh-Hans" });
      assertExactSourceSpans(text, chunk);
      expect(chunk.sentences.length).toBe(2);

      const wo = chunk.tokens.find((t) => t.surface === "我");
      expect(wo?.morphology?.features.pinyin).toBe("wǒ");
      const fantizi = chunk.tokens.find((t) => t.surface === "繁體字");
      expect(fantizi?.morphology?.features.scriptTag).toBe("Hant");
      expect(fantizi?.morphology?.features.simplified).toBe("繁体字");
      expect(fantizi?.normalized).toBe("繁体字");
      expect(fantizi?.morphology?.features.pinyin).toBe("fántǐzì");

      expect(toSimplifiedChinese("繁體字")).toBe("繁体字");
      expect(toTraditionalChinese("简体字")).toBe("簡體字");
      expect(toPinyin("学习")).toBe("xuéxí");
    });
  });

  describe("koreanAdapter", () => {
    it("decomposes/recomposes Hangul Jamo, strips particles, deinflects predicates, and romanizes", async () => {
      const text = "나는 학교에서 밥을 먹었습니다. 친구가 집에 갔어요. 날씨가 좋아요!";
      const chunk = await koreanAdapter.analyze({ text, languageTag: "ko" });
      assertExactSourceSpans(text, chunk);
      expect(chunk.sentences.length).toBe(3);

      const bySurface = new Map(chunk.tokens.map((t) => [t.surface, t]));
      expect(bySurface.get("나는")).toMatchObject({ lemma: "나", pos: "pronoun" });
      expect(bySurface.get("학교에서")).toMatchObject({
        lemma: "학교",
        pos: "noun",
        morphology: { features: expect.objectContaining({ particle: "에서" }) },
      });
      expect(bySurface.get("밥을")).toMatchObject({ lemma: "밥", pos: "noun" });
      expect(bySurface.get("먹었습니다")).toMatchObject({ lemma: "먹다", pos: "verb" });
      expect(bySurface.get("갔어요")).toMatchObject({ lemma: "가다", pos: "verb" });
      expect(bySurface.get("좋아요")).toMatchObject({ lemma: "좋다", pos: "adjective" });
      expect(bySurface.get("밥을")?.morphology?.features.romanization).toBe("babeul");

      const jamo = decomposeHangul("한글");
      expect(composeHangul(jamo)).toBe("한글");
      expect(romanizeKorean("먹어요")).toBe("meogeoyo");
    });
  });

  describe("arabicRtlAdapter", () => {
    it("preserves diacritics in surface, normalizes letters, strips clitics conservatively, and keeps RTL metadata", async () => {
      const text = "مَرْحَبًا؟ والْكِتَابُ على الطَّاوِلَةِ في المدرسة.";
      const chunk = await arabicRtlAdapter.analyze({ text, languageTag: "ar" });
      assertExactSourceSpans(text, chunk);
      expect(chunk.sentences.length).toBe(2);

      const kitab = chunk.tokens.find((t) => t.surface === "والْكِتَابُ");
      expect(kitab).toBeDefined();
      expect(kitab?.surface).toBe("والْكِتَابُ");
      expect(kitab?.normalized).toBe("والكتاب");
      expect(kitab?.lemma).toBe("كتاب");
      expect(kitab?.script.direction).toBe("rtl");
      expect(kitab?.morphology?.features.proclitic).toBe("وال");

      expect(normalizeArabicLookup("أَكَلَ إِلَى آدَمَ ى ة")).toBe("اكل الي ادم ي ه");

      // Conservative stripping must not mangle 3-letter root nouns starting with ك/ب
      const rootChunk = await arabicRtlAdapter.analyze({ text: "كتاب باب ولد", languageTag: "ar" });
      expect(rootChunk.tokens.find((t) => t.surface === "كتاب")?.lemma).toBe("كتاب");
      expect(rootChunk.tokens.find((t) => t.surface === "باب")?.lemma).toBe("باب");
      expect(rootChunk.tokens.find((t) => t.surface === "ولد")?.lemma).toBe("ولد");
    });
  });
});
