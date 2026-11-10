import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QACreatorPopup } from "../QACreatorPopup";

const mocks = vi.hoisted(() => ({
  createQAFromExtract: vi.fn(),
}));

vi.mock("../../../api/extract-review", () => ({
  createQAFromExtract: mocks.createQAFromExtract,
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
});
