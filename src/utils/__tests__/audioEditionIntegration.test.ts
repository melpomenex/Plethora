import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractArticleSemanticSections,
  extractEpubSemanticSections,
  extractPdfSemanticSections,
} from "../sectionIndex";
import {
  computeSentenceAnchors,
  resolveAnchorAtTimestamp,
  expandSmartExtractBoundaries,
} from "../audioEditionAnchors";
import { estimateAudioEditionCost } from "../audioEditionEstimation";
import { applyPronunciationDictionary } from "../../stores/audioEditionGenerationStore";
import { createAudioEdition, getAudioEdition, listAudioEditions } from "../../api/audioEditions";

const mockDbEditions = new Map<string, any>();
const mockDbSections = new Map<string, any[]>();

vi.mock("../../lib/tauri", () => ({
  isTauri: () => false,
  invokeCommand: vi.fn(async (cmd: string, args: any) => {
    if (cmd === "create_audio_edition") {
      mockDbEditions.set(args.edition.id, { ...args.edition, sections: args.sections });
      mockDbSections.set(args.edition.id, [...args.sections]);
      return { ...args.edition, sections: args.sections };
    }
    if (cmd === "get_audio_edition") {
      const ed = mockDbEditions.get(args.id);
      if (!ed) return null;
      return { ...ed, sections: mockDbSections.get(args.id) || [] };
    }
    if (cmd === "list_audio_editions") {
      return Array.from(mockDbEditions.values());
    }
    return null;
  }),
}));

describe("Audio Edition End-to-End Integration Pipeline", () => {
  beforeEach(() => {
    mockDbEditions.clear();
    mockDbSections.clear();
  });

  it("processes EPUB documents into segmented Audio Edition manifests", async () => {
    const epubToc = [
      { id: "c1", label: "Chapter I: Down the Rabbit-Hole", href: "chapter1.xhtml" },
      { id: "c2", label: "Chapter II: The Pool of Tears", href: "chapter2.xhtml" },
    ];
    const epubSpine = [{ idref: "c1", href: "chapter1.xhtml" }, { idref: "c2", href: "chapter2.xhtml" }];
    const contentMap = {
      "chapter1.xhtml": "Alice was beginning to get very tired of sitting by her sister on the bank.",
      "chapter2.xhtml": "Curiouser and curiouser! cried Alice as she opened the little cake box.",
    };

    const sections = extractEpubSemanticSections(epubToc, epubSpine, contentMap);
    expect(sections.length).toBe(2);
    expect(sections[0].title).toContain("Chapter I");
    expect(sections[0].characterCount).toBeGreaterThan(30);

    const editionId = "ed-alice-epub";
    const audioSections = sections.map((s, idx) => ({
      id: `sec-${editionId}-${idx}`,
      editionId,
      sectionIndex: idx,
      title: s.title,
      characterCount: s.characterCount,
      audioMimeType: "audio/mp3",
      durationSec: 15,
      generationStatus: "ready" as const,
      retryCount: 0,
      cacheKey: `k-${idx}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    const created = await createAudioEdition(
      {
        id: editionId,
        sourceDocumentId: "doc-alice",
        sourceRevisionHash: "hash-epub-1",
        provider: "pocket",
        model: "default",
        voice: "alba",
        totalDurationSec: 30,
        status: "ready",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      audioSections
    );

    expect(created.id).toBe(editionId);
    expect(created.sections?.length).toBe(2);

    const fetched = await getAudioEdition(editionId);
    expect(fetched?.sourceDocumentId).toBe("doc-alice");
  });

  it("processes PDF documents with outlines into Audio Edition anchors", () => {
    const pdfOutline = [
      { title: "Abstract", dest: 1 },
      { title: "1. Introduction", dest: 3 },
      { title: "2. Methodology", dest: 7 },
    ];
    const fullText = "Abstract: This paper presents novel results in topological quantum computing.\n\n1. Introduction: In recent years...";
    const sections = extractPdfSemanticSections(pdfOutline, undefined, fullText);

    expect(sections.length).toBe(3);
    expect(sections[0].title).toBe("Abstract");

    // Compute sentence anchors for the introduction
    const anchors = computeSentenceAnchors("sec-pdf-intro", sections[0].content, 45.0);
    expect(anchors.length).toBeGreaterThanOrEqual(1);
    expect(anchors[0].audioStartSec).toBe(0);

    // Expand smart extract boundary at playback 10s
    const smartExtract = expandSmartExtractBoundaries(anchors, 10.0, 15);
    expect(smartExtract.text).toContain("Abstract");
  });

  it("processes HTML / Web Articles with headings and pronunciation rules", () => {
    const htmlArticle = `
      <h1>Episteme and Techne in Modern Software</h1>
      <p>Aristotle distinguished Episteme from practical techne. In SQL database design, both paradigms converge.</p>
      <h2>Theoretical Foundations</h2>
      <p>Formal verification proves algebraic invariants in relational algebra.</p>
    `;

    const sections = extractArticleSemanticSections(htmlArticle);
    expect(sections.length).toBe(2);
    expect(sections[0].title).toBe("Episteme and Techne in Modern Software");

    // Apply custom pronunciation dictionary
    const transformed = applyPronunciationDictionary(sections[0].content, {
      Episteme: "eh-PISS-tuh-mee",
      SQL: "sequel",
    });
    expect(transformed).toContain("eh-PISS-tuh-mee");
    expect(transformed).toContain("sequel");

    // Pre-flight cost estimation
    const estimation = estimateAudioEditionCost({
      characterCount: sections.reduce((sum, s) => sum + s.characterCount, 0),
      provider: "openrouter",
      model: "openai/tts-1",
    });
    expect(estimation.estimatedCostUsd).toBeGreaterThan(0);
    expect(estimation.isFreeTier).toBe(false);
  });
});
