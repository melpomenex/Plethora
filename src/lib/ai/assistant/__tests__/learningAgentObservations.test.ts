/**
 * D0 correlation for the agent persistence stage (diagnostics task 5.1).
 *
 * A generation success must not be reported as workflow success when the
 * subsequent save fails; the stage summary has to distinguish them.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { saveAgentProposals } from "../learningAgentAcceptance";
import type { AgentCardProposal } from "../../agent/tools/types";
import type { LearningCardCandidate } from "../../schemas/learningMaterial";
import { clearFeatureDiagnostics, getFeatureSummary } from "../../diagnostics";

function proposal(): AgentCardProposal {
  return {
    kind: "flashcard",
    proposalId: "p1",
    cardType: "qa",
    question: "What is entropy?",
    answer: "A measure of disorder in a system.",
    sourceText: "Entropy is a measure of disorder in a system.",
    sourceRefs: [
      {
        handle: "s1",
        refId: "chunk-1",
        kind: "chunk",
        documentId: "doc-a",
        title: "Paper A",
        locator: "Chapter 1",
        text: "Entropy is a measure of disorder in a system.",
      },
    ],
    sourceRevision: "rev-1",
    evidenceQuote: "Entropy is a measure of disorder in a system.",
    createdAt: 1,
  };
}

function candidate(): LearningCardCandidate {
  return {
    cardType: "qa",
    concept: "entropy",
    conceptKeys: ["entropy"],
    question: "What is entropy?",
    answer: "A measure of disorder in a system.",
    evidenceQuote: "Entropy is a measure of disorder in a system.",
  };
}

describe("agent persistence observations", () => {
  beforeEach(() => clearFeatureDiagnostics());

  it("records a successful persistence stage", async () => {
    const result = await saveAgentProposals({
      runId: "run-success",
      conversationId: "conv-1",
      provider: "fake",
      modelClass: "full",
      capabilityRevision: "rev-1",
      proposals: [],
      selected: [],
    });
    expect(result.failed).toHaveLength(0);
    const summary = getFeatureSummary("learning-agent", "rev-1")!;
    expect(summary.stages.persistence?.outcome).toBe("success");
  });

  it("records a failed save while generation evidence stays separate", async () => {
    const result = await saveAgentProposals(
      {
        runId: "run-fail",
        conversationId: "conv-1",
        provider: "fake",
        modelClass: "full",
        capabilityRevision: "rev-2",
        proposals: [proposal()],
        selected: [{ proposalId: "p1", candidate: candidate() }],
      },
      {
        createBatch: async () => {
          throw new Error("disk full");
        },
        findSaved: async () => [],
        checkDuplicates: async () => [],
        getDocumentSnapshot: () => ({ contentVersion: "rev-1" }),
      }
    );
    expect(result.failed.length).toBeGreaterThan(0);
    const summary = getFeatureSummary("learning-agent", "rev-2")!;
    expect(summary.stages.persistence?.outcome).toBe("failed");
    expect(summary.stages.persistence?.recoveryCode).toBe("save_failed");
  });
});
