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
  | "SeekBackward"
  | "SeekTo";

/** Which adapter produced a command envelope. */
export type RemoteMediaCommandSource = "android" | "desktop" | "ios" | "web";

/**
 * Source-neutral long-form playback kinds. These are deliberately narrower
 * than the UI taxonomy: they describe what a native media surface is
 * controlling, not where the document was opened.
 */
export type LongFormPlaybackSourceKind =
  | "podcast"
  | "audiobook"
  | "audio_edition"
  | "browser_document"
  | "reader_tts"
  | "generated_audio"
  | "web_speech"
  | "native_android_tts";

export type LongFormPlaybackState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "stopped";

/** Capabilities are truthful, especially for sentence-based speech engines. */
export interface LongFormPlaybackCapabilities {
  canPlay: boolean;
  canPause: boolean;
  canResume: boolean;
  canSeekRelative: boolean;
  canSeekAbsolute: boolean;
  /** True only when position is continuous/sample-accurate. */
  precisePosition: boolean;
  canNext: boolean;
  canPrevious: boolean;
}

export interface LongFormPlaybackSection {
  id?: string;
  title?: string;
  index?: number;
  /** Reader/audio anchor or sentence/chunk identity. */
  anchor?: string;
}

export interface LongFormPlaybackMetadata {
  sourceId: string;
  sourceKind: LongFormPlaybackSourceKind;
  sessionId: string;
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  section?: LongFormPlaybackSection;
}

/** State sent to browser, desktop, and Android native media surfaces. */
export interface LongFormPlaybackStateSnapshot {
  metadata: LongFormPlaybackMetadata;
  state: LongFormPlaybackState;
  positionSec: number;
  durationSec: number | null;
  playbackRate: number;
  capabilities: LongFormPlaybackCapabilities;
  section?: LongFormPlaybackSection;
  /** Monotonic wall-clock freshness for source-switch reconciliation. */
  updatedAt: number;
}

/** Runtime adapter owned by the active playback host. */
export interface LongFormPlaybackSession {
  sessionId: string;
  sourceId: string;
  sourceKind: LongFormPlaybackSourceKind;
  getSnapshot: () => LongFormPlaybackStateSnapshot;
  play: () => void | Promise<void>;
  pause: () => void | Promise<void>;
  toggle: () => void | Promise<void>;
  next?: () => void | Promise<void>;
  previous?: () => void | Promise<void>;
  seekRelative?: (deltaSec: number) => void | Promise<void>;
  seekTo?: (positionSec: number) => void | Promise<void>;
}

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
  /** Active source/session identity at the time of the physical event. */
  sourceId?: string;
  sessionId?: string;
  /** Optional playback position at press time, used when reconciling queued commands. */
  positionHintSec?: number;
  /** Absolute position for `SeekTo`; relative seeks use the canonical increments. */
  positionSec?: number;
}

export type NativeMediaCommandDisposition =
  | "accepted"
  | "duplicate"
  | "stale"
  | "retryable_failure";

export type NativeMediaCommandFailureReason =
  | "unknown_command"
  | "no_active_session"
  | "source_mismatch"
  | "expired"
  | "unsupported_capability"
  | "dispatch_error";

/** One acknowledgement shape shared by Android and future native adapters. */
export interface NativeMediaCommandAck {
  eventId: string;
  sessionId?: string;
  disposition: NativeMediaCommandDisposition;
  reason?: NativeMediaCommandFailureReason;
  acknowledgedAt: number;
}

/** Native/frontend state exchange after resume, source switches, and seeks. */
export interface NativeMediaReconciliationEnvelope {
  source: RemoteMediaCommandSource;
  observedAt: number;
  snapshot: LongFormPlaybackStateSnapshot;
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
