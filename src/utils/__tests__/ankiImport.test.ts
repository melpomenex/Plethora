import { describe, expect, it } from "vitest";
import { inferAnkiDeckNames } from "../ankiImport";

describe("inferAnkiDeckNames", () => {
  it("recovers and deduplicates native/browser Anki source deck tags", () => {
    const imported = [
      { tags: ["biology", "anki-import", "Basic", "Anatomy 1K"] },
      { tags: ["anki-import", "Cloze", "Anatomy 1K"] },
      { tags: ["anki-import", "Basic", "Physiology"] },
      { tags: ["manual", "Anatomy 1K"] },
    ];

    expect(inferAnkiDeckNames(imported)).toEqual(["Anatomy 1K", "Physiology"]);
  });

  it("prefers explicit deck tags when an importer provides them", () => {
    expect(inferAnkiDeckNames([{
      tags: ["anki-import", "Basic", "legacy-last-value", "deck:Neuroscience"],
    }])).toEqual(["Neuroscience"]);
  });

  it("ignores malformed and non-Anki items", () => {
    expect(inferAnkiDeckNames([
      null,
      {},
      { tags: "anki-import" },
      { tags: ["manual", "Biology"] },
    ])).toEqual([]);
  });
});
