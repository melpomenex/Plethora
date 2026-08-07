import type { QueueItem } from "../../types/queue";
import { emitFeedback, type FeedbackEmitOptions } from "../../lib/feedback";
import type { FeedbackEventPayloads } from "../../lib/feedback/events";

export type QueueItemActionKind = "study-now" | "open-document" | "open-extract";
export type QueueItemSheetAction =
  | "study-now"
  | "open-document"
  | "open-extract"
  | "postpone"
  | "suspend"
  | "dismiss"
  | "select";

export function getQueuePrimaryAction(itemType: string): QueueItemActionKind {
  if (itemType === "learning-item") return "study-now";
  if (itemType === "extract") return "open-extract";
  return "open-document";
}

/**
 * i18n key for a primary action's button label. Kept here (rather than in each
 * view) so desktop, mobile and the action sheet stay consistent from one place.
 */
export function getQueuePrimaryActionLabelKey(action: QueueItemActionKind): string {
  switch (action) {
    case "study-now":
      return "queue.studyNow";
    case "open-extract":
      return "queue.openExtract";
    default:
      return "queue.openDocument";
  }
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

  if (item.itemType === "extract") {
    // Primary action opens the extract reader; the reader itself offers
    // "Open source document", so the sheet doesn't duplicate that path.
    return ["open-extract", "select"];
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
