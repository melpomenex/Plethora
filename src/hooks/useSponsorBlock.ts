import { useCallback, useMemo } from "react";
import { useSettingsStore, defaultSettings } from "../stores/settingsStore";
import type { SponsorBlockSegment } from "../api/sponsorblock";

/**
 * The one place the players read SponsorBlock settings.
 *
 * All three players (YouTube, local video, audiobook) used to run the same
 * ungated fetch-then-skip loop. Keeping the interpretation of the settings here
 * is what stops them drifting apart again: the request, the category filter,
 * the seek gate and the notification gate are decided once.
 *
 * `fetch` is gated separately from `autoSkip` on purpose — with `enabled` off no
 * request is made at all, so the user's video ids are not sent anywhere; with
 * `autoSkip` off the segments are still loaded and reported, just not acted on.
 */
export function useSponsorBlock() {
  const settings = useSettingsStore((state) => state.settings.sponsorBlock);
  const sb = settings ?? defaultSettings.sponsorBlock;

  const enabledCategories = useMemo(
    () =>
      (Object.keys(sb.categories) as Array<keyof typeof sb.categories>).filter(
        (key) => sb.categories[key]
      ),
    [sb.categories]
  );

  /** Keep only segments whose category the user enabled. */
  const filterSegments = useCallback(
    (segments: SponsorBlockSegment[]): SponsorBlockSegment[] =>
      segments.filter((segment) => sb.categories[segment.category] !== false),
    [sb.categories]
  );

  return {
    enabled: sb.enabled,
    /** Whether the players may fetch segment data at all. */
    canFetch: sb.enabled,
    /** Whether the players may move the playhead on their own. */
    canSkip: sb.enabled && sb.autoSkip,
    /** Whether a skip should be announced. */
    showNotifications: sb.enabled && sb.notifications,
    privacyMode: sb.privacyMode,
    cacheDurationHours: sb.cacheDuration,
    enabledCategories,
    filterSegments,
  };
}
