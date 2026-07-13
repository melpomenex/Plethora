import { describe, expect, it, vi } from "vitest";
import { incrementalExport } from "../sync/incrementalExport";

describe("incremental legacy export", () => {
  it("respects record/byte budgets and checkpoints each record", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    const result = await incrementalExport({ records: [{ id: "1" }, { id: "2" }, { id: "3" }], maxRecordsPerSession: 2, publish, checkpoint });
    expect(result.exported).toBe(2);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(checkpoint).toHaveBeenCalledTimes(2);
  });
});
