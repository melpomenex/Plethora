import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SocraticMarginThread } from "../SocraticMarginThread";

const answerQuestionMock = vi.fn();

vi.mock("../../../api/ai", () => ({
  answerQuestion: (...args: unknown[]) => answerQuestionMock(...args),
}));

describe("SocraticMarginThread", () => {
  beforeEach(() => {
    answerQuestionMock.mockReset();
  });

  it("submits question with anchored quote and converts explanation to extract and flashcard", async () => {
    answerQuestionMock.mockResolvedValueOnce(
      "Retrieval practice strengthens memory traces by forcing active reconstruction."
    );
    const onConvertToExtract = vi.fn().mockResolvedValue(undefined);
    const onConvertToFlashcard = vi.fn().mockResolvedValue(undefined);

    render(
      <SocraticMarginThread
        isOpen={true}
        documentId="doc-1"
        selectedText="Active recall outperforms passive rereading."
        onClose={vi.fn()}
        onConvertToExtract={onConvertToExtract}
        onConvertToFlashcard={onConvertToFlashcard}
      />
    );

    expect(
      screen.getByText("Active recall outperforms passive rereading.")
    ).toBeInTheDocument();

    const input = screen.getByLabelText("Ask Socratic question");
    fireEvent.change(input, { target: { value: "Why does retrieval help?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));

    await waitFor(() => {
      expect(answerQuestionMock).toHaveBeenCalledWith(
        "Why does retrieval help?",
        "Active recall outperforms passive rereading."
      );
    });

    expect(
      await screen.findByText(
        "Retrieval practice strengthens memory traces by forcing active reconstruction."
      )
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Convert Explanation to Extract/i })
    );
    await waitFor(() => {
      expect(onConvertToExtract).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Retrieval practice strengthens memory traces"),
          notes: "Socratic prompt: Why does retrieval help?",
        })
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Convert to Flashcard/i })
    );
    await waitFor(() => {
      expect(onConvertToFlashcard).toHaveBeenCalledWith({
        question: "Why does retrieval help?",
        answer:
          "Retrieval practice strengthens memory traces by forcing active reconstruction.",
      });
    });
  });

  it("preserves user prompt in input when AI call fails", async () => {
    answerQuestionMock.mockRejectedValueOnce(new Error("AI provider offline"));

    render(
      <SocraticMarginThread
        isOpen={true}
        documentId="doc-1"
        selectedText="Spaced repetition intervals expand exponentially."
        onClose={vi.fn()}
        onConvertToExtract={vi.fn()}
        onConvertToFlashcard={vi.fn()}
      />
    );

    const input = screen.getByLabelText("Ask Socratic question") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "How does spacing affect forgetting?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("AI provider offline");
    expect(input.value).toBe("How does spacing affect forgetting?");
  });
});
