//! Polar Account Export adapter (`nightly_recovery_*.json` for HRV/ANS recovery;
//! explicitly documents that Polar account exports exclude sleep session timelines).

use serde_json::Value;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use crate::health::models::{
    HealthDataCategory, HealthProviderId, HrvMethod, PhysiologicalMetricType,
    PhysiologicalObservation, RecoveryObservation,
};
use crate::health::provider::NormalizedIngestionBatch;
use crate::health::time::parse_timestamp_with_offset;

use super::archive::SafeZipArchive;
use super::detector::ImportInspection;
use super::limits::{ArchiveSecurityLimits, StreamingParserLimits};
use super::registry::WearableImportAdapter;
use super::types::{
    DetectionCandidate, DetectionConfidence, ImportAdapterDescriptor, ImportCancellationToken,
    ImportCapabilities, ImportError, ImportProgressEvent, ParsedImportOutput, VerificationStatus,
};

pub struct PolarExportAdapter;

impl WearableImportAdapter for PolarExportAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "polar_account_export".to_string(),
            provider_id: HealthProviderId::Polar,
            display_name: "Polar".to_string(),
            format_id: "polar_nightly_recovery".to_string(),
            format_label: "Polar Account Export (nightly_recovery JSON)".to_string(),
            format_version: "1.0".to_string(),
            verification_status: VerificationStatus::PartialRecoveryOnly,
            capabilities: ImportCapabilities {
                supports_archive: true,
                supports_standalone: true,
                supports_detailed_stages: false,
                supports_stage_totals_only: false,
                supports_timezone: false,
                supported_extensions: vec!["zip".to_string(), "json".to_string()],
                supported_categories: vec![
                    HealthDataCategory::Hrv,
                    HealthDataCategory::Recovery,
                    HealthDataCategory::RespiratoryRate,
                ],
                known_limitations: vec![
                    "Polar account exports exclude sleep timelines and durations; sync Polar Flow via Apple Health or Health Connect for sleep data.".to_string(),
                ],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip {
            let has_polar = inspection.zip_paths.iter().any(|p| {
                let l = p.to_ascii_lowercase();
                l.contains("nightly_recovery") && l.ends_with(".json")
            });
            if has_polar {
                return Some(DetectionCandidate {
                    provider_id: HealthProviderId::Polar,
                    adapter_id: "polar_account_export".to_string(),
                    format_id: "polar_zip".to_string(),
                    format_label: "Polar Account Export (.zip)".to_string(),
                    confidence: DetectionConfidence::Confident,
                    score: 94,
                    reasons: vec!["Archive contains Polar nightly_recovery JSON".to_string()],
                });
            }
            return None;
        }

        if inspection.extension == "json"
            && inspection.text_sample.contains("\"meanNightlyRecoveryRmssd\"")
        {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::Polar,
                adapter_id: "polar_account_export".to_string(),
                format_id: "polar_nightly_recovery_json".to_string(),
                format_label: "Polar nightly_recovery JSON".to_string(),
                confidence: DetectionConfidence::Confident,
                score: 94,
                reasons: vec!["JSON contains Polar meanNightlyRecoveryRmssd".to_string()],
            });
        }
        None
    }

    fn parse_file(
        &self,
        path: &Path,
        archive_limits: &ArchiveSecurityLimits,
        streaming_limits: &StreamingParserLimits,
        cancel: &ImportCancellationToken,
        _progress: Option<&dyn Fn(ImportProgressEvent)>,
        _job_id: &str,
    ) -> Result<ParsedImportOutput, ImportError> {
        cancel.check()?;
        let is_zip = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("zip"));

        let mut batch = NormalizedIngestionBatch::default();
        let now = chrono::Utc::now().timestamp_millis();

        if is_zip {
            let mut archive = SafeZipArchive::open(path, *archive_limits)?;
            let indices: Vec<usize> = archive
                .entries()
                .iter()
                .filter(|e| {
                    !e.is_dir && {
                        let l = e.normalized_path.to_ascii_lowercase();
                        l.contains("nightly_recovery") && l.ends_with(".json")
                    }
                })
                .map(|e| e.index)
                .collect();

            for idx in indices {
                cancel.check()?;
                let bytes = archive.read_entry_bytes(
                    idx,
                    streaming_limits.max_json_bytes.min(usize::MAX as u64) as usize,
                    cancel,
                )?;
                let val: Value = serde_json::from_slice(&bytes).map_err(|e| {
                    ImportError::InvalidInput(format!("Invalid Polar nightly_recovery JSON: {e}"))
                })?;
                parse_polar_recovery_value(&val, now, &mut batch);
            }
        } else {
            let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
            let val: Value = serde_json::from_reader(BufReader::new(file)).map_err(|e| {
                ImportError::InvalidInput(format!("Invalid Polar nightly_recovery JSON: {e}"))
            })?;
            parse_polar_recovery_value(&val, now, &mut batch);
        }

        batch.warnings.push(
            "Polar account exports include Nightly Recharge recovery & HRV but omit sleep session timelines. Sync Polar Flow through Apple Health or Android Health Connect for sleep durations and stages.".to_string(),
        );

        Ok(ParsedImportOutput {
            provider_id: HealthProviderId::Polar,
            export_format: if is_zip {
                "polar_zip".to_string()
            } else {
                "polar_nightly_recovery_json".to_string()
            },
            format_version: Some("1.0".to_string()),
            batch,
            invalid_records: 0,
            missing_fields: vec!["sleep_sessions".to_string()],
            unsupported_fields: Vec::new(),
            timezone_assumptions: Vec::new(),
            row_errors: Vec::new(),
        })
    }
}

fn parse_polar_recovery_value(val: &Value, now_ms: i64, batch: &mut NormalizedIngestionBatch) {
    let items: Vec<&Value> = if let Some(arr) = val.as_array() {
        arr.iter().collect()
    } else if val.is_object() {
        vec![val]
    } else {
        return;
    };

    for item in items {
        let Some(night) = item.get("night").and_then(|v| v.as_str()) else {
            continue;
        };
        let ts = parse_timestamp_with_offset(&format!("{night}T07:00:00Z"))
            .map(|(ms, _)| ms)
            .unwrap_or(now_ms);

        if let Some(rmssd) = item
            .get("meanNightlyRecoveryRmssd")
            .and_then(|v| v.as_f64())
            .filter(|v| v.is_finite() && *v > 0.0)
        {
            let ext = format!("polar_hrv_{night}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{ext}"),
                provider_id: HealthProviderId::Polar,
                device_id: None,
                external_record_id: ext,
                metric_type: PhysiologicalMetricType::Hrv,
                value: rmssd,
                unit: "ms".to_string(),
                hrv_method: HrvMethod::Rmssd,
                measured_at_ms: ts,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: None,
                aggregation_method: Some("nightly_recovery_mean".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms: now_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
            });
        }

        if let Some(resp_ms) = item
            .get("meanNightlyRecoveryRespirationInterval")
            .and_then(|v| v.as_f64())
            .filter(|v| v.is_finite() && *v > 0.0)
        {
            let brpm = 60_000.0 / resp_ms;
            let ext = format!("polar_resp_{night}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{ext}"),
                provider_id: HealthProviderId::Polar,
                device_id: None,
                external_record_id: ext,
                metric_type: PhysiologicalMetricType::RespiratoryRate,
                value: brpm,
                unit: "brpm".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: ts,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: None,
                aggregation_method: Some("nightly_recovery_mean".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms: now_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
            });
        }

        if let Some(rec_ind) = item.get("recoveryIndicator").and_then(|v| v.as_f64()) {
            let ext = format!("polar_nightly_recharge_{night}");
            batch.recovery_observations.push(RecoveryObservation {
                id: format!("rec_{ext}"),
                provider_id: HealthProviderId::Polar,
                external_record_id: ext,
                score_name: "Polar Nightly Recharge".to_string(),
                score_value: Some(rec_ind),
                scale_min: 1.0,
                scale_max: 6.0,
                score_state: "SCORED".to_string(),
                algorithm_id: Some("polar_nightly_recharge".to_string()),
                represented_date: night.to_string(),
                measured_at_ms: ts,
                underlying_metrics_json: None,
                acquisition_at_ms: now_ms,
                is_synthetic: false,
            });
        }
    }
}
