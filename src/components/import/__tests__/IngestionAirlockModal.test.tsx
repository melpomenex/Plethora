import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { splitDocumentByHeadings } from "../../../utils/documentHeadingSplitter";
import { IngestionAirlockModal } from "../IngestionAirlockModal";

const markdownArticle = `## Consensus Basics
Nodes agree on a single state machine log.

## Leader Election
Terms act as logical clocks across elections.

## Log Replication
The leader appends entries and replicates to followers.`;

describe("IngestionAirlockModal & documentHeadingSplitter", () => {
  it("splits Markdown H2 sections deterministically and preserves HTML heading text", () => {
    const mdChunks = splitDocumentByHeadings(markdownArticle);
    expect(mdChunks).toHaveLength(3);
    expect(mdChunks.map((c) => c.heading)).toEqual([
      "Consensus Basics",
      "Leader Election",
      "Log Replication",
    ]);

    const htmlChunks = splitDocumentByHeadings(
      "<h2><span>Alpha</span></h2><p>Body A</p><h2>Beta</h2><p>Body B</p>"
    );
    expect(htmlChunks).toHaveLength(2);
    expect(htmlChunks.map((c) => c.heading)).toEqual(["Alpha", "Beta"]);
  });

  it("routes [1] with Pre-Chunk by H2 enabled into 3 Priority-10 chunks", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <IngestionAirlockModal
        isOpen={true}
        title="Raft Paper"
        content={markdownArticle}
        initialPreChunk={true}
        onCommit={onCommit}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Will split into 3 sections/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: "active_course",
          prioritySlider: 10,
          status: "active",
          chunks: expect.arrayContaining([
            expect.objectContaining({ heading: "Consensus Basics" }),
            expect.objectContaining({ heading: "Leader Election" }),
            expect.objectContaining({ heading: "Log Replication" }),
          ]),
        })
      );
    });
  });

  it("routes [3] as Reference Only archived vault and ignores shortcuts inside title input", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <IngestionAirlockModal
        isOpen={true}
        title="Bookmark Clip"
        content="Interesting reference note."
        onCommit={onCommit}
        onClose={vi.fn()}
      />
    );

    const titleInput = screen.getByLabelText("Document Title");
    fireEvent.keyDown(titleInput, { key: "3" });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: "reference",
          prioritySlider: 95,
          status: "archived",
        })
      );
    });
  });
});
