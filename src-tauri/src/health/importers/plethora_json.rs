//! Plethora Health JSON v1 bundle adapter (preserves backwards compatibility).

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use crate::health::import_export::HealthExportBundleV1;
use crate::health::models::{HealthDataCategory, HealthProviderId};
use crate::health::provider::NormalizedIngestionBatch;
use crate::health::time::elapsed_minutes;

use super::detector::ImportInspection;
use super::limits::{ArchiveSecurityLimits, StreamingParserLimits};
use super::registry::WearableImportAdapter;
use super::types::{
    DetectionCandidate, DetectionConfidence, ImportAdapterDescriptor, ImportCancellationToken,
    ImportCapabilities, ImportError, ImportProgressEvent, ParsedImportOutput, VerificationStatus,
};

pub struct PlethoraJsonAdapter;

impl WearableImportAdapter for PlethoraJsonAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "plethora_json_v1".to_string(),
            provider_id: HealthProviderId::FileImport,
            display_name: "Plethora Health JSON".to_string(),
            format_id: "plethora_json".to_string(),
            format_label: "Plethora Health JSON Bundle (v1)".to_string(),
            format_version: "1.0".to_string(),
            verification_status: VerificationStatus::ImplementedFixtureTested,
            capabilities: ImportCapabilities {
                supports_archive: false,
                supports_standalone: true,
                supports_detailed_stages: true,
                supports_stage_totals_only: true,
                supports_timezone: true,
                supported_extensions: vec!["json".to_string()],
                supported_categories: vec![
                    HealthDataCategory::Sleep,
                    HealthDataCategory::SleepStages,
                    HealthDataCategory::HeartRate,
                    HealthDataCategory::RestingHeartRate,
                    HealthDataCategory::Hrv,
                    HealthDataCategory::Recovery,
                ],
                known_limitations: vec![],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip || inspection.extension != "json" {
            return None;
        }
        if inspection.text_sample.contains("\"schemaVersion\"")
            && (inspection.text_sample.contains("\"sleepSessions\"")
                || inspection.text_sample.contains("\"physiologicalObservations\""))
        {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::FileImport,
                adapter_id: "plethora_json_v1".to_string(),
                format_id: "plethora_json".to_string(),
                format_label: "Plethora Health JSON Bundle".to_string(),
                confidence: DetectionConfidence::Confident,
                score: 99,
                reasons: vec!["JSON matches Plethora HealthExportBundleV1 schema".to_string()],
            });
        }
        None
    }

    fn parse_file(
        &self,
        path: &Path,
        _archive_limits: &ArchiveSecurityLimits,
        streaming_limits: &StreamingParserLimits,
        cancel: &ImportCancellationToken,
        _progress: Option<&dyn Fn(ImportProgressEvent)>,
        _job_id: &str,
    ) -> Result<ParsedImportOutput, ImportError> {
        cancel.check()?;
        let meta = std::fs::metadata(path).map_err(|e| ImportError::Io(e.to_string()))?;
        if meta.len() > streaming_limits.max_json_bytes {
            return Err(ImportError::SecurityViolation(format!(
                "JSON bundle exceeds {} byte limit",
                streaming_limits.max_json_bytes
            )));
        }
        let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
        let bundle: HealthExportBundleV1 = serde_json::from_reader(BufReader::new(file))
            .map_err(|e| ImportError::InvalidInput(format!("Invalid Plethora JSON bundle: {e}")))?;

        if bundle.schema_version != 1 {
            return Err(ImportError::UnsupportedFormat(format!(
                "Unsupported Plethora health bundle schema version: {}",
                bundle.schema_version
            )));
        }

        for (idx, session) in bundle.sleep_sessions.iter().enumerate() {
            let dur = elapsed_minutes(session.start_at_ms, session.end_at_ms);
            if session.external_record_id.is_empty()
                || session.is_synthetic
                || chrono::DateTime::from_timestamp_millis(session.start_at_ms).is_none()
                || chrono::DateTime::from_timestamp_millis(session.end_at_ms).is_none()
                || !dur.is_ok_and(|m| (0.0..=2_880.0).contains(&m))
                || !session.duration_mins.is_finite()
                || !(0.0..=2_880.0).contains(&session.duration_mins)
            {
                return Err(ImportError::InvalidInput(format!(
                    "Invalid sleep record at row {}",
                    idx + 1
                )));
            }
        }

        let provider = bundle
            .sleep_sessions
            .first()
            .map(|s| s.provider_id)
            .unwrap_or(HealthProviderId::FileImport);

        Ok(ParsedImportOutput {
            provider_id: provider,
            export_format: "plethora_json".to_string(),
            format_version: Some("1.0".to_string()),
            batch: NormalizedIngestionBatch {
                devices: bundle.devices,
                sleep_sessions: bundle.sleep_sessions,
                physio_observations: bundle.physiological_observations,
                recovery_observations: bundle.recovery_observations,
                ..Default::default()
            },
            invalid_records: 0,
            missing_fields: Vec::new(),
            unsupported_fields: Vec::new(),
            timezone_assumptions: Vec::new(),
            row_errors: Vec::new(),
        })
    }
}
