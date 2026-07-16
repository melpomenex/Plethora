import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  browserInvoke: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
  isTauri: () => true,
}));

vi.mock("../../lib/browser-backend", () => ({
  browserInvoke: mocks.browserInvoke,
}));

vi.mock("../../lib/sync/syncJournal", () => ({
  enqueueSyncOperation: vi.fn(),
}));

vi.mock("../../lib/sync/syncClock", () => ({
  nowHLC: () => "test-clock",
}));

import { getDocumentsWithProgress } from "../position";

describe("getDocumentsWithProgress timestamp mapping", () => {
  const nowMs = Date.UTC(2026, 6, 16, 12, 0, 0);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(nowMs);
  });

  it("normalizes native Unix-second modification and import timestamps", async () => {
    const modifiedSeconds = Math.floor((nowMs - 5 * 60_000) / 1000);
    const addedSeconds = Math.floor((nowMs - 2 * 86_400_000) / 1000);
    mocks.invokeCommand.mockResolvedValueOnce([
      ["d1", 25, "Imported document", modifiedSeconds, addedSeconds],
    ]);

    await expect(getDocumentsWithProgress(10)).resolves.toEqual([
      {
        id: "d1",
        progress: 25,
        title: "Imported document",
        date_modified: nowMs - 5 * 60_000,
        date_added: nowMs - 2 * 86_400_000,
      },
    ]);
  });

  it("accepts an older four-field response and exposes a null import timestamp", async () => {
    const modifiedSeconds = Math.floor((nowMs - 60_000) / 1000);
    mocks.invokeCommand.mockResolvedValueOnce([
      ["legacy", 10, "Legacy document", modifiedSeconds],
    ]);

    await expect(getDocumentsWithProgress(10)).resolves.toEqual([
      {
        id: "legacy",
        progress: 10,
        title: "Legacy document",
        date_modified: nowMs - 60_000,
        date_added: null,
      },
    ]);
  });
});
