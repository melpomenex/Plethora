import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});

import {
  getRoomCursor,
  setRoomCursor,
  getDomainProgress,
  recordDomainProgress,
  resetDeltaLogCursors,
  ROOM_CURSOR_DOMAIN,
} from "../sync/deltaLog/checkpoints";

describe("deltaLog checkpoints", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
  });

  it("getRoomCursor defaults to 0 when no checkpoint exists", async () => {
    mocks.invokeCommand.mockResolvedValue(null);
    expect(await getRoomCursor()).toBe(0);
  });

  it("getRoomCursor reads the persisted cursor for the room-wide domain key", async () => {
    mocks.invokeCommand.mockResolvedValue({ domain: ROOM_CURSOR_DOMAIN, cursor: "42" });
    expect(await getRoomCursor()).toBe(42);
    expect(mocks.invokeCommand).toHaveBeenCalledWith("get_sync_checkpoint", { domain: ROOM_CURSOR_DOMAIN });
  });

  it("setRoomCursor persists under the synthetic room-cursor domain", async () => {
    mocks.invokeCommand.mockResolvedValue({});
    await setRoomCursor(7);
    expect(mocks.invokeCommand).toHaveBeenCalledWith("set_sync_checkpoint", {
      domain: ROOM_CURSOR_DOMAIN,
      cursor: "7",
      shard: undefined,
    });
  });

  it("domain progress is stored under a distinct per-domain key, never used as a pull cursor", async () => {
    mocks.invokeCommand.mockResolvedValue({});
    await recordDomainProgress("documents", 10);
    expect(mocks.invokeCommand).toHaveBeenCalledWith("set_sync_checkpoint", {
      domain: "deltaLog:domain:documents",
      cursor: "10",
      shard: undefined,
    });

    mocks.invokeCommand.mockResolvedValue({ domain: "deltaLog:domain:documents", cursor: "10" });
    expect(await getDomainProgress("documents")).toBe(10);
  });

  it("resetDeltaLogCursors zeroes the room cursor and every listed domain", async () => {
    mocks.invokeCommand.mockResolvedValue({});
    await resetDeltaLogCursors(["documents", "extracts"]);
    const domainsSeen = mocks.invokeCommand.mock.calls
      .filter((c) => c[0] === "set_sync_checkpoint")
      .map((c) => (c[1] as { domain: string; cursor: string }).domain);
    expect(domainsSeen).toContain(ROOM_CURSOR_DOMAIN);
    expect(domainsSeen).toContain("deltaLog:domain:documents");
    expect(domainsSeen).toContain("deltaLog:domain:extracts");
    const cursors = mocks.invokeCommand.mock.calls
      .filter((c) => c[0] === "set_sync_checkpoint")
      .map((c) => (c[1] as { cursor: string }).cursor);
    expect(cursors.every((c) => c === "0")).toBe(true);
  });
});
