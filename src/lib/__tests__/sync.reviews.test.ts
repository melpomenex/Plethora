import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  config: null as any,
}));

vi.mock("../sync/replicatedMap", () => ({
  createReplicatedMap: (config: any) => {
    if (config.name === "reviews") mocks.config = config;
    return {
      ensureReady: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      getMap: () => null,
      gc: () => 0,
      teardown: () => undefined,
      publishDebounced: vi.fn().mockResolvedValue(undefined),
    };
  },
}));

vi.mock("../tauri", () => ({
  isTauri: () => true,
  invokeCommand: mocks.invokeCommand,
}));

vi.mock("../sync/syncClock", () => ({
  nowHLC: () => "1700000000000.000001",
}));

vi.mock("../deviceIdentity", () => ({
  getDeviceId: vi.fn().mockResolvedValue("device-a"),
}));

function reviewRow() {
  return {
    id: "review-1",
    collection_id: "collection-1",
    session_id: "source-device-session",
    item_id: "card-1",
    rating: 3,
    time_taken: 8,
    new_due_date: "2026-08-04T00:00:00.000Z",
    new_interval: 12,
    new_ease_factor: 2.5,
    timestamp: "2026-08-03T10:00:00.000Z",
    reviewed_at_ms: 1_700_000_000_000,
    device_id: "device-a",
    updatedAt: "1700000000000.000001",
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.config = null;
  const entity = await import("../sync/entities/flashcards");
  await entity.ensureFlashcardSyncReady();
});

describe("sync review parent dependencies", () => {
  it("defers without invoking the FK-constrained upsert when the card is absent", async () => {
    mocks.invokeCommand.mockResolvedValueOnce(null);

    await expect(mocks.config.apply("review-1", reviewRow())).rejects.toThrow(
      "review parent learning item is not available yet",
    );
    expect(mocks.invokeCommand).toHaveBeenCalledWith("get_synced_learning_item", { id: "card-1" });
    expect(mocks.invokeCommand).not.toHaveBeenCalledWith(
      "upsert_synced_review_result",
      expect.anything(),
    );
  });

  it("drops the source-local session id before inserting after the card arrives", async () => {
    mocks.invokeCommand.mockResolvedValueOnce({ id: "card-1" }).mockResolvedValueOnce({});

    await mocks.config.apply("review-1", reviewRow());

    expect(mocks.invokeCommand).toHaveBeenNthCalledWith(2, "upsert_synced_review_result", {
      review: expect.objectContaining({
        id: "review-1",
        item_id: "card-1",
        session_id: null,
      }),
    });
  });

  it("projects reviews synchronously instead of acknowledging a delayed batch", () => {
    expect(mocks.config.applyBatch).toBeUndefined();
  });
});
