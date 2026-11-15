import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QACreatorPopup } from "../QACreatorPopup";
import { ClozeCreatorPopup } from "../ClozeCreatorPopup";

const mocks = vi.hoisted(() => ({
  createQAFromExtract: vi.fn(),
  createClozeFromExtract: vi.fn(),
}));

vi.mock("../../../api/extract-review", () => ({
  createQAFromExtract: mocks.createQAFromExtract,
  createClozeFromExtract: mocks.createClozeFromExtract,
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("QACreatorPopup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("focuses question textarea on mount and does NOT steal focus back when typing answer", () => {
    const onCreated = vi.fn();
    const onCancel = vi.fn();

    render(
      <QACreatorPopup
        extractId="ext-1"
        onCreated={onCreated}
        onCancel={onCancel}
      />
    );

    const questionInput = screen.getByPlaceholderText("Enter your question here...");
    const answerInput = screen.getByPlaceholderText("Enter the answer...");

    // Mount focus should be on the question input
    expect(document.activeElement).toBe(questionInput);

    // Focus answer and type
    answerInput.focus();
    expect(document.activeElement).toBe(answerInput);

    fireEvent.change(answerInput, { target: { value: "A" } });
    // Focus should remain on answerInput, NOT stolen by questionInput
    expect(document.activeElement).toBe(answerInput);

    fireEvent.change(answerInput, { target: { value: "Answer text" } });
    expect(document.activeElement).toBe(answerInput);
  });

  it("submits on Ctrl+Enter and closes on Escape", async () => {
    const onCreated = vi.fn();
    const onCancel = vi.fn();
    mocks.createQAFromExtract.mockResolvedValue({ id: "item-1" });

    render(
      <QACreatorPopup
        extractId="ext-1"
        onCreated={onCreated}
        onCancel={onCancel}
      />
    );

    const questionInput = screen.getByPlaceholderText("Enter your question here...");
    const answerInput = screen.getByPlaceholderText("Enter the answer...");

    fireEvent.change(questionInput, { target: { value: "What is X?" } });
    fireEvent.change(answerInput, { target: { value: "X is Y" } });

    // Ctrl+Enter
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(mocks.createQAFromExtract).toHaveBeenCalledWith("ext-1", "What is X?", "X is Y");
      expect(onCreated).toHaveBeenCalledWith({ id: "item-1" });
    });

    // Escape
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders non-blocking docked split-sheet, inserts live selection into Answer, and isolates triage keydown propagation", () => {
    const onCreated = vi.fn();
    const onCancel = vi.fn();
    const parentKeyDown = vi.fn();
    const onGrabSelection = vi.fn(() => "Lamport timestamps");

    render(
      <div onKeyDown={parentKeyDown}>
        <QACreatorPopup
          extractId="ext-1"
          mode="docked"
          onGrabSelection={onGrabSelection}
          onCreated={onCreated}
          onCancel={onCancel}
        />
      </div>
    );

    const sheet = document.querySelector("[data-split-sheet='true']");
    expect(sheet).toBeInTheDocument();
    expect(sheet).toHaveAttribute("data-creator-mode", "docked");
    expect(document.querySelector(".bg-black\\/60")).not.toBeInTheDocument();

    const questionInput = screen.getByPlaceholderText("Enter your question here...");
    const answerInput = screen.getByPlaceholderText("Enter the answer...") as HTMLTextAreaElement;

    fireEvent.change(questionInput, { target: { value: "What orders events?" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert Selection into Answer" }));

    expect(onGrabSelection).toHaveBeenCalledTimes(1);
    expect(answerInput.value).toBe("Lamport timestamps");
    expect((questionInput as HTMLTextAreaElement).value).toBe("What orders events?");

    for (const key of ["e", "q", "d", "p", " "]) {
      fireEvent.keyDown(questionInput, { key });
    }
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it("renders ClozeCreatorPopup in docked split-sheet mode and inserts current selection", () => {
    const onCreated = vi.fn();
    const onCancel = vi.fn();

    render(
      <ClozeCreatorPopup
        extractId="ext-1"
        selectedText="Initial {{cloze}}"
        selectionRange={[0, 17]}
        mode="docked"
        onGrabSelection={() => "second sentence"}
        onCreated={onCreated}
        onCancel={onCancel}
      />
    );

    const sheet = document.querySelector("[data-split-sheet='true']");
    expect(sheet).toBeInTheDocument();
    expect(document.querySelector(".bg-black\\/60")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Insert Current Selection" }));
    const textarea = screen.getByPlaceholderText("e.g. The {{capital}} of France is Paris.") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Initial {{cloze}}\nsecond sentence");
  });
});
