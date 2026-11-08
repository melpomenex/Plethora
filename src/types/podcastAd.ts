/**
 * Podcast chapter and advertisement detection types.
 * Matches Rust DTOs in src-tauri/src/models/podcast_ad.rs with camelCase serialization.
 */

export type ChapterSource =
  | "podcast20_json"
  | "podlove_xml"
  | "id3_chap"
  | "description_timestamp"
  | "generated";

export type AdDetectionMethod =
  | "metadata_chapter"
  | "classifier_llm"
  | "manual_user";

export type PodcastAdDetectionStatus =
  | "none"
  | "queued"
  | "inspecting_metadata"
  | "transcribing"
  | "classifying"
  | "refining_boundaries"
  | "ready"
  | "failed"
  | "cancelled"
  | "deferred";

export interface PodcastChapter {
  id: string;
  episodeId: string;
  chapterIndex: number;
  title: string;
  startMs: number;
  endMs: number;
  imageUrl?: string | null;
  linkUrl?: string | null;
  source: ChapterSource | string;
  isAdvertisement: boolean;
}

export interface PodcastAdInterval {
  id: string;
  episodeId: string;
  mediaRevision: string;
  startMs: number;
  endMs: number;
  category: "external_ad" | "podcast_cross_promo" | "host_self_promo" | "bumper" | "uncertain" | string;
  confidence: number;
  origin: AdDetectionMethod | string;
  metadataJson?: string | null;
}

export interface PodcastAdSettings {
  id: string;
  autoDetectAds: boolean;
  skipExternalAds: boolean;
  skipCrossPromo: boolean;
  skipSelfPromo: boolean;
  minConfidence: number;
  minAdDurationSeconds: number;
  mobileChargingOnly: boolean;
  processingMode: "battery_saver" | "smart" | "always" | "manual" | string;
}

export interface PodcastAdCorrection {
  id: string;
  episodeId: string;
  correctionType: "restore_content" | "mark_ad" | "adjust_boundary";
  startMs: number;
  endMs: number;
  userNote?: string | null;
  createdAt?: string | null;
}

export interface PodcastProcessingJob {
  id: string;
  episodeId: string;
  status: PodcastAdDetectionStatus | string;
  stageProgress: number;
  overallProgress: number;
  errorMessage?: string | null;
  deferralReason?: string | null;
  updatedAt: string;
}

export interface AdRemovalState {
  episodeId: string;
  status: PodcastAdDetectionStatus;
  intervals: PodcastAdInterval[];
  chapters: PodcastChapter[];
  isAdSkippingActive: boolean;
  skippedIntervalCount: number;
  totalAdDurationMs: number;
}

export interface SkipToastData {
  id: string;
  episodeId: string;
  intervalId: string;
  category: string;
  brand?: string | null;
  startMs: number;
  endMs: number;
  durationMs: number;
  timestamp: number;
}
