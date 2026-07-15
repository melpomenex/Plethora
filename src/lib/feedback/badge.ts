import { clearBadge, updateBadgeCount } from "../../utils/notificationService";
import { isPWA } from "../tauri";
import { queryAsyncCapabilities } from "./capabilities";
import { useSettingsStore } from "../../stores/settingsStore";

/** Best-effort installed-PWA badge synchronization. */
export async function updateDueBadgeCount(dueCount: number): Promise<void> {
  if (!isPWA() || !Number.isFinite(dueCount)) return;

  try {
    const capabilities = await queryAsyncCapabilities();
    if (!capabilities.badgeAvailable) return;

    const showBadge = useSettingsStore.getState().settings.notifications.showBadge;
    if (!showBadge || dueCount <= 0) {
      await clearBadge();
      return;
    }

    await updateBadgeCount(Math.max(0, Math.floor(dueCount)));
  } catch {
    // Badging is optional and must never affect queue or review state.
  }
}

