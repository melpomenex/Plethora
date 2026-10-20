import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const checkSemanticDuplicateCandidates = vi.hoisted(() => vi.fn());
const createLearningItemsBatch = vi.hoisted(() => vi.fn());
const createLearningItem = vi.hoisted(() => vi.fn());
const createClozeFromExtract = vi.hoisted(() => vi.fn());
const recordAiProvenance = vi.hoisted(() => vi.fn());
const getLearningItemsByAcceptanceKey = vi.hoisted(() => vi.fn());
const updateLearningItemTags = vi.hoisted(() => vi.fn());

vi.mock("../../../api/learning-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/learning-items")>();
  return {
    ...actual,
    checkSemanticDuplicateCandidates,
    createLearningItemsBatch,
    createLearningItem,
    getLearningItemsByAcceptanceKey,
    updateLearningItemTags,
  };
});
vi.mock("../../../api/extract-review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/extract-review")>();
  return { ...actual, createClozeFromExtract };
});
vi.mock("../../../api/ai-provenance", () => ({ recordAiProvenance }));

import { LearningAgentProposals } from "../LearningAgentProposals";
import type { AgentProposal } from "../../../lib/ai/agent/tools/types";

function proposal(
  id: string,
  documentId: string,
  title: string,
  question: string,
  answer: string,
  sourceText: string
): AgentProposal {
  return {
    kind: "flashcard",
    proposalId: id,
    question,
    answer,
    cardType: "qa",
    concept: question,
    conceptKeys: [question],
    sourceText,
    evidenceQuote: sourceText,
    sourceRevision: "rev-1",
    sourceRefs: [
      {
        handle: `s-${documentId}`,
        refId: `chunk-${documentId}`,
        kind: "chunk",
        documentId,
        title,
        locator: "Chapter 1",
        text: sourceText,
        sourceRevision: "rev-1",
      },
    ],
    createdAt: 1,
  } as AgentProposal;
}

const run = {
  runId: "run-ui-1",
  conversationId: "conv-1",
  intent: "Cards from these papers",
  scope: "papers" as const,
  sources: [
    {
      attachmentId: "doc:paper-a",
      kind: "document" as const,
      libraryId: "paper-a",
      title: "Paper A",
      origin: "active-view" as const,
      role: "required" as const,
    },
    {
      attachmentId: "doc:paper-b",
      kind: "document" as const,
      libraryId: "paper-b",
      title: "Paper B",
      origin: "picker" as const,
      role: "optional" as const,
    },
  ],
  proposals: [
    proposal("p1", "paper-a", "Paper A", "What is entropy?", "Disorder.", "Entropy is disorder."),
    proposal("p2", "paper-a", "Paper A", "What is enthalpy?", "Heat content.", "Enthalpy is heat content."),
    proposal("p3", "paper-b", "Paper B", "What is free energy?", "Spontaneity.", "Free energy predicts spontaneity."),
  ],
  provider: "fake",
  modelClass: "full",
  capabilityRevision: "rev-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  checkSemanticDuplicateCandidates.mockResolvedValue([]);
  createLearningItemsBatch.mockImplementation(async (entries: Array<{ proposal_id: string; question: string }>) =>
    entries.map((entry) => ({
      id: `saved-${entry.proposal_id}`,
      question: entry.question,
      item_type: "Qa",
      state: "New",
      due_date: "",
      date_created: "",
      date_modified: "",
      difficulty: 0,
      interval: 0,
      ease_factor: 0,
      review_count: 0,
      lapses: 0,
      is_suspended: false,
      tags: [],
    }))
  );
  recordAiProvenance.mockResolvedValue({});
  getLearningItemsByAcceptanceKey.mockResolvedValue([]);
  updateLearningItemTags.mockImplementation(async (itemId: string, tags: string[]) => ({
    id: itemId,
    tags,
  }));
});

describe("LearningAgentProposals", () => {
  it("groups previews by their actual source document", async () => {
    render(<LearningAgentProposals run={run as never} />);
    await waitFor(() => {
      expect(document.querySelector('[data-agent-source-group="document:paper-a"]')).not.toBeNull();
      expect(document.querySelector('[data-agent-source-group="document:paper-b"]')).not.toBeNull();
    });
    expect(screen.getByText("Paper A")).toBeInTheDocument();
    expect(screen.getByText("Paper B")).toBeInTheDocument();
  });

  it("saves only the selected subset and reports per-group results", async () => {
    const onArtifactChange = vi.fn();
    render(<LearningAgentProposals run={run as never} onArtifactChange={onArtifactChange} />);
    await waitFor(() => expect(screen.getByText("What is entropy?")).toBeInTheDocument());

    // Uncheck the second card on paper A; the third (paper B) stays selected.
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save selected/i }));
    });

    await waitFor(() => expect(createLearningItemsBatch).toHaveBeenCalled());
    const entries = createLearningItemsBatch.mock.calls.flatMap(
      (call) => call[0] as Array<{ proposal_id: string; document_id?: string }>
    );
    expect(entries.map((entry) => entry.proposal_id).sort()).toEqual(["p1", "p3"]);
    expect(entries.find((entry) => entry.proposal_id === "p1")?.document_id).toBe("paper-a");
    expect(entries.find((entry) => entry.proposal_id === "p3")?.document_id).toBe("paper-b");
    expect(onArtifactChange).toHaveBeenCalled();
    const artifact = onArtifactChange.mock.calls.at(-1)?.[0];
    expect(artifact.candidates.find((row: { proposalId: string }) => row.proposalId === "p1").savedId).toBe(
      "saved-p1"
    );
    expect(artifact.candidates.find((row: { proposalId: string }) => row.proposalId === "p2").status).toBe(
      "draft"
    );
  });

  it("blocks acceptance when duplicate checking is unavailable and requires a retry", async () => {
    checkSemanticDuplicateCandidates.mockRejectedValueOnce(new Error("service offline"));
    render(<LearningAgentProposals run={run as never} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Retry duplicate check/i })).toBeInTheDocument()
    );
    expect(screen.getAllByRole("checkbox")[0]).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save selected \(2\)/i })).toBeEnabled();

    fireEvent.click(screen.getAllByRole("button", { name: /Retry duplicate check/i })[0]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Save selected \(3\)/i })).toBeEnabled()
    );
  });

  it("blocks approval for a source the user removed after the run", async () => {
    render(
      <LearningAgentProposals
        run={{ ...run, revokedSourceIds: ["paper-a"] } as never}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/cited source was removed/i)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /Save selected/i })).toBeDisabled();
  });

  it("requires a visible confirmation before applying an agent tag", async () => {
    const tagProposal: AgentProposal = {
      kind: "tag",
      proposalId: "tag-1",
      itemId: "item-1",
      itemQuestion: "What is entropy?",
      existingTags: ["physics"],
      tag: "thermo",
      sourceText: "What is entropy?",
      sourceRefs: [
        {
          handle: "s1",
          refId: "item-1",
          kind: "card",
          documentId: "paper-a",
          title: "Paper A",
          text: "What is entropy?",
        },
      ],
      sourceRevision: "rev-1",
      createdAt: 1,
    } as AgentProposal;
    render(
      <LearningAgentProposals run={{ ...run, proposals: [tagProposal] } as never} />
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Apply tag/i })).toBeInTheDocument()
    );
    expect(updateLearningItemTags).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Apply tag/i }));
    expect(screen.getByText(/Add tag/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(updateLearningItemTags).toHaveBeenCalledWith("item-1", ["physics", "thermo"])
    );
  });

  it("revalidates an edit before allowing acceptance", async () => {
    render(<LearningAgentProposals run={run as never} />);
    await waitFor(() => expect(screen.getByText("What is entropy?")).toBeInTheDocument());
    const questionBox = screen.getAllByRole("textbox", { name: /Card front/i })[0];
    fireEvent.change(questionBox, { target: { value: "What is entropy, edited?" } });
    // Editing clears the checkbox until revalidation passes.
    await waitFor(() =>
      expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked()
    );
    const revalidate = screen.getAllByRole("button", { name: /Revalidate/i })[0];
    fireEvent.click(revalidate);
    await waitFor(() =>
      expect(screen.getAllByRole("checkbox")[0]).toBeChecked()
    );
  });
});
