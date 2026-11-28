/**
 * Frontend IPC API client for podcast ad removal, chapters, and detection settings.
 */

import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  PodcastAdInterval,
  PodcastAdSettings,
  PodcastChapter,
} from "../types/podcastAd";
import type { AudioPolicyInterval } from "../types/audioEdition";

/**
 * Filter persisted podcast ad intervals according to the user's PodcastAdSettings.
 * Manual user-marked intervals are always honored unless ad removal is globally disabled.
 */
export function filterAdIntervalsBySettings(
  intervals: readonly PodcastAdInterval[],
  settings: PodcastAdSettings | null | undefined
): AudioPolicyInterval[] {
  if (settings && !settings.autoDetectAds) {
    return [];
  }
  const minConfidence = settings?.minConfidence ?? 0.85;
  const minDurationMs = (settings?.minAdDurationSeconds ?? 10) * 1000;
  const skipExternal = settings?.skipExternalAds ?? true;
  const skipCrossPromo = settings?.skipCrossPromo ?? true;
  const skipSelfPromo = settings?.skipSelfPromo ?? false;

  return intervals
    .filter((ad) => {
      if (!Number.isFinite(ad.startMs) || !Number.isFinite(ad.endMs) || ad.endMs <= ad.startMs) {
        return false;
      }
      if (ad.origin === "manual_user") {
        return true;
      }
      if (ad.endMs - ad.startMs < minDurationMs) {
        return false;
      }
      if (ad.confidence < minConfidence) {
        return false;
      }
      if (ad.category === "podcast_cross_promo") return skipCrossPromo;
      if (ad.category === "host_self_promo") return skipSelfPromo;
      return skipExternal;
    })
    .map((ad) => ({
      id: ad.id,
      category: ad.category,
      startSec: ad.startMs / 1000,
      endSec: ad.endMs / 1000,
    }));
}

export async function getEpisodeChapters(
  episodeId: string
): Promise<PodcastChapter[]> {
  if (isTauri()) {
    return invokeCommand<PodcastChapter[]>("get_episode_chapters", {
      episodeId,
    });
  }
  return [];
}

export async function getEpisodeAdIntervals(
  episodeId: string
): Promise<PodcastAdInterval[]> {
  if (isTauri()) {
    return invokeCommand<PodcastAdInterval[]>("get_episode_ad_intervals", {
      episodeId,
    });
  }
  return [];
}

export async function detectEpisodeAds(episodeId: string): Promise<string> {
  if (isTauri()) {
    return invokeCommand<string>("detect_episode_ads", { episodeId });
  }
  return "web-mock-job";
}

export async function cancelAdDetection(episodeId: string): Promise<void> {
  if (isTauri()) {
    return invokeCommand<void>("cancel_ad_detection", { episodeId });
  }
}

export async function saveManualAdInterval(
  episodeId: string,
  interval: PodcastAdInterval
): Promise<void> {
  if (isTauri()) {
    return invokeCommand<void>("save_manual_ad_interval", {
      episodeId,
      interval,
    });
  }
}

export async function deleteAdInterval(intervalId: string): Promise<void> {
  if (isTauri()) {
    return invokeCommand<void>("delete_ad_interval", { intervalId });
  }
}

export async function getPodcastAdSettings(): Promise<PodcastAdSettings> {
  if (isTauri()) {
    return invokeCommand<PodcastAdSettings>("get_podcast_ad_settings");
  }
  return {
    id: "default",
    autoDetectAds: true,
    skipExternalAds: true,
    skipCrossPromo: true,
    skipSelfPromo: false,
    minConfidence: 0.85,
    minAdDurationSeconds: 10,
    mobileChargingOnly: true,
    processingMode: "smart",
    showSkipNotifications: true,
    boundarySnapWindowSeconds: 2.5,
    autoTranscribeOnDownload: false,
  };
}

export async function updatePodcastAdSettings(
  settings: PodcastAdSettings
): Promise<void> {
  if (isTauri()) {
    return invokeCommand<void>("update_podcast_ad_settings", { settings });
  }
}
