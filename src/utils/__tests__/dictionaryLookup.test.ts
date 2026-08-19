/**
 * Unit tests for the hardened dictionary service (task 2.3): query
 * normalization, phonetics/POS preservation, typed failure taxonomy, and
 * best-effort synonyms.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupDictionaryEntry } from "../../utils/dictionaryLookup";

const apiEntry = (overrides: Record<string, unknown> = {}) => [
  {
    word: "ephemeral",
    phonetic: "/ɪˈfem(ə)rəl/",
    phonetics: [
      { text: "/ɪˈfem(ə)rəl/", audio: "" },
      { text: "/əˈfɛm(ə)rəl/", audio: "https://audio.example/ephemeral.mp3" },
    ],
    meanings: [
      {
        partOfSpeech: "adjective",
        definitions: [
          { definition: "Lasting for a very short time.", example: "ephemeral pleasures" },
          { definition: "(chiefly of plants) Having a very short life cycle." },
        ],
        synonyms: ["transient"],
      },
    ],
    ...overrides,
  },
];

function mockFetch(handlers: Array<(url: string, init?: RequestInit) => { status: number; body: unknown }>) {
  let call = 0;
  const urls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const handler = handlers[Math.min(call, handlers.length - 1)];
    call += 1;
    const { status, body } = handler(url);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, urls };
}

describe("lookupDictionaryEntry", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes punctuated/cased selections before querying", async () => {
    const { urls } = mockFetch([
      () => ({ status: 200, body: apiEntry() }),
      () => ({ status: 200, body: [] }), // datamuse
    ]);
    const result = await lookupDictionaryEntry('"Ephemeral,"');
    expect(result.ok).toBe(true);
    const apiUrl = urls.find((u) => u.includes("dictionaryapi.dev"));
    expect(apiUrl).toContain("/entries/en/ephemeral");
  });

  it("preserves provider phonetics, audio, POS and examples", async () => {
    mockFetch([
      () => ({ status: 200, body: apiEntry() }),
      () => ({ status: 200, body: [] }),
    ]);
    const result = await lookupDictionaryEntry("ephemeral");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.word).toBe("ephemeral");
    expect(result.entry.phonetic).toBe("/ɪˈfem(ə)rəl/");
    expect(result.entry.audioUrl).toBe("https://audio.example/ephemeral.mp3");
    expect(result.entry.senses[0]).toEqual({
      partOfSpeech: "adjective",
      definition: "Lasting for a very short time.",
      example: "ephemeral pleasures",
    });
    // Provider synonyms merged with (empty) Datamuse results.
    expect(result.entry.synonyms).toContain("transient");
  });

  it("merges provider and Datamuse synonyms, deduped and capped", async () => {
    mockFetch([
      () => ({ status: 200, body: apiEntry() }),
      () => ({
        status: 200,
        body: [
          { word: "transient" },
          { word: "fleeting" },
          { word: "ephemeral" },
          { word: "fugacious" },
        ],
      }),
    ]);
    const result = await lookupDictionaryEntry("ephemeral");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.synonyms).toEqual(["transient", "fleeting", "fugacious"]);
  });

  it("maps provider 404 to not-found", async () => {
    mockFetch([
      () => ({ status: 404, body: { title: "No Definitions Found" } }),
      () => ({ status: 200, body: [] }),
    ]);
    const result = await lookupDictionaryEntry("asdfqwerty");
    expect(result).toEqual({ ok: false, failure: { kind: "not-found" } });
  });

  it("maps an empty 200 payload to not-found", async () => {
    mockFetch([
      () => ({ status: 200, body: [] }),
      () => ({ status: 200, body: [] }),
    ]);
    const result = await lookupDictionaryEntry("zzz");
    expect(result).toEqual({ ok: false, failure: { kind: "not-found" } });
  });

  it("maps provider 500 to unavailable", async () => {
    mockFetch([
      () => ({ status: 500, body: {} }),
      () => ({ status: 200, body: [] }),
    ]);
    const result = await lookupDictionaryEntry("ephemeral");
    expect(result).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });

  it("maps a network failure while offline to offline-uncached", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const result = await lookupDictionaryEntry("ephemeral");
    expect(result).toEqual({ ok: false, failure: { kind: "offline-uncached" } });
  });

  it("maps a network failure while online to unavailable", async () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const result = await lookupDictionaryEntry("ephemeral");
    expect(result).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });

  it("a Datamuse failure never fails the definition", async () => {
    mockFetch([
      () => ({ status: 200, body: apiEntry() }),
      () => {
        throw new Error("datamuse down");
      },
    ]);
    const result = await lookupDictionaryEntry("ephemeral");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.synonyms).toContain("transient");
  });

  it("returns not-found for an empty query", async () => {
    const result = await lookupDictionaryEntry("   ");
    expect(result).toEqual({ ok: false, failure: { kind: "not-found" } });
  });
});
