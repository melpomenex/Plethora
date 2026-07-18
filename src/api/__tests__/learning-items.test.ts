import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLearningItem } from "../learning-items";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  publishCard: vi.fn(),
  toSyncedLearningItem: vi.fn((item) => item),
}));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
}));

vi.mock("../../lib/sync/entities/flashcards", () => ({
  publishCard: mocks.publishCard,
  toSyncedLearningItem: mocks.toSyncedLearningItem,
}));

vi.mock("../../lib/sync/syncClock", () => ({
  nowHLC: () => "test-clock",
}));

describe("learning item API", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
    mocks.publishCard.mockReset();
    mocks.toSyncedLearningItem.mockClear();
  });

  it("maps an extract-linked card to the command's camel-case relationship fields", async () => {
    const created = {
      id: "card-1",
      extract_id: "extract-1",
      document_id: "document-1",
      item_type: "Qa",
      question: "Question",
      answer: "Answer",
    };
    mocks.invokeCommand.mockResolvedValue(created);

    await createLearningItem({
      item_type: "qa",
      question: "Question",
      answer: "Answer",
      extract_id: "extract-1",
      document_id: "document-1",
    });

    expect(mocks.invokeCommand).toHaveBeenCalledWith("create_learning_item", expect.objectContaining({
      extractId: "extract-1",
      documentId: "document-1",
    }));
  });
});
