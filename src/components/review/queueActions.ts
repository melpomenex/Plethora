import type { QueueItem } from "../../types/queue";
import { createFeedbackInteractionId, emitUserInteraction, emitFeedback, type FeedbackEmitOptions } from "../../lib/feedback";
import type { FeedbackEventPayloads } from "../../lib/feedback/events";

export type QueueItemActionKind = "study-now" | "open-document" | "open-extract" | "listen-edition";
export type QueueItemSheetAction =
  | "study-now"
  | "open-document"
  | "open-extract"
  | "listen-edition"
  | "edit-card"
  | "postpone"
  | "suspend"
  | "dismiss"
  | "select";

export function getQueuePrimaryAction(
  itemType: string,
  hasAudioEdition?: boolean
): QueueItemActionKind {
  if (hasAudioEdition) return "listen-edition";
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
    case "listen-edition":
      return "queue.listenEdition";
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
    return ["study-now", "edit-card", "postpone", "suspend", "select"];
  }

  if (item.itemType === "document") {
    if (item.hasAudioEdition) {
      return ["listen-edition", "open-document", "postpone", "dismiss", "select"];
    }
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
  interactionId?: string;
};

/** Route queue-action presentation through the policy layer without changing its copy or Undo callback. */
export function emitQueueActionFeedback({
  onUndo,
  undoLabel,
  dedupeKey,
  interactionId = createFeedbackInteractionId(),
  ...payload
}: QueueActionFeedback): void {
  const options: FeedbackEmitOptions = {
    dedupeKey: dedupeKey ?? interactionId,
    interactionId,
    origin: "user",
    toast: onUndo
      ? { action: { label: undoLabel ?? "Undo", onClick: () => {
        void Promise.resolve().then(onUndo).then(
          () => { emitUserInteraction("action.committed"); },
          () => { emitUserInteraction("action.failed"); },
        );
      } } }
      : undefined,
  };
  void emitFeedback("review.card-action", { ...payload, onUndo }, options);
}
