import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import React from "react";
import {
  GhostContextPeek,
  extractSurroundingParagraphs,
} from "../GhostContextPeek";
import { ExtractScrollItem } from "../ExtractScrollItem";
import type { Extract } from "../../../api/extracts";

const getDocumentMock = vi.fn();
const extractDocumentTextMock = vi.fn();

vi.mock("../../../api/documents", () => ({
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
  extractDocumentText: (...args: unknown[]) => extractDocumentTextMock(...args),
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: { settings: { ai: { aiControls: { extractProgressiveSummaries: boolean } } } }) => boolean) =>
    selector({ settings: { ai: { aiControls: { extractProgressiveSummaries: false } } } }),
}));

vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: (selector: (s: { documents: Array<{ id: string; content?: string | null }> }) => unknown) =>
    selector({ documents: [{ id: "doc-summary-only", content: null }] }),
}));

const sampleParent = `
# Consensus Protocols

## Raft

Paragraph 1 introduces replicated state machines.

Paragraph 2 explains leader election timeouts.

Paragraph 3 describes log replication and commit index safety.

Paragraph 4 covers membership changes via joint consensus.

Paragraph 5 summarizes snapshotting and log compaction.
`;

const sampleExtract: Extract = {
  id: "ext-raft",
  document_id: "doc-raft",
  content: "Paragraph 3 describes log replication and commit index safety.",
  date_created: "2026-11-01T00:00:00Z",
  date_modified: "2026-11-01T00:00:00Z",
  review_count: 1,
  reps: 1,
  progressive_disclosure_level: 0,
  max_disclosure_level: 0,
  tags: [],
};

describe("UX02-T03 GhostContextPeek", () => {
  beforeEach(() => {
    getDocumentMock.mockReset();
    extractDocumentTextMock.mockReset();
  });

  it("extracts breadcrumb and +/- 2 surrounding paragraphs cleanly", () => {
    const result = extractSurroundingParagraphs(
      sampleParent,
      sampleExtract.content,
      2
    );

    expect(result.matched).toBe(true);
    expect(result.breadcrumb).toEqual(["Consensus Protocols", "Raft"]);
    expect(result.before).toEqual([
      "Paragraph 1 introduces replicated state machines.",
      "Paragraph 2 explains leader election timeouts.",
    ]);
    expect(result.after).toEqual([
      "Paragraph 4 covers membership changes via joint consensus.",
      "Paragraph 5 summarizes snapshotting and log compaction.",
    ]);
  });

  it("reveals GhostContextPeek on Alt hold and collapses on Alt release in ExtractScrollItem", () => {
    render(
      <ExtractScrollItem
        extract={sampleExtract}
        documentTitle="Distributed Systems"
        parentContent={sampleParent}
        onRate={vi.fn()}
        onCreateCloze={vi.fn()}
        onCreateQA={vi.fn()}
      />
    );

    expect(document.querySelector("[data-ghost-context-peek='true']")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Alt" });
    const peek = document.querySelector("[data-ghost-context-peek='true']");
    expect(peek).toBeInTheDocument();
    expect(peek).toHaveTextContent("Distributed Systems > Consensus Protocols > Raft");
    expect(peek).toHaveTextContent("Paragraph 1 introduces replicated state machines.");
    expect(peek).toHaveTextContent("Paragraph 5 summarizes snapshotting and log compaction.");

    fireEvent.keyUp(window, { key: "Alt" });
    expect(document.querySelector("[data-ghost-context-peek='true']")).not.toBeInTheDocument();
  });

  it("shows non-crashing fallback when parent context is unavailable", () => {
    render(
      <GhostContextPeek
        isPeeking={true}
        documentTitle="Missing Doc"
        parentContent={null}
        extractText="Orphan extract"
      />
    );

    const peek = document.querySelector("[data-ghost-context-peek='true']");
    expect(peek).toBeInTheDocument();
    expect(peek).toHaveTextContent("Missing Doc");
    expect(peek).toHaveTextContent("Parent context unavailable");
  });

  it("hydrates parent document content lazily when Peek Context is clicked and store only has a summary", async () => {
    getDocumentMock.mockResolvedValue({
      id: "doc-summary-only",
      content: sampleParent,
    });

    render(
      <ExtractScrollItem
        extract={{ ...sampleExtract, document_id: "doc-summary-only" }}
        documentTitle="Distributed Systems"
        onRate={vi.fn()}
        onCreateCloze={vi.fn()}
        onCreateQA={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Peek Context \(Alt\)/i }));

    await waitFor(() => {
      const peek = document.querySelector("[data-ghost-context-peek='true']");
      expect(peek).toBeInTheDocument();
      expect(peek).toHaveTextContent("Distributed Systems > Consensus Protocols > Raft");
      expect(peek).toHaveTextContent("Paragraph 2 explains leader election timeouts.");
      expect(peek).toHaveTextContent("Paragraph 4 covers membership changes via joint consensus.");
    });

    expect(getDocumentMock).toHaveBeenCalledWith("doc-summary-only");
  });

  it("falls back to extractDocumentText when getDocument returns null content (e.g. PDF/EPUB)", async () => {
    getDocumentMock.mockResolvedValue({
      id: "doc-pdf",
      content: null,
      fileType: "pdf",
    });
    extractDocumentTextMock.mockResolvedValue({
      content: sampleParent,
      extracted: true,
    });

    render(
      <ExtractScrollItem
        extract={{ ...sampleExtract, document_id: "doc-pdf" }}
        documentTitle="Raft Paper"
        onRate={vi.fn()}
        onCreateCloze={vi.fn()}
        onCreateQA={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { key: "Alt" });

    await waitFor(() => {
      const peek = document.querySelector("[data-ghost-context-peek='true']");
      expect(peek).toBeInTheDocument();
      expect(peek).toHaveTextContent("Raft Paper > Consensus Protocols > Raft");
      expect(peek).toHaveTextContent("Paragraph 1 introduces replicated state machines.");
      expect(peek).toHaveTextContent("Paragraph 5 summarizes snapshotting and log compaction.");
    });

    expect(extractDocumentTextMock).toHaveBeenCalledWith("doc-pdf");
  });

  it("extracts HTML headings into breadcrumb and splits HTML block paragraphs", () => {
    const htmlParent = `
      <article>
        <h1>Quantum Mechanics</h1>
        <h2>Delayed Choice</h2>
        <p>First introductory paragraph before the extract.</p>
        <div>Some physicists have dubbed this concept retrocausality, which means the cause is in the future.</div>
        <p>Following paragraph about Wheeler&apos;s interpretation.</p>
      </article>
    `;

    const result = extractSurroundingParagraphs(
      htmlParent,
      "Some physicists have dubbed this concept retrocausality, which means the cause is in the future.",
      2
    );

    expect(result.matched).toBe(true);
    expect(result.breadcrumb).toEqual(["Quantum Mechanics", "Delayed Choice"]);
    expect(result.before).toEqual(["First introductory paragraph before the extract."]);
    expect(result.after).toEqual(["Following paragraph about Wheeler's interpretation."]);
  });

  it("matches markdown-formatted parent paragraphs against plain-text extracts", () => {
    const mdParent = `
## Simulation Hypothesis

Before paragraph discussing [Bostrom](https://example.com).

Some physicists have dubbed this concept **retrocausality**, which means *the cause* is in the future.

After paragraph about many worlds.
`;

    const result = extractSurroundingParagraphs(
      mdParent,
      "Some physicists have dubbed this concept retrocausality, which means the cause is in the future.",
      2
    );

    expect(result.matched).toBe(true);
    expect(result.breadcrumb).toEqual(["Simulation Hypothesis"]);
    expect(result.before).toEqual(["Before paragraph discussing [Bostrom](https://example.com)."]);
    expect(result.after).toEqual(["After paragraph about many worlds."]);
  });

  it("resolves context for edited extracts using selection_context or overlapping text", () => {
    const result = extractSurroundingParagraphs(
      sampleParent,
      "EDITED NOTE: completely different opening — log replication and commit index safety.",
      2,
      {
        type: "text",
        surface: "markdown",
        documentId: "doc-raft",
        startOffset: 0,
        endOffset: 60,
        selectedText: "Paragraph 3 describes log replication and commit index safety.",
      }
    );

    expect(result.matched).toBe(true);
    expect(result.before).toEqual([
      "Paragraph 1 introduces replicated state machines.",
      "Paragraph 2 explains leader election timeouts.",
    ]);
    expect(result.after).toEqual([
      "Paragraph 4 covers membership changes via joint consensus.",
      "Paragraph 5 summarizes snapshotting and log compaction.",
    ]);
  });

  it("advances past multi-paragraph extracts so after does not repeat the extract", () => {
    const multiExtract =
      "Paragraph 2 explains leader election timeouts.\n\nParagraph 3 describes log replication and commit index safety.";

    const result = extractSurroundingParagraphs(sampleParent, multiExtract, 2);

    expect(result.matched).toBe(true);
    expect(result.before).toEqual(["Paragraph 1 introduces replicated state machines."]);
    expect(result.after).toEqual([
      "Paragraph 4 covers membership changes via joint consensus.",
      "Paragraph 5 summarizes snapshotting and log compaction.",
    ]);
  });

  it("falls back to selection_context anchor prefix and suffix when parent content is unavailable", () => {
    render(
      <GhostContextPeek
        isPeeking={true}
        documentTitle="Web Article"
        parentContent={null}
        extractText="Retrocausality"
        selectionContext={{
          type: "text",
          surface: "html",
          documentId: "doc-web",
          startOffset: 10,
          endOffset: 24,
          selectedText: "Retrocausality",
          anchor: {
            textQuote: {
              exact: "Retrocausality",
              prefix: "Preceding sentence from anchor.",
              suffix: "Succeeding sentence from anchor.",
            },
            sectionHeading: "Delayed Choice",
          },
        }}
      />
    );

    const peek = document.querySelector("[data-ghost-context-peek='true']");
    expect(peek).toBeInTheDocument();
    expect(peek).toHaveTextContent("Web Article > Delayed Choice");
    expect(peek).toHaveTextContent("Preceding sentence from anchor.");
    expect(peek).toHaveTextContent("Succeeding sentence from anchor.");
  });
});
