import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LanguagePeekService,
  type LanguagePeekProvider,
  offlinePackDictionaryProvider,
  wiktionaryMultilingualProvider,
  jishoDictionaryProvider,
  aiDictionaryFallbackProvider,
  languagePeekService,
} from "../index";
import * as languagePacksApi from "../../../api/languagePacks";
import * as aiProvider from "../../ai/provider";
import * as runTaskMod from "../../ai/tasks/runTask";
import * as cloudProviderMod from "../../ai/providers/cloudProvider";
import * as disclosureMod from "../../privacy/cloudAiDisclosure";

describe("LanguagePeekService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    languagePeekService.clear();
  });

  it("includes profile, analysis, phrase, and provider versions in cache identity", () => {
    const calls: string[] = [];
    const provider: LanguagePeekProvider = {
      id: "test",
      version: "2",
      supports: () => true,
      lookup: async ({ text }) => {
        calls.push(text);
        return { ok: true, result: { providerId: "test", providerVersion: "2", provenance: "local" } };
      },
    };
    const service = new LanguagePeekService({ providers: [provider] });
    return Promise.all([
      service.lookup("hablo", { profileId: "p1", languageTag: "es", analysis: { processingKey: "a" }, phrase: { phraseId: "x", normalizedForm: "hablo" } }),
      service.lookup("hablo", { profileId: "p1", languageTag: "es", analysis: { processingKey: "a" }, phrase: { phraseId: "x", normalizedForm: "hablo" } }),
      service.lookup("hablo", { profileId: "p2", languageTag: "es", analysis: { processingKey: "a" }, phrase: { phraseId: "x", normalizedForm: "hablo" } }),
    ]).then(() => expect(calls).toEqual(["hablo", "hablo"]));
  });

  it("dedupes in-flight lookups and supports cancellation without poisoning cache", async () => {
    let resolve!: (value: Awaited<ReturnType<LanguagePeekProvider["lookup"]>>) => void;
    const provider: LanguagePeekProvider = {
      id: "test",
      supports: () => true,
      lookup: vi.fn((() => new Promise<Awaited<ReturnType<LanguagePeekProvider["lookup"]>>>((r) => { resolve = r; }))),
    };
    const service = new LanguagePeekService({ providers: [provider] });
    const controller = new AbortController();
    const first = service.lookup("word", { profileId: "p" }, controller.signal);
    const second = service.lookup("word", { profileId: "p" });
    controller.abort();
    expect((await first).ok).toBe(false);
    resolve({ ok: true, result: { providerId: "test", provenance: "local" } });
    expect((await second).ok).toBe(true);
    expect(provider.lookup).toHaveBeenCalledTimes(1);
    expect((await service.lookup("word", { profileId: "p" })).ok).toBe(true);
  });

  it("supports registerProvider({ prepend }) and unregisterProvider(id) and falls back across all matching providers", async () => {
    const order: string[] = [];
    const primaryUnavailable: LanguagePeekProvider = {
      id: "primary-unavailable",
      supports: () => true,
      lookup: async () => {
        order.push("primary-unavailable");
        return { ok: false, failure: { kind: "unavailable", message: "No pack" } };
      },
    };
    const secondaryNotFound: LanguagePeekProvider = {
      id: "secondary-not-found",
      supports: () => true,
      lookup: async () => {
        order.push("secondary-not-found");
        return { ok: false, failure: { kind: "not-found" } };
      },
    };
    const tertiaryHit: LanguagePeekProvider = {
      id: "tertiary-hit",
      supports: () => true,
      lookup: async ({ text }) => {
        order.push("tertiary-hit");
        return {
          ok: true,
          result: {
            providerId: "tertiary-hit",
            provenance: "dedicated",
            dictionary: { word: text, senses: [{ definition: "fallback meaning" }], synonyms: [] },
          },
        };
      },
    };

    const service = new LanguagePeekService({ providers: [secondaryNotFound] });
    service.registerProvider(primaryUnavailable, { prepend: true });
    service.registerProvider(tertiaryHit);

    expect(service.getProviders().map((p) => p.id)).toEqual([
      "primary-unavailable",
      "secondary-not-found",
      "tertiary-hit",
    ]);

    const res = await service.lookup("hola", { languageTag: "es" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.providerId).toBe("tertiary-hit");
    }
    expect(order).toEqual(["primary-unavailable", "secondary-not-found", "tertiary-hit"]);

    expect(service.unregisterProvider("tertiary-hit")).toBe(true);
    expect(service.unregisterProvider("missing-id")).toBe(false);
    const failed = await service.lookup("hola", { languageTag: "es" });
    expect(failed).toEqual({ ok: false, failure: { kind: "not-found" } });
  });

  it("registers ordered default multilingual providers on languagePeekService", () => {
    expect(languagePeekService.getProviders().map((p) => p.id)).toEqual([
      "offline-language-pack",
      "jisho.org",
      "dictionaryapi.dev",
      "wiktionary-rest",
      "plethora-ai-dict",
    ]);
  });
});

describe("offlinePackDictionaryProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("looks up Spanish and Japanese entries from installed offline packs", async () => {
    const lookupSpy = vi.spyOn(languagePacksApi, "lookupLanguagePackDictionary");
    lookupSpy.mockResolvedValueOnce([
      {
        id: "es-1",
        packId: "pack-es",
        languageTag: "es",
        headword: "hablo",
        normalizedHeadword: "hablo",
        lemma: "hablar",
        partOfSpeech: "verb",
        morphology: { person: "1", tense: "present" },
        senses: [{ definition: "I speak" }],
        examples: ["Hablo español."],
      },
    ]);

    const esRes = await offlinePackDictionaryProvider.lookup({
      text: "hablo",
      languageTag: "es",
      context: { languageTag: "es", analysis: { lemma: "hablar" } },
    });
    expect(esRes.ok).toBe(true);
    if (esRes.ok) {
      expect(esRes.result.provenance).toBe("local");
      expect(esRes.result.providerId).toBe("offline-language-pack");
      expect(esRes.result.dictionary?.senses[0]).toEqual({
        partOfSpeech: "verb",
        definition: "I speak",
        example: "Hablo español.",
      });
    }

    lookupSpy.mockResolvedValueOnce([
      {
        id: "ja-1",
        packId: "pack-ja",
        languageTag: "ja",
        headword: "食べる",
        normalizedHeadword: "食べる",
        reading: "たべる",
        lemma: "食べる",
        partOfSpeech: "v1",
        morphology: { class: "ichidan" },
        senses: [{ definition: "to eat" }],
        examples: ["朝ご飯を食べる。"],
      },
    ]);

    const jaRes = await offlinePackDictionaryProvider.lookup({
      text: "食べる",
      languageTag: "ja",
    });
    expect(jaRes.ok).toBe(true);
    if (jaRes.ok) {
      expect(jaRes.result.provenance).toBe("local");
      expect(jaRes.result.dictionary?.phonetic).toBe("たべる");
      expect(jaRes.result.dictionary?.senses[0]?.definition).toBe("to eat");
    }
  });

  it("returns unavailable when no offline pack is installed and never fabricates starter entries", async () => {
    vi.spyOn(languagePacksApi, "lookupLanguagePackDictionary").mockResolvedValue([]);
    vi.spyOn(languagePacksApi, "listLanguagePacks").mockResolvedValue([]);

    const res = await offlinePackDictionaryProvider.lookup({
      text: "hablo",
      languageTag: "es",
    });
    expect(res).toEqual({
      ok: false,
      failure: { kind: "unavailable", message: "No offline dictionary pack installed" },
    });
  });

  it("uses embedded starter pack fallback ONLY when that starter pack is installed", async () => {
    vi.spyOn(languagePacksApi, "lookupLanguagePackDictionary").mockResolvedValue([]);
    vi.spyOn(languagePacksApi, "listLanguagePacks").mockResolvedValue([
      {
        id: "plethora-starter-es",
        languageTag: "es",
        targetLanguage: "es",
        baseLanguage: "en",
        name: "Plethora Spanish Core Starter",
        kind: "bundle",
        format: "json",
        version: "1.0.0",
        sha256: "abc",
        sizeBytes: 100,
        entryCount: 4,
        license: "CC-BY-SA-4.0",
        attribution: "Plethora",
        capabilities: {},
        status: "installed",
        installedAt: 1,
        updatedAt: 1,
      },
    ]);

    const res = await offlinePackDictionaryProvider.lookup({
      text: "hablo",
      languageTag: "es",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.provenance).toBe("local");
      expect(res.result.dictionary?.word).toBe("hablo");
      expect(res.result.dictionary?.senses[0]?.definition).toContain("I speak");
    }
  });
});

describe("wiktionaryMultilingualProvider & jishoDictionaryProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns offline-uncached for Wiktionary and Jisho when navigator.onLine is false", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const wikt = await wiktionaryMultilingualProvider.lookup({ text: "hablo", languageTag: "es" });
    const jisho = await jishoDictionaryProvider.lookup({ text: "食べる", languageTag: "ja" });

    expect(wikt).toEqual({ ok: false, failure: { kind: "offline-uncached" } });
    expect(jisho).toEqual({ ok: false, failure: { kind: "offline-uncached" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses Wiktionary REST definitions with HTML stripping and lemma fallback on 404", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/definition/comieron")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.includes("/definition/comer")) {
        return new Response(
          JSON.stringify({
            es: [
              {
                partOfSpeech: "Verb",
                definitions: [
                  {
                    definition: "to <a href='/wiki/eat'>eat</a>; consume",
                    examples: ["Quiero <i>comer</i> pan."],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await wiktionaryMultilingualProvider.lookup({
      text: "comieron",
      languageTag: "es-MX",
      context: { languageTag: "es-MX", analysis: { lemma: "comer" } },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.provenance).toBe("dedicated");
      expect(res.result.providerId).toBe("wiktionary-rest");
      expect(res.result.dictionary).toEqual({
        word: "comer",
        senses: [
          {
            partOfSpeech: "Verb",
            definition: "to eat; consume",
            example: "Quiero comer pan.",
          },
        ],
        synonyms: [],
      });
    }
  });

  it("parses Jisho API v1 entries for Japanese", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                slug: "食べる",
                japanese: [{ word: "食べる", reading: "たべる" }],
                senses: [
                  {
                    english_definitions: ["to eat", "to live on (e.g. a salary)"],
                    parts_of_speech: ["Ichidan verb", "Transitive verb"],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const res = await jishoDictionaryProvider.lookup({ text: "食べる", languageTag: "ja" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.provenance).toBe("dedicated");
      expect(res.result.providerId).toBe("jisho.org");
      expect(res.result.dictionary).toEqual({
        word: "食べる",
        phonetic: "たべる",
        senses: [
          {
            partOfSpeech: "Ichidan verb, Transitive verb",
            definition: "to eat; to live on (e.g. a salary)",
          },
        ],
        synonyms: [],
      });
    }
  });
});

describe("aiDictionaryFallbackProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("skips when allowAiFallback is false or offline with cloud AI", async () => {
    const disabled = await aiDictionaryFallbackProvider.lookup({
      text: "desconocido",
      languageTag: "es",
      context: { allowAiFallback: false } as never,
    });
    expect(disabled.ok).toBe(false);

    vi.stubGlobal("navigator", { onLine: false });
    vi.spyOn(aiProvider, "isAnyAiAvailable").mockResolvedValue(true);
    vi.spyOn(aiProvider, "resolveAiPath").mockResolvedValue("cloud");
    const runSpy = vi.spyOn(runTaskMod, "runTask");

    const offlineCloud = await aiDictionaryFallbackProvider.lookup({
      text: "desconocido",
      languageTag: "es",
    });
    expect(offlineCloud).toEqual({ ok: false, failure: { kind: "offline-uncached" } });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("calls runTask when available and online and tags provenance as ai", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.spyOn(aiProvider, "isAnyAiAvailable").mockResolvedValue(true);
    vi.spyOn(aiProvider, "resolveAiPath").mockResolvedValue("cloud");
    vi.spyOn(cloudProviderMod, "getActiveCloudConfig").mockReturnValue(null);
    vi.spyOn(disclosureMod, "ensureCloudAiDisclosure").mockResolvedValue(true);
    vi.spyOn(runTaskMod, "runTask").mockResolvedValue({
      taskId: "language-dictionary-peek",
      output: {
        word: "madrugada",
        lemma: "madrugada",
        partOfSpeech: "noun",
        reading: "ma.ðɾuˈɣa.ða",
        senses: [{ definition: "early morning; dawn", example: "Llegó de madrugada." }],
      },
      text: "{}",
      providerId: "cloud-llm",
      providerKind: "cloud",
      requestedModelClass: "fast",
      servedModelClass: "fast",
      fallbackPath: "none",
      validationOutcome: "strict-json",
    });

    const res = await aiDictionaryFallbackProvider.lookup({
      text: "madrugada",
      languageTag: "es",
      context: { languageTag: "es", sentence: { text: "Salió de madrugada." } },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.provenance).toBe("ai");
      expect(res.result.providerId).toBe("plethora-ai-dict");
      expect(res.result.dictionary?.word).toBe("madrugada");
      expect(res.result.dictionary?.phonetic).toBe("ma.ðɾuˈɣa.ða");
      expect(res.result.dictionary?.senses[0]).toEqual({
        partOfSpeech: "noun",
        definition: "early morning; dawn",
        example: "Llegó de madrugada.",
      });
    }
  });
});
