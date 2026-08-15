/**
 * RatingButtons advisory-suggestion tests (task 5.8, spec scenario
 * "Auto-grade suggestion is advisory"): the experimental flag may at most
 * HIGHLIGHT a suggested grade button; it never submits on the user's behalf
 * and never changes the buttons' click routing.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { RatingButtons } from "../RatingButtons";

describe("RatingButtons suggestedRating (highlight only)", () => {
  it("marks exactly one suggested button with a data attribute and ring", () => {
    const { container } = render(
      <RatingButtons onSelectRating={() => {}} suggestedRating={3 as never} />
    );
    const suggested = container.querySelectorAll("[data-suggested='true']");
    expect(suggested).toHaveLength(1);
    expect(suggested[0].getAttribute("data-review-rating")).toBe("3");
    expect(suggested[0].className).toContain("ring-4");
  });

  it("renders no suggestion marker without suggestedRating", () => {
    const { container } = render(<RatingButtons onSelectRating={() => {}} />);
    expect(container.querySelectorAll("[data-suggested='true']")).toHaveLength(0);
  });

  it("NEVER auto-submits: no rating callback fires without a click", () => {
    const onSelectRating = vi.fn();
    render(<RatingButtons onSelectRating={onSelectRating} suggestedRating={1 as never} />);
    expect(onSelectRating).not.toHaveBeenCalled();
  });

  it("clicking any button routes exactly the standard rating", () => {
    const onSelectRating = vi.fn();
    const { container } = render(
      <RatingButtons onSelectRating={onSelectRating} suggestedRating={4 as never} />
    );
    fireEvent.click(container.querySelector("[data-review-rating='2']")!);
    expect(onSelectRating).toHaveBeenCalledTimes(1);
    expect(onSelectRating).toHaveBeenCalledWith(2);
  });

  it("highlights the equivalent native grade on the SM-20 scale", () => {
    const { container } = render(
      <RatingButtons onSelectRating={() => {}} gradeScale suggestedRating={3 as never} />
    );
    const suggested = container.querySelectorAll("[data-suggested='true']");
    expect(suggested).toHaveLength(1);
    // rating 3 (Good) maps to native grade 4.
    expect(suggested[0].getAttribute("data-review-rating")).toBe("4");
  });
});
