import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});

import { getRoomCursor, setRoomCursor } from "../sync/deltaLog/checkpoints";

describe("delta-log room cursor is scoped to its room", () => {
  let stored: { cursor: string; shard: string | null } | null = null;

  beforeEach(() => {
    stored = null;
    mocks.invokeCommand.mockReset();
    mocks.invokeCommand.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "set_sync_checkpoint") {
        stored = { cursor: String(args?.cursor), shard: (args?.shard as string | null) ?? null };
        return true;
      }
      if (command === "get_sync_checkpoint") return stored;
      return null;
    });
  });

  it("resumes within the same room", async () => {
    await setRoomCursor(8270, "room-a");
    expect(await getRoomCursor("room-a")).toBe(8270);
  });

  it("restarts from 0 after a room switch", async () => {
    // Seq numbers are per-room: pulling room-b `since=8270` returns an empty
    // page forever, so the device would silently receive nothing at all.
    await setRoomCursor(8270, "room-a");
    expect(await getRoomCursor("room-b")).toBe(0);
  });

  it("treats a pre-upgrade checkpoint (no shard recorded) as belonging to the current room", async () => {
    stored = { cursor: "8270", shard: null };
    expect(await getRoomCursor("room-a")).toBe(8270);
  });
});
