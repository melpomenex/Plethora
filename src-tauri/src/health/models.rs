//! Canonical normalized domain models for Plethora Wearable Health & Sleep Intelligence.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthProviderId {
    AppleHealthkit,
    AndroidHealthConnect,
    Oura,
    Whoop,
    GoogleHealth,
    Garmin,
    Polar,
    Withings,
    SamsungHealth,
    Suunto,
    Ultrahuman,
    Ringconn,
    Manual,
    FileImport,
}

impl HealthProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AppleHealthkit => "apple_healthkit",
            Self::AndroidHealthConnect => "android_health_connect",
            Self::Oura => "oura",
            Self::Whoop => "whoop",
            Self::GoogleHealth => "google_health",
            Self::Garmin => "garmin",
            Self::Polar => "polar",
            Self::Withings => "withings",
            Self::SamsungHealth => "samsung_health",
            Self::Suunto => "suunto",
            Self::Ultrahuman => "ultrahuman",
            Self::Ringconn => "ringconn",
            Self::Manual => "manual",
            Self::FileImport => "file_import",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "apple_healthkit" | "healthkit" => Some(Self::AppleHealthkit),
            "android_health_connect" | "health_connect" => Some(Self::AndroidHealthConnect),
            "oura" => Some(Self::Oura),
            "whoop" => Some(Self::Whoop),
            "google_health" | "google-health" => Some(Self::GoogleHealth),
            "garmin" => Some(Self::Garmin),
            "polar" => Some(Self::Polar),
            "withings" => Some(Self::Withings),
            "samsung_health" | "samsung-health" => Some(Self::SamsungHealth),
            "suunto" => Some(Self::Suunto),
            "ultrahuman" => Some(Self::Ultrahuman),
            "ringconn" => Some(Self::Ringconn),
            "manual" => Some(Self::Manual),
            "file_import" | "file-import" => Some(Self::FileImport),
            _ => None,
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::AppleHealthkit => "Apple Health / Apple Watch",
            Self::AndroidHealthConnect => "Android Health Connect",
            Self::Oura => "Oura Ring",
            Self::Whoop => "WHOOP",
            Self::GoogleHealth => "Google Health (Pixel Watch / Fitbit)",
            Self::Garmin => "Garmin",
            Self::Polar => "Polar",
            Self::Withings => "Withings",
            Self::SamsungHealth => "Samsung Health (Galaxy Watch / Ring)",
            Self::Suunto => "Suunto",
            Self::Ultrahuman => "Ultrahuman Ring",
            Self::Ringconn => "RingConn",
            Self::Manual => "Manual Sleep Entry",
            Self::FileImport => "File Import (JSON / CSV / Apple Health XML)",
        }
    }

    pub fn default_priority_rank(self) -> usize {
        match self {
            Self::Manual => 0,
            Self::Oura => 1,
            Self::Whoop => 2,
            Self::Garmin => 3,
            Self::GoogleHealth => 4,
            Self::AppleHealthkit => 5,
            Self::AndroidHealthConnect => 6,
            Self::Polar => 7,
            Self::Withings => 8,
            Self::SamsungHealth => 9,
            Self::Suunto => 10,
            Self::Ultrahuman => 11,
            Self::Ringconn => 12,
            Self::FileImport => 13,
        }
    }

    pub fn is_aggregator_hub(self) -> bool {
        matches!(
            self,
            Self::AppleHealthkit | Self::AndroidHealthConnect | Self::FileImport
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderCategory {
    NativeMobile,
    CloudOauth,
    LocalManual,
    LocalImport,
    AggregatorBridged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderReadinessState {
    Available,
    NotConfigured,
    RequiresDeveloperApproval,
    RequiresUserAuthorization,
    Connected,
    Synchronizing,
    RateLimited,
    TemporarilyUnavailable,
    PermissionRevoked,
    Unsupported,
    FeatureDisabledCompliance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthDataCategory {
    Sleep,
    SleepStages,
    HeartRate,
    RestingHeartRate,
    Hrv,
    Activity,
    Recovery,
    Temperature,
    RespiratoryRate,
}

impl HealthDataCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sleep => "sleep",
            Self::SleepStages => "sleep_stages",
            Self::HeartRate => "heart_rate",
            Self::RestingHeartRate => "resting_heart_rate",
            Self::Hrv => "hrv",
            Self::Activity => "activity",
            Self::Recovery => "recovery",
            Self::Temperature => "temperature",
            Self::RespiratoryRate => "respiratory_rate",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "sleep" => Some(Self::Sleep),
            "sleep_stages" => Some(Self::SleepStages),
            "heart_rate" => Some(Self::HeartRate),
            "resting_heart_rate" => Some(Self::RestingHeartRate),
            "hrv" => Some(Self::Hrv),
            "activity" => Some(Self::Activity),
            "recovery" => Some(Self::Recovery),
            "temperature" => Some(Self::Temperature),
            "respiratory_rate" => Some(Self::RespiratoryRate),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthProviderInfo {
    pub id: HealthProviderId,
    pub category: ProviderCategory,
    pub display_name: String,
    pub supported_categories: Vec<HealthDataCategory>,
    pub readiness_state: ProviderReadinessState,
    pub readiness_reason: String,
    pub implementation_version: String,
    pub requires_approval: bool,
    pub requires_credentials: bool,
    pub supports_backfill: bool,
    pub max_backfill_days: Option<u32>,
    pub bridged_via: Vec<HealthProviderId>,
    pub documentation_url: String,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthConnection {
    pub provider_id: HealthProviderId,
    pub status: ProviderReadinessState,
    pub auth_state: String,
    pub requested_categories: Vec<HealthDataCategory>,
    pub granted_categories: Vec<HealthDataCategory>,
    pub last_sync_at_ms: Option<i64>,
    pub last_success_at_ms: Option<i64>,
    pub sync_cursor: Option<String>,
    pub account_subject_hint: Option<String>,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
    pub history_limit_days: Option<i32>,
    pub background_sync_enabled: bool,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthDevice {
    pub id: String,
    pub provider_id: HealthProviderId,
    pub external_device_id: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub source_app_bundle: Option<String>,
    pub platform_source_id: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthConsentRecord {
    pub id: String,
    pub provider_id: HealthProviderId,
    pub action: String,
    pub categories: Vec<HealthDataCategory>,
    pub purpose: String,
    pub policy_version: String,
    pub recorded_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SleepStageType {
    Awake,
    Light,
    Deep,
    Rem,
    AsleepUnknown,
    InBed,
    Unknown,
}

impl SleepStageType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Awake => "awake",
            Self::Light => "light",
            Self::Deep => "deep",
            Self::Rem => "rem",
            Self::AsleepUnknown => "asleep_unknown",
            Self::InBed => "in_bed",
            Self::Unknown => "unknown",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "awake" => Self::Awake,
            "light" | "core" | "asleep_core" => Self::Light,
            "deep" | "sws" | "asleep_deep" => Self::Deep,
            "rem" | "asleep_rem" => Self::Rem,
            "asleep_unknown" | "asleep" | "sleeping" | "asleep_unspecified" => Self::AsleepUnknown,
            "in_bed" | "inbed" => Self::InBed,
            _ => Self::Unknown,
        }
    }

    pub fn is_specific_sleep_stage(self) -> bool {
        matches!(self, Self::Light | Self::Deep | Self::Rem)
    }

    pub fn counts_as_asleep(self) -> bool {
        matches!(
            self,
            Self::Light | Self::Deep | Self::Rem | Self::AsleepUnknown
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SleepKind {
    MainSleep,
    Nap,
    Unknown,
}

impl SleepKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MainSleep => "main_sleep",
            Self::Nap => "nap",
            Self::Unknown => "unknown",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "main_sleep" | "long_sleep" | "main" => Self::MainSleep,
            "nap" | "late_nap" | "short_sleep" => Self::Nap,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SleepQualityFlag {
    MissingStages,
    PartialStages,
    ImplausibleDuration,
    SourceConflict,
    ClockSkewOrDst,
    UserEntered,
    IncompleteBoundaries,
    AggregateStageDurationsOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepStageInterval {
    pub id: String,
    pub raw_session_id: String,
    pub stage_type: SleepStageType,
    pub start_at_ms: i64,
    pub end_at_ms: i64,
    pub provider_stage_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSleepSession {
    pub id: String,
    pub provider_id: HealthProviderId,
    pub device_id: Option<String>,
    pub external_record_id: String,
    pub source_app_bundle: Option<String>,
    pub start_at_ms: i64,
    pub end_at_ms: i64,
    pub start_tz_offset_secs: Option<i32>,
    pub end_tz_offset_secs: Option<i32>,
    pub duration_mins: f64,
    pub time_in_bed_mins: Option<f64>,
    pub sleep_efficiency_pct: Option<f64>,
    pub awake_mins: Option<f64>,
    pub light_mins: Option<f64>,
    pub deep_mins: Option<f64>,
    pub rem_mins: Option<f64>,
    pub sleep_kind: SleepKind,
    pub provider_sleep_kind: Option<String>,
    pub quality_flags: Vec<SleepQualityFlag>,
    pub quality_score: f64,
    pub notes: Option<String>,
    pub subjective_quality: Option<i32>,
    pub acquisition_at_ms: i64,
    pub sync_batch_id: Option<String>,
    pub is_deleted: bool,
    pub is_synthetic: bool,
    pub stages: Vec<SleepStageInterval>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateRelationship {
    Primary,
    SameSourceExportDuplicate,
    IndependentDeviceObservation,
}

impl DuplicateRelationship {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::SameSourceExportDuplicate => "same_source_export_duplicate",
            Self::IndependentDeviceObservation => "independent_device_observation",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "primary" => Self::Primary,
            "same_source_export_duplicate" => Self::SameSourceExportDuplicate,
            _ => Self::IndependentDeviceObservation,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepEpisodeMember {
    pub canonical_episode_id: String,
    pub raw_session_id: String,
    pub provider_id: HealthProviderId,
    pub source_app_bundle: Option<String>,
    pub duration_mins: f64,
    pub relationship: DuplicateRelationship,
    pub priority_rank: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalSleepEpisode {
    pub id: String,
    pub primary_raw_session_id: String,
    pub primary_provider_id: HealthProviderId,
    pub start_at_ms: i64,
    pub end_at_ms: i64,
    pub start_tz_offset_secs: Option<i32>,
    pub end_tz_offset_secs: Option<i32>,
    pub anchor_local_date: String,
    pub sleep_kind: SleepKind,
    pub user_sleep_kind_override: Option<SleepKind>,
    pub total_sleep_mins: f64,
    pub time_in_bed_mins: Option<f64>,
    pub sleep_efficiency_pct: Option<f64>,
    pub waso_mins: Option<f64>,
    pub stage_coverage_ratio: f64,
    pub awake_mins: Option<f64>,
    pub light_mins: Option<f64>,
    pub deep_mins: Option<f64>,
    pub rem_mins: Option<f64>,
    pub has_source_conflict: bool,
    pub conflict_duration_diff_mins: Option<f64>,
    pub quality_flags: Vec<SleepQualityFlag>,
    pub is_synthetic: bool,
    pub stages: Vec<SleepStageInterval>,
    pub members: Vec<SleepEpisodeMember>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhysiologicalMetricType {
    HeartRate,
    RestingHeartRate,
    Hrv,
    Spo2,
    SkinTempDeviation,
    RespiratoryRate,
    Steps,
    ActiveCalories,
}

impl PhysiologicalMetricType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::HeartRate => "heart_rate",
            Self::RestingHeartRate => "resting_heart_rate",
            Self::Hrv => "hrv",
            Self::Spo2 => "spo2",
            Self::SkinTempDeviation => "skin_temp_deviation",
            Self::RespiratoryRate => "respiratory_rate",
            Self::Steps => "steps",
            Self::ActiveCalories => "active_calories",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "heart_rate" => Some(Self::HeartRate),
            "resting_heart_rate" => Some(Self::RestingHeartRate),
            "hrv" => Some(Self::Hrv),
            "spo2" => Some(Self::Spo2),
            "skin_temp_deviation" => Some(Self::SkinTempDeviation),
            "respiratory_rate" => Some(Self::RespiratoryRate),
            "steps" => Some(Self::Steps),
            "active_calories" => Some(Self::ActiveCalories),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HrvMethod {
    Rmssd,
    Sdnn,
    Unknown,
}

impl HrvMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rmssd => "rmssd",
            Self::Sdnn => "sdnn",
            Self::Unknown => "unknown",
        }
    }

    pub fn from_str(value: Option<&str>) -> Self {
        match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
            Some("rmssd") => Self::Rmssd,
            Some("sdnn") => Self::Sdnn,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysiologicalObservation {
    pub id: String,
    pub provider_id: HealthProviderId,
    pub device_id: Option<String>,
    pub external_record_id: String,
    pub metric_type: PhysiologicalMetricType,
    pub value: f64,
    pub unit: String,
    pub hrv_method: HrvMethod,
    pub measured_at_ms: i64,
    pub period_start_ms: Option<i64>,
    pub period_end_ms: Option<i64>,
    pub tz_offset_secs: Option<i32>,
    pub aggregation_method: Option<String>,
    pub quality_flags: Vec<String>,
    pub acquisition_at_ms: i64,
    pub sync_batch_id: Option<String>,
    pub is_deleted: bool,
    pub is_synthetic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryObservation {
    pub id: String,
    pub provider_id: HealthProviderId,
    pub external_record_id: String,
    pub score_name: String,
    pub score_value: Option<f64>,
    pub scale_min: f64,
    pub scale_max: f64,
    pub score_state: String,
    pub algorithm_id: Option<String>,
    pub represented_date: String,
    pub measured_at_ms: i64,
    pub underlying_metrics_json: Option<String>,
    pub acquisition_at_ms: i64,
    pub is_synthetic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSourcePreference {
    pub category: String,
    pub ordered_provider_ids: Vec<HealthProviderId>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthPrivacySettings {
    pub ai_sharing_enabled: bool,
    pub cloud_sync_enabled: bool,
    pub demo_mode_enabled: bool,
    pub retention_days: Option<i32>,
    pub updated_at_ms: i64,
}

impl Default for HealthPrivacySettings {
    fn default() -> Self {
        Self {
            ai_sharing_enabled: false,
            cloud_sync_enabled: false,
            demo_mode_enabled: false,
            retention_days: None,
            updated_at_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSyncBatch {
    pub id: String,
    pub provider_id: HealthProviderId,
    pub sync_kind: String,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub status: String,
    pub sleep_upserts: i64,
    pub sleep_deletes: i64,
    pub physio_upserts: i64,
    pub recovery_upserts: i64,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSyncReport {
    pub batch_id: String,
    pub provider_id: HealthProviderId,
    pub sleep_upserts: usize,
    pub sleep_deletes: usize,
    pub physio_upserts: usize,
    pub recovery_upserts: usize,
    pub reconciled_episodes: usize,
    pub warnings: Vec<String>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualSleepInput {
    pub id: Option<String>,
    pub start_iso: String,
    pub end_iso: String,
    pub tz_offset_minutes: Option<i32>,
    pub sleep_kind: Option<SleepKind>,
    pub time_in_bed_mins: Option<f64>,
    pub subjective_quality: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthFileImportResult {
    pub format: String,
    pub sleep_imported: usize,
    pub sleep_skipped: usize,
    pub physio_imported: usize,
    pub recovery_imported: usize,
    pub warnings: Vec<String>,
    pub row_errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthProviderError {
    pub code: String,
    pub message: String,
    pub retry_after_secs: Option<u64>,
    pub recoverable: bool,
}

impl HealthProviderError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retry_after_secs: None,
            recoverable,
        }
    }

    pub fn platform_unsupported(provider: &str, platform: &str) -> Self {
        Self::new(
            "platform_unsupported",
            format!("{provider} is not supported on {platform}"),
            false,
        )
    }

    pub fn rate_limited(retry_after_secs: Option<u64>) -> Self {
        Self {
            code: "rate_limited".to_string(),
            message: "Provider rate limit exceeded; retry after backoff window".to_string(),
            retry_after_secs,
            recoverable: true,
        }
    }
}

impl std::fmt::Display for HealthProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for HealthProviderError {}
