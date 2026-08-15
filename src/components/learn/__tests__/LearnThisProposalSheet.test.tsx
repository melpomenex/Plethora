/**
 * LearnThisProposalSheet preview interactions (task 2.9):
 *  - renders the proposal header and candidate cards after the run;
 *  - valid candidates start accepted; flagged (ungrounded/duplicate)
 *    candidates CANNOT be accepted until an edit makes them pass validation;
 *  - editing a candidate re-validates it (grounding) and unlocks acceptance;
 *  - Regenerate re-runs the task;
 *  - acceptance goes through `acceptLearnThisCandidates` with document +
 *    provenance context, then reports the created count.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnThisRun } from "../../../lib/ai/tasks/definitions/learnThisValidation";

const runLearnThis = vi.hoisted(() => vi.fn());
const acceptLearnThisCandidates = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.message !== undefined ? `${key}: ${params.message}` : key,
  }),
}));

vi.mock("../../../lib/ai/tasks/definitions/learnThisValidation", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../lib/ai/tasks/definitions/learnThisValidation")
  >();
  return { ...actual, runLearnThis };
});

vi.mock("../acceptLearnThis", () => ({ acceptLearnThisCandidates }));

import { LearnThisProposalSheet } from "../LearnThisProposalSheet";

const PASSAGE =
  "Entropy is a measure of the number of microstates consistent with a macrostate. Temperature is the average kinetic energy of particles.";

function makeRun(): LearnThisRun {
  return {
    run: {
      taskId: "learn-this",
      output: {} as never,
      text: "",
      providerId: "fake-ondevice",
      providerKind: "ondevice",
      requestedModelClass: "full",
      servedModelClass: "full",
      fallbackPath: "none",
      validationOutcome: "strict-json",
      baseModelName: "gemini-nano",
    },
    validated: {
      proposal: {
        importance: 0.9,
        knowledgeType: "definition",
        concepts: ["entropy"],
        suggestedCards: [],
        prerequisites: [],
        tags: ["physics"],
        rationale: "Core statistical definition.",
      },
      candidates: [
        {
          candidate: {
            cardType: "definition",
            conceptKeys: ["entropy"],
            question: "Define entropy.",
            answer: "Entropy is a measure of microstates.",
          },
          status: "valid",
          issues: [],
          groundingScore: 1,
        },
        {
          candidate: {
            cardType: "qa",
            conceptKeys: ["entropy"],
            question: "What does entropy smell like?",
            answer: "Purple cheese riding a unicycle through hyperspace.",
          },
          status: "ungrounded",
          issues: ["answer not grounded in the source passage"],
          groundingScore: 0.1,
        },
      ],
      validCount: 1,
    },
  };
}

function renderSheet(props: Partial<Parameters<typeof LearnThisProposalSheet>[0]> = {}) {
  return render(
    <LearnThisProposalSheet
      open
      text="Entropy is a measure of microstates."
      passage={PASSAGE}
      documentId="doc-1"
      onClose={vi.fn()}
      {...props}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  runLearnThis.mockResolvedValue(makeRun());
  acceptLearnThisCandidates.mockResolvedValue({ created: [{ id: "item-1" }], provenanceRecorded: 1 });
});

describe("LearnThisProposalSheet", () => {
  it("runs on open and renders the proposal with its candidates", async () => {
    renderSheet();
    expect(runLearnThis).toHaveBeenCalledWith(
      expect.objectContaining({ passage: PASSAGE }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    await waitFor(() =>
      expect(screen.getByText("aiLearning.kt.definition")).toBeTruthy()
    );
    expect(screen.getByText("Core statistical definition.")).toBeTruthy();
    expect(screen.getByText("Define entropy.")).toBeTruthy();
    expect(screen.getByText("What does entropy smell like?")).toBeTruthy();
    expect(screen.getByText("aiLearning.regenerate")).toBeTruthy();
  });

  it("shows the running state while the task is in flight", async () => {
    runLearnThis.mockReturnValue(new Promise(() => {}));
    renderSheet();
    expect(screen.getByText("aiLearning.running")).toBeTruthy();
  });

  it("starts valid candidates accepted and flagged candidates blocked", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByText("Define entropy.")).toBeTruthy());

    const checkboxes = screen.getAllByLabelText("aiLearning.acceptCard");
    expect(checkboxes[0]).not.toBeDisabled();
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect(checkboxes[1]).toBeDisabled();
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);

    // The ungrounded candidate is presented flagged.
    expect(screen.getByText("aiLearning.statusUngrounded")).toBeTruthy();
  });

  it("accepts only the currently selected candidates through the domain flow", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByText("Define entropy.")).toBeTruthy());

    fireEvent.click(screen.getByText(/aiLearning.accept/));

    await waitFor(() => expect(acceptLearnThisCandidates).toHaveBeenCalledTimes(1));
    const [candidates, ctx] = acceptLearnThisCandidates.mock.calls[0];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].question).toBe("Define entropy.");
    expect(ctx).toMatchObject({
      documentId: "doc-1",
      provider: "fake-ondevice",
      model: "gemini-nano",
      modelClass: "full",
      passage: PASSAGE,
    });
    expect(screen.getByText(/aiLearning.created/)).toBeTruthy();
  });

  it("unchecking the only valid candidate disables acceptance", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByText("Define entropy.")).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText("aiLearning.acceptCard")[0]);
    const acceptButton = screen
      .getAllByRole("button")
      .find((b) => b.textContent === "aiLearning.accept");
    expect(acceptButton).toBeDefined();
    expect((acceptButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("unlocks a flagged candidate after an edit that grounds it", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByText("What does entropy smell like?")).toBeTruthy());

    // Enter edit mode for the flagged card.
    const editButtons = screen.getAllByLabelText("aiLearning.edit");
    fireEvent.click(editButtons[1]);

    const answerBox = await screen.findByDisplayValue(
      "Purple cheese riding a unicycle through hyperspace."
    );
    fireEvent.change(answerBox, {
      target: { value: "Entropy is a measure of microstates." },
    });

    const checkboxes = screen.getAllByLabelText("aiLearning.acceptCard");
    expect(checkboxes[1]).not.toBeDisabled();

    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "aiLearning.accept")!);

    await waitFor(() => expect(acceptLearnThisCandidates).toHaveBeenCalledTimes(1));
    const [candidates] = acceptLearnThisCandidates.mock.calls[0];
    expect(candidates).toHaveLength(2);
    expect(candidates[1].answer).toBe("Entropy is a measure of microstates.");
  });

  it("keeps a flagged candidate blocked when the edit does not ground it", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByText("What does entropy smell like?")).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText("aiLearning.edit")[1]);
    const answerBox = await screen.findByDisplayValue(
      "Purple cheese riding a unicycle through hyperspace."
    );
    fireEvent.change(answerBox, { target: { value: "Still totally made up nonsense." } });

    const checkboxes = screen.getAllByLabelText("aiLearning.acceptCard");
    expect(checkboxes[1]).toBeDisabled();
  });

  it("switches the card type through the type dropdown", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByText("Define entropy.")).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText("aiLearning.edit")[0]);
    const select = await screen.findByDisplayValue("aiLearning.ct.definition");
    fireEvent.change(select, { target: { value: "qa" } });

    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "aiLearning.accept")!);
    await waitFor(() => expect(acceptLearnThisCandidates).toHaveBeenCalledTimes(1));
    const [candidates] = acceptLearnThisCandidates.mock.calls[0];
    expect(candidates[0].cardType).toBe("qa");
  });

  it("regenerate re-runs the task and replaces the proposal", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByText("Define entropy.")).toBeTruthy());
    fireEvent.click(screen.getByText("aiLearning.regenerate"));
    await waitFor(() => expect(runLearnThis).toHaveBeenCalledTimes(2));
  });

  it("shows the failure state with a retry action", async () => {
    runLearnThis.mockRejectedValue(new Error("model offline"));
    renderSheet();
    await waitFor(() =>
      expect(screen.getByText("aiLearning.error: model offline")).toBeTruthy()
    );
    expect(screen.getByText("aiLearning.retry")).toBeTruthy();
  });

  it("shows the empty state when nothing could be proposed", async () => {
    const emptyRun = makeRun();
    emptyRun.validated.candidates = [];
    runLearnThis.mockResolvedValue(emptyRun);
    renderSheet();
    await waitFor(() => expect(screen.getByText("aiLearning.empty")).toBeTruthy());
  });
});
