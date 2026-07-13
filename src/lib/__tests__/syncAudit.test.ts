import { describe, expect, it } from "vitest";
import { auditSyncRecords } from "../sync/syncAudit";

describe("sync audits", () => {
  it("detects duplicate ids and malformed tombstones", async () => {
    const result = await auditSyncRecords("reviews", [
      { id: "r1" }, { id: "r1" }, { id: "deleted", _deleted: true },
    ]);
    expect(result.ok).toBe(false);
    expect(result.duplicateIds).toEqual(["r1"]);
    expect(result.invalidTombstones).toEqual(["deleted"]);
    expect(result.projectionHash).toBeTruthy();
  });
});
