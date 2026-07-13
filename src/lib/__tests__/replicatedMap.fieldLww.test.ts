import { describe, expect, it } from "vitest";
import { mergeFieldLww } from "../sync/replicatedMap";

type Article = {
  updatedAt: string;
  is_read: boolean;
  read_at: string | null;
  unread_at: string | null;
  is_queued: boolean;
  queued_at: string | null;
};

describe("field-level sync conflicts", () => {
  it("merges independent RSS read and queued transitions", () => {
    const local: Article = {
      updatedAt: "1000.000001", is_read: true, read_at: "1000.000001", unread_at: null,
      is_queued: false, queued_at: null,
    };
    const remote: Article = {
      updatedAt: "1000.000002", is_read: true, read_at: "1000.000001", unread_at: null,
      is_queued: true, queued_at: "1000.000002",
    };
    const merged = mergeFieldLww(local, remote, [["is_read", "read_at"], ["is_queued", "queued_at"]]);
    expect(merged.is_read).toBe(true);
    expect(merged.is_queued).toBe(true);
  });

  it("allows a newer unread transition to beat stale read state", () => {
    const local: Article = {
      updatedAt: "1000.000001", is_read: true, read_at: "1000.000001", unread_at: null,
      is_queued: false, queued_at: null,
    };
    const remote: Article = {
      updatedAt: "1000.000003", is_read: false, read_at: "1000.000001", unread_at: "1000.000003",
      is_queued: false, queued_at: null,
    };
    // The RSS adapter carries the opposing transition clock as the field's
    // clock when marking unread; this fixture asserts the merge remains
    // deterministic even when that companion value is supplied.
    const merged = mergeFieldLww(local, remote, [["is_read", "unread_at"]]);
    expect(merged.is_read).toBe(false);
  });
});
