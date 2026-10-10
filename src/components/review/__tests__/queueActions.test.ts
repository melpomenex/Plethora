import { describe, expect, it, vi } from "vitest";

const emitFeedback = vi.hoisted(() => vi.fn().mockResolvedValue({ channels: ["toast"] }));
const emitUserInteraction = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/feedback", () => ({ emitFeedback, emitUserInteraction, createFeedbackInteractionId: () => "queue:operation" }));

import type { QueueItem } from "../../../types/queue";
import {
  emitQueueActionFeedback,
  getQueueItemSheetActions,
  getQueuePrimaryAction,
  getQueuePrimaryActionLabelKey,
  getQueueSecondaryActions,
} from "../queueActions";

const item = (itemType: QueueItem["itemType"]): QueueItem => ({
  id: `${itemType}-1`,
  documentId: "doc-1",
  documentTitle: "Queue item",
  itemType,
  priority: 5,
  estimatedTime: 2,
  tags: [],
  progress: 0,
});

describe("queue action hierarchy", () => {
  it("routes action feedback through the orchestrator while preserving Undo", async () => {
    const onUndo = vi.fn();

    emitQueueActionFeedback({
      action: "suspend",
      succeeded: true,
      title: "Suspended",
      message: "Schedule updated",
      onUndo,
      undoLabel: "Undo",
    });

    expect(emitFeedback).toHaveBeenCalledWith(
      "review.card-action",
      expect.objectContaining({ action: "suspend", succeeded: true, onUndo }),
      expect.objectContaining({
        toast: { action: { label: "Undo", onClick: expect.any(Function) } },
        origin: "user",
        interactionId: "queue:operation",
      }),
    );
    const options = emitFeedback.mock.calls.at(-1)?.[2];
    options.toast.action.onClick();
    await vi.waitFor(() => expect(onUndo).toHaveBeenCalledOnce());
    expect(emitUserInteraction).toHaveBeenCalledWith("action.committed");
  });

  it("contains thrown/rejected undo failures without claiming success", async () => {
    emitUserInteraction.mockClear();
    emitQueueActionFeedback({ action: "suspend", succeeded: true, title: "Suspended", onUndo: () => { throw new Error("failed"); } });
    emitFeedback.mock.calls.at(-1)?.[2].toast.action.onClick();
    await vi.waitFor(() => expect(emitUserInteraction).toHaveBeenCalledWith("action.failed"));
    expect(emitUserInteraction).not.toHaveBeenCalledWith("action.committed");
  });

  it("maps learning items to study-now with reversible secondary actions", () => {
    expect(getQueuePrimaryAction("learning-item")).toBe("study-now");
    expect(getQueueSecondaryActions("learning-item")).toContain("postpone");
  });

  it("maps documents to open-document with dismissal in secondary actions", () => {
    expect(getQueuePrimaryAction("document")).toBe("open-document");
    expect(getQueueSecondaryActions("document")).toContain("dismiss");
  });

  it("maps extracts to open-extract as the primary action", () => {
    expect(getQueuePrimaryAction("extract")).toBe("open-extract");
    expect(getQueuePrimaryActionLabelKey("open-extract")).toBe("queue.openExtract");
    expect(getQueuePrimaryActionLabelKey("study-now")).toBe("queue.studyNow");
    expect(getQueuePrimaryActionLabelKey("open-document")).toBe("queue.openDocument");
  });

  it("exposes contextual actions only for supported item types", () => {
    expect(getQueueItemSheetActions(item("document"))).toEqual([
      "open-document",
      "postpone",
      "dismiss",
      "select",
    ]);
    expect(getQueueItemSheetActions(item("learning-item"))).toEqual([
      "study-now",
      "edit-card",
      "postpone",
      "suspend",
      "select",
    ]);
    expect(getQueueItemSheetActions(item("rss-article"))).toEqual([
      "open-document",
      "select",
    ]);
    expect(getQueueItemSheetActions(item("extract"))).toEqual([
      "open-extract",
      "select",
    ]);
  });
});
