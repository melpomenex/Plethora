import { describe, expect, it } from "vitest";
import {
  FILE_INTENT_TTL_MS,
  QUEUE_PREFETCH_HORIZON,
  __fileAvailabilityIntentTest,
} from "../sync/fileAvailabilityIntent";

describe("file availability intent", () => {
  it("uses a device-scoped key so queue cleanup cannot cancel another device", () => {
    expect(__fileAvailabilityIntentTest.keyFor("desktop", "file-1")).toBe("desktop:file-1");
    expect(__fileAvailabilityIntentTest.keyFor("phone", "file-1")).not.toBe(
      __fileAvailabilityIntentTest.keyFor("desktop", "file-1"),
    );
  });

  it("expires queue intents without treating them as a file deletion", () => {
    const now = Date.now();
    expect(__fileAvailabilityIntentTest.isActive({ expiresAt: new Date(now + 1).toISOString() } as never, now)).toBe(true);
    expect(__fileAvailabilityIntentTest.isActive({ expiresAt: new Date(now - 1).toISOString() } as never, now)).toBe(false);
    expect(FILE_INTENT_TTL_MS).toBeGreaterThan(0);
    expect(QUEUE_PREFETCH_HORIZON).toBe(3);
  });

  it("selects only the bounded file-backed queue horizon", () => {
    const docs = [
      { id: "a", fileId: undefined },
      { id: "b", fileId: "file-b" },
      { id: "c", fileId: "file-c" },
      { id: "d", fileId: "file-d" },
      { id: "e", fileId: "file-e" },
    ] as never[];
    expect(__fileAvailabilityIntentTest.selectQueuePrefetchDocuments(docs as never, 3).map((doc: any) => doc.id)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });
});
