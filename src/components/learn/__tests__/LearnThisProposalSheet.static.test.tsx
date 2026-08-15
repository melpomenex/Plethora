/**
 * Static-proposal path tests for LearnThisProposalSheet (task 5.9): a
 * promoted recall question opens the preview flow directly with a single
 * pre-accepted candidate — no generation runs, and only acceptance creates
 * a card.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LearnThisProposalSheet } from "../LearnThisProposalSheet";

const runLearnThis = vi.fn();
vi.mock("../../../lib/ai/tasks/definitions/learnThisValidation", () => ({
  runLearnThis: (...args: unknown[]) => runLearnThis(...args),
}));

const acceptMock = vi.fn();
vi.mock("../acceptLearnThis", () => ({
  acceptLearnThisCandidates: (...args: unknown[]) => acceptMock(...args),
}));

import { acceptLearnThisCandidates as accept } from "../acceptLearnThis";

beforeEach(() => {
  runLearnThis.mockReset();
  acceptMock.mockReset();
  acceptMock.mockResolvedValue({ created: [], provenanceRecorded: 1 });
});

describe("LearnThisProposalSheet static (promoted recall question)", () => {
  it("skips generation and previews the static candidate pre-accepted", async () => {
    render(
      <LearnThisProposalSheet
        open
        text="Why can virtual memory exceed physical RAM?"
        passage="Virtual memory maps virtual addresses onto RAM and disk-backed pages."
        documentId="doc-1"
        staticCandidates={[
          {
            question: "Why can virtual memory exceed physical RAM?",
            answer: "Address spaces map onto RAM and disk-backed pages.",
            cardType: "qa",
            conceptKeys: ["virtual memory"],
          },
        ]}
        staticProvenance={{ provider: "recall-question", modelClass: "fast" }}
        onClose={() => {}}
      />
    );

    expect(await screen.findByText(/recall question/i)).toBeInTheDocument();
    expect(screen.getByText("Why can virtual memory exceed physical RAM?")).toBeInTheDocument();
    // Generation NEVER runs for the static path.
    expect(runLearnThis).not.toHaveBeenCalled();
    // No Regenerate button (there is no passage to regenerate from).
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
    // The candidate starts checked (pre-accepted)…
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("acceptance goes through the domain batch create with static provenance", async () => {
    render(
      <LearnThisProposalSheet
        open
        text="Q?"
        passage="Passage text."
        documentId="doc-1"
        staticCandidates={[{ question: "Q?", answer: "A." }]}
        staticProvenance={{ provider: "recall-question", modelClass: "fast" }}
        onClose={() => {}}
      />
    );

    const acceptButton = await screen.findByRole("button", { name: /add 1 card/i });
    fireEvent.click(acceptButton);

    await waitForCalled();
    expect(acceptMock).toHaveBeenCalledTimes(1);
    const [candidates, ctx] = acceptMock.mock.calls[0];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].question).toBe("Q?");
    expect(candidates[0].answer).toBe("A.");
    expect(ctx.provider).toBe("recall-question");
    expect(ctx.modelClass).toBe("fast");
    expect(ctx.documentId).toBe("doc-1");
  });

  it("unchecking the candidate disables acceptance (nothing auto-created)", async () => {
    render(
      <LearnThisProposalSheet
        open
        text="Q?"
        passage="Passage."
        staticCandidates={[{ question: "Q?", answer: "A." }]}
        staticProvenance={{ provider: "recall-question", modelClass: "fast" }}
        onClose={() => {}}
      />
    );
    fireEvent.click(await screen.findByRole("checkbox"));
    const acceptButton = screen.getByRole("button", { name: /add 0 card/i });
    expect((acceptButton as HTMLButtonElement).disabled).toBe(true);
    expect(acceptMock).not.toHaveBeenCalled();
  });
});

function waitForCalled() {
  return new Promise((resolve, reject) => {
    setTimeout(() => (acceptMock.mock.calls.length > 0 ? resolve(null) : reject(new Error("not called"))), 25);
  });
}
