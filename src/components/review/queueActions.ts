export type QueueItemActionKind = "study-now" | "open-document";

export function getQueuePrimaryAction(itemType: string): QueueItemActionKind {
  return itemType === "learning-item" ? "study-now" : "open-document";
}

export function getQueueSecondaryActions(itemType: string): string[] {
  return itemType === "learning-item"
    ? ["suspend", "postpone", "compress", "reschedule", "delete"]
    : ["dismiss", "delete"];
}
