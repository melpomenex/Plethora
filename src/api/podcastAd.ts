/**
 * Frontend IPC API client for podcast ad removal, chapters, and detection settings.
 */

import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  PodcastAdInterval,
  PodcastAdSettings,
  PodcastChapter,
} from "../types/podcastAd";

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
  };
}

export async function updatePodcastAdSettings(
  settings: PodcastAdSettings
): Promise<void> {
  if (isTauri()) {
    return invokeCommand<void>("update_podcast_ad_settings", { settings });
  }
}
