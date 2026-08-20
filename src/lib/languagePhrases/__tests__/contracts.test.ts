import { describe, expect, it } from "vitest";
import { acceptPhraseCandidate, selectNonOverlappingPhrases, normalizePhrase, phraseKey } from "../index";

describe("language phrase contracts", () => {
  it("normalizes phrase identity without changing source text", () => {
    expect(normalizePhrase("  Buen   Día ")).toBe("buen día");
    expect(phraseKey("p1", "es", "Buen Día")).toBe(phraseKey("p1", "es", " buen   día "));
  });

  it("rejects weak candidates and chooses deterministic non-overlapping spans", () => {
    const weak = acceptPhraseCandidate({ profileId: "p1", surface: "a b", constituents: [{ position: 0, surface: "a", normalized: "a" }, { position: 1, surface: "b", normalized: "b" }], confidence: 0.4 });
    expect(weak).toBeNull();
    const make = (id: string, start: number, end: number, confidence: number) => ({ candidate: { id, profileId: "p1", surface: id, normalizedForm: id, constituents: [], confidence, status: "pending" as const, createdAt: 0, updatedAt: 0 }, start, end });
    expect(selectNonOverlappingPhrases([make("short", 0, 2, 1), make("long", 0, 4, 0.8), make("tail", 4, 6, 0.7)]).map((span) => span.candidate.id)).toEqual(["long", "tail"]);
  });
});
