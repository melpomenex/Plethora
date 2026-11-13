import { resolveQueueOrderingMode } from "../utils/queueManualOrder";
import { useSettingsStore } from "./settingsStore";

export function getQueueOrderingMode() {
  return resolveQueueOrderingMode(useSettingsStore.getState?.()?.settings?.smartQueue?.queueOrderingMode);
}
