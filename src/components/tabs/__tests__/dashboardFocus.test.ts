import { describe, expect, it } from "vitest";
import { selectDailyFocus } from "../dashboardFocus";

describe("selectDailyFocus", () => {
  it("prioritizes due reviews", () => {
    expect(selectDailyFocus({ cardsDue: 3, dueDocuments: 4, hasResumableReading: true, documentCount: 10 })).toBe("review");
  });

  it("continues reading before queue work when no review is due", () => {
    expect(selectDailyFocus({ cardsDue: 0, dueDocuments: 4, hasResumableReading: true, documentCount: 10 })).toBe("continue-reading");
  });

  it("uses the queue when reading is not resumable", () => {
    expect(selectDailyFocus({ cardsDue: 0, dueDocuments: 4, hasResumableReading: false, documentCount: 10 })).toBe("queue");
  });

  it("falls back to the library for populated and empty libraries", () => {
    expect(selectDailyFocus({ cardsDue: 0, dueDocuments: 0, hasResumableReading: false, documentCount: 4 })).toBe("documents");
    expect(selectDailyFocus({ cardsDue: 0, dueDocuments: 0, hasResumableReading: false, documentCount: 0 })).toBe("documents");
  });
});
