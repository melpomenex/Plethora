import type { AudioSourceKey, ResolvedAudioItem } from "../../types/audioEdition";

export type AudioDeletedSourcePredicate = (
  key: AudioSourceKey,
  item: ResolvedAudioItem | null,
) => boolean;

type AudioDeletionHandler = (
  predicate: AudioDeletedSourcePredicate,
) => Promise<"active_retired" | "queue_pruned" | "unchanged">;

let activeHandler: AudioDeletionHandler | null = null;

export function registerAudioDeletionHook(handler: AudioDeletionHandler | null): void {
  activeHandler = handler;
}

export async function notifyAudioSourceDeleting(
  predicate: AudioDeletedSourcePredicate,
): Promise<"active_retired" | "queue_pruned" | "unchanged"> {
  if (!activeHandler) return "unchanged";
  return activeHandler(predicate);
}
