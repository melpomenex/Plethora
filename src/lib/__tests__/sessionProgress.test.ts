import { describe, expect, it } from "vitest";
import { mergeSessionProgress } from "../sync/sessionProgress";

describe("session-aware progress", () => {
  it("keeps the newest progress in one session", () => {
    expect(mergeSessionProgress({ sessionId: "s", position: 10, updatedAt: "2" }, { sessionId: "s", position: 8, updatedAt: "1" }).position).toBe(10);
  });

  it("allows an explicit newer reset to move backward", () => {
    expect(mergeSessionProgress({ sessionId: "s", position: 80, updatedAt: "2" }, { sessionId: "s", position: 0, updatedAt: "3", resetAt: "3" }).position).toBe(0);
  });
});
