import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { splitTextIntoClozeCandidates } from "../LeechRefactorWizard";
import { FlashcardScrollItem } from "../FlashcardScrollItem";
import type { LearningItem } from "../../../api/learning-items";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../hooks/useHapticFeedback", () => ({
  useHapticFeedback: () => ({ trigger: vi.fn(), click: vi.fn() }),
}));

vi.mock("../../../lib/feedback/orchestrator", () => ({
  emitUserInteraction: vi.fn(),
}));

vi.mock("../../../lib/rating-grades", () => ({
  gradeToRating: (g: number) => g,
  useRatingSchema: () => ({ type: "four-button" }),
}));

vi.mock("../SixGradeRatingControl", () => ({
  SixGradeRatingControl: () => <div />,
}));

vi.mock("../ReviewCardContent", () => ({
  ReviewCardContent: ({ text }: { text: string }) => <div>{text}</div>,
}));

const leechCard: LearningItem = {
  id: "card-leech",
  extract_id: "ext-1",
  item_type: "Flashcard",
  question: "Explain Raft safety guarantees.",
  answer: "Leader completeness ensures committed entries persist. Log matching guarantees prefix consistency.",
  difficulty: 6.5,
  interval: 1,
  ease_factor: 1.8,
  due_date: "2026-11-16T00:00:00Z",
  date_created: "2026-10-01T00:00:00Z",
  date_modified: "2026-11-01T00:00:00Z",
  review_count: 10,
  lapses: 5,
  state: "Relearning",
  is_suspended: false,
  tags: [],
};

describe("UX03-T03 LeechRefactorWizard", () => {
  it("deterministically splits multi-sentence text into atomic cloze candidates", () => {
    const candidates = splitTextIntoClozeCandidates(
      "Leader completeness ensures committed entries persist. Log matching guarantees prefix consistency; State machine safety prevents divergence."
    );
    expect(candidates).toEqual([
      "Leader completeness ensures committed entries persist",
      "Log matching guarantees prefix consistency",
      "State machine safety prevents divergence",
    ]);
  });

  it("renders LeechRefactorWizard in FlashcardScrollItem when lapses >= 4 and supports Demote & Split", async () => {
    const onDemoteToExtract = vi.fn();
    const onSplitClozes = vi.fn();

    render(
      <FlashcardScrollItem
        learningItem={leechCard}
        parentExtractText="Raft guarantees safety by requiring leader completeness and log matching."
        onRate={vi.fn()}
        onDemoteToExtract={onDemoteToExtract}
        onSplitClozes={onSplitClozes}
      />
    );

    const wizard = document.querySelector("[data-leech-refactor-wizard='true']");
    expect(wizard).toBeInTheDocument();
    expect(wizard).toHaveTextContent("Leech Detected (5 lapses)");
    expect(wizard).toHaveTextContent(
      "Raft guarantees safety by requiring leader completeness and log matching."
    );

    fireEvent.click(screen.getByRole("button", { name: "Split into Simpler Clozes" }));
    await waitFor(() => {
      expect(onSplitClozes).toHaveBeenCalledWith([
        "Leader completeness ensures committed entries persist",
        "Log matching guarantees prefix consistency",
      ]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Demote to Reading Extract" }));
    await waitFor(() => {
      expect(onDemoteToExtract).toHaveBeenCalledTimes(1);
    });
  });

  it("does not render LeechRefactorWizard when lapses < 4", () => {
    render(
      <FlashcardScrollItem
        learningItem={{ ...leechCard, lapses: 2 }}
        onRate={vi.fn()}
      />
    );
    expect(document.querySelector("[data-leech-refactor-wizard='true']")).not.toBeInTheDocument();
  });
});
