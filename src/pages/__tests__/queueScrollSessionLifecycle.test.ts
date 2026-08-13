import { describe, expect, it } from "vitest";
import { shouldBuildScrollSession } from "../queueScrollSessionLifecycle";

describe("shouldBuildScrollSession", () => {
  it("does not recompose the session when a rating/removal lock is released", () => {
    let wasRating = false;
    const runEffect = (isRating: boolean) => {
      const shouldBuild = shouldBuildScrollSession({ isRating, wasRating });
      wasRating = isRating;
      return shouldBuild;
    };

    // Initial data arrival builds the session.
    expect(runEffect(false)).toBe(true);

    // Rating starts, then due/rated source state mutates while it is in flight.
    // Neither effect run may replace the established session order.
    expect(runEffect(true)).toBe(false);
    expect(runEffect(true)).toBe(false);

    // The old race was here: unlocking rebuilt and re-sorted the remaining
    // 50/50 session at the current numeric index, replacing the flashcard that
    // advanceAfterRemoval had just revealed with a document.
    expect(runEffect(false)).toBe(false);

    // A later, genuine source/settings dependency change while idle still
    // rebuilds normally.
    expect(runEffect(false)).toBe(true);
  });
});
