import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatFlashcardCollection } from "../ChatFlashcardCollection";
import type { ChatFlashcardArtifact } from "../../../features/assistant/chatFlashcardArtifacts";

const artifact = (index: number, status: ChatFlashcardArtifact["status"] = "saved"): ChatFlashcardArtifact => ({
  id: `card-${index}`,
  callIndex: index,
  type: index % 2 ? "cloze" : "qa",
  front: index % 2 ? `The {{answer ${index}}} is hidden.` : `Question ${index}`,
  back: index % 2 ? undefined : `Answer ${index}`,
  status,
  error: status === "failed" ? "Could not save" : undefined,
  createdAt: 1,
});

describe("ChatFlashcardCollection", () => {
  it("renders a compact accessible list and expands large batches", () => {
    render(<ChatFlashcardCollection artifacts={[0, 1, 2, 3, 4].map((index) => artifact(index))} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    const expand = screen.getByRole("button", { name: "Show 2 more" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("opens a row with keyboard activation and retries only a failed card", () => {
    const onOpen = vi.fn();
    const onRetry = vi.fn();
    const failed = artifact(0, "failed");
    render(<ChatFlashcardCollection artifacts={[failed]} onOpen={onOpen} onRetry={onRetry} />);
    const row = screen.getByRole("button", { name: /Open question and answer flashcard 1/ });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith(failed);
    fireEvent.click(screen.getByRole("button", { name: /Retry saving flashcard/ }));
    expect(onRetry).toHaveBeenCalledWith(failed);
  });
});
