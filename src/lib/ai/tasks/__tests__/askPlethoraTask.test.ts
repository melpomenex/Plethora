/**
 * Unit tests for AskPlethoraTask & RAG pipeline
 */

import { describe, it, expect } from "vitest";
import {
  askPlethoraTask,
  askPlethora,
  type AskPlethoraInput,
} from "../definitions/askPlethoraTask";
import { validateLibraryAnswer } from "../../schemas/libraryAnswer";

describe("askPlethoraTask", () => {
  it("defines correct task metadata and system prompt", () => {
    expect(askPlethoraTask.id).toBe("ask-plethora");
    expect(askPlethoraTask.modelClass).toBe("fast");
    expect(askPlethoraTask.systemInstruction).toContain("<untrusted_source");
    expect(askPlethoraTask.systemInstruction).toContain("Ask Plethora");
  });

  it("builds input prompt wrapping chunks in untrusted containment tags", () => {
    const input: AskPlethoraInput = {
      query: "How do I turn on E-ink mode?",
      sources: [
        {
          id: "platform.eink#summary",
          docId: "platform.eink",
          title: "True E-Ink Monochrome Mode",
          text: "Open Settings → Appearance → Display Mode and select E-ink Monochrome.",
        },
      ],
      appContext: {
        activeView: "settings",
        ttsActive: false,
      },
    };

    const built = askPlethoraTask.buildInput(input);
    expect(built.text).toContain("<untrusted_source id=\"platform-eink-summary\">");
    expect(built.text).toContain("Open Settings → Appearance → Display Mode");
    expect(built.text).toContain("</untrusted_source>");
    expect(built.text).toContain("User Question:\nHow do I turn on E-ink mode?");
    expect(built.text).toContain("Current App Context: view=settings");
  });

  it("validates grounded citations and drops fabricated ones", () => {
    const contextSources = new Map([
      ["reader.pdf.reflow#summary", "Reflow extracts text from multi-column PDF files and reflows into single column."],
    ]);

    // Case A: Grounded quote passes
    const validOutput = {
      answer: "Reflow mode converts multi-column PDFs into a single column [1].",
      sourceRefs: [
        {
          refId: "reader.pdf.reflow#summary",
          quote: "Reflow extracts text from multi-column PDF files",
        },
      ],
      evidenceLevel: "supported",
    };

    const outcomeA = validateLibraryAnswer(validOutput, { sources: contextSources });
    expect(outcomeA.ok).toBe(true);
    if (outcomeA.ok) {
      expect(outcomeA.value.sourceRefs.length).toBe(1);
      expect(outcomeA.value.evidenceLevel).toBe("supported");
    }

    // Case B: Fabricated refId gets dropped and evidenceLevel normalized to none
    const fakeOutput = {
      answer: "Made up hallucination.",
      sourceRefs: [
        {
          refId: "nonexistent.chunk#1",
          quote: "This quote does not exist anywhere.",
        },
      ],
      evidenceLevel: "supported",
    };

    const outcomeB = validateLibraryAnswer(fakeOutput, { sources: contextSources });
    expect(outcomeB.ok).toBe(true);
    if (outcomeB.ok) {
      expect(outcomeB.value.sourceRefs.length).toBe(0);
      expect(outcomeB.value.evidenceLevel).toBe("none");
    }
  });

  it("resolves direct canonical alias queries via zero-AI fallback with 1.0 confidence", async () => {
    const res = await askPlethora({ query: "e-ink mode" });
    expect(res.mode).toBe("zero-ai-fallback");
    expect(res.answer.evidenceLevel).toBe("supported");
    expect(res.answer.answer).toContain("True E-Ink Monochrome Mode");
    expect(res.retrievedResults.length).toBeGreaterThan(0);
  });

  it("honestly refuses queries with zero evidence in product docs", async () => {
    const res = await askPlethora({
      query: "how do I bake a sourdough baguette with yeast starter?",
    });
    expect(res.answer.evidenceLevel).toBe("none");
    expect(res.answer.answer).toContain("does not contain information");
  });
});
