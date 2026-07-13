import { describe, expect, it } from "vitest";
import { findUnjournaledChanges } from "../sync/coverageAudit";

describe("sync coverage audit", () => {
  it("finds a persisted change with no matching journal operation", () => {
    expect(findUnjournaledChanges(
      [{ domain: "cards", entityKey: "1", updatedAt: "2" }, { domain: "cards", entityKey: "2", updatedAt: "3" }],
      [{ domain: "cards", entityKey: "1", clock: "2" }],
    )).toEqual([{ domain: "cards", entityKey: "2", updatedAt: "3" }]);
  });
});
