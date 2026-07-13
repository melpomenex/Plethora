import { describe, expect, it, vi } from "vitest";
import { commitLocalMutationWithSync, projectInboxBatch } from "../sync/syncJournal";

describe("sync journal helpers", () => {
  it("commits the local mutation without making offline sync a dependency", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "local-1" });
    const result = await commitLocalMutationWithSync({
      mutate,
      operation: {
        domain: "learningItems",
        entityKey: "local-1",
        operation: "upsert",
        payload: { id: "local-1" },
        clock: "clock-1",
      },
    });
    expect(result).toEqual({ id: "local-1" });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("returns an empty bounded projection result when the journal is unavailable", async () => {
    const result = await projectInboxBatch(async () => undefined, 1);
    expect(result).toEqual({ applied: 0, failed: 0 });
  });
});
