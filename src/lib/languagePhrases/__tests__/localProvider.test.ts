import { describe, expect, it } from "vitest";
import {
  acceptPhraseCandidate,
  collectPhraseCandidates,
  createLocalPhraseCandidateProvider,
  phraseSpanFromCandidate,
  selectNonOverlappingCandidatePhrases,
  selectNonOverlappingPhrases,
  type LanguagePhrase,
} from "../index";

describe("local phrase candidate provider", () => {
  it("matches Spanish built-in multiword expressions with exact spans and case/diacritic normalization", async () => {
    const provider = createLocalPhraseCandidateProvider();
    const text = "¡Sin embargo, por favor! A menudo hay que tener que y echar de menos lo más o menos.";
    const candidates = await provider.propose({
      profileId: "profile-es",
      languageTag: "es-ES",
      text,
    });

    const surfaces = candidates.map((candidate) => candidate.surface);
    expect(surfaces).toEqual([
      "Sin embargo",
      "por favor",
      "A menudo",
      "tener que",
      "echar de menos",
      "más o menos",
    ]);

    for (const candidate of candidates) {
      expect(text.slice(candidate.start, candidate.end)).toBe(candidate.surface);
      expect(candidate.confidence).toBe(0.85);
      expect(candidate.tokenIds).toHaveLength(candidate.constituents.length);
      expect(candidate.constituents.length).toBeGreaterThanOrEqual(2);
      expect(candidate.sourceAnchor?.locator).toMatchObject({
        start: candidate.start,
        end: candidate.end,
        tokenIds: candidate.tokenIds,
      });
    }

    // Diacritic-insensitive matching on "mas o menos" without accent
    const unaccented = await provider.propose({
      profileId: "profile-es",
      languageTag: "es",
      text: "Esto cuesta mas o menos diez euros.",
    });
    expect(unaccented.map((c) => c.surface)).toContain("mas o menos");
  });

  it("matches French built-in multiword patterns regardless of casing or accents", async () => {
    const provider = createLocalPhraseCandidateProvider();
    const text = "Par exemple, c'est tout à fait vrai : il y a des gens qui semblent avoir besoin de repos, TOUT A FAIT.";
    const candidates = await provider.propose({
      profileId: "profile-fr",
      languageTag: "fr-FR",
      text,
    });

    expect(candidates.map((c) => c.surface)).toEqual([
      "Par exemple",
      "tout à fait",
      "il y a",
      "avoir besoin de",
      "TOUT A FAIT",
    ]);
    for (const candidate of candidates) {
      expect(text.slice(candidate.start, candidate.end)).toBe(candidate.surface);
      expect(candidate.confidence).toBe(0.85);
    }
  });

  it("matches German built-in multiword expressions", async () => {
    const provider = createLocalPhraseCandidateProvider();
    const text = "Zum Beispiel gibt es in der Regel viel zu tun, auf jeden Fall.";
    const candidates = await provider.propose({
      profileId: "profile-de",
      languageTag: "de",
      text,
    });

    expect(candidates.map((c) => c.surface)).toEqual([
      "Zum Beispiel",
      "in der Regel",
      "auf jeden Fall",
    ]);

    const esGibt = await provider.propose({
      profileId: "profile-de",
      languageTag: "de-DE",
      text: "Es gibt heute viele Möglichkeiten.",
    });
    expect(esGibt.map((c) => c.surface)).toEqual(["Es gibt"]);
  });

  it("matches Japanese built-in multiword patterns without corrupting dakuten", async () => {
    const provider = createLocalPhraseCandidateProvider();
    const text = "そういうというわけではないかもしれないし、うまく話せるようになる。";
    const candidates = await provider.propose({
      profileId: "profile-ja",
      languageTag: "ja",
      text,
    });

    expect(candidates.map((c) => c.surface)).toEqual([
      "というわけ",
      "わけではない",
      "かもしれない",
      "ようになる",
    ]);
    for (const candidate of candidates) {
      expect(text.slice(candidate.start, candidate.end)).toBe(candidate.surface);
      expect(candidate.confidence).toBe(0.85);
      expect(candidate.constituents.length).toBeGreaterThanOrEqual(2);
    }

    // Voiced kana must not collapse to unvoiced kana (が !== か)
    const noFalseVoicingMatch = await provider.propose({
      profileId: "profile-ja",
      languageTag: "ja",
      text: "がもしれない",
    });
    expect(noFalseVoicingMatch.map((c) => c.surface)).not.toContain("がもしれない");
  });

  it("matches Chinese built-in multiword patterns cleanly across CJK text", async () => {
    const provider = createLocalPhraseCandidateProvider();
    const text = "因为所以，换句话说，他的中文越来越好。";
    const candidates = await provider.propose({
      profileId: "profile-zh",
      languageTag: "zh-CN",
      text,
    });

    expect(candidates.map((c) => c.surface)).toEqual([
      "因为所以",
      "换句话说",
      "越来越",
    ]);
    for (const candidate of candidates) {
      expect(text.slice(candidate.start, candidate.end)).toBe(candidate.surface);
      expect(candidate.confidence).toBe(0.85);
      expect(candidate.tokenIds).toHaveLength(candidate.constituents.length);
    }

    // Punctuation breaks contiguity
    const broken = await provider.propose({
      profileId: "profile-zh",
      languageTag: "zh",
      text: "因为，所以。",
    });
    expect(broken).toEqual([]);
  });

  it("matches Arabic built-in multiword patterns with or without tashkeel/hamza diacritics", async () => {
    const provider = createLocalPhraseCandidateProvider();
    const text = "على سبيل المثال، نعمل مِنْ أَجْلِ المستقبل، على أي حال.";
    const candidates = await provider.propose({
      profileId: "profile-ar",
      languageTag: "ar",
      text,
    });

    expect(candidates.map((c) => c.surface)).toEqual([
      "على سبيل المثال",
      "مِنْ أَجْلِ",
      "على أي حال",
    ]);
    for (const candidate of candidates) {
      expect(text.slice(candidate.start, candidate.end)).toBe(candidate.surface);
      expect(candidate.confidence).toBe(0.85);
    }
  });

  it("does not match across intervening punctuation", async () => {
    const provider = createLocalPhraseCandidateProvider();
    const candidates = await provider.propose({
      profileId: "profile-es",
      languageTag: "es",
      text: "Sin, embargo. Por. Favor.",
    });
    expect(candidates).toEqual([]);
  });

  it("matches custom profile phrases and language pack dictionary entries at 0.95 confidence", async () => {
    const savedPhrase: LanguagePhrase = {
      id: "lp-1",
      profileId: "profile-1",
      languageTag: "es",
      objectKind: "idiom",
      phraseKey: "profile-1\u001fes\u001ftomar el pelo",
      normalizedForm: "tomar el pelo",
      canonicalForm: "tomar el pelo",
      constituents: [
        { position: 0, surface: "tomar", normalized: "tomar" },
        { position: 1, surface: "el", normalized: "el" },
        { position: 2, surface: "pelo", normalized: "pelo" },
      ],
      meaning: "to pull someone's leg",
      state: "learning",
      occurrenceCount: 2,
      version: 1,
    };

    const ignoredPhrase: LanguagePhrase = {
      ...savedPhrase,
      id: "lp-ignored",
      canonicalForm: "buenas noches",
      normalizedForm: "buenas noches",
      phraseKey: "profile-1\u001fes\u001fbuenas noches",
      state: "ignored",
    };

    const provider = createLocalPhraseCandidateProvider({
      knownPhrases: [savedPhrase, ignoredPhrase, "por favor"],
      resolveKnownPhrases: async () => [
        { phrase: "a todo color", languageTag: "es", objectKind: "phrase" },
        { phrase: "autre langue", languageTag: "fr" },
      ],
      resolvePackEntries: async ({ languageTag }) => {
        if (!languageTag.startsWith("es")) return [];
        return [
          {
            headword: "punto de vista",
            languageTag: "es",
            entryId: "pack-es-12",
            meaning: "point of view",
          },
        ];
      },
    });

    const text = "Por favor, no me vayas a tomar el pelo sobre mi punto de vista a todo color. Buenas noches.";
    const candidates = await provider.propose({
      profileId: "profile-1",
      languageTag: "es",
      text,
    });

    expect(candidates.map((c) => [c.surface, c.confidence, c.sourceKind])).toEqual([
      ["Por favor", 0.95, "profile"],
      ["tomar el pelo", 0.95, "profile"],
      ["punto de vista", 0.95, "pack"],
      ["a todo color", 0.95, "profile"],
    ]);
    // Ignored phrase and French phrase must not appear
    expect(candidates.some((c) => c.surface.toLowerCase() === "buenas noches")).toBe(false);
    expect(candidates.some((c) => c.surface.toLowerCase() === "autre langue")).toBe(false);
  });

  it("preserves caller-supplied tokenIds, start, end, and surface", async () => {
    const provider = createLocalPhraseCandidateProvider();
    const text = "Sin embargo, por favor";
    const tokens = [
      { id: "doc-tok-10", start: 100, end: 103, surface: "Sin", lexicalEntryId: "lex-sin" },
      { id: "doc-tok-11", start: 104, end: 111, surface: "embargo", lexicalEntryId: "lex-embargo" },
      { id: "doc-tok-12", start: 111, end: 112, surface: ",", isLexical: false },
      { id: "doc-tok-13", start: 113, end: 116, surface: "por" },
      { id: "doc-tok-14", start: 117, end: 122, surface: "favor" },
    ];

    const candidates = await provider.propose({
      profileId: "profile-es",
      languageTag: "es",
      text,
      tokens,
      sourceOffset: 100,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      surface: "Sin embargo",
      start: 100,
      end: 111,
      tokenIds: ["doc-tok-10", "doc-tok-11"],
    });
    expect(candidates[0].constituents[0].lexicalEntryId).toBe("lex-sin");
    expect(candidates[1]).toMatchObject({
      surface: "por favor",
      start: 113,
      end: 122,
      tokenIds: ["doc-tok-13", "doc-tok-14"],
    });
  });

  it("integrates cleanly with collectPhraseCandidates and selectNonOverlappingPhrases", async () => {
    const provider = createLocalPhraseCandidateProvider({
      knownPhrases: [
        { phrase: "muy a menudo", languageTag: "es" },
        { phrase: "de menos", languageTag: "es" },
      ],
      packEntries: [
        { phrase: "tener que ver", languageTag: "es" },
      ],
    });

    const text = "Muy a menudo hay que tener que ver y echar de menos.";
    const accepted = await collectPhraseCandidates(provider, {
      profileId: "profile-1",
      languageTag: "es",
      text,
    });

    // Overlapping matches exist before resolution:
    // "Muy a menudo" (0..12) vs "a menudo" (4..12)
    // "tener que ver" (21..34) vs "tener que" (21..30)
    // "echar de menos" (37..51) vs "de menos" (43..51)
    expect(accepted.map((c) => c.surface)).toEqual([
      "Muy a menudo",
      "a menudo",
      "tener que ver",
      "tener que",
      "echar de menos",
      "de menos",
    ]);

    const spans = accepted
      .map((candidate) => phraseSpanFromCandidate(candidate))
      .filter((span): span is NonNullable<typeof span> => Boolean(span));

    const selected = selectNonOverlappingPhrases(spans);
    expect(selected.map((s) => s.candidate.surface)).toEqual([
      "Muy a menudo",
      "tener que ver",
      "echar de menos",
    ]);

    const convenienceSelected = selectNonOverlappingCandidatePhrases(accepted);
    expect(convenienceSelected.map((s) => s.candidate.surface)).toEqual([
      "Muy a menudo",
      "tener que ver",
      "echar de menos",
    ]);

    // Also verify direct acceptPhraseCandidate compatibility
    const proposals = await provider.propose({ profileId: "profile-1", languageTag: "es", text });
    const directSpans = proposals
      .map((proposal) => {
        const candidate = acceptPhraseCandidate(proposal);
        return candidate ? { candidate, start: proposal.start, end: proposal.end } : null;
      })
      .filter((span): span is NonNullable<typeof span> => Boolean(span));
    expect(selectNonOverlappingPhrases(directSpans).map((s) => s.candidate.surface)).toEqual([
      "Muy a menudo",
      "tener que ver",
      "echar de menos",
    ]);
  });

  it("respects AbortSignal when pre-aborted or aborted while async resolvers are pending", async () => {
    const preAborted = new AbortController();
    preAborted.abort();

    let resolverCalled = false;
    const provider = createLocalPhraseCandidateProvider({
      resolveKnownPhrases: async () => {
        resolverCalled = true;
        return ["sin embargo"];
      },
    });

    await expect(
      provider.propose({
        profileId: "profile-es",
        languageTag: "es",
        text: "Sin embargo, por favor.",
        signal: preAborted.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(resolverCalled).toBe(false);

    const midFlight = new AbortController();
    const hangingProvider = createLocalPhraseCandidateProvider({
      resolvePackEntries: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(["por favor"]), 5000);
        }),
    });

    const pending = hangingProvider.propose({
      profileId: "profile-es",
      languageTag: "es",
      text: "Por favor.",
      signal: midFlight.signal,
    });
    midFlight.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
