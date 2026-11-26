import { normalizeForLookup, tokenKind, wordSegments, type TextSegment } from "../unicode";
import {
  buildChunkFromAnalysis,
  createCapabilityDeclarations,
  createSimpleAdapter,
  getLanguageAdapterPackResolver,
  resolvePackEntry,
  resolvePackSegments,
  segmentSentencesMultilingual,
  throwIfAborted,
  type RawTokenInput,
} from "./shared";

export const CHINESE_ADAPTER_ID = "local-chinese";
const CHINESE_ADAPTER_VERSION = "1.0.0";

const TRAD_TO_SIMP_CHARS: Readonly<Record<string, string>> = {
  漢: "汉", 語: "语", 學: "学", 習: "习", 體: "体", 簡: "简", 書: "书", 讀: "读",
  寫: "写", 說: "说", 話: "话", 聽: "听", 見: "见", 買: "买", 賣: "卖", 來: "来",
  開: "开", 關: "关", 門: "门", 車: "车", 馬: "马", 鳥: "鸟", 魚: "鱼", 龍: "龙",
  風: "风", 雲: "云", 電: "电", 飛: "飞", 機: "机", 東: "东", 國: "国", 華: "华",
  愛: "爱", 樂: "乐", 歡: "欢", 師: "师", 長: "长", 壞: "坏", 對: "对", 錯: "错",
  舊: "旧", 熱: "热", 紅: "红", 藍: "蓝", 綠: "绿", 黃: "黄", 這: "这", 誰: "谁",
  麼: "么", 為: "为", 會: "会", 認: "认", 識: "识", 問: "问", 題: "题", 請: "请",
  謝: "谢", 時: "时", 間: "间", 點: "点", 現: "现", 過: "过", 著: "着", 與: "与",
  雖: "虽", 從: "从", 給: "给", 讓: "让", 發: "发", 髮: "发", 實: "实", 際: "际",
  經: "经", 濟: "济", 歷: "历", 藝: "艺", 術: "术", 視: "视", 網: "网", 絡: "络",
  數: "数", 據: "据", 統: "统", 軟: "软", 設: "设", 備: "备", 號: "号", 碼: "码",
  詞: "词", 節: "节", 頁: "页", 圖: "图", 畫: "画", 聲: "声", 響: "响", 動: "动",
  靜: "静", 夢: "梦", 記: "记", 幫: "帮", 護: "护", 衛: "卫", 醫: "医", 藥: "药",
  運: "运", 遊: "游", 戲: "戏", 錢: "钱", 銀: "银", 價: "价", 貴: "贵", 窮: "穷",
  滿: "满", 虛: "虚", 誠: "诚", 義: "义", 禮: "礼", 強: "强", 勝: "胜", 敗: "败",
  戰: "战", 爭: "争", 險: "险", 難: "难", 單: "单", 複: "复", 雜: "杂", 輕: "轻",
  遠: "远", 內: "内", 邊: "边", 後: "后", 裡: "里", 頭: "头", 腳: "脚", 臉: "脸",
  齒: "齿", 膚: "肤", 氣: "气", 殺: "杀", 傷: "伤", 驚: "惊", 麗: "丽", 醜: "丑",
  乾: "干", 幹: "干", 淨: "净", 髒: "脏", 亂: "乱", 齊: "齐", 辦: "办", 規: "规",
  則: "则", 條: "条", 種: "种", 類: "类", 樣: "样", 級: "级", 層: "层", 總: "总",
  萬: "万", 億: "亿", 兩: "两", 雙: "双", 幾: "几", 個: "个", 隻: "只", 張: "张",
  輛: "辆", 廠: "厂", 廳: "厅", 館: "馆", 場: "场", 路: "路", 橋: "桥", 樓: "楼",
  燈: "灯", 鏡: "镜", 鐘: "钟", 錶: "表", 褲: "裤", 飯: "饭", 湯: "汤", 麵: "面",
  餅: "饼", 鹽: "盐", 醬: "酱", 麥: "麦", 樹: "树", 葉: "叶", 島: "岛",
  鐵: "铁", 紙: "纸", 筆: "笔", 詩: "诗", 劇: "剧", 慶: "庆", 壽: "寿", 財: "财",
  還: "还", 換: "换", 丟: "丢", 創: "创", 計: "计", 測: "测", 試: "试", 驗: "验",
  證: "证", 準: "准", 確: "确", 決: "决", 選: "选", 擇: "择", 較: "较", 別: "别",
  異: "异", 復: "复", 剛: "刚", 僅: "仅", 牠: "它", 們: "们",
};

const SIMP_TO_TRAD_WORDS: Readonly<Record<string, string>> = {
  简体字: "簡體字",
  简体: "簡體",
  繁体字: "繁體字",
  繁体: "繁體",
  头发: "頭髮",
  发现: "發現",
  里面: "裡面",
  面条: "麵條",
  以后: "以後",
  皇后: "皇后",
  干净: "乾淨",
  干部: "幹部",
  喜欢: "喜歡",
  学习: "學習",
  中文: "中文",
  汉语: "漢語",
  朋友: "朋友",
  老师: "老師",
  学生: "學生",
  中国: "中國",
};

const SIMP_TO_TRAD_CHARS: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  for (const [trad, simp] of Object.entries(TRAD_TO_SIMP_CHARS)) {
    if (!map[simp]) map[simp] = trad;
  }
  // Prefer primary traditional equivalents for ambiguous mappings
  map["发"] = "發";
  map["干"] = "幹";
  map["后"] = "後";
  map["里"] = "裡";
  map["面"] = "麵";
  map["表"] = "表";
  map["复"] = "複";
  map["只"] = "隻";
  return map;
})();

const TRAD_ONLY_CHARS = new Set(Object.keys(TRAD_TO_SIMP_CHARS));
const SIMP_ONLY_CHARS = new Set(Object.values(TRAD_TO_SIMP_CHARS));

export function toSimplifiedChinese(value: string): string {
  let out = "";
  for (const ch of value) {
    out += TRAD_TO_SIMP_CHARS[ch] ?? ch;
  }
  return out;
}

export function toTraditionalChinese(value: string): string {
  const wordHit = SIMP_TO_TRAD_WORDS[value];
  if (wordHit) return wordHit;
  let out = "";
  for (const ch of value) {
    out += SIMP_TO_TRAD_CHARS[ch] ?? ch;
  }
  return out;
}

export function detectChineseScriptTag(value: string, languageTag = "zh"): "Hans" | "Hant" {
  let tradScore = 0;
  let simpScore = 0;
  for (const ch of value) {
    if (TRAD_ONLY_CHARS.has(ch) && !SIMP_ONLY_CHARS.has(ch)) tradScore += 1;
    else if (SIMP_ONLY_CHARS.has(ch) && !TRAD_ONLY_CHARS.has(ch)) simpScore += 1;
  }
  if (tradScore > simpScore) return "Hant";
  if (simpScore > tradScore) return "Hans";
  const lower = languageTag.toLowerCase();
  if (lower.includes("hant") || lower.endsWith("-tw") || lower.endsWith("-hk") || lower.endsWith("-mo")) {
    return "Hant";
  }
  return "Hans";
}

const PINYIN_WORDS: Readonly<Record<string, string>> = {
  我: "wǒ",
  你: "nǐ",
  您: "nín",
  他: "tā",
  她: "tā",
  它: "tā",
  我们: "wǒmen",
  你们: "nǐmen",
  他们: "tāmen",
  喜欢: "xǐhuan",
  学习: "xuéxí",
  中文: "zhōngwén",
  汉语: "hànyǔ",
  繁体字: "fántǐzì",
  简体字: "jiǎntǐzì",
  繁体: "fántǐ",
  简体: "jiǎntǐ",
  你好: "nǐhǎo",
  谢谢: "xièxie",
  中国: "zhōngguó",
  北京: "běijīng",
  朋友: "péngyou",
  老师: "lǎoshī",
  学生: "xuésheng",
  世界: "shìjiè",
  今天: "jīntiān",
  明天: "míngtiān",
  昨天: "zuótiān",
  时候: "shíhou",
  时间: "shíjiān",
  因为: "yīnwèi",
  所以: "suǒyǐ",
  但是: "dànshì",
  如果: "rúguǒ",
  可以: "kěyǐ",
  知道: "zhīdào",
  什么: "shénme",
  怎么: "zěnme",
  为什么: "wèishénme",
  这里: "zhèlǐ",
  那里: "nàlǐ",
};

const PINYIN_CHARS: Readonly<Record<string, string>> = {
  的: "de", 一: "yī", 是: "shì", 不: "bù", 了: "le", 在: "zài", 人: "rén", 有: "yǒu",
  我: "wǒ", 他: "tā", 这: "zhè", 个: "gè", 们: "men", 中: "zhōng", 来: "lái", 上: "shàng",
  大: "dà", 为: "wèi", 和: "hé", 国: "guó", 地: "dì", 到: "dào", 以: "yǐ", 说: "shuō",
  时: "shí", 要: "yào", 就: "jiù", 出: "chū", 会: "huì", 可: "kě", 也: "yě", 你: "nǐ",
  对: "duì", 生: "shēng", 能: "néng", 而: "ér", 子: "zi", 那: "nà", 得: "dé", 于: "yú",
  着: "zhe", 下: "xià", 自: "zì", 之: "zhī", 年: "nián", 过: "guò", 发: "fā", 后: "hòu",
  作: "zuò", 里: "lǐ", 用: "yòng", 道: "dào", 行: "xíng", 所: "suǒ", 然: "rán", 家: "jiā",
  种: "zhǒng", 事: "shì", 成: "chéng", 方: "fāng", 多: "duō", 经: "jīng", 么: "me", 去: "qù",
  法: "fǎ", 学: "xué", 如: "rú", 都: "dōu", 同: "tóng", 现: "xiàn", 当: "dāng", 没: "méi",
  动: "dòng", 面: "miàn", 起: "qǐ", 看: "kàn", 定: "dìng", 天: "tiān", 分: "fēn", 还: "hái",
  进: "jìn", 好: "hǎo", 小: "xiǎo", 部: "bù", 其: "qí", 些: "xiē", 主: "zhǔ", 样: "yàng",
  理: "lǐ", 心: "xīn", 她: "tā", 本: "běn", 前: "qián", 开: "kāi", 但: "dàn", 因: "yīn",
  只: "zhǐ", 从: "cóng", 想: "xiǎng", 实: "shí", 日: "rì", 军: "jūn", 者: "zhě", 意: "yì",
  无: "wú", 力: "lì", 它: "tā", 与: "yǔ", 长: "cháng", 把: "bǎ", 机: "jī", 十: "shí",
  民: "mín", 第: "dì", 公: "gōng", 此: "cǐ", 已: "yǐ", 工: "gōng", 使: "shǐ", 情: "qíng",
  明: "míng", 性: "xìng", 知: "zhī", 全: "quán", 三: "sān", 又: "yòu", 关: "guān", 点: "diǎn",
  正: "zhèng", 业: "yè", 外: "wài", 将: "jiāng", 两: "liǎng", 高: "gāo", 间: "jiān", 由: "yóu",
  问: "wèn", 很: "hěn", 最: "zuì", 重: "zhòng", 并: "bìng", 物: "wù", 手: "shǒu", 应: "yīng",
  战: "zhàn", 向: "xiàng", 头: "tóu", 文: "wén", 体: "tǐ", 政: "zhèng", 美: "měi", 相: "xiāng",
  被: "bèi", 利: "lì", 什: "shén", 二: "èr", 等: "děng", 产: "chǎn", 或: "huò", 新: "xīn",
  加: "jiā", 书: "shū", 字: "zì", 简: "jiǎn", 繁: "fán", 喜: "xǐ", 欢: "huān", 习: "xí",
  汉: "hàn", 语: "yǔ", 读: "dú", 写: "xiě", 听: "tīng", 吃: "chī", 喝: "hē", 买: "mǎi",
  卖: "mài", 走: "zǒu", 跑: "pǎo", 水: "shuǐ", 山: "shān", 朋: "péng", 友: "yǒu", 爱: "ài",
  谢: "xiè", 请: "qǐng", 老: "lǎo", 师: "shī", 校: "xiào", 门: "mén", 车: "chē", 马: "mǎ",
  风: "fēng", 雨: "yǔ", 花: "huā", 草: "cǎo", 红: "hóng", 白: "bái", 黑: "hēi", 黄: "huáng",
  蓝: "lán", 绿: "lǜ", 东: "dōng", 西: "xī", 南: "nán", 北: "běi",
};

/**
 * Transliterates Simplified or Traditional Chinese words to tone-marked Pinyin
 * using word-level lookup with character-by-character fallback.
 */
export function toPinyin(value: string): string | undefined {
  const simplified = toSimplifiedChinese(value);
  const wordHit = PINYIN_WORDS[simplified];
  if (wordHit) return wordHit;
  const syllables: string[] = [];
  for (const ch of simplified) {
    const py = PINYIN_CHARS[ch];
    if (!py) return undefined;
    syllables.push(py);
  }
  return syllables.length > 0 ? syllables.join(" ") : undefined;
}

async function mergeChinesePackWords(
  segments: readonly TextSegment[],
  languageTag: string,
  signal?: AbortSignal,
): Promise<TextSegment[]> {
  const resolver = getLanguageAdapterPackResolver();
  if (!resolver?.lookupToken) return [...segments];
  const merged: TextSegment[] = [];
  let index = 0;
  while (index < segments.length) {
    throwIfAborted(signal, CHINESE_ADAPTER_ID);
    const current = segments[index];
    if (!current.isWordLike) {
      merged.push(current);
      index += 1;
      continue;
    }
    let matchedSpan = 1;
    const maxSpan = Math.min(4, segments.length - index);
    for (let span = maxSpan; span >= 2; span -= 1) {
      const parts = segments.slice(index, index + span);
      const contiguous = parts.every(
        (p, idx) => p.isWordLike && (idx === 0 || parts[idx - 1].end === p.start),
      );
      if (!contiguous) continue;
      const surface = parts.map((p) => p.segment).join("");
      const normalized = toSimplifiedChinese(normalizeForLookup(surface, languageTag));
      const pack = await resolvePackEntry(surface, normalized, languageTag);
      if (pack) {
        matchedSpan = span;
        break;
      }
    }
    const parts = segments.slice(index, index + matchedSpan);
    merged.push({
      start: parts[0].start,
      end: parts[parts.length - 1].end,
      segment: parts.map((p) => p.segment).join(""),
      isWordLike: true,
    });
    index += matchedSpan;
  }
  return merged;
}

export const chineseAdapter = createSimpleAdapter({
  id: CHINESE_ADAPTER_ID,
  version: CHINESE_ADAPTER_VERSION,
  supportedLanguageTags: ["zh", "zh-Hans", "zh-Hant"],
  capabilities: createCapabilityDeclarations({
    sentenceSegment: 0.95,
    tokenize: 0.9,
    normalize: 0.98,
    transliteration: 0.82,
    script: 0.99,
  }),
  privacyDisclosure:
    "Runs locally on this device using Intl.Segmenter, Simplified/Traditional mapping, Pinyin transliteration, and optional local pack dictionaries. No text leaves the device.",
  async analyze(request, languageTag, manifest, signal) {
    const sentenceParts = segmentSentencesMultilingual(request.text, String(languageTag));
    const packSegments = await resolvePackSegments(request.text, String(languageTag));
    const baseSegments = packSegments ?? wordSegments(request.text, String(languageTag));
    const segments = packSegments
      ? [...baseSegments]
      : await mergeChinesePackWords(baseSegments, String(languageTag), signal);

    const chunkScriptTag = detectChineseScriptTag(request.text, String(languageTag));
    const rawTokens: RawTokenInput[] = [];

    for (const part of segments) {
      throwIfAborted(signal, CHINESE_ADAPTER_ID);
      const kind = tokenKind(part.segment, part.isWordLike);
      const simplified = toSimplifiedChinese(part.segment);
      const traditional = toTraditionalChinese(part.segment);
      const normalized = normalizeForLookup(simplified, languageTag);

      if (kind !== "word") {
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized: normalizeForLookup(part.segment, languageTag),
          confidenceScore: 0.98,
        });
        continue;
      }

      const tokenScriptTag = detectChineseScriptTag(part.segment, chunkScriptTag);
      const features: Record<string, string> = {
        scriptTag: tokenScriptTag,
        simplified,
        traditional,
      };

      const pack = await resolvePackEntry(part.segment, normalized, String(languageTag));
      if (pack) {
        const pinyin = pack.transliteration ?? pack.reading ?? toPinyin(part.segment);
        if (pinyin) features.pinyin = pinyin;
        if (pack.morphology) Object.assign(features, pack.morphology);
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: pack.lemma,
          pos: pack.pos,
          morphology: { features },
          confidenceScore: pack.confidence ?? 0.95,
        });
        continue;
      }

      const pinyin = toPinyin(part.segment);
      if (pinyin) features.pinyin = pinyin;

      rawTokens.push({
        start: part.start,
        end: part.end,
        surface: part.segment,
        kind,
        normalized,
        morphology: { features },
        confidenceScore: pinyin ? 0.88 : 0.78,
      });
    }

    return buildChunkFromAnalysis({
      adapterId: CHINESE_ADAPTER_ID,
      adapterVersion: CHINESE_ADAPTER_VERSION,
      manifest,
      request,
      languageTag,
      sentenceParts,
      rawTokens,
    });
  },
});
