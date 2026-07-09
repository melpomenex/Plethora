import { describe, expect, it } from "vitest";
import { getReviewHomeAction } from "../reviewFocus";

describe("getReviewHomeAction", () => {
  it("starts review when cards are due", () => {
    expect(getReviewHomeAction(1)).toBe("start-review");
  });

  it("offers continuing reading when caught up", () => {
    expect(getReviewHomeAction(0)).toBe("continue-reading");
  });
});
