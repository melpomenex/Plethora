use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const MEDIA_COMPAT_SCHEMA_VERSION: u32 = 1;
pub const COMPAT_PIPELINE_VERSION: u32 = 1;

/// Shared, evidence-backed media playback failure taxonomy.
///
/// A code is only emitted when the corresponding evidence exists. The generic
/// `SourceAccess` grouping used by the UI is not a code; it is derived from the
/// `Source*` variants.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum MediaFailureCode {
    SourceNotFound,
    SourcePermissionDenied,
    SourceTransportFailed,
    SourceServerUnavailable,
    SourceRangeInvalid,
    SourceEmpty,
    ContainerUnsupported,
    VideoDecoderUnavailable,
    AudioDecoderUnavailable,
    BitmapSubtitleUnsupported,
    DecoderInitializationFailed,
    MediaCorrupt,
    UnsupportedProtectedMedia,
    MediaInspectionUnavailable,
    MediaCompatibilityIndeterminate,
    ConversionDependencyMissing,
    ConversionEncoderMissing,
    ConversionFilterMissing,
    ConversionPlatformUnsupported,
    ConversionFailed,
    ConversionVerificationFailed,
    ConversionCancelled,
    ConversionRequiresConsent,
    ConversionInProgress,
    ConversionQueueFull,
    InsufficientStorage,
    DolbyVisionUnsupported,
    PlaybackInterrupted,
    Unknown,
}

impl MediaFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SourceNotFound => "source_not_found",
            Self::SourcePermissionDenied => "source_permission_denied",
            Self::SourceTransportFailed => "source_transport_failed",
            Self::SourceServerUnavailable => "source_server_unavailable",
            Self::SourceRangeInvalid => "source_range_invalid",
            Self::SourceEmpty => "source_empty",
            Self::ContainerUnsupported => "container_unsupported",
            Self::VideoDecoderUnavailable => "video_decoder_unavailable",
            Self::AudioDecoderUnavailable => "audio_decoder_unavailable",
            Self::BitmapSubtitleUnsupported => "bitmap_subtitle_unsupported",
            Self::DecoderInitializationFailed => "decoder_initialization_failed",
            Self::MediaCorrupt => "media_corrupt",
            Self::UnsupportedProtectedMedia => "unsupported_protected_media",
            Self::MediaInspectionUnavailable => "media_inspection_unavailable",
            Self::MediaCompatibilityIndeterminate => "media_compatibility_indeterminate",
            Self::ConversionDependencyMissing => "conversion_dependency_missing",
            Self::ConversionEncoderMissing => "conversion_encoder_missing",
            Self::ConversionFilterMissing => "conversion_filter_missing",
            Self::ConversionPlatformUnsupported => "conversion_platform_unsupported",
            Self::ConversionFailed => "conversion_failed",
            Self::ConversionVerificationFailed => "conversion_verification_failed",
            Self::ConversionCancelled => "conversion_cancelled",
            Self::ConversionRequiresConsent => "conversion_requires_consent",
            Self::ConversionInProgress => "conversion_in_progress",
            Self::ConversionQueueFull => "conversion_queue_full",
            Self::InsufficientStorage => "insufficient_storage",
            Self::DolbyVisionUnsupported => "dolby_vision_unsupported",
            Self::PlaybackInterrupted => "playback_interrupted",
            Self::Unknown => "unknown",
        }
    }

    pub fn retryable(self) -> bool {
        matches!(
            self,
            Self::SourceNotFound
                | Self::SourcePermissionDenied
                | Self::SourceTransportFailed
                | Self::SourceServerUnavailable
                | Self::SourceRangeInvalid
                | Self::ContainerUnsupported
                | Self::VideoDecoderUnavailable
                | Self::AudioDecoderUnavailable
                | Self::BitmapSubtitleUnsupported
                | Self::DecoderInitializationFailed
                | Self::MediaInspectionUnavailable
                | Self::MediaCompatibilityIndeterminate
                | Self::ConversionDependencyMissing
                | Self::ConversionEncoderMissing
                | Self::ConversionFilterMissing
                | Self::ConversionFailed
                | Self::ConversionVerificationFailed
                | Self::ConversionCancelled
                | Self::ConversionRequiresConsent
                | Self::ConversionInProgress
                | Self::ConversionQueueFull
                | Self::InsufficientStorage
                | Self::PlaybackInterrupted
                | Self::Unknown
        )
    }
}

/// Serialized command/job error. `type` is a stable discriminator used by the
/// frontend `coerceError` path; `code` is the taxonomy value.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCompatError {
    #[serde(rename = "type")]
    pub kind: String,
    pub code: MediaFailureCode,
    pub message: String,
    pub detail: Option<String>,
    pub retryable: bool,
}

impl MediaCompatError {
    pub fn new(code: MediaFailureCode, message: impl Into<String>) -> Self {
        Self {
            kind: "media_compat".to_string(),
            code,
            message: message.into(),
            detail: None,
            retryable: code.retryable(),
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

impl std::fmt::Display for MediaCompatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for MediaCompatError {}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaUrlKind {
    LoopbackMediaServer,
    Remote,
    Blob,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTransportProbe {
    pub url_kind: MediaUrlKind,
    pub reachable: bool,
    pub status: Option<u16>,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
    pub accept_ranges: Option<String>,
    pub content_range: Option<String>,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProbeStatus {
    Ok,
    #[default]
    Unavailable,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SubtitleKind {
    Text,
    Bitmap,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum HdrKind {
    Sdr,
    Hdr10,
    Hlg,
    DolbyVision,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DolbyVisionInfo {
    pub profile: u8,
    pub level: u8,
    pub rpu_present: bool,
    pub el_present: bool,
    pub bl_present: bool,
    pub compatibility_id: Option<u8>,
    pub hdr10_compatible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HdrInfo {
    pub kind: HdrKind,
    pub bt2020: bool,
    pub dolby_vision: Option<DolbyVisionInfo>,
    pub hdr10_plus: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VideoStreamInfo {
    pub index: i32,
    pub codec: String,
    pub codec_long_name: Option<String>,
    pub profile: Option<String>,
    pub level: Option<i32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub coded_width: Option<u32>,
    pub coded_height: Option<u32>,
    pub pixel_format: Option<String>,
    pub bit_depth: Option<u32>,
    pub frame_rate: Option<f64>,
    pub avg_frame_rate: Option<f64>,
    pub codec_tag: Option<String>,
    pub is_attached_pic: bool,
    pub is_default: bool,
    pub language: Option<String>,
    pub title: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub color_range: Option<String>,
    pub hdr: HdrInfo,
    pub start_time_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub bit_rate: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AudioStreamInfo {
    pub index: i32,
    pub codec: String,
    pub profile: Option<String>,
    pub channels: Option<u32>,
    pub channel_layout: Option<String>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub bit_rate: Option<u64>,
    pub language: Option<String>,
    pub title: Option<String>,
    pub is_default: bool,
    pub is_commentary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SubtitleStreamInfo {
    pub index: i32,
    pub codec: String,
    pub kind: SubtitleKind,
    pub language: Option<String>,
    pub title: Option<String>,
    pub is_default: bool,
    pub is_forced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ChapterInfo {
    pub start_seconds: f64,
    pub end_seconds: Option<f64>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaToolReport {
    pub ffprobe_available: bool,
    pub ffmpeg_available: bool,
    pub ffprobe_version: Option<String>,
    pub ffmpeg_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaSourceInfo {
    pub path_label: String,
    pub path_hash: String,
    pub size_bytes: Option<u64>,
    pub modified_unix_ms: Option<i64>,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaInspection {
    pub schema_version: u32,
    pub document_id: Option<String>,
    pub source: MediaSourceInfo,
    pub probe_status: ProbeStatus,
    pub probe_error: Option<String>,
    pub container: Option<String>,
    pub container_raw: Option<String>,
    pub duration_seconds: Option<f64>,
    pub start_time_seconds: Option<f64>,
    pub bit_rate: Option<u64>,
    pub size_bytes: Option<u64>,
    pub video_streams: Vec<VideoStreamInfo>,
    pub audio_streams: Vec<AudioStreamInfo>,
    pub subtitle_streams: Vec<SubtitleStreamInfo>,
    pub chapters: Vec<ChapterInfo>,
    pub is_protected: bool,
    pub warnings: Vec<String>,
    pub tool: MediaToolReport,
}

pub fn is_bitmap_subtitle(codec: &str) -> bool {
    matches!(
        codec.to_ascii_lowercase().as_str(),
        "hdmv_pgs_subtitle" | "dvd_subtitle" | "dvb_subtitle" | "xsub" | "dvb_teletext"
    )
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityLevel {
    Supported,
    Unsupported,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlatformKind {
    Linux,
    Macos,
    Windows,
    Android,
    Ios,
    Web,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum EngineKind {
    Webkitgtk,
    Wkwebview,
    Webview2,
    AndroidWebview,
    Browser,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EncoderCapability {
    pub level: CapabilityLevel,
    pub factory: Option<String>,
    pub hardware: bool,
    pub canary: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FfmpegCapabilities {
    pub available: bool,
    pub ffprobe_available: bool,
    pub version: Option<String>,
    pub has_libx264: bool,
    pub has_aac: bool,
    pub has_zscale: bool,
    pub has_tonemap: bool,
    pub hardware_encoders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GStreamerReport {
    pub inspect_available: bool,
    pub plugin_dirs: Vec<String>,
    pub registry: Option<String>,
    pub plugin_set_id: Option<String>,
    pub found_elements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaRuntimeCapabilities {
    pub schema_version: u32,
    pub platform: PlatformKind,
    pub engine: EngineKind,
    pub engine_version: Option<String>,
    pub evidence: Vec<String>,
    pub runtime_fingerprint: String,
    pub checked_at: String,
    pub decoders: HashMap<String, CapabilityLevel>,
    pub demuxers: HashMap<String, CapabilityLevel>,
    pub subtitle_support: HashMap<String, CapabilityLevel>,
    pub encoders: HashMap<String, EncoderCapability>,
    pub ffmpeg: FfmpegCapabilities,
    pub gstreamer: Option<GStreamerReport>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DeclaredCodecSupport {
    pub h264: CapabilityLevel,
    pub hevc: CapabilityLevel,
    pub av1: CapabilityLevel,
    pub vp9: CapabilityLevel,
    pub aac: CapabilityLevel,
    pub ac3: CapabilityLevel,
    pub eac3: CapabilityLevel,
    pub dts: CapabilityLevel,
    pub truehd: CapabilityLevel,
    pub opus: CapabilityLevel,
    pub flac: CapabilityLevel,
    pub mp3: CapabilityLevel,
    pub vorbis: CapabilityLevel,
    pub bitmap_subtitles: CapabilityLevel,
    pub text_subtitles: CapabilityLevel,
    pub containers: HashMap<String, CapabilityLevel>,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackStrategy {
    Native,
    Remux,
    AudioTranscode,
    VideoTranscode,
    #[default]
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlanConfidence {
    Certain,
    Probable,
    #[default]
    Indeterminate,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SubtitlePolicy {
    Keep,
    #[default]
    StripAll,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct OutputProfile {
    pub container: String,
    pub video: String,
    pub audio: String,
    pub scale: Option<String>,
    pub tone_map: Option<String>,
    pub video_crf: Option<u8>,
    pub video_preset: Option<String>,
    pub audio_bitrate_kbps: Option<u32>,
    pub audio_channels: Option<u32>,
    pub hardware: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CachedArtifact {
    pub cache_key: String,
    pub output_container: String,
    pub duration_seconds: Option<f64>,
    pub size_bytes: u64,
    pub timeline_offset_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ConversionEstimate {
    pub source_bytes: Option<u64>,
    pub duration_seconds: Option<f64>,
    pub output_bytes_floor: Option<u64>,
    pub free_space_required_bytes: Option<u64>,
    pub cache_fits: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaPlaybackPlan {
    pub schema_version: u32,
    pub plan_id: String,
    pub document_id: String,
    pub source_fingerprint: String,
    pub inspection_hash: String,
    pub strategy: PlaybackStrategy,
    pub confidence: PlanConfidence,
    pub reasons: Vec<String>,
    pub selected_video_index: Option<i32>,
    pub selected_audio_index: Option<i32>,
    pub subtitle_policy: SubtitlePolicy,
    pub output: Option<OutputProfile>,
    pub requires_consent: bool,
    pub consent_reasons: Vec<String>,
    pub limitations: Vec<String>,
    pub cached_artifact: Option<CachedArtifact>,
    pub can_convert: bool,
    pub unavailable_reason: Option<String>,
    pub estimated: ConversionEstimate,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum CompatibilityMode {
    AutomaticInexpensive,
    Ask,
    #[default]
    Never,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ConversionQuality {
    #[default]
    Balanced,
    Quality,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum HardwareAcceleration {
    #[default]
    Auto,
    Off,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProcessingPolicy {
    pub mode: CompatibilityMode,
    pub quality: ConversionQuality,
    pub hardware_acceleration: HardwareAcceleration,
    pub cache_limit_gb: u32,
}

impl Default for MediaProcessingPolicy {
    fn default() -> Self {
        Self {
            mode: CompatibilityMode::AutomaticInexpensive,
            quality: ConversionQuality::Balanced,
            hardware_acceleration: HardwareAcceleration::Auto,
            cache_limit_gb: 25,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaybackRecoveryContext {
    pub trigger: String,
    pub failure_code: Option<MediaFailureCode>,
    pub media_error_code: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaPlaybackPlanRequest {
    pub document_id: String,
    pub file_path: String,
    pub inspection_fingerprint: String,
    pub client_support: DeclaredCodecSupport,
    pub policy: MediaProcessingPolicy,
    pub recovery: Option<PlaybackRecoveryContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StartMediaCompatibilityJobRequest {
    pub document_id: String,
    pub file_path: String,
    pub inspection_fingerprint: String,
    pub client_support: DeclaredCodecSupport,
    pub policy: MediaProcessingPolicy,
    pub consent_granted: bool,
    pub recovery: Option<PlaybackRecoveryContext>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MediaCompatibilityJobState {
    #[default]
    Queued,
    Running,
    Finalizing,
    Ready,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MediaCompatibilityJobPhase {
    #[default]
    Queued,
    Probing,
    Preparing,
    Encoding,
    Verifying,
    Publishing,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct JobProgress {
    pub percent: Option<f64>,
    pub processed_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub speed: Option<f64>,
    pub output_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct JobOutput {
    pub cache_key: String,
    pub output_container: String,
    pub duration_seconds: Option<f64>,
    pub size_bytes: u64,
    pub timeline_offset_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaCompatibilityJobEvent {
    pub schema_version: u32,
    pub job_id: String,
    pub document_id: String,
    pub cache_key: String,
    pub sequence: u64,
    pub state: MediaCompatibilityJobState,
    pub phase: MediaCompatibilityJobPhase,
    pub progress: JobProgress,
    pub output: Option<JobOutput>,
    pub error: Option<MediaCompatError>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaCacheArtifactSummary {
    pub cache_key: String,
    pub document_id: String,
    pub size_bytes: u64,
    pub output_container: String,
    pub last_accessed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaCacheUsage {
    pub artifact_count: usize,
    pub total_bytes: u64,
    pub cache_root_label: String,
    pub artifacts: Vec<MediaCacheArtifactSummary>,
}
