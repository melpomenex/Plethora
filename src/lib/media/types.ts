/**
 * Shared local-media compatibility types.
 *
 * Keep this module type-only (no React/Tauri imports) so pure classifiers and
 * tests can use it in plain Node.
 */

export type MediaFailureCode =
  | "source_not_found"
  | "source_permission_denied"
  | "source_transport_failed"
  | "source_server_unavailable"
  | "source_range_invalid"
  | "source_empty"
  | "container_unsupported"
  | "video_decoder_unavailable"
  | "audio_decoder_unavailable"
  | "bitmap_subtitle_unsupported"
  | "decoder_initialization_failed"
  | "media_corrupt"
  | "unsupported_protected_media"
  | "media_inspection_unavailable"
  | "media_compatibility_indeterminate"
  | "conversion_dependency_missing"
  | "conversion_encoder_missing"
  | "conversion_filter_missing"
  | "conversion_platform_unsupported"
  | "conversion_failed"
  | "conversion_verification_failed"
  | "conversion_cancelled"
  | "conversion_requires_consent"
  | "conversion_in_progress"
  | "conversion_queue_full"
  | "insufficient_storage"
  | "dolby_vision_unsupported"
  | "playback_interrupted"
  | "unknown";

export type MediaFailureAction =
  | "retry"
  | "convert"
  | "try_original"
  | "cancel"
  | "reimport"
  | "manage_cache"
  | "install_help"
  | "recheck"
  | "resume"
  | "show_details";

export type MediaUrlKind =
  | "loopback_media_server"
  | "remote"
  | "blob"
  | "unsupported";

export interface MediaTransportProbe {
  urlKind: MediaUrlKind;
  reachable: boolean;
  status?: number | null;
  contentType?: string | null;
  contentLength?: number | null;
  acceptRanges?: string | null;
  contentRange?: string | null;
  elapsedMs: number;
  error?: string | null;
}

export interface MediaCompatInvokeError {
  type: "media_compat";
  code: MediaFailureCode;
  message: string;
  detail?: string | null;
  retryable?: boolean;
}

export interface MediaPlaybackFailure {
  code: MediaFailureCode;
  messageKey: string;
  detail?: string;
  retryable: boolean;
  actions: MediaFailureAction[];
  evidence: Record<string, unknown>;
}

export function isMediaFailureCode(value: unknown): value is MediaFailureCode {
  return (
    typeof value === "string" &&
    [
      "source_not_found",
      "source_permission_denied",
      "source_transport_failed",
      "source_server_unavailable",
      "source_range_invalid",
      "source_empty",
      "container_unsupported",
      "video_decoder_unavailable",
      "audio_decoder_unavailable",
      "bitmap_subtitle_unsupported",
      "decoder_initialization_failed",
      "media_corrupt",
      "unsupported_protected_media",
      "media_inspection_unavailable",
      "media_compatibility_indeterminate",
      "conversion_dependency_missing",
      "conversion_encoder_missing",
      "conversion_filter_missing",
      "conversion_platform_unsupported",
      "conversion_failed",
      "conversion_verification_failed",
      "conversion_cancelled",
      "conversion_requires_consent",
      "conversion_in_progress",
      "conversion_queue_full",
      "insufficient_storage",
      "dolby_vision_unsupported",
      "playback_interrupted",
      "unknown",
    ].includes(value)
  );
}

export type ProbeStatus = "ok" | "unavailable" | "failed";
export type SubtitleKind = "text" | "bitmap" | "unknown";
export type HdrKind = "sdr" | "hdr10" | "hlg" | "dolby_vision" | "unknown";
export type CapabilityLevel = "supported" | "unsupported" | "unknown";

export interface DolbyVisionInfo {
  profile: number;
  level: number;
  rpuPresent: boolean;
  elPresent: boolean;
  blPresent: boolean;
  compatibilityId?: number | null;
  hdr10Compatible: boolean;
}

export interface HdrInfo {
  kind: HdrKind;
  bt2020: boolean;
  dolbyVision?: DolbyVisionInfo | null;
  hdr10Plus: boolean;
}

export interface VideoStreamInfo {
  index: number;
  codec: string;
  codecLongName?: string | null;
  profile?: string | null;
  level?: number | null;
  width?: number | null;
  height?: number | null;
  codedWidth?: number | null;
  codedHeight?: number | null;
  pixelFormat?: string | null;
  bitDepth?: number | null;
  frameRate?: number | null;
  avgFrameRate?: number | null;
  codecTag?: string | null;
  isAttachedPic: boolean;
  isDefault: boolean;
  language?: string | null;
  title?: string | null;
  colorSpace?: string | null;
  colorTransfer?: string | null;
  colorPrimaries?: string | null;
  colorRange?: string | null;
  hdr: HdrInfo;
  startTimeSeconds?: number | null;
  durationSeconds?: number | null;
  bitRate?: number | null;
}

export interface AudioStreamInfo {
  index: number;
  codec: string;
  profile?: string | null;
  channels?: number | null;
  channelLayout?: string | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  bitRate?: number | null;
  language?: string | null;
  title?: string | null;
  isDefault: boolean;
  isCommentary: boolean;
}

export interface SubtitleStreamInfo {
  index: number;
  codec: string;
  kind: SubtitleKind;
  language?: string | null;
  title?: string | null;
  isDefault: boolean;
  isForced: boolean;
}

export interface ChapterInfo {
  startSeconds: number;
  endSeconds?: number | null;
  title?: string | null;
}

export interface MediaToolReport {
  ffprobeAvailable: boolean;
  ffmpegAvailable: boolean;
  ffprobeVersion?: string | null;
  ffmpegVersion?: string | null;
}

export interface MediaSourceInfo {
  pathLabel: string;
  pathHash: string;
  sizeBytes?: number | null;
  modifiedUnixMs?: number | null;
  fingerprint: string;
}

export interface MediaInspection {
  schemaVersion: number;
  documentId?: string | null;
  source: MediaSourceInfo;
  probeStatus: ProbeStatus;
  probeError?: string | null;
  container?: string | null;
  containerRaw?: string | null;
  durationSeconds?: number | null;
  startTimeSeconds?: number | null;
  bitRate?: number | null;
  sizeBytes?: number | null;
  videoStreams: VideoStreamInfo[];
  audioStreams: AudioStreamInfo[];
  subtitleStreams: SubtitleStreamInfo[];
  chapters: ChapterInfo[];
  isProtected: boolean;
  warnings: string[];
  tool: MediaToolReport;
}

export interface MediaRuntimeCapabilities {
  schemaVersion: number;
  platform: "linux" | "macos" | "windows" | "android" | "ios" | "web" | "unknown";
  engine: "webkitgtk" | "wkwebview" | "webview2" | "android_webview" | "browser" | "unknown";
  engineVersion?: string | null;
  evidence: string[];
  runtimeFingerprint: string;
  checkedAt: string;
  decoders: Record<string, CapabilityLevel>;
  demuxers: Record<string, CapabilityLevel>;
  subtitleSupport: Record<string, CapabilityLevel>;
  encoders: Record<string, { level: CapabilityLevel; factory?: string | null; hardware: boolean; canary?: boolean | null }>;
  ffmpeg: {
    available: boolean;
    ffprobeAvailable: boolean;
    version?: string | null;
    hasLibx264: boolean;
    hasAac: boolean;
    hasZscale: boolean;
    hasTonemap: boolean;
    hardwareEncoders: string[];
  };
  gstreamer?: {
    inspectAvailable: boolean;
    pluginDirs: string[];
    registry?: string | null;
    pluginSetId?: string | null;
    foundElements: string[];
  } | null;
  warnings: string[];
}

export interface DeclaredCodecSupport {
  h264: CapabilityLevel;
  hevc: CapabilityLevel;
  av1: CapabilityLevel;
  vp9: CapabilityLevel;
  aac: CapabilityLevel;
  ac3: CapabilityLevel;
  eac3: CapabilityLevel;
  dts: CapabilityLevel;
  truehd: CapabilityLevel;
  opus: CapabilityLevel;
  flac: CapabilityLevel;
  mp3: CapabilityLevel;
  vorbis: CapabilityLevel;
  bitmapSubtitles: CapabilityLevel;
  textSubtitles: CapabilityLevel;
  containers: Record<string, CapabilityLevel>;
  evidence: string[];
}

export type PlaybackStrategy = "native" | "remux" | "audio_transcode" | "video_transcode" | "unavailable";
export type PlanConfidence = "certain" | "probable" | "indeterminate";

export interface CachedArtifact {
  cacheKey: string;
  outputContainer: string;
  durationSeconds?: number | null;
  sizeBytes: number;
  timelineOffsetSeconds: number;
}

export interface MediaPlaybackPlan {
  schemaVersion: number;
  planId: string;
  documentId: string;
  sourceFingerprint: string;
  inspectionHash: string;
  strategy: PlaybackStrategy;
  confidence: PlanConfidence;
  reasons: string[];
  selectedVideoIndex?: number | null;
  selectedAudioIndex?: number | null;
  subtitlePolicy: "keep" | "strip_all";
  requiresConsent: boolean;
  consentReasons: string[];
  limitations: string[];
  cachedArtifact?: CachedArtifact | null;
  canConvert: boolean;
  unavailableReason?: string | null;
  estimated?: {
    sourceBytes?: number | null;
    durationSeconds?: number | null;
    outputBytesFloor?: number | null;
    freeSpaceRequiredBytes?: number | null;
    cacheFits?: boolean | null;
  } | null;
}

export interface MediaCacheArtifactSummary {
  cacheKey: string;
  documentId: string;
  sizeBytes: number;
  outputContainer: string;
  lastAccessedAt: string;
}

export interface MediaCacheUsage {
  artifactCount: number;
  totalBytes: number;
  cacheRootLabel: string;
  artifacts: MediaCacheArtifactSummary[];
}

export interface MediaProcessingPolicy {
  mode: "automatic-inexpensive" | "ask" | "never";
  quality: "balanced" | "quality";
  hardwareAcceleration: "auto" | "off";
  cacheLimitGb: number;
}

export interface PlaybackRecoveryContext {
  trigger: "native_failed";
  failureCode?: MediaFailureCode | null;
  mediaErrorCode?: number | null;
}

export interface MediaPlaybackPlanInput {
  documentId: string;
  filePath: string;
  inspectionFingerprint: string;
  clientSupport: DeclaredCodecSupport;
  policy: MediaProcessingPolicy;
  recovery?: PlaybackRecoveryContext | null;
}

export interface StartMediaCompatibilityJobInput extends MediaPlaybackPlanInput {
  consentGranted: boolean;
}

export type MediaCompatibilityJobState =
  | "queued"
  | "running"
  | "finalizing"
  | "ready"
  | "failed"
  | "cancelled";

export type MediaCompatibilityJobPhase =
  | "queued"
  | "probing"
  | "preparing"
  | "encoding"
  | "verifying"
  | "publishing"
  | "done"
  | "failed";

export interface MediaCompatibilityJobProgress {
  percent?: number | null;
  processedSeconds?: number | null;
  durationSeconds?: number | null;
  speed?: number | null;
  outputBytes?: number | null;
}

export interface MediaCompatibilityJobOutput {
  cacheKey: string;
  outputContainer: string;
  durationSeconds?: number | null;
  sizeBytes: number;
  timelineOffsetSeconds: number;
}

export interface MediaCompatibilityJobEvent {
  schemaVersion: number;
  jobId: string;
  documentId: string;
  cacheKey: string;
  sequence: number;
  state: MediaCompatibilityJobState;
  phase: MediaCompatibilityJobPhase;
  progress: MediaCompatibilityJobProgress;
  output?: MediaCompatibilityJobOutput | null;
  error?: {
    type: "media_compat";
    code: MediaFailureCode;
    message: string;
    detail?: string | null;
    retryable?: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
}
