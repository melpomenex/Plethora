import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  LANGUAGE_PACK_CATALOG,
  LanguagePackError,
  LanguagePackManager,
  MemoryLanguagePackStorageAdapter,
  getStarterPackBytes,
  parseJsonDictionary,
  parseKaikkiJsonl,
  parseLanguagePackPayload,
  parseStarDictFiles,
  parseTsvDictionary,
  parseYomichanZip,
  parseYomichanZipWithMeta,
  sha256Hex,
  sha256HexSync,
  type LanguagePackManifest,
  type PackInstallProgress,
} from "../index";

const encoder = new TextEncoder();

function buildStarDictFixture(
  items: Array<{ word: string; payload: Uint8Array }>,
  options: { sametypesequence?: string; bookname?: string } = {},
): { ifo: string; idx: Uint8Array; dict: Uint8Array } {
  const dictChunks: Uint8Array[] = [];
  const idxChunks: Uint8Array[] = [];
  let dictOffset = 0;

  for (const item of items) {
    const wordBytes = encoder.encode(item.word);
    const entryIdx = new Uint8Array(wordBytes.length + 1 + 8);
    entryIdx.set(wordBytes, 0);
    entryIdx[wordBytes.length] = 0; // null terminator
    const view = new DataView(entryIdx.buffer);
    view.setUint32(wordBytes.length + 1, dictOffset, false);
    view.setUint32(wordBytes.length + 5, item.payload.length, false);
    idxChunks.push(entryIdx);

    dictChunks.push(item.payload);
    dictOffset += item.payload.length;
  }

  const totalIdxSize = idxChunks.reduce((sum, c) => sum + c.length, 0);
  const idx = new Uint8Array(totalIdxSize);
  let idxCursor = 0;
  for (const chunk of idxChunks) {
    idx.set(chunk, idxCursor);
    idxCursor += chunk.length;
  }

  const dict = new Uint8Array(dictOffset);
  let dictCursor = 0;
  for (const chunk of dictChunks) {
    dict.set(chunk, dictCursor);
    dictCursor += chunk.length;
  }

  const ifoLines = [
    "StarDict's dict ifo file",
    "version=2.4.2",
    `bookname=${options.bookname ?? "Test StarDict"}`,
    `wordcount=${items.length}`,
    `idxfilesize=${idx.length}`,
    ...(options.sametypesequence ? [`sametypesequence=${options.sametypesequence}`] : []),
  ];

  return {
    ifo: ifoLines.join("\n") + "\n",
    idx,
    dict,
  };
}

describe("LanguagePack catalog & digests", () => {
  it("covers all 9 target languages with authentic licenses and zero invented CDN URLs", () => {
    const expectedLanguages = ["es", "fr", "de", "ja", "zh", "ko", "ar", "it", "pt"];
    const catalogLanguages = new Set(LANGUAGE_PACK_CATALOG.map((p) => p.languageTag));
    for (const lang of expectedLanguages) {
      expect(catalogLanguages.has(lang)).toBe(true);
    }

    for (const pack of LANGUAGE_PACK_CATALOG) {
      expect(pack.license.length).toBeGreaterThan(0);
      expect(pack.attribution.length).toBeGreaterThan(0);
      expect(pack.downloadUrl).toBeUndefined();
    }
  });

  it("has exact SHA-256 and byte sizes for every embedded starter pack", async () => {
    const starters = LANGUAGE_PACK_CATALOG.filter((p) => p.availability === "embedded-starter");
    expect(starters).toHaveLength(9);

    for (const starter of starters) {
      const bytes = getStarterPackBytes(starter.id);
      expect(bytes).not.toBeNull();
      expect(bytes!.byteLength).toBe(starter.sizeBytes);
      const actual = await sha256Hex(bytes!);
      expect(actual).toBe(starter.sha256);
    }
  });

  it("computes standard SHA-256 vectors via both WebCrypto and pure-TS fallback", async () => {
    const abc = encoder.encode("abc");
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(sha256HexSync(abc)).toBe(expected);
    expect(await sha256Hex(abc)).toBe(expected);

    const empty = new Uint8Array(0);
    const expectedEmpty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(sha256HexSync(empty)).toBe(expectedEmpty);
    expect(await sha256Hex(empty)).toBe(expectedEmpty);
  });
});

describe("Dictionary parsers", () => {
  it("parses Plethora pack JSON (object and array forms)", () => {
    const packJson = JSON.stringify({
      packId: "test-es",
      entries: [
        {
          headword: "Canción",
          reading: "/kanˈθjon/",
          lemma: "canción",
          pos: "noun",
          morphology: { gender: "feminine" },
          senses: [{ definition: "song", glosses: ["song", "tune"], tags: ["music"] }],
          examples: ["Es una canción hermosa."],
          frequencyRank: 310,
        },
      ],
    });

    const parsed = parseJsonDictionary(packJson, "es");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      headword: "Canción",
      normalizedHeadword: "canción",
      reading: "/kanˈθjon/",
      lemma: "canción",
      pos: "noun",
      morphology: { gender: "feminine" },
      examples: ["Es una canción hermosa."],
      frequencyRank: 310,
    });
    expect(parsed[0].senses[0].glosses).toEqual(["song", "tune"]);

    const arrayParsed = parseJsonDictionary(
      JSON.stringify([{ word: "casa", definition: "house", pos: "noun" }]),
      "es",
    );
    expect(arrayParsed).toHaveLength(1);
    expect(arrayParsed[0].senses[0].definition).toBe("house");
  });

  it("parses Kaikki / Wiktionary JSONL line-by-line with readings, glosses, examples, and form_of lemmas", () => {
    const lines = [
      JSON.stringify({
        word: "hablo",
        lang_code: "es",
        pos: "verb",
        sounds: [{ ipa: "/ˈablo/" }],
        senses: [
          {
            glosses: ["first-person singular present indicative of hablar"],
            form_of: [{ word: "hablar" }],
            tags: ["form-of", "first-person", "present"],
            examples: [{ text: "Yo hablo español.", english: "I speak Spanish." }],
          },
        ],
      }),
      "",
      JSON.stringify({
        word: "house",
        lang_code: "en",
        pos: "noun",
        senses: [{ glosses: ["a dwelling"] }],
      }),
      JSON.stringify({
        word: "gato",
        lang_code: "es",
        pos: "noun",
        senses: [{ glosses: ["cat"], tags: ["animal"] }],
      }),
    ].join("\n");

    const parsedViaJson = parseJsonDictionary(lines, "es");
    const parsedDirect = parseKaikkiJsonl(lines, "es");
    expect(parsedViaJson).toEqual(parsedDirect);

    // `en` entry is filtered out when parsing for `es`.
    expect(parsedViaJson).toHaveLength(2);
    expect(parsedViaJson[0]).toMatchObject({
      headword: "hablo",
      normalizedHeadword: "hablo",
      reading: "/ˈablo/",
      lemma: "hablar",
      pos: "verb",
      examples: ["Yo hablo español. — I speak Spanish."],
    });
    expect(parsedViaJson[0].senses[0].tags).toContain("form-of");
    expect(parsedViaJson[1].headword).toBe("gato");

    expect(() => parseKaikkiJsonl("{not-valid-json\n", "es")).toThrow(LanguagePackError);
  });

  it("parses TSV dictionaries with header, comments, and optional frequencyRank", () => {
    const tsv = [
      "# Sample Korean TSV dictionary",
      "headword\treading\tlemma\tpos\tdefinition\texample\tfrequencyRank",
      "",
      "읽어요\tilgeoyo\t읽다\tverb\treads (polite present)\t책을 읽어요.\t115",
      "친구\tchingu\t친구\tnoun\tfriend\t좋은 친구\t82",
    ].join("\n");

    const parsed = parseTsvDictionary(tsv, "ko");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      headword: "읽어요",
      normalizedHeadword: "읽어요",
      reading: "ilgeoyo",
      lemma: "읽다",
      pos: "verb",
      senses: [{ definition: "reads (polite present)" }],
      examples: ["책을 읽어요."],
      frequencyRank: 115,
    });
    expect(parsed[1].headword).toBe("친구");
  });

  it("parses Yomichan / Yomitan ZIP archives built with jszip", async () => {
    const zip = new JSZip();
    zip.file(
      "index.json",
      JSON.stringify({
        title: "JMdict Test",
        revision: "jmdict-2026-01",
        format: 3,
        attribution: "EDRDG CC-BY-SA 4.0",
      }),
    );
    zip.file(
      "term_bank_1.json",
      JSON.stringify([
        ["食べる", "たべる", "v1 vt", "v1", 10, ["to eat"], 1001, "ichi1"],
        [
          "本",
          "ほん",
          "n",
          "",
          0,
          [
            {
              type: "structured-content",
              content: [
                { tag: "span", content: "book" },
                { tag: "span", content: "volume" },
              ],
            },
          ],
          1002,
          "news1",
        ],
      ]),
    );
    zip.file(
      "term_bank_2.json",
      JSON.stringify([["走る", "はしる", "v5r", "v5", 0, ["to run"], 1003, ""]]),
    );
    zip.file(
      "term_meta_bank_1.json",
      JSON.stringify([
        ["本", "freq", { reading: "ほん", frequency: { value: 42, displayValue: "42" } }],
        ["走る", "freq", 180],
      ]),
    );

    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const { index, entries } = await parseYomichanZipWithMeta(zipBytes, "ja");
    expect(index?.title).toBe("JMdict Test");
    expect(entries).toHaveLength(3);

    expect(entries[0]).toMatchObject({
      headword: "食べる",
      reading: "たべる",
      pos: "v1",
      morphology: { inflectionRules: "v1" },
      senses: [{ definition: "to eat", tags: ["v1", "vt", "ichi1"] }],
      frequencyRank: 10,
    });
    expect(entries[1]).toMatchObject({
      headword: "本",
      reading: "ほん",
      pos: "n",
      senses: [{ definition: "book volume", tags: ["n", "news1"] }],
      frequencyRank: 42,
    });
    expect(entries[2]).toMatchObject({
      headword: "走る",
      reading: "はしる",
      frequencyRank: 180,
    });

    const directEntries = await parseYomichanZip(zipBytes, "ja");
    expect(directEntries).toHaveLength(3);
  });

  it("parses StarDict .ifo, .idx, and .dict binary files (plain, tm, and XDXF XML)", async () => {
    const xdxf =
      "<ar><k>parlare</k><tr>/parˈla.re/</tr><pos>verb</pos><dtrn>to speak</dtrn><ex>Parlare italiano.</ex></ar>";
    const fixture = buildStarDictFixture(
      [
        { word: "libro", payload: encoder.encode("book; volume") },
        { word: "parlare", payload: encoder.encode(xdxf) },
      ],
      { sametypesequence: "x", bookname: "FreeDict ITA-ENG" },
    );

    const parsed = parseStarDictFiles(fixture, "it");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      headword: "libro",
      normalizedHeadword: "libro",
      senses: [{ definition: "book; volume" }],
    });
    expect(parsed[1]).toMatchObject({
      headword: "parlare",
      reading: "/parˈla.re/",
      pos: "verb",
      senses: [{ definition: "to speak" }],
      examples: ["Parlare italiano."],
    });

    // Multi-field `sametypesequence=tm` (phonetic \0 definition)
    const tmPayload = new Uint8Array([
      ...encoder.encode("/ˈka.za/"),
      0,
      ...encoder.encode("house; home"),
    ]);
    const tmFixture = buildStarDictFixture([{ word: "casa", payload: tmPayload }], {
      sametypesequence: "tm",
    });
    const tmParsed = parseStarDictFiles(tmFixture, "it");
    expect(tmParsed[0]).toMatchObject({
      headword: "casa",
      reading: "/ˈka.za/",
      senses: [{ definition: "house; home" }],
    });

    // Also verify StarDict zipped bundle via unified payload parser
    const zip = new JSZip();
    zip.file("dict.ifo", fixture.ifo);
    zip.file("dict.idx", fixture.idx);
    zip.file("dict.dict", fixture.dict);
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const fromZip = await parseLanguagePackPayload("stardict", zipBytes, "it");
    expect(fromZip).toHaveLength(2);

    // Truncated / out-of-bounds idx throws LanguagePackError
    expect(() =>
      parseStarDictFiles(
        {
          ifo: fixture.ifo,
          idx: fixture.idx.subarray(0, fixture.idx.length - 3),
          dict: fixture.dict,
        },
        "it",
      ),
    ).toThrow(LanguagePackError);
  });
});

describe("LanguagePackManager lifecycle", () => {
  it("installs embedded starter packs, supports lookup & lemma fallback, and tracks storage/attribution", async () => {
    const storage = new MemoryLanguagePackStorageAdapter(() => 1_700_000_000_000);
    const manager = new LanguagePackManager({ storage, now: () => 1_700_000_000_000 });

    const esInstalled = await manager.installStarterPack("plethora-starter-es");
    const jaInstalled = await manager.installStarterPack("plethora-starter-ja");

    expect(esInstalled.status).toBe("installed");
    expect(esInstalled.entryCount).toBe(4);
    expect(jaInstalled.status).toBe("installed");

    // Exact lookup + normalization
    const exactEs = await manager.lookup({ query: "HABLAR", languageTag: "es-MX" });
    expect(exactEs.length).toBeGreaterThanOrEqual(1);
    expect(exactEs[0].headword).toBe("hablar");

    // Reading lookup in Japanese
    const jaByReading = await manager.lookup({ query: "たべる", languageTag: "ja" });
    expect(jaByReading).toHaveLength(1);
    expect(jaByReading[0].headword).toBe("食べる");

    // Storage usage summary
    const summary = await manager.getStorageUsage();
    expect(summary.totalPacks).toBe(2);
    expect(summary.installedPacks).toBe(2);
    expect(summary.corruptPacks).toBe(0);
    expect(summary.totalEntries).toBe(7);
    expect(summary.byLanguage.es.entryCount).toBe(4);
    expect(summary.byLanguage.ja.entryCount).toBe(3);

    // Attribution listing
    const attributions = await manager.listAttribution();
    expect(attributions).toHaveLength(2);
    expect(attributions.map((a) => a.license)).toEqual(["CC-BY-SA-4.0", "CC-BY-SA-4.0"]);

    // Removal cleans up pack and entries
    const removed = await manager.removePack("plethora-starter-es");
    expect(removed).toBe(true);
    expect(await manager.lookup({ query: "hablar", languageTag: "es" })).toHaveLength(0);
    expect((await manager.getStorageUsage()).totalPacks).toBe(1);
  });

  it("imports local TSV and StarDict files 100% offline", async () => {
    const manager = new LanguagePackManager();

    const tsvBytes = encoder.encode(
      "headword\treading\tlemma\tpos\tdefinition\texample\nbonjour\t/bɔ̃.ʒuʁ/\tbonjour\tinterj\thello; good day\tBonjour !\n",
    );
    const localTsv = await manager.importLocalPack({
      fileName: "french-core.tsv",
      bytes: tsvBytes,
      languageTag: "fr",
      license: "CC0-1.0",
      attribution: "Local Test Corpus",
    });
    expect(localTsv.format).toBe("tsv");
    expect(localTsv.entryCount).toBe(1);

    const starDict = buildStarDictFixture(
      [{ word: "Buch", payload: encoder.encode("book") }],
      { sametypesequence: "m", bookname: "FreeDict DE-EN" },
    );
    const localStarDict = await manager.importLocalPack({
      id: "local-de-stardict",
      name: "Local German StarDict",
      languageTag: "de",
      files: starDict,
      license: "GPL-3.0",
      attribution: "FreeDict Local Import",
    });
    expect(localStarDict.format).toBe("stardict");
    expect(localStarDict.entryCount).toBe(1);

    const frHit = await manager.lookup({ query: "bonjour", languageTag: "fr" });
    expect(frHit[0].senses[0].definition).toBe("hello; good day");

    const deHit = await manager.lookup({ query: "Buch", languageTag: "de" });
    expect(deHit[0].senses[0].definition).toBe("book");
  });

  it("downloads with streaming progress, verifies SHA-256, and rejects checksum mismatches before committing", async () => {
    const manager = new LanguagePackManager();
    const payloadText = JSON.stringify({
      entries: [{ headword: "agua", lemma: "agua", pos: "noun", senses: [{ definition: "water" }] }],
    });
    const payloadBytes = encoder.encode(payloadText);
    const validSha = await sha256Hex(payloadBytes);

    const baseManifest: LanguagePackManifest = {
      id: "remote-es-test",
      name: "Remote Spanish Test",
      languageTag: "es",
      targetLanguage: "es",
      baseLanguage: "en",
      kind: "dictionary",
      format: "json",
      version: "1.0.0",
      sizeBytes: payloadBytes.byteLength,
      sha256: validSha,
      downloadUrl: "https://example.invalid/es-test.json",
      license: "CC-BY-SA-4.0",
      attribution: "Test Source",
      capabilities: { offlineDictionary: true },
      description: "Test remote download",
    };

    // 1) Mismatch checksum must fail BEFORE committing anything to storage.
    const badManifest: LanguagePackManifest = {
      ...baseManifest,
      id: "remote-es-bad",
      sha256: "0".repeat(64),
    };
    const mockFetch: typeof fetch = async () => {
      const mid = Math.floor(payloadBytes.length / 2);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payloadBytes.subarray(0, mid));
          controller.enqueue(payloadBytes.subarray(mid));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-length": String(payloadBytes.byteLength) },
      });
    };

    await expect(
      manager.downloadAndInstall(badManifest, { fetchImpl: mockFetch }),
    ).rejects.toMatchObject({ code: "checksum-mismatch" });
    expect(await manager.getInstalledPack("remote-es-bad")).toBeNull();
    expect(await manager.lookup({ query: "agua", languageTag: "es" })).toHaveLength(0);

    // 2) Valid checksum installs and emits progress phases.
    const phases: PackInstallProgress["phase"][] = [];
    const installed = await manager.downloadAndInstall(baseManifest, {
      fetchImpl: mockFetch,
      onProgress: (p) => phases.push(p.phase),
    });
    expect(installed.status).toBe("installed");
    expect(phases).toContain("downloading");
    expect(phases).toContain("verifying");
    expect(phases).toContain("parsing");
    expect(phases).toContain("storing");
    expect(phases[phases.length - 1]).toBe("completed");
  });

  it("cancels download cleanly via AbortSignal without leaving partial entries", async () => {
    const manager = new LanguagePackManager();
    const controller = new AbortController();

    const payloadBytes = encoder.encode(
      JSON.stringify({ entries: [{ headword: "sol", senses: [{ definition: "sun" }] }] }),
    );
    const manifest: LanguagePackManifest = {
      id: "abort-es-test",
      name: "Abortable Pack",
      languageTag: "es",
      targetLanguage: "es",
      kind: "dictionary",
      format: "json",
      version: "1.0.0",
      sizeBytes: payloadBytes.byteLength,
      sha256: await sha256Hex(payloadBytes),
      downloadUrl: "https://example.invalid/abort.json",
      license: "CC-BY-SA-4.0",
      attribution: "Test Source",
      capabilities: { offlineDictionary: true },
      description: "Test abort",
    };

    const abortingFetch: typeof fetch = async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(streamController) {
          streamController.enqueue(payloadBytes.subarray(0, 10));
          controller.abort();
        },
      });
      return new Response(stream, { status: 200 });
    };

    await expect(
      manager.downloadAndInstall(manifest, {
        signal: controller.signal,
        fetchImpl: abortingFetch,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });

    expect(await manager.getInstalledPack("abort-es-test")).toBeNull();
    expect(await manager.lookup({ query: "sol", languageTag: "es" })).toHaveLength(0);
  });

  it("detects corrupt packs (byte checksum corruption and missing entries) and repairs them", async () => {
    const storage = new MemoryLanguagePackStorageAdapter();
    const manager = new LanguagePackManager({ storage });

    await manager.installStarterPack("plethora-starter-es");
    const validCheck = await manager.verifyPack("plethora-starter-es");
    expect(validCheck.valid).toBe(true);
    expect(validCheck.status).toBe("installed");

    // 1) Simulate corrupted stored bytes
    await storage.corruptForTest("plethora-starter-es", "bytes");
    const corruptByteCheck = await manager.verifyPack("plethora-starter-es");
    expect(corruptByteCheck.valid).toBe(false);
    expect(corruptByteCheck.status).toBe("corrupt");
    expect(corruptByteCheck.reason).toContain("Checksum mismatch");

    // Corrupt packs are excluded from lookups and reflected in storage summary
    expect(await manager.lookup({ query: "hablar", languageTag: "es" })).toHaveLength(0);
    expect((await manager.getStorageUsage()).corruptPacks).toBe(1);

    // Repair restores installed state and entries
    const repaired = await manager.repairPack("plethora-starter-es");
    expect(repaired.status).toBe("installed");
    expect((await manager.verifyPack("plethora-starter-es")).valid).toBe(true);
    expect(await manager.lookup({ query: "hablar", languageTag: "es" })).toHaveLength(2);

    // 2) Simulate missing dictionary entries
    await storage.corruptForTest("plethora-starter-es", "entries");
    const corruptEntryCheck = await manager.verifyPack("plethora-starter-es");
    expect(corruptEntryCheck.valid).toBe(false);
    expect(corruptEntryCheck.status).toBe("corrupt");
    expect(corruptEntryCheck.reason).toContain("Entry count mismatch");

    await manager.repairPack("plethora-starter-es");
    expect((await manager.verifyPack("plethora-starter-es")).valid).toBe(true);
  });
});
