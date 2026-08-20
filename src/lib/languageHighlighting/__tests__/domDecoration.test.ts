import { describe, expect, it } from "vitest";
import { applyLanguageAnnotationSpans, clearLanguageAnnotationSpans } from "../domDecoration";
import type { LanguageHighlightSettings, VocabularyAnnotation } from "../types";

const settings: LanguageHighlightSettings = {
  profileId: "p",
  mode: "full",
  theme: "light",
  highContrast: false,
  reducedMotion: false,
  eInk: false,
  announceState: true,
};

describe("language DOM annotation decoration", () => {
  it("wraps supported DOM anchors without replacing source text", () => {
    const root = document.createElement("p");
    root.append("La casa pequeña");
    document.body.append(root);
    const text = root.firstChild as Text;
    const annotation: VocabularyAnnotation = {
      tokenId: "t1",
      profileId: "p",
      lexicalEntryId: "entry-casa",
      surface: "casa",
      range: { start: 3, end: 7 },
      anchor: { kind: "dom-text", sourceId: "doc", node: text, startOffset: 3, endOffset: 7, confidence: "exact", confidenceScore: 1 },
      summary: { state: "learning", label: "Learning word", description: "", isKnown: false, isIgnored: false, defaultTreatment: "background", defaultCue: "solid" },
      treatment: "background",
      cue: "solid",
      className: "language-vocabulary-token language-vocabulary-learning",
      dataAttributes: { state: "learning", lexicalEntryId: "entry-casa" },
      ariaLabel: "casa: Learning word",
    };
    expect(applyLanguageAnnotationSpans(root, [annotation], settings)).toBe(1);
    expect(root.textContent).toBe("La casa pequeña");
    expect(root.querySelector("[data-language-vocabulary-token]")?.textContent).toBe("casa");
    clearLanguageAnnotationSpans(root);
    expect(root.textContent).toBe("La casa pequeña");
    root.remove();
  });

  it("requires canonical confidence before decorating fixed-PDF words", () => {
    const root = document.createElement("div");
    root.append("hola gráfico");
    document.body.append(root);
    const text = root.firstChild as Text;
    const makeAnnotation = (tokenId: string, startOffset: number, endOffset: number, confidence: number, source: "native-pdf-text" | "graphical"): VocabularyAnnotation => ({
      tokenId,
      profileId: "p",
      lexicalEntryId: tokenId,
      surface: text.data.slice(startOffset, endOffset),
      range: { start: startOffset, end: endOffset },
      anchor: {
        kind: "pdf-canonical-word",
        sourceId: "pdf",
        pageNumber: 1,
        wordId: tokenId,
        source,
        bboxExact: source === "native-pdf-text",
        confidence: confidence >= 0.9 ? "exact" : "low",
        confidenceScore: confidence,
        node: text,
        startOffset,
        endOffset,
      },
      summary: { state: "learning", label: "Learning word", description: "", isKnown: false, isIgnored: false, defaultTreatment: "background", defaultCue: "solid" },
      treatment: "background",
      cue: "solid",
      className: "language-vocabulary-token language-vocabulary-learning",
      dataAttributes: { state: "learning", lexicalEntryId: tokenId },
    });
    expect(applyLanguageAnnotationSpans(root, [
      makeAnnotation("good", 0, 4, 0.98, "native-pdf-text"),
      makeAnnotation("ambiguous", 5, 12, 0.89, "native-pdf-text"),
      makeAnnotation("graphic", 0, 4, 0.99, "graphical"),
    ], settings)).toBe(1);
    expect(root.querySelectorAll("[data-language-vocabulary-token]")).toHaveLength(1);
    root.remove();
  });
});
