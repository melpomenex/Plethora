import type { QueueItem } from "../../types/queue";
import { emitFeedback, type FeedbackEmitOptions } from "../../lib/feedback";
import type { FeedbackEventPayloads } from "../../lib/feedback/events";

export type QueueItemActionKind = "study-now" | "open-document";
export type QueueItemSheetAction =
  | "study-now"
  | "open-document"
  | "postpone"
  | "suspend"
  | "dismiss"
  | "select";

export function getQueuePrimaryAction(itemType: string): QueueItemActionKind {
  return itemType === "learning-item" ? "study-now" : "open-document";
}

export function getQueueSecondaryActions(itemType: string): string[] {
  return itemType === "learning-item"
    ? ["suspend", "postpone", "compress", "reschedule", "delete"]
    : ["dismiss", "delete"];
}

export function getQueueItemSheetActions(item: QueueItem): QueueItemSheetAction[] {
  if (item.itemType === "learning-item") {
    return ["study-now", "postpone", "suspend", "select"];
  }

  if (item.itemType === "document") {
    return ["open-document", "postpone", "dismiss", "select"];
  }

  return ["open-document", "select"];
}

export type QueueActionFeedback = Omit<FeedbackEventPayloads["review.card-action"], "onUndo"> & {
  onUndo?: () => void | Promise<void>;
  undoLabel?: string;
  dedupeKey?: string;
};

/** Route queue-action presentation through the policy layer without changing its copy or Undo callback. */
export function emitQueueActionFeedback({
  onUndo,
  undoLabel,
  dedupeKey,
  ...payload
}: QueueActionFeedback): void {
  const options: FeedbackEmitOptions = {
    dedupeKey: dedupeKey ?? `${payload.action}:${payload.title}:${payload.message ?? ""}`,
    toast: onUndo
      ? { action: { label: undoLabel ?? "Undo", onClick: onUndo } }
      : undefined,
  };
  void emitFeedback("review.card-action", { ...payload, onUndo }, options);
}
