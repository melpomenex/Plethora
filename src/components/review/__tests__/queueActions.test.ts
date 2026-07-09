import { describe, expect, it } from "vitest";
import { getQueuePrimaryAction, getQueueSecondaryActions } from "../queueActions";

describe("queue action hierarchy", () => {
  it("maps learning items to study-now with reversible secondary actions", () => {
    expect(getQueuePrimaryAction("learning-item")).toBe("study-now");
    expect(getQueueSecondaryActions("learning-item")).toContain("postpone");
  });

  it("maps documents to open-document with dismissal in secondary actions", () => {
    expect(getQueuePrimaryAction("document")).toBe("open-document");
    expect(getQueueSecondaryActions("document")).toContain("dismiss");
  });
});
