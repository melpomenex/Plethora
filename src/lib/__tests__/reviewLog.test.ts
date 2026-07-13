import { describe, expect, it } from "vitest";
import { mergeReviewEvents, recomputeScheduleFromReviewLog } from "../sync/reviewLog";

describe("review log merge", () => {
  it("deduplicates replayed events and orders concurrent devices deterministically", () => {
    const events = [
      { id: "b", itemId: "card", reviewedAtMs: 2, deviceId: "B", rating: 1 },
      { id: "a", itemId: "card", reviewedAtMs: 1, deviceId: "A", rating: 4 },
      { id: "b", itemId: "card", reviewedAtMs: 2, deviceId: "B", rating: 1 },
    ];
    expect(mergeReviewEvents(events).map((event) => event.id)).toEqual(["a", "b"]);
    expect(recomputeScheduleFromReviewLog(events, 0, (state, event) => state + event.rating)).toBe(5);
  });
});
