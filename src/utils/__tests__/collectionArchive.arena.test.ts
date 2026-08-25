import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeCommandMock } = vi.hoisted(() => ({ invokeCommandMock: vi.fn() }));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: invokeCommandMock,
  isTauri: vi.fn(() => false),
}));

vi.mock("../ankiExport", () => ({
  buildAnkiApkg: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

import { buildCollectionArchive } from "../collectionArchive";

describe("collection archive Arena provenance", () => {
  beforeEach(() => {
    invokeCommandMock.mockReset();
    localStorage.clear();
  });

  it("exports Arena Pick, model, Custom, and legacy review rows without losing provenance", async () => {
    const reviewResults = [
      { id: "arena", reviewSessionId: "session-1", scheduleSource: "arena", arenaCommitId: "commit-arena" },
      { id: "model", reviewSessionId: "session-1", scheduleSource: "model", scheduleModelId: "m3", arenaCommitId: "commit-model" },
      { id: "custom", reviewSessionId: "session-1", scheduleSource: "custom", arenaCommitId: "commit-custom", arenaRecommendedInterval: 12, arenaDecisionTimeMs: 420, arenaSnapshot: "{\"version\":1}" },
      { id: "legacy", reviewSessionId: "session-1" },
      { id: "other-collection", reviewSessionId: "session-2", scheduleSource: "arena" },
    ];
    invokeCommandMock.mockImplementation(async (command: string) => {
      if (command === "get_documents" || command === "get_extracts" || command === "get_all_learning_items") return [];
      if (command === "get_review_sessions_by_collection") return [{ id: "session-1" }];
      if (command === "get_all_review_results") return reviewResults;
      if (command === "get_categories_by_collection") return [];
      throw new Error(`Unexpected command: ${command}`);
    });

    const { blob } = await buildCollectionArchive({
      scope: "current",
      activeCollectionId: "collection-1",
      collections: [{ id: "collection-1", name: "Biology" } as any],
    });
    const archiveBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const zip = await JSZip.loadAsync(archiveBytes);
    const payload = JSON.parse(await zip.file("data/payload.json")!.async("string"));

    expect(payload.reviewResults).toEqual(reviewResults.slice(0, 4));
    expect(payload.reviewResults.map((result: { scheduleSource?: string }) => result.scheduleSource ?? null))
      .toEqual(["arena", "model", "custom", null]);
  });
});
