import type { QueueOrderingMode } from "../types/queue";
import { resolveQueueOrderingMode } from "../utils/queueManualOrder";
import { useSettingsStore } from "./settingsStore";

export function getQueueOrderingMode(): QueueOrderingMode {
  return resolveQueueOrderingMode(useSettingsStore.getState?.()?.settings?.smartQueue?.queueOrderingMode);
}

export function setQueueOrderingMode(mode: QueueOrderingMode): void {
  useSettingsStore.getState().updateSettingsCategory("smartQueue", {
    queueOrderingMode: resolveQueueOrderingMode(mode),
  });
}
