import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningItem } from "../../types/document";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("../../lib/tauri", () => ({
  invokeCommand: invoke,
}));

import { DeleteLearningItemCommand } from "../undoableCommands";

describe("DeleteLearningItemCommand", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("uses the registered learning-item delete command and argument name", async () => {
    invoke.mockResolvedValueOnce({
      id: "card-1",
      question: "Question",
      answer: "Answer",
    } as LearningItem);
    invoke.mockResolvedValueOnce(undefined);

    await new DeleteLearningItemCommand("card-1").execute();

    expect(invoke).toHaveBeenNthCalledWith(1, "get_learning_item", { itemId: "card-1" });
    expect(invoke).toHaveBeenNthCalledWith(2, "delete_learning_item", { itemId: "card-1" });
  });

  it("restores the complete saved item when the deletion is undone", async () => {
    const item = {
      id: "card-1",
      question: "Question",
      answer: "Answer",
    } as LearningItem;
    invoke.mockResolvedValueOnce(item);
    invoke.mockResolvedValueOnce(undefined);
    invoke.mockResolvedValueOnce(item);
    const command = new DeleteLearningItemCommand("card-1");

    await command.execute();
    await command.undo();

    expect(invoke).toHaveBeenCalledWith("restore_learning_item", { item });
  });
});
