import { describe, expect, it, vi } from "vitest";

const emitFeedback = vi.hoisted(() => vi.fn().mockResolvedValue({ channels: ["toast"] }));
vi.mock("../../../lib/feedback", () => ({ emitFeedback }));

import type { QueueItem } from "../../../types/queue";
import {
  emitQueueActionFeedback,
  getQueueItemSheetActions,
  getQueuePrimaryAction,
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
  it("routes action feedback through the orchestrator while preserving Undo", () => {
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
        toast: { action: { label: "Undo", onClick: onUndo } },
      }),
    );
  });

  it("maps learning items to study-now with reversible secondary actions", () => {
    expect(getQueuePrimaryAction("learning-item")).toBe("study-now");
    expect(getQueueSecondaryActions("learning-item")).toContain("postpone");
  });

  it("maps documents to open-document with dismissal in secondary actions", () => {
    expect(getQueuePrimaryAction("document")).toBe("open-document");
    expect(getQueueSecondaryActions("document")).toContain("dismiss");
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
      "postpone",
      "suspend",
      "select",
    ]);
    expect(getQueueItemSheetActions(item("rss-article"))).toEqual([
      "open-document",
      "select",
    ]);
  });
});
