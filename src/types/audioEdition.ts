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

/**
 * Canonical remote media command vocabulary (design Decision 6): every adapter
 * (Android Media3 bridge, desktop Rust bridge, web MediaSession) normalizes
 * into exactly these canonical-cased values.
 */
export type RemoteMediaCommand =
  | "Play"
  | "Pause"
  | "TogglePlayPause"
  | "Next"
  | "Previous"
  | "SeekForward"
  | "SeekBackward";

/** Which adapter produced a command envelope. */
export type RemoteMediaCommandSource = "android" | "desktop" | "web";

/**
 * Normalized command envelope (design Decision 6/12): every dispatched command
 * carries a unique event ID, its origin, and the epoch-ms time it occurred, so
 * duplicate delivery (native + web, Bluetooth double-fire, replayed queue
 * entries) can be suppressed deterministically.
 */
export interface RemoteMediaCommandEnvelope {
  command: RemoteMediaCommand;
  /** UUID unique to one physical button press. */
  eventId: string;
  source: RemoteMediaCommandSource;
  /** Epoch milliseconds when the button was pressed (native clock). */
  occurredAt: number;
  /** Optional playback position at press time, used when reconciling queued commands. */
  positionHintSec?: number;
}

/**
 * Canonical Study Mode action enum (design Decision 7). One union shared by
 * the settings schema, settings UI, dispatcher, and persisted state. Every
 * value has an implementation in `executeStudyAction`.
 */
export type StudyAction =
  | "save_recent_extract"
  | "bookmark"
  | "replay_recent_passage"
  | "mark_interesting"
  | "mark_confusing"
  | "ask_plethora"
  | "skip_forward"
  | "skip_backward"
  | "next_chapter"
  | "previous_chapter"
  | "none";

/** Capture windows offered in Settings; "smart" snaps to semantic units (≤ 90 s). */
export type CaptureWindow = 15 | 30 | 60 | "smart";

/**
 * Typed capture outcome (design Decision 9). A hands-free capture resolves to
 * exactly one of these — placeholder text such as "Audio extract at 123s" is
 * prohibited.
 */
export type CaptureOutcomeKind =
  | "resolved"
  | "needs_confirmation"
  | "pending_audio_bookmark";

/** Alignment confidence tier for paired external audiobooks / transcripts. */
export type CaptureConfidence = "high" | "medium" | "low";

/**
 * Durable audio provenance persisted on the extract's `selection_context`
 * JSON column (no schema migration) and consumed by "Open in source".
 */
export interface AudioCaptureProvenance {
  kind: "audio_capture";
  documentId: string;
  editionId?: string;
  sectionId?: string;
  sourceStartAnchor: string;
  sourceEndAnchor: string;
  audioTimestampSec: number;
  captureWindowSec: number | "smart";
  sessionId?: string;
  confidence: CaptureConfidence;
  provider?: string;
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
