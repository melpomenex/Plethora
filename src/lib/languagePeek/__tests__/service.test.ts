import { describe, expect, it, vi } from "vitest";
import { LanguagePeekService, type LanguagePeekProvider } from "../index";

describe("LanguagePeekService", () => {
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
});
