import type {
  LanguagePackAvailability,
  LanguagePackFormat,
  LanguagePackKind,
  LanguagePackManifest,
  ParsedDictionaryEntry,
} from "./types";

interface StarterSeedEntry {
  headword: string;
  reading?: string;
  lemma?: string;
  pos: string;
  morphology?: Record<string, string>;
  senses: Array<{ definition: string; glosses?: string[]; tags?: string[] }>;
  examples?: string[];
  frequencyRank?: number;
}

interface StarterPackSeed {
  manifest: Omit<LanguagePackManifest, "sizeBytes" | "sha256">;
  entries: StarterSeedEntry[];
}

const STARTER_SEEDS: readonly StarterPackSeed[] = [
  {
    manifest: {
      id: "plethora-starter-es",
      name: "Plethora Spanish Core Starter",
      languageTag: "es",
      targetLanguage: "es",
      baseLanguage: "en",
      kind: "bundle",
      format: "json",
      version: "1.0.0",
      license: "CC-BY-SA-4.0",
      attribution:
        "Plethora Core Lexicon Starter (derived from Wiktionary/Kaikki & FreeDict community open data, CC-BY-SA-4.0)",
      capabilities: {
        offlineDictionary: true,
        lemmaTable: true,
        frequency: true,
        morphology: true,
      },
      description:
        "Lightweight embedded Spanish-English starter dictionary with core lemmas, verb morphology, examples, and frequency ranks.",
      availability: "embedded-starter",
    },
    entries: [
      {
        headword: "hablar",
        lemma: "hablar",
        pos: "verb",
        morphology: { conjugation: "ar", mood: "infinitive" },
        senses: [{ definition: "to speak; to talk", glosses: ["speak", "talk"] }],
        examples: ["Quiero hablar español contigo."],
        frequencyRank: 45,
      },
      {
        headword: "hablo",
        lemma: "hablar",
        pos: "verb",
        morphology: { person: "1", number: "singular", tense: "present" },
        senses: [{ definition: "I speak (first-person singular present of hablar)" }],
        frequencyRank: 45,
      },
      {
        headword: "libro",
        lemma: "libro",
        pos: "noun",
        morphology: { gender: "masculine", number: "singular" },
        senses: [{ definition: "book", glosses: ["book", "volume"] }],
        examples: ["Estoy leyendo un libro interesante."],
        frequencyRank: 120,
      },
      {
        headword: "tiempo",
        lemma: "tiempo",
        pos: "noun",
        morphology: { gender: "masculine", number: "singular" },
        senses: [
          { definition: "time; duration", glosses: ["time"] },
          { definition: "weather", glosses: ["weather"] },
        ],
        frequencyRank: 32,
      },
    ],
  },
  {
    manifest: {
      id: "plethora-starter-fr",
      name: "Plethora French Core Starter",
      languageTag: "fr",
      targetLanguage: "fr",
      baseLanguage: "en",
      kind: "bundle",
      format: "json",
      version: "1.0.0",
      license: "CC-BY-SA-4.0",
      attribution:
        "Plethora Core Lexicon Starter (derived from Wiktionary/Kaikki & FreeDict community open data, CC-BY-SA-4.0)",
      capabilities: {
        offlineDictionary: true,
        lemmaTable: true,
        readings: true,
        frequency: true,
        morphology: true,
      },
      description:
        "Lightweight embedded French-English starter dictionary with core lemmas, IPA readings, morphology, and examples.",
      availability: "embedded-starter",
    },
    entries: [
      {
        headword: "parler",
        reading: "/paʁ.le/",
        lemma: "parler",
        pos: "verb",
        morphology: { group: "1st", mood: "infinitive" },
        senses: [{ definition: "to speak; to talk", glosses: ["speak", "talk"] }],
        examples: ["Nous aimons parler français."],
        frequencyRank: 54,
      },
      {
        headword: "livre",
        reading: "/livʁ/",
        lemma: "livre",
        pos: "noun",
        morphology: { gender: "masculine", number: "singular" },
        senses: [{ definition: "book", glosses: ["book"] }],
        examples: ["Ce livre est passionnant."],
        frequencyRank: 112,
      },
      {
        headword: "comprendre",
        reading: "/kɔ̃.pʁɑ̃dʁ/",
        lemma: "comprendre",
        pos: "verb",
        senses: [{ definition: "to understand; to include", glosses: ["understand", "comprehend"] }],
        frequencyRank: 68,
      },
    ],
  },
  {
    manifest: {
      id: "plethora-starter-de",
      name: "Plethora German Core Starter",
      languageTag: "de",
      targetLanguage: "de",
      baseLanguage: "en",
      kind: "bundle",
      format: "json",
      version: "1.0.0",
      license: "CC-BY-SA-4.0",
      attribution:
        "Plethora Core Lexicon Starter (derived from Wiktionary/Kaikki & FreeDict community open data, CC-BY-SA-4.0)",
      capabilities: {
        offlineDictionary: true,
        lemmaTable: true,
        compounds: true,
        frequency: true,
        morphology: true,
      },
      description:
        "Lightweight embedded German-English starter dictionary with noun genders, lemmas, and core verbs.",
      availability: "embedded-starter",
    },
    entries: [
      {
        headword: "Buch",
        lemma: "Buch",
        pos: "noun",
        morphology: { gender: "neuter", plural: "Bücher" },
        senses: [{ definition: "book", glosses: ["book"] }],
        examples: ["Ich lese ein Buch."],
        frequencyRank: 108,
      },
      {
        headword: "sprechen",
        lemma: "sprechen",
        pos: "verb",
        morphology: { class: "strong", past: "sprach", participle: "gesprochen" },
        senses: [{ definition: "to speak; to talk", glosses: ["speak", "talk"] }],
        frequencyRank: 62,
      },
      {
        headword: "Handschuh",
        lemma: "Handschuh",
        pos: "noun",
        morphology: { gender: "masculine", compound: "Hand+Schuh" },
        senses: [{ definition: "glove", glosses: ["glove"] }],
        frequencyRank: 1420,
      },
    ],
  },
  {
    manifest: {
      id: "plethora-starter-ja",
      name: "Plethora Japanese Core Starter",
      languageTag: "ja",
      targetLanguage: "ja",
      baseLanguage: "en",
      kind: "bundle",
      format: "json",
      version: "1.0.0",
      license: "CC-BY-SA-4.0",
      attribution:
        "Plethora Core Lexicon Starter (inspired by JMdict/EDRDG open licensing, CC-BY-SA-4.0)",
      capabilities: {
        offlineDictionary: true,
        lemmaTable: true,
        readings: true,
        frequency: true,
      },
      description:
        "Lightweight embedded Japanese-English starter dictionary with kanji headwords, kana readings, POS tags, and frequency ranks.",
      availability: "embedded-starter",
    },
    entries: [
      {
        headword: "食べる",
        reading: "たべる",
        lemma: "食べる",
        pos: "v1",
        morphology: { class: "ichidan", transitivity: "transitive" },
        senses: [{ definition: "to eat", glosses: ["eat"] }],
        examples: ["朝ご飯を食べる。"],
        frequencyRank: 140,
      },
      {
        headword: "本",
        reading: "ほん",
        lemma: "本",
        pos: "noun",
        senses: [{ definition: "book; volume; script", glosses: ["book", "volume"] }],
        examples: ["図書館で本を読む。"],
        frequencyRank: 95,
      },
      {
        headword: "言葉",
        reading: "ことば",
        lemma: "言葉",
        pos: "noun",
        senses: [{ definition: "word; phrase; language", glosses: ["word", "language"] }],
        frequencyRank: 185,
      },
    ],
  },
  {
    manifest: {
      id: "plethora-starter-zh",
      name: "Plethora Chinese Core Starter",
      languageTag: "zh",
      targetLanguage: "zh",
      baseLanguage: "en",
      kind: "bundle",
      format: "json",
      version: "1.0.0",
      license: "CC-BY-SA-4.0",
      attribution:
        "Plethora Core Lexicon Starter (compatible with CC-CEDICT attribution model, CC-BY-SA-4.0)",
      capabilities: {
        offlineDictionary: true,
        readings: true,
        compounds: true,
        frequency: true,
      },
      description:
        "Lightweight embedded Mandarin Chinese-English starter dictionary with pinyin readings and core vocabulary.",
      availability: "embedded-starter",
    },
    entries: [
      {
        headword: "学习",
        reading: "xuéxí",
        lemma: "学习",
        pos: "verb",
        senses: [{ definition: "to learn; to study", glosses: ["learn", "study"] }],
        examples: ["我每天学习中文。"],
        frequencyRank: 88,
      },
      {
        headword: "书",
        reading: "shū",
        lemma: "书",
        pos: "noun",
        senses: [{ definition: "book; letter; document", glosses: ["book"] }],
        frequencyRank: 130,
      },
      {
        headword: "明白",
        reading: "míngbai",
        lemma: "明白",
        pos: "verb",
        senses: [{ definition: "to understand; clear; obvious", glosses: ["understand", "clear"] }],
        frequencyRank: 210,
      },
    ],
  },
  {
    manifest: {
      id: "plethora-starter-ko",
      name: "Plethora Korean Core Starter",
      languageTag: "ko",
      targetLanguage: "ko",
      baseLanguage: "en",
      kind: "bundle",
      format: "json",
      version: "1.0.0",
      license: "CC-BY-SA-4.0",
      attribution:
        "Plethora Core Lexicon Starter (compatible with Kengdic/NIKL open data, CC-BY-SA-4.0)",
      capabilities: {
        offlineDictionary: true,
        lemmaTable: true,
        readings: true,
        frequency: true,
      },
      description:
        "Lightweight embedded Korean-English starter dictionary with romanized readings, dictionary lemmas, and core entries.",
      availability: "embedded-starter",
    },
    entries: [
      {
        headword: "읽다",
        reading: "ikda",
        lemma: "읽다",
        pos: "verb",
        senses: [{ definition: "to read", glosses: ["read"] }],
        examples: ["매일 책을 읽다."],
        frequencyRank: 115,
      },
      {
        headword: "책",
        reading: "chaek",
        lemma: "책",
        pos: "noun",
        senses: [{ definition: "book", glosses: ["book"] }],
        frequencyRank: 92,
      },
      {
        headword: "말",
        reading: "mal",
        lemma: "말",
        pos: "noun",
        senses: [{ definition: "speech; word; language", glosses: ["word", "speech"] }],
        frequencyRank: 48,
      },
    ],
  },
  {
    manifest: {
      id: "plethora-starter-ar",
      name: "Plethora Arabic Core Starter",
      languageTag: "ar",
      targetLanguage: "ar",
      baseLanguage: "en",
      kind: "bundle",
      format: "json",
      version: "1.0.0",
      license: "CC-BY-SA-4.0",
      attribution:
        "Plethora Core Lexicon Starter (Buckwalter/Aralex-aligned open starter lexicon, CC-BY-SA-4.0)",
      capabilities: {
        offlineDictionary: true,
        lemmaTable: true,
        readings: true,
        morphology: true,
        frequency: true,
      },
      description:
        "Lightweight embedded Arabic-English starter dictionary with vocalized readings, triliteral roots, and core definitions.",
      availability: "embedded-starter",
    },
    entries: [
      {
        headword: "كتاب",
        reading: "kitāb",
        lemma: "كِتَاب",
        pos: "noun",
        morphology: { root: "ك-ت-ب", number: "singular", plural: "كتب" },
        senses: [{ definition: "book; writing", glosses: ["book"] }],
        examples: ["قرأت كتابا مفيدا."],
        frequencyRank: 84,
      },
      {
        headword: "قرأ",
        reading: "qaraʾa",
        lemma: "قَرَأَ",
        pos: "verb",
        morphology: { root: "ق-ر-أ", form: "I" },
        senses: [{ definition: "to read; to recite", glosses: ["read", "recite"] }],
        frequencyRank: 122,
      },
      {
        headword: "كلمة",
        reading: "kalima",
        lemma: "كَلِمَة",
        pos: "noun",
        morphology: { root: "ك-ل-م", gender: "feminine" },
        senses: [{ definition: "word; speech; remark", glosses: ["word"] }],
        frequencyRank: 96,
      },
    ],
  },
  {
    manifest: {
      id: "plethora-starter-it",
      name: "Plethora Italian Core Starter",
      languageTag: "it",
      targetLanguage: "it",
      baseLanguage: "en",
      kind: "bundle",
      format: "json",
      version: "1.0.0",
      license: "CC-BY-SA-4.0",
      attribution:
        "Plethora Core Lexicon Starter (derived from Wiktionary/Kaikki & FreeDict community open data, CC-BY-SA-4.0)",
      capabilities: {
        offlineDictionary: true,
        lemmaTable: true,
        frequency: true,
        morphology: true,
      },
      description:
        "Lightweight embedded Italian-English starter dictionary with lemmas, gender morphology, and core vocabulary.",
      availability: "embedded-starter",
    },
    entries: [
      {
        headword: "parlare",
        lemma: "parlare",
        pos: "verb",
        morphology: { conjugation: "are", auxiliary: "avere" },
        senses: [{ definition: "to speak; to talk", glosses: ["speak", "talk"] }],
        examples: ["Parlare una nuova lingua apre molte porte."],
        frequencyRank: 58,
      },
      {
        headword: "libro",
        lemma: "libro",
        pos: "noun",
        morphology: { gender: "masculine", plural: "libri" },
        senses: [{ definition: "book", glosses: ["book"] }],
        frequencyRank: 118,
      },
      {
        headword: "capire",
        lemma: "capire",
        pos: "verb",
        morphology: { conjugation: "ire-isc" },
        senses: [{ definition: "to understand", glosses: ["understand"] }],
        frequencyRank: 74,
      },
    ],
  },
  {
    manifest: {
      id: "plethora-starter-pt",
      name: "Plethora Portuguese Core Starter",
      languageTag: "pt",
      targetLanguage: "pt",
      baseLanguage: "en",
      kind: "bundle",
      format: "json",
      version: "1.0.0",
      license: "CC-BY-SA-4.0",
      attribution:
        "Plethora Core Lexicon Starter (derived from Wiktionary/Kaikki & FreeDict community open data, CC-BY-SA-4.0)",
      capabilities: {
        offlineDictionary: true,
        lemmaTable: true,
        frequency: true,
        morphology: true,
      },
      description:
        "Lightweight embedded Portuguese-English starter dictionary with lemmas, morphology, and core entries.",
      availability: "embedded-starter",
    },
    entries: [
      {
        headword: "falar",
        lemma: "falar",
        pos: "verb",
        morphology: { conjugation: "ar" },
        senses: [{ definition: "to speak; to talk", glosses: ["speak", "talk"] }],
        examples: ["Gosto de falar português."],
        frequencyRank: 52,
      },
      {
        headword: "livro",
        lemma: "livro",
        pos: "noun",
        morphology: { gender: "masculine", plural: "livros" },
        senses: [{ definition: "book", glosses: ["book"] }],
        frequencyRank: 114,
      },
      {
        headword: "ler",
        lemma: "ler",
        pos: "verb",
        senses: [{ definition: "to read", glosses: ["read"] }],
        frequencyRank: 81,
      },
    ],
  },
];

// Precomputed SHA-256 hex digests and UTF-8 byte lengths for the deterministic
// embedded starter payloads above, verified by `packs.test.ts`.
const STARTER_DIGESTS: Record<string, { sizeBytes: number; sha256: string }> = {
  "plethora-starter-es": {
    sizeBytes: 1014,
    sha256: "0d73fb23203a04f7eaca026c2b524215d4bc8df6305a682d945e3897959e79c5",
  },
  "plethora-starter-fr": {
    sizeBytes: 782,
    sha256: "453dbd17ea72dd585dcd2fe2e0cec09218eb48811e83631b0fb588c302244fa9",
  },
  "plethora-starter-de": {
    sizeBytes: 702,
    sha256: "fde6dd5266b0c0052c409d49611f75464998a58ef84d0edcff303cd67d68b095",
  },
  "plethora-starter-ja": {
    sizeBytes: 712,
    sha256: "0e2392ddcc9cd0b792f0aa4f21859e5ff06d6606bf93116948beaf9a8a029f9c",
  },
  "plethora-starter-zh": {
    sizeBytes: 624,
    sha256: "83d32409bac137a6c1a81cd203df27a3410c0b89480ca90c50ef123ad0a7f953",
  },
  "plethora-starter-ko": {
    sizeBytes: 557,
    sha256: "cbc5059eaf915f5ffc8b335c0eb29993a72ba457746ed9147d7dde65e08bb95f",
  },
  "plethora-starter-ar": {
    sizeBytes: 796,
    sha256: "54978cd9d91e97b182e1bad3ff7f4072ab89b72ea0d509760298d39e3aaed51f",
  },
  "plethora-starter-it": {
    sizeBytes: 692,
    sha256: "576645a5a7a9fb5d983934cd8875d74bd4e406cf622a12fd6822b385c8b32407",
  },
  "plethora-starter-pt": {
    sizeBytes: 595,
    sha256: "f309fe8d92b19d0a56a619b9c8c8514b3cd45126b37d515930ae2246778673a5",
  },
};

const utf8Encoder = new TextEncoder();

function serializeStarterPayload(seed: StarterPackSeed): string {
  return JSON.stringify({
    packId: seed.manifest.id,
    version: seed.manifest.version,
    languageTag: seed.manifest.languageTag,
    entries: seed.entries,
  });
}

const STARTER_PAYLOAD_MAP = new Map<string, Uint8Array>(
  STARTER_SEEDS.map((seed) => [seed.manifest.id, utf8Encoder.encode(serializeStarterPayload(seed))]),
);

const EMBEDDED_STARTER_MANIFESTS: LanguagePackManifest[] = STARTER_SEEDS.map((seed) => {
  const bytes = STARTER_PAYLOAD_MAP.get(seed.manifest.id)!;
  const digest = STARTER_DIGESTS[seed.manifest.id];
  return {
    ...seed.manifest,
    sizeBytes: bytes.byteLength,
    sha256: digest?.sha256 ?? "",
  };
});

/**
 * Curated upstream open-license dictionaries.
 *
 * We intentionally omit invented CDN URLs that would 404; instead each entry
 * points to its authentic upstream homepage / distribution portal and supports
 * 100% offline local file import via `importLocalPack`.
 */
export const COMMUNITY_PACK_CATALOG: readonly LanguagePackManifest[] = [
  {
    id: "freedict-spa-eng",
    name: "FreeDict Spanish–English Dictionary",
    languageTag: "es",
    targetLanguage: "es",
    baseLanguage: "en",
    kind: "dictionary",
    format: "stardict",
    version: "0.3.1",
    sizeBytes: 3_400_000,
    sha256: "",
    license: "CC-BY-SA-3.0 / GPL-3.0",
    attribution: "FreeDict Project (freedict.org) — TEI / StarDict community release",
    capabilities: { offlineDictionary: true },
    description:
      "Community-maintained Spanish-English bilingual dictionary in StarDict format. Import a local FreeDict StarDict archive offline.",
    availability: "local-import",
    homepageUrl: "https://freedict.org/",
    mirrors: [
      {
        label: "FreeDict Official Portal",
        homepageUrl: "https://freedict.org/downloads/",
        formatNote: "Select spa-eng StarDict (.tar.xz / .zip)",
      },
    ],
  },
  {
    id: "kaikki-es-wiktextract",
    name: "Kaikki / Wiktionary Spanish Lexicon",
    languageTag: "es",
    targetLanguage: "es",
    baseLanguage: "en",
    kind: "bundle",
    format: "kaikki-jsonl",
    version: "2026-wiktionary",
    sizeBytes: 98_000_000,
    sha256: "",
    license: "CC-BY-SA-4.0",
    attribution: "Wiktionary contributors & Tatu Ylonen (wiktextract / kaikki.org), CC-BY-SA-4.0",
    capabilities: { offlineDictionary: true, lemmaTable: true, morphology: true, readings: true },
    description:
      "Rich Spanish Wiktionary extract with inflection forms, IPA pronunciations, etymologies, and example sentences.",
    availability: "local-import",
    homepageUrl: "https://kaikki.org/dictionary/Spanish/",
    mirrors: [
      {
        label: "Kaikki.org Spanish JSONL",
        homepageUrl: "https://kaikki.org/dictionary/Spanish/",
        formatNote: "kaikki.org-dictionary-Spanish.jsonl",
      },
    ],
  },
  {
    id: "freedict-fra-eng",
    name: "FreeDict French–English Dictionary",
    languageTag: "fr",
    targetLanguage: "fr",
    baseLanguage: "en",
    kind: "dictionary",
    format: "stardict",
    version: "0.4.1",
    sizeBytes: 4_100_000,
    sha256: "",
    license: "CC-BY-SA-3.0 / GPL-3.0",
    attribution: "FreeDict Project (freedict.org) — French–English bilingual lexicon",
    capabilities: { offlineDictionary: true },
    description:
      "Open-source French-English StarDict dictionary. Download from FreeDict and import locally offline.",
    availability: "local-import",
    homepageUrl: "https://freedict.org/",
    mirrors: [
      {
        label: "FreeDict Official Portal",
        homepageUrl: "https://freedict.org/downloads/",
        formatNote: "Select fra-eng StarDict package",
      },
    ],
  },
  {
    id: "kaikki-fr-wiktextract",
    name: "Kaikki / Wiktionary French Lexicon",
    languageTag: "fr",
    targetLanguage: "fr",
    baseLanguage: "en",
    kind: "bundle",
    format: "kaikki-jsonl",
    version: "2026-wiktionary",
    sizeBytes: 125_000_000,
    sha256: "",
    license: "CC-BY-SA-4.0",
    attribution: "Wiktionary contributors & Kaikki/wiktextract (kaikki.org), CC-BY-SA-4.0",
    capabilities: { offlineDictionary: true, lemmaTable: true, morphology: true, readings: true },
    description:
      "Complete French Wiktionary JSONL export with IPA pronunciations, verb conjugations, and glosses.",
    availability: "local-import",
    homepageUrl: "https://kaikki.org/dictionary/French/",
    mirrors: [
      {
        label: "Kaikki.org French JSONL",
        homepageUrl: "https://kaikki.org/dictionary/French/",
        formatNote: "kaikki.org-dictionary-French.jsonl",
      },
    ],
  },
  {
    id: "freedict-deu-eng",
    name: "FreeDict German–English Dictionary",
    languageTag: "de",
    targetLanguage: "de",
    baseLanguage: "en",
    kind: "dictionary",
    format: "stardict",
    version: "1.9",
    sizeBytes: 18_500_000,
    sha256: "",
    license: "GPL-3.0 / CC-BY-SA-3.0",
    attribution: "FreeDict Project (freedict.org) — German–English community dictionary",
    capabilities: { offlineDictionary: true, compounds: true },
    description:
      "Large FreeDict German-English dictionary in StarDict format suitable for local offline import.",
    availability: "local-import",
    homepageUrl: "https://freedict.org/",
    mirrors: [
      {
        label: "FreeDict Official Portal",
        homepageUrl: "https://freedict.org/downloads/",
        formatNote: "Select deu-eng StarDict package",
      },
    ],
  },
  {
    id: "jmdict-ja-yomichan",
    name: "JMdict Japanese–English (Yomichan/Yomitan)",
    languageTag: "ja",
    targetLanguage: "ja",
    baseLanguage: "en",
    kind: "bundle",
    format: "yomichan-zip",
    version: "2026-edrdg",
    sizeBytes: 24_000_000,
    sha256: "",
    license: "CC-BY-SA-4.0",
    attribution:
      "Electronic Dictionary Research and Development Group (EDRDG) — JMdict/EDICT, CC-BY-SA-4.0",
    capabilities: {
      offlineDictionary: true,
      readings: true,
      lemmaTable: true,
      frequency: true,
    },
    description:
      "JMdict Japanese-English lexicon packaged in Yomichan/Yomitan ZIP format (`index.json` + `term_bank_*.json`).",
    availability: "local-import",
    homepageUrl: "https://www.edrdg.org/jmdict/j_jmdict.html",
    mirrors: [
      {
        label: "EDRDG JMdict Project",
        homepageUrl: "https://www.edrdg.org/jmdict/j_jmdict.html",
        formatNote: "Import any JMdict Yomichan/Yomitan .zip archive locally",
      },
    ],
  },
  {
    id: "cc-cedict-zh",
    name: "CC-CEDICT Mandarin Chinese–English",
    languageTag: "zh",
    targetLanguage: "zh",
    baseLanguage: "en",
    kind: "dictionary",
    format: "yomichan-zip",
    version: "2026-cedict",
    sizeBytes: 11_200_000,
    sha256: "",
    license: "CC-BY-SA-4.0",
    attribution: "MDBG / CC-CEDICT community contributors (cc-cedict.org), CC-BY-SA-4.0",
    capabilities: { offlineDictionary: true, readings: true, compounds: true },
    description:
      "Standard open-source Mandarin Chinese-English dictionary with simplified/traditional headwords and pinyin readings.",
    availability: "local-import",
    homepageUrl: "https://cc-cedict.org/wiki/",
    mirrors: [
      {
        label: "CC-CEDICT Wiki & Downloads",
        homepageUrl: "https://cc-cedict.org/wiki/",
        formatNote: "Import CC-CEDICT converted to Yomichan ZIP, TSV, or JSON locally",
      },
    ],
  },
  {
    id: "kengdic-nikl-ko",
    name: "Kengdic / NIKL Korean–English Lexicon",
    languageTag: "ko",
    targetLanguage: "ko",
    baseLanguage: "en",
    kind: "bundle",
    format: "tsv",
    version: "2026-open",
    sizeBytes: 6_800_000,
    sha256: "",
    license: "CC-BY-SA-4.0 / KOGL-BY-SA",
    attribution:
      "Kengdic (github.com/garfieldnate/kengdic) & National Institute of Korean Language (NIKL) Learners' Dictionary",
    capabilities: { offlineDictionary: true, lemmaTable: true, readings: true },
    description:
      "Open Korean-English learner dictionary compatible with TSV or Kaikki JSONL local imports.",
    availability: "local-import",
    homepageUrl: "https://krdict.korean.go.kr/",
    mirrors: [
      {
        label: "NIKL Korean-English Learners' Dictionary",
        homepageUrl: "https://krdict.korean.go.kr/",
        formatNote: "CC-BY-SA 2.0 KR open dataset",
      },
      {
        label: "Kengdic Open Korean Dictionary",
        homepageUrl: "https://github.com/garfieldnate/kengdic",
        formatNote: "TSV export compatible with Plethora TSV parser",
      },
    ],
  },
  {
    id: "buckwalter-aralex-ar",
    name: "Buckwalter / Aralex & FreeDict Arabic–English",
    languageTag: "ar",
    targetLanguage: "ar",
    baseLanguage: "en",
    kind: "bundle",
    format: "stardict",
    version: "1.0-open",
    sizeBytes: 5_400_000,
    sha256: "",
    license: "GPL-3.0 / CC-BY-SA-3.0",
    attribution:
      "Tim Buckwalter AraMorph / Aralex open lexicon & FreeDict Arabic–English (GPL / CC-BY-SA)",
    capabilities: { offlineDictionary: true, lemmaTable: true, morphology: true, readings: true },
    description:
      "Arabic-English morphological and lexical pack supporting StarDict or Kaikki JSONL local files.",
    availability: "local-import",
    homepageUrl: "https://freedict.org/",
    mirrors: [
      {
        label: "FreeDict Arabic–English",
        homepageUrl: "https://freedict.org/downloads/",
        formatNote: "ara-eng StarDict archive",
      },
    ],
  },
  {
    id: "freedict-ita-eng",
    name: "FreeDict Italian–English Dictionary",
    languageTag: "it",
    targetLanguage: "it",
    baseLanguage: "en",
    kind: "dictionary",
    format: "stardict",
    version: "0.2",
    sizeBytes: 2_900_000,
    sha256: "",
    license: "GPL-3.0 / CC-BY-SA-3.0",
    attribution: "FreeDict Project (freedict.org) — Italian–English bilingual dictionary",
    capabilities: { offlineDictionary: true },
    description:
      "Open-source Italian-English StarDict dictionary for local offline import.",
    availability: "local-import",
    homepageUrl: "https://freedict.org/",
    mirrors: [
      {
        label: "FreeDict Official Portal",
        homepageUrl: "https://freedict.org/downloads/",
        formatNote: "Select ita-eng StarDict package",
      },
    ],
  },
  {
    id: "freedict-por-eng",
    name: "FreeDict Portuguese–English Dictionary",
    languageTag: "pt",
    targetLanguage: "pt",
    baseLanguage: "en",
    kind: "dictionary",
    format: "stardict",
    version: "0.2",
    sizeBytes: 2_750_000,
    sha256: "",
    license: "GPL-3.0 / CC-BY-SA-3.0",
    attribution: "FreeDict Project (freedict.org) — Portuguese–English bilingual dictionary",
    capabilities: { offlineDictionary: true },
    description:
      "Open-source Portuguese-English StarDict dictionary for local offline import.",
    availability: "local-import",
    homepageUrl: "https://freedict.org/",
    mirrors: [
      {
        label: "FreeDict Official Portal",
        homepageUrl: "https://freedict.org/downloads/",
        formatNote: "Select por-eng StarDict package",
      },
    ],
  },
];

export const LANGUAGE_PACK_CATALOG: readonly LanguagePackManifest[] = [
  ...EMBEDDED_STARTER_MANIFESTS,
  ...COMMUNITY_PACK_CATALOG,
];

export interface CatalogFilter {
  languageTag?: string;
  kind?: LanguagePackKind;
  format?: LanguagePackFormat;
  availability?: LanguagePackAvailability;
}

export function filterCatalogPacks(
  catalog: readonly LanguagePackManifest[],
  filter?: CatalogFilter,
): LanguagePackManifest[] {
  if (!filter) return [...catalog];
  const targetLangBase = filter.languageTag?.trim().toLowerCase().split(/[-_]/)[0];
  return catalog.filter((pack) => {
    if (targetLangBase) {
      const packBase = pack.languageTag.trim().toLowerCase().split(/[-_]/)[0];
      if (packBase !== targetLangBase) return false;
    }
    if (filter.kind && pack.kind !== filter.kind) return false;
    if (filter.format && pack.format !== filter.format) return false;
    if (filter.availability && pack.availability !== filter.availability) return false;
    return true;
  });
}

export function findCatalogPack(
  packId: string,
  catalog: readonly LanguagePackManifest[] = LANGUAGE_PACK_CATALOG,
): LanguagePackManifest | undefined {
  return catalog.find((pack) => pack.id === packId);
}

export function getStarterPackBytes(packId: string): Uint8Array | null {
  const bytes = STARTER_PAYLOAD_MAP.get(packId);
  if (!bytes) return null;
  return new Uint8Array(bytes);
}

export function getStarterPackEntries(packId: string): ParsedDictionaryEntry[] | null {
  const seed = STARTER_SEEDS.find((item) => item.manifest.id === packId);
  if (!seed) return null;
  return seed.entries.map((entry) => ({
    ...entry,
    normalizedHeadword: entry.headword.normalize("NFC").toLocaleLowerCase(seed.manifest.languageTag),
  }));
}
