import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, within } from "../../test/utils";
import { Review } from "../review";
import { useReviewStore } from "../../stores/reviewStore";

describe("review route completion layout", () => {
  beforeEach(() => {
    useReviewStore.setState({
      queue: [{} as never],
      currentIndex: 2,
      currentCard: null,
      isLoading: false,
      isAnswerShown: false,
      isSubmitting: false,
      error: null,
      sessionStartTime: Date.now() - 30_000,
      sessionStartedAt: Date.now() - 30_000,
      reviewsCompleted: 2,
      correctCount: 2,
      streak: null,
      loadQueue: vi.fn(),
      resetSession: vi.fn(),
      setPendingReviewMetadata: vi.fn(),
    });
  });

  it("keeps the completion action inside the scrollable viewport", () => {
    renderWithProviders(<Review />);

    const viewport = document.querySelector("[data-review-completion-viewport]");
    expect(viewport).toHaveClass("overflow-y-auto");
    expect(
      within(viewport as HTMLElement).getByRole("button", { name: "Back to Queue" }),
    ).toBeInTheDocument();
  });
});
