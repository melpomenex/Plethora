import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  config: null as any,
}));

vi.mock("../sync/replicatedMap", () => ({
  createReplicatedMap: (config: any) => {
    mocks.config = config;
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

function extractRow() {
  return {
    id: "extract-1",
    collection_id: "00000000-0000-0000-0000-000000000001",
    document_id: "document-1",
    content: "A useful passage",
    progressive_disclosure_level: 0,
    max_disclosure_level: 3,
    date_created: "2026-01-01T00:00:00.000Z",
    date_modified: "2026-01-01T00:00:00.000Z",
    tags: [],
    review_count: 0,
    reps: 0,
    priority_score: 0,
    is_dismissed: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.config = null;
  const entity = await import("../sync/entities/extracts");
  await entity.ensureExtractSyncReady();
});

describe("sync extracts parent dependency", () => {
  it("defers without invoking the FK-constrained upsert when the parent is absent", async () => {
    mocks.invokeCommand.mockResolvedValueOnce(null);

    await expect(mocks.config.apply("extract-1", extractRow())).rejects.toThrow(
      "extract parent document is not available yet",
    );
    expect(mocks.invokeCommand).toHaveBeenCalledWith("get_document", { id: "document-1" });
    expect(mocks.invokeCommand).not.toHaveBeenCalledWith(
      "upsert_synced_extract",
      expect.anything(),
    );
  });

  it("upserts after the parent document is available", async () => {
    mocks.invokeCommand.mockResolvedValueOnce({ id: "document-1" }).mockResolvedValueOnce({});

    await mocks.config.apply("extract-1", extractRow());

    expect(mocks.invokeCommand).toHaveBeenNthCalledWith(2, "upsert_synced_extract", {
      extract: expect.objectContaining({ id: "extract-1", document_id: "document-1" }),
    });
  });
});
