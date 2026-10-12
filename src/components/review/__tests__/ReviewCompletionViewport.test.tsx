import { describe, expect, it } from "vitest";
import { render, within } from "../../../test/utils";
import { ReviewCompletionViewport } from "../ReviewCompletionViewport";

describe("ReviewCompletionViewport", () => {
  it("keeps the final action inside a bounded vertical scroll area", () => {
    render(
      <ReviewCompletionViewport>
        <p>Review summary</p>
        <button type="button">Back to Review Home</button>
      </ReviewCompletionViewport>,
    );

    const viewport = document.querySelector("[data-review-completion-viewport]");
    expect(viewport).toBeTruthy();
    expect(viewport).toHaveClass(
      "h-full",
      "min-h-0",
      "overflow-y-auto",
      "overscroll-y-contain",
    );

    const content = viewport?.firstElementChild;
    expect(content).toHaveClass("min-h-full", "justify-center", "pb-6");
    expect(
      within(viewport as HTMLElement).getByRole("button", {
        name: "Back to Review Home",
      }),
    ).toBeInTheDocument();
  });
});
