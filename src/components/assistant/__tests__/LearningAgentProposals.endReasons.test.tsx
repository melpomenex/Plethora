/**
 * End-reason matrix (change 9.4): every end reason renders distinct localized
 * copy, zero-proposal partials narrate honestly, and route disclosure appears
 * with the answer.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LearningAgentProposals, type LearningAgentRunView } from "../LearningAgentProposals";

function run(overrides: Partial<LearningAgentRunView>): LearningAgentRunView {
  return {
    runId: "run-1",
    conversationId: "conv-1",
    intent: "Cards from this section",
    scope: "section",
    sources: [],
    proposals: [],
    provider: "cloud-llm:cfg-1",
    modelClass: "full",
    capabilityRevision: "rev-1",
    ...overrides,
  };
}

describe("LearningAgentProposals end-reason matrix", () => {
  it("renders distinct localized copy per end reason", () => {
    const cases: Array<[string, string]> = [
      ["turn-budget", "turn limit"],
      ["no-progress", "no usable tool calls"],
      ["tool-budget", "limit of tool calls"],
      ["proposal-budget", "limit of proposals"],
      ["timeout", "hard deadline"],
      ["retrieval-hops", "retrieval limit"],
      ["loop-detected", "same action without progress"],
      ["agent-protocol", "bounded recovery"],
      ["cancelled", "cancelled"],
      ["blocked", "frozen sources or destination changed"],
      ["error", "model request failed"],
    ];
    for (const [reason, expected] of cases) {
      const { unmount } = render(<LearningAgentProposals run={run({ endReason: reason, partial: true })} />);
      expect(screen.getByText(new RegExp(expected, "i")), reason).toBeTruthy();
      unmount();
    }
  });

  it("zero-proposal partial runs narrate honestly from a section", () => {
    const { getByText } = render(
      <LearningAgentProposals run={run({ endReason: "agent-protocol", partial: true })} />
    );
    expect(getByText(/no cards could be validated from this section/i)).toBeTruthy();
  });

  it("discloses the serving model beside the answer", () => {
    const { getByText } = render(
      <LearningAgentProposals
        run={run({
          model: "gemini-2.0-flash",
          servedModel: "gemini-2.0-flash",
          servedProviderId: "cloud-llm:cfg-1",
          selectedProviderId: "gemini",
          endReason: "final-answer",
        })}
      />
    );
    expect(getByText(/served by/i)).toBeTruthy();
    expect(getByText(/gemini-2.0-flash/)).toBeTruthy();
  });

  it("states a route mismatch as a disclosure, not a substitution", () => {
    const { getByText } = render(
      <LearningAgentProposals
        run={run({
          provider: "cloud-llm:cfg-1",
          model: "gemini-2.0-flash",
          servedModel: "llama3",
          servedProviderId: "cloud-llm:cfg-9",
          selectedProviderId: "gemini",
          endReason: "final-answer",
        })}
      />
    );
    expect(getByText(/you selected/i)).toBeTruthy();
  });
});
