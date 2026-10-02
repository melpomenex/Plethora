import { useSettingsStore } from "../../stores/settingsStore";
import {
  AFK_IDLE_TIMEOUT_MIN_MS,
  AFK_IDLE_TIMEOUT_MAX_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
} from "../../hooks/useActiveTimeTracker";

/**
 * The user's idle timeout, clamped to the range the settings schema allows.
 *
 * Re-clamped here rather than trusted from the store because this value decides
 * whether time counts as dwell, and a hand-edited or stale settings blob must
 * not be able to produce a timeout outside the documented range.
 */
export function useDaqeIdleTimeout(): number {
  const stored = useSettingsStore((state) => state.settings.daqe?.knobs.afkIdleTimeoutMs);
  if (typeof stored !== "number" || !Number.isFinite(stored)) return DEFAULT_IDLE_TIMEOUT_MS;
  return Math.min(AFK_IDLE_TIMEOUT_MAX_MS, Math.max(AFK_IDLE_TIMEOUT_MIN_MS, stored));
}
