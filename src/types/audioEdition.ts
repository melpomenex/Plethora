/**
 * Types for Audio Editions and Hands-Free Study Mode
 */

export type AudioEditionStatus = "draft" | "generating" | "ready" | "failed" | "stale";

export type SectionGenerationStatus = "queued" | "generating" | "ready" | "failed" | "stale";

export type QualityPreset = "fast" | "natural" | "best" | "custom";

export type MarkerType = "extract" | "bookmark" | "interesting" | "confusing";

export interface AudioEditionSettings {
  speed?: number;
  responseFormat?: string;
  instructions?: string;
  pronunciationDictionary?: Record<string, string>;
  pitch?: number;
  temperature?: number;
}

export interface AudioEdition {
  id: string;
  sourceDocumentId: string;
  sourceRevisionHash: string;
  provider: string;
  model: string;
  voice: string;
  qualityPreset?: QualityPreset | null;
  generationSettings?: string | AudioEditionSettings | null;
  totalDurationSec: number;
  status: AudioEditionStatus;
  createdAt: number;
  updatedAt: number;
  sections?: AudioEditionSection[];
}

export interface AudioEditionSection {
  id: string;
  editionId: string;
  sectionIndex: number;
  title: string;
  sourceSectionId?: string | null;
  sourceStartAnchor?: string | null;
  sourceEndAnchor?: string | null;
  characterCount: number;
  audioFilePath?: string | null;
  audioMimeType: string;
  durationSec: number;
  generationStatus: SectionGenerationStatus;
  failureReason?: string | null;
  retryCount: number;
  cacheKey: string;
  createdAt: number;
  updatedAt: number;
  anchors?: AudioEditionAnchor[];
}

export interface AudioEditionAnchor {
  id: string;
  sectionId: string;
  audioStartSec: number;
  audioEndSec: number;
  sourceStartAnchor: string;
  sourceEndAnchor: string;
  textContent: string;
}

export interface ListeningSession {
  id: string;
  editionId: string;
  startedAt: number;
  endedAt?: number | null;
  durationSeconds: number;
  extractCount: number;
  isReviewed: boolean;
  items?: ListeningSessionItem[];
}

export interface ListeningSessionItem {
  id: string;
  sessionId: string;
  extractId?: string | null;
  markerType: MarkerType;
  audioTimestamp: number;
  sourceAnchor: string;
  snippetText: string;
  note?: string | null;
  createdAt: number;
}

export type RemoteMediaCommand =
  | "play"
  | "pause"
  | "togglePlayPause"
  | "next"
  | "previous"
  | "seekForward"
  | "seekBackward"
  | "Play"
  | "Pause"
  | "TogglePlayPause"
  | "Next"
  | "Previous"
  | "SeekForward"
  | "SeekBackward";

export type StudyActionType =
  | "saveRecentExtract"
  | "bookmark"
  | "replayRecentPassage"
  | "markInteresting"
  | "markConfusing"
  | "skipForward"
  | "skipBackward"
  | "default";

export interface StudyModeConfig {
  enabled: boolean;
  lookbackSeconds: number; // default: 30
  extensionWindowMs: number; // default: 2500
  audioChimeEnabled: boolean;
  volumeDuckingPercent: number; // default: 40 (meaning 40% volume)
  mappings: {
    next?: StudyActionType;
    previous?: StudyActionType;
    seekForward?: StudyActionType;
    seekBackward?: StudyActionType;
  };
}

export interface AudioEditionEstimation {
  characterCount: number;
  wordCount: number;
  estimatedDurationSec: number;
  estimatedCostUsd: number;
  isFreeTier: boolean;
  provider: string;
  model: string;
}

export interface PronunciationRule {
  id: string;
  pattern: string; // Text or regex
  replacement: string; // Phonetic or spoken replacement
  isRegex?: boolean;
  caseSensitive?: boolean;
  language?: string;
}
