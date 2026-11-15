import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  KnowledgeGapCard,
  URGENT_REMEDIATION_PRIORITY_SLIDER,
} from "../KnowledgeGapCard";
import type { KnowledgeGapView } from "../../../../types/learningEvidence";

const createExtractMock = vi.fn();
const createLearningItemMock = vi.fn();
const dispatchPriorityCommitMock = vi.fn();

vi.mock("../../../../api/extracts", () => ({
  createExtract: (...args: unknown[]) => createExtractMock(...args),
}));

vi.mock("../../../../api/learning-items", () => ({
  createLearningItem: (...args: unknown[]) => createLearningItemMock(...args),
}));

vi.mock("../../../../services/priority/priorityCommit", () => ({
  dispatchPriorityCommit: (...args: unknown[]) => dispatchPriorityCommitMock(...args),
}));

const sampleGap: KnowledgeGapView = {
  id: "gap-raft-1",
  kind: "repeatedly_failed",
  conceptId: "concept-raft-leader",
  conceptName: "Raft Leader Completeness",
  planId: "plan-1",
  nodeId: "node-1",
  ruleId: "rule-lapse-3",
  status: "active",
  evidence: [
    {
      recordId: "ev-1",
      kind: "assessment",
      description: "Leader completeness invariant ensures committed entries appear in future leaders.",
      learningEvidenceId: null,
      sourceRefId: "doc-raft",
      payload: { documentId: "doc-raft" },
    },
  ],
  demonstrated: null,
  firstDetectedAt: "2026-11-10T10:00:00Z",
  lastDetectedAt: "2026-11-15T10:00:00Z",
  evidenceCutoff: "2026-11-15T10:00:00Z",
};

describe("KnowledgeGapCard.queueInject", () => {
  beforeEach(() => {
    createExtractMock.mockReset();
    createLearningItemMock.mockReset();
    dispatchPriorityCommitMock.mockReset();
    createExtractMock.mockResolvedValue({ id: "ext-remediation-1" });
    createLearningItemMock.mockResolvedValue({ id: "card-remediation-1" });
    dispatchPriorityCommitMock.mockResolvedValue(undefined);
  });

  it("spawns Priority 8 extract + flashcard linked to source document and prevents duplicate clicks", async () => {
    render(<KnowledgeGapCard gap={sampleGap} />);

    const btn = screen.getByRole("button", { name: /Inject Weak Concepts into Queue/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(createExtractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          document_id: "doc-raft",
          content: expect.stringContaining("Raft Leader Completeness"),
        })
      );
    });

    expect(dispatchPriorityCommitMock).toHaveBeenCalledWith(
      { kind: "extract", id: "ext-remediation-1" },
      URGENT_REMEDIATION_PRIORITY_SLIDER
    );
    expect(URGENT_REMEDIATION_PRIORITY_SLIDER).toBeLessThan(10);

    expect(createLearningItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: "doc-raft",
        extract_id: "ext-remediation-1",
        item_type: "Flashcard",
      })
    );

    const queuedBtn = await screen.findByRole("button", {
      name: /Queued for Urgent Review \(P8\)/i,
    });
    expect(queuedBtn).toBeDisabled();

    fireEvent.click(queuedBtn);
    expect(createExtractMock).toHaveBeenCalledTimes(1);
  });
});
