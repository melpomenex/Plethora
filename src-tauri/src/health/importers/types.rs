//! Shared contracts for the Universal Wearable Health Data Import Platform.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::health::models::{
    HealthDataCategory, HealthProviderId, RawSleepSession,
};
use crate::health::provider::NormalizedIngestionBatch;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcquisitionMethod {
    FileImport,
    NativeMobile,
    CloudOauth,
    Manual,
}

impl AcquisitionMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FileImport => "file_import",
            Self::NativeMobile => "native_mobile",
            Self::CloudOauth => "cloud_oauth",
            Self::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectionConfidence {
    Confident,
    Probable,
    Ambiguous,
    Unknown,
    RecognizedUnsupported,
    NoUsableSleepData,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    ImplementedFixtureTested,
    VerifiedConsumerExport,
    PartialRecoveryOnly,
    BridgeRequired,
    UnsupportedInternalFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionCandidate {
    pub provider_id: HealthProviderId,
    pub adapter_id: String,
    pub format_id: String,
    pub format_label: String,
    pub confidence: DetectionConfidence,
    pub score: u8,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionResult {
    pub confidence: DetectionConfidence,
    pub primary: Option<DetectionCandidate>,
    pub candidates: Vec<DetectionCandidate>,
    pub file_kind: String,
    pub is_archive: bool,
    pub requires_csv_mapping: bool,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCapabilities {
    pub supports_archive: bool,
    pub supports_standalone: bool,
    pub supports_detailed_stages: bool,
    pub supports_stage_totals_only: bool,
    pub supports_timezone: bool,
    pub supported_extensions: Vec<String>,
    pub supported_categories: Vec<HealthDataCategory>,
    pub known_limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAdapterDescriptor {
    pub adapter_id: String,
    pub provider_id: HealthProviderId,
    pub display_name: String,
    pub format_id: String,
    pub format_label: String,
    pub format_version: String,
    pub verification_status: VerificationStatus,
    pub capabilities: ImportCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryCount {
    pub category: HealthDataCategory,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    pub file_hash: String,
    pub detection: DetectionResult,
    pub selected_provider_id: Option<HealthProviderId>,
    pub selected_adapter_id: Option<String>,
    pub date_range_start_ms: Option<i64>,
    pub date_range_end_ms: Option<i64>,
    pub available_categories: Vec<CategoryCount>,
    pub sleep_sessions_count: usize,
    pub sleep_stages_count: usize,
    pub physio_observations_count: usize,
    pub recovery_observations_count: usize,
    pub estimated_new: usize,
    pub estimated_duplicates: usize,
    pub estimated_updates: usize,
    pub invalid_records: usize,
    pub missing_fields: Vec<String>,
    pub unsupported_fields: Vec<String>,
    pub timezone_assumptions: Vec<String>,
    pub warnings: Vec<String>,
    pub sample_csv_headers: Vec<String>,
    pub sample_csv_rows: Vec<Vec<String>>,
    pub can_commit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgressEvent {
    pub job_id: String,
    pub phase: String,
    pub processed: usize,
    pub total: Option<usize>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitResult {
    pub batch_id: String,
    pub provider_id: HealthProviderId,
    pub acquisition_method: AcquisitionMethod,
    pub export_format: String,
    pub sleep_imported: usize,
    pub sleep_updated: usize,
    pub sleep_skipped: usize,
    pub physio_imported: usize,
    pub recovery_imported: usize,
    pub reconciled_episodes: usize,
    pub date_range_start_ms: Option<i64>,
    pub date_range_end_ms: Option<i64>,
    pub warnings: Vec<String>,
    pub row_errors: Vec<String>,
    pub has_usable_sleep: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchSummary {
    pub id: String,
    pub provider_id: HealthProviderId,
    pub acquisition_method: AcquisitionMethod,
    pub export_format: String,
    pub format_version: Option<String>,
    pub source_file_name: String,
    pub file_size_bytes: i64,
    pub imported_at_ms: i64,
    pub date_range_start_ms: Option<i64>,
    pub date_range_end_ms: Option<i64>,
    pub sleep_added: i64,
    pub sleep_updated: i64,
    pub sleep_skipped: i64,
    pub physio_imported: i64,
    pub recovery_imported: i64,
    pub warnings: Vec<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvMappingProfile {
    pub id: Option<String>,
    pub name: String,
    pub provider_id: Option<HealthProviderId>,
    pub delimiter: Option<char>,
    pub start_column: Option<String>,
    pub end_column: Option<String>,
    pub date_column: Option<String>,
    pub duration_column: Option<String>,
    pub duration_unit: Option<String>,
    pub time_in_bed_column: Option<String>,
    pub awake_column: Option<String>,
    pub light_column: Option<String>,
    pub deep_column: Option<String>,
    pub rem_column: Option<String>,
    pub latency_column: Option<String>,
    pub efficiency_column: Option<String>,
    pub sleep_kind_column: Option<String>,
    pub nap_indicator_column: Option<String>,
    pub hrv_column: Option<String>,
    pub hrv_method: Option<String>,
    pub resting_hr_column: Option<String>,
    pub respiratory_rate_column: Option<String>,
    pub spo2_column: Option<String>,
    pub temperature_column: Option<String>,
    pub temperature_unit: Option<String>,
    pub sleep_score_column: Option<String>,
    pub recovery_score_column: Option<String>,
    pub source_column: Option<String>,
    pub notes_column: Option<String>,
    pub timestamp_format: Option<String>,
    pub fallback_tz_offset_minutes: Option<i32>,
    pub stage_label_map: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderExportGuide {
    pub provider_id: HealthProviderId,
    pub display_name: String,
    pub file_import_available: bool,
    pub verification_status: VerificationStatus,
    pub supported_export_formats: Vec<String>,
    pub export_steps: Vec<String>,
    pub official_portal_url: String,
    pub available_categories: Vec<HealthDataCategory>,
    pub limitations: Vec<String>,
    pub native_bridge_available: bool,
    pub cloud_sync_requires_approval: bool,
    pub readiness_label: String,
    pub last_verified_date: String,
}

#[derive(Debug, Clone)]
pub struct ImportCancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl Default for ImportCancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

impl ImportCancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    pub fn check(&self) -> Result<(), ImportError> {
        if self.is_cancelled() {
            Err(ImportError::Cancelled)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone)]
pub enum ImportError {
    Cancelled,
    SecurityViolation(String),
    UnsupportedFormat(String),
    InvalidInput(String),
    Io(String),
    Database(String),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "Import was cancelled by the user"),
            Self::SecurityViolation(m) => write!(f, "Security check rejected input: {m}"),
            Self::UnsupportedFormat(m) => write!(f, "{m}"),
            Self::InvalidInput(m) => write!(f, "{m}"),
            Self::Io(m) => write!(f, "File I/O error: {m}"),
            Self::Database(m) => write!(f, "Health Vault error: {m}"),
        }
    }
}

impl std::error::Error for ImportError {}

impl From<ImportError> for String {
    fn from(err: ImportError) -> Self {
        err.to_string()
    }
}

#[derive(Debug, Clone)]
pub struct ParsedImportOutput {
    pub provider_id: HealthProviderId,
    pub export_format: String,
    pub format_version: Option<String>,
    pub batch: NormalizedIngestionBatch,
    pub invalid_records: usize,
    pub missing_fields: Vec<String>,
    pub unsupported_fields: Vec<String>,
    pub timezone_assumptions: Vec<String>,
    pub row_errors: Vec<String>,
}

impl ParsedImportOutput {
    pub fn date_range(&self) -> (Option<i64>, Option<i64>) {
        let mut min_ms: Option<i64> = None;
        let mut max_ms: Option<i64> = None;
        for s in &self.batch.sleep_sessions {
            min_ms = Some(min_ms.map_or(s.start_at_ms, |v| v.min(s.start_at_ms)));
            max_ms = Some(max_ms.map_or(s.end_at_ms, |v| v.max(s.end_at_ms)));
        }
        for p in &self.batch.physio_observations {
            min_ms = Some(min_ms.map_or(p.measured_at_ms, |v| v.min(p.measured_at_ms)));
            max_ms = Some(max_ms.map_or(p.measured_at_ms, |v| v.max(p.measured_at_ms)));
        }
        for r in &self.batch.recovery_observations {
            min_ms = Some(min_ms.map_or(r.measured_at_ms, |v| v.min(r.measured_at_ms)));
            max_ms = Some(max_ms.map_or(r.measured_at_ms, |v| v.max(r.measured_at_ms)));
        }
        (min_ms, max_ms)
    }

    pub fn filter_categories(&mut self, allowed: &[HealthDataCategory]) {
        if allowed.is_empty() {
            return;
        }
        let allow_sleep = allowed.contains(&HealthDataCategory::Sleep);
        let allow_stages = allowed.contains(&HealthDataCategory::SleepStages);
        if !allow_sleep {
            self.batch.sleep_sessions.clear();
        } else if !allow_stages {
            for s in &mut self.batch.sleep_sessions {
                s.stages.clear();
                s.awake_mins = None;
                s.light_mins = None;
                s.deep_mins = None;
                s.rem_mins = None;
            }
        }

        self.batch.physio_observations.retain(|obs| {
            let cat = match obs.metric_type {
                crate::health::models::PhysiologicalMetricType::HeartRate => {
                    HealthDataCategory::HeartRate
                }
                crate::health::models::PhysiologicalMetricType::RestingHeartRate => {
                    HealthDataCategory::RestingHeartRate
                }
                crate::health::models::PhysiologicalMetricType::Hrv => HealthDataCategory::Hrv,
                crate::health::models::PhysiologicalMetricType::Spo2 => HealthDataCategory::Recovery,
                crate::health::models::PhysiologicalMetricType::SkinTempDeviation => {
                    HealthDataCategory::Temperature
                }
                crate::health::models::PhysiologicalMetricType::RespiratoryRate => {
                    HealthDataCategory::RespiratoryRate
                }
                crate::health::models::PhysiologicalMetricType::Steps
                | crate::health::models::PhysiologicalMetricType::ActiveCalories => {
                    HealthDataCategory::Activity
                }
            };
            allowed.contains(&cat)
        });

        if !allowed.contains(&HealthDataCategory::Recovery) {
            self.batch.recovery_observations.clear();
        }
    }
}

pub fn update_session_range(session: &RawSleepSession, min_ms: &mut Option<i64>, max_ms: &mut Option<i64>) {
    *min_ms = Some(min_ms.map_or(session.start_at_ms, |v| v.min(session.start_at_ms)));
    *max_ms = Some(max_ms.map_or(session.end_at_ms, |v| v.max(session.end_at_ms)));
}
