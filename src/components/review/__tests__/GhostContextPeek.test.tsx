import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import {
  GhostContextPeek,
  extractSurroundingParagraphs,
} from "../GhostContextPeek";
import { ExtractScrollItem } from "../ExtractScrollItem";
import type { Extract } from "../../../api/extracts";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: { settings: { ai: { aiControls: { extractProgressiveSummaries: boolean } } } }) => boolean) =>
    selector({ settings: { ai: { aiControls: { extractProgressiveSummaries: false } } } }),
}));

vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: (selector: (s: { documents: Array<{ id: string; content?: string }> }) => unknown) =>
    selector({ documents: [] }),
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
});
