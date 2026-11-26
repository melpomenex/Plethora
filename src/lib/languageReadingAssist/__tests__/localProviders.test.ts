import { afterEach, describe, expect, it } from "vitest";
import { setLanguageAdapterPackResolver } from "../../languageProcessing/adapters";
import {
  applyReadingAssistSpans,
  clearReadingAssistSpans,
  createCjkSegmentationProvider,
  createCjkTransliterationProvider,
  createJapaneseRubyProvider,
  createRtlBidiProvider,
} from "../index";

describe("local reading-assist providers", () => {
  afterEach(() => {
    setLanguageAdapterPackResolver(null);
  });

  it("generates Japanese ruby (furigana) spans with exact UTF-16 offsets and pack readings", async () => {
    const provider = createJapaneseRubyProvider();
    const text = "日本語を食べました。";
    const result = await provider.assist({
      sourceId: "ja-doc",
      contentFingerprint: "fp-1",
      text,
      languageTag: "ja",
      kind: "ruby",
    });

    expect(result.status).toBe("ready");
    expect(result.direction).toBe("ltr");
    expect(result.spans.length).toBeGreaterThanOrEqual(2);

    const nihongo = result.spans.find((s) => s.sourceText === "日本語");
    expect(nihongo).toMatchObject({ renderedText: "にほんご", annotation: "にほんご" });

    const tabemashita = result.spans.find((s) => s.sourceText === "食べました");
    expect(tabemashita).toMatchObject({ renderedText: "たべました", annotation: "たべました" });

    // Pure kana particle should not receive a ruby span
    expect(result.spans.find((s) => s.sourceText === "を")).toBeUndefined();

    for (const span of result.spans) {
      expect(text.slice(span.sourceStart, span.sourceEnd)).toBe(span.sourceText);
    }

    setLanguageAdapterPackResolver({
      lookupToken(surface) {
        if (surface === "日本語学校") {
          return { lemma: "日本語学校", pos: "noun", reading: "にほんごがっこう", confidence: 0.99 };
        }
        return null;
      },
    });

    const packText = "日本語学校です。";
    const packResult = await provider.assist({
      sourceId: "ja-pack",
      contentFingerprint: "fp-2",
      text: packText,
      languageTag: "ja",
      kind: "ruby",
    });
    const school = packResult.spans.find((s) => s.sourceText === "日本語学校");
    expect(school).toMatchObject({ renderedText: "にほんごがっこう", annotation: "にほんごがっこう" });
    expect(packText.slice(school!.sourceStart, school!.sourceEnd)).toBe("日本語学校");
  });

  it("generates Chinese Pinyin transliteration spans including Traditional Chinese and packs", async () => {
    const provider = createCjkTransliterationProvider();
    const text = "我喜欢学习中文！繁體字。";
    const result = await provider.assist({
      sourceId: "zh-doc",
      contentFingerprint: "fp-zh",
      text,
      languageTag: "zh-Hans",
      kind: "transliteration",
    });

    expect(result.status).toBe("ready");
    const byText = new Map(result.spans.map((s) => [s.sourceText, s]));
    expect(byText.get("我")?.renderedText).toBe("wǒ");
    expect(byText.get("喜欢")?.renderedText).toBe("xǐhuan");
    expect(byText.get("学习")?.renderedText).toBe("xuéxí");
    expect(byText.get("中文")?.renderedText).toBe("zhōngwén");
    expect(byText.get("繁體字")?.renderedText).toBe("fántǐzì");

    for (const span of result.spans) {
      expect(text.slice(span.sourceStart, span.sourceEnd)).toBe(span.sourceText);
    }
  });

  it("generates Korean Revised Romanization spans and honors pack transliterations", async () => {
    const provider = createCjkTransliterationProvider();
    const text = "나는 밥을 먹었습니다.";
    const result = await provider.assist({
      sourceId: "ko-doc",
      contentFingerprint: "fp-ko",
      text,
      languageTag: "ko",
      kind: "transliteration",
    });

    expect(result.status).toBe("ready");
    const byText = new Map(result.spans.map((s) => [s.sourceText, s]));
    expect(byText.get("나는")?.renderedText).toBe("naneun");
    expect(byText.get("밥을")?.renderedText).toBe("babeul");
    expect(byText.get("먹었습니다")?.renderedText).toBe("meogeotseupnida");

    setLanguageAdapterPackResolver({
      lookupToken(surface) {
        if (surface === "서울") return { transliteration: "Seoul-pack" };
        return null;
      },
    });
    const packResult = await provider.assist({
      sourceId: "ko-pack",
      contentFingerprint: "fp-ko-2",
      text: "서울",
      languageTag: "ko-KR",
      kind: "transliteration",
    });
    expect(packResult.spans[0]?.renderedText).toBe("Seoul-pack");
  });

  it("segments unspaced CJK text without mutating source text or DOM content", async () => {
    const provider = createCjkSegmentationProvider();
    const jaText = "日本語を読む";
    const jaResult = await provider.assist({
      sourceId: "seg-ja",
      contentFingerprint: "fp-seg-ja",
      text: jaText,
      languageTag: "ja",
      kind: "segmentation",
    });

    expect(jaResult.status).toBe("ready");
    expect(jaResult.spans.map((s) => s.sourceText)).toEqual(["日本語", "を", "読む"]);
    expect(jaResult.spans.map((s) => s.sourceText).join("")).toBe(jaText);

    const zhText = "我喜欢学习中文";
    const zhResult = await provider.assist({
      sourceId: "seg-zh",
      contentFingerprint: "fp-seg-zh",
      text: zhText,
      languageTag: "zh-CN",
      kind: "segmentation",
    });
    expect(zhResult.status).toBe("ready");
    expect(zhResult.spans.length).toBeGreaterThanOrEqual(3);
    expect(zhResult.spans.map((s) => s.sourceText).join("")).toBe(zhText);

    const container = document.createElement("div");
    container.textContent = jaText;
    const applied = applyReadingAssistSpans(container, jaText, jaResult.spans, { kind: "segmentation" });
    expect(applied).toBe(3);
    expect(container.textContent).toBe(jaText);
    clearReadingAssistSpans(container);
    expect(container.textContent).toBe(jaText);
    expect(container.querySelectorAll("[data-language-reading-assist]")).toHaveLength(0);
  });

  it("provides RTL bidi direction and clitic/boundary hints for Arabic, Hebrew, Persian, and Urdu", async () => {
    const provider = createRtlBidiProvider();
    const arText = "والْكِتَابُ في 2026 المدرسة.";
    const arResult = await provider.assist({
      sourceId: "ar-doc",
      contentFingerprint: "fp-ar",
      text: arText,
      languageTag: "ar",
      kind: "bidi",
    });

    expect(arResult.status).toBe("ready");
    expect(arResult.direction).toBe("rtl");

    const kitab = arResult.spans.find((s) => s.sourceText === "والْكِتَابُ");
    expect(kitab).toBeDefined();
    expect(kitab?.annotation).toContain("وال+");
    expect(kitab?.annotation).toContain("كتاب");
    expect(arResult.spans.find((s) => s.sourceText === "2026")?.annotation).toBe("LTR");

    for (const span of arResult.spans) {
      expect(arText.slice(span.sourceStart, span.sourceEnd)).toBe(span.sourceText);
    }

    // Hebrew, Persian, Urdu
    for (const [lang, sample] of [
      ["he", "שלום עולם"],
      ["fa", "سلام دنیا"],
      ["ur", "سلام دنیا"],
    ] as const) {
      const res = await provider.assist({
        sourceId: `rtl-${lang}`,
        contentFingerprint: `fp-${lang}`,
        text: sample,
        languageTag: lang,
        kind: "bidi",
      });
      expect(res.status).toBe("ready");
      expect(res.direction).toBe("rtl");
      expect(res.spans).toHaveLength(2);
    }

    // DOM decoration and cleanup restores exact textContent without leaving <rt> artifacts
    const container = document.createElement("div");
    container.textContent = arText;
    const applied = applyReadingAssistSpans(container, arText, arResult.spans, { kind: "bidi", direction: "rtl" });
    expect(applied).toBe(arResult.spans.length);
    expect(container.querySelector("ruby")?.getAttribute("dir")).toBe("rtl");
    clearReadingAssistSpans(container);
    expect(container.textContent).toBe(arText);
  });
});
