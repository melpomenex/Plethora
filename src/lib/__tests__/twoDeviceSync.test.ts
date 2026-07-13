import { describe, expect, it } from "vitest";
import { mergeFieldLww } from "../sync/replicatedMap";
import { mergeReviewEvents } from "../sync/reviewLog";

describe("two-device sync contract matrix", () => {
  it("keeps desktop-read RSS state hidden on mobile after convergence", () => {
    const desktop = { updatedAt: "2", is_read: true, read_at: "2", unread_at: null, is_queued: false, queued_at: null };
    const mobile = { updatedAt: "1", is_read: false, read_at: null, unread_at: null, is_queued: false, queued_at: null };
    const merged = mergeFieldLww(mobile, desktop, [["is_read", "read_at"], ["is_queued", "queued_at"]]);
    expect(merged.is_read).toBe(true);
  });

  it("keeps both offline device reviews while collapsing replay", () => {
    const events = [
      { id: "a", itemId: "card", reviewedAtMs: 1, deviceId: "desktop", rating: 3 },
      { id: "b", itemId: "card", reviewedAtMs: 2, deviceId: "mobile", rating: 1 },
      { id: "a", itemId: "card", reviewedAtMs: 1, deviceId: "desktop", rating: 3 },
    ];
    expect(mergeReviewEvents(events).map((event) => event.id)).toEqual(["a", "b"]);
  });
});
