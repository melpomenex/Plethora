//! Withings consumer export adapter (`sleep.csv` / ZIP).

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::health::models::{
    HealthDataCategory, HealthProviderId, HrvMethod, PhysiologicalMetricType,
    PhysiologicalObservation, RawSleepSession, SleepKind, SleepQualityFlag,
};
use crate::health::provider::NormalizedIngestionBatch;
use crate::health::time::parse_timestamp_with_offset;

use super::archive::SafeZipArchive;
use super::csv_reader::CsvStreamReader;
use super::detector::ImportInspection;
use super::limits::{ArchiveSecurityLimits, StreamingParserLimits};
use super::registry::WearableImportAdapter;
use super::types::{
    DetectionCandidate, DetectionConfidence, ImportAdapterDescriptor, ImportCancellationToken,
    ImportCapabilities, ImportError, ImportProgressEvent, ParsedImportOutput, VerificationStatus,
};

pub struct WithingsExportAdapter;

impl WearableImportAdapter for WithingsExportAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "withings_consumer_export".to_string(),
            provider_id: HealthProviderId::Withings,
            display_name: "Withings".to_string(),
            format_id: "withings_sleep_csv".to_string(),
            format_label: "Withings Health Data Export (ZIP / sleep.csv)".to_string(),
            format_version: "1.0".to_string(),
            verification_status: VerificationStatus::ImplementedFixtureTested,
            capabilities: ImportCapabilities {
                supports_archive: true,
                supports_standalone: true,
                supports_detailed_stages: false,
                supports_stage_totals_only: true,
                supports_timezone: true,
                supported_extensions: vec!["zip".to_string(), "csv".to_string()],
                supported_categories: vec![HealthDataCategory::Sleep, HealthDataCategory::HeartRate],
                known_limitations: vec![
                    "Withings sleep.csv provides aggregate stage durations without per-epoch hypnogram intervals.".to_string(),
                ],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip {
            let has_withings = inspection.zip_samples.iter().any(|(path, sample)| {
                path.to_ascii_lowercase().ends_with("sleep.csv")
                    && sample.contains("light (s)")
                    && sample.contains("deep (s)")
            });
            if has_withings {
                return Some(DetectionCandidate {
                    provider_id: HealthProviderId::Withings,
                    adapter_id: "withings_consumer_export".to_string(),
                    format_id: "withings_zip".to_string(),
                    format_label: "Withings Health Data Export (.zip)".to_string(),
                    confidence: DetectionConfidence::Confident,
                    score: 97,
                    reasons: vec!["Archive contains Withings sleep.csv (light (s), deep (s))".to_string()],
                });
            }
            return None;
        }

        let headers_lower: Vec<String> = inspection
            .csv_headers
            .iter()
            .map(|h| h.trim().to_ascii_lowercase())
            .collect();
        if headers_lower.iter().any(|h| h == "from")
            && headers_lower.iter().any(|h| h == "to")
            && headers_lower.iter().any(|h| h == "light (s)" || h == "deep (s)")
        {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::Withings,
                adapter_id: "withings_consumer_export".to_string(),
                format_id: "withings_sleep_csv".to_string(),
                format_label: "Withings sleep.csv".to_string(),
                confidence: DetectionConfidence::Confident,
                score: 96,
                reasons: vec!["CSV headers match Withings sleep.csv".to_string()],
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
        let mut invalid_records = 0usize;
        let now = chrono::Utc::now().timestamp_millis();

        if is_zip {
            let mut archive = SafeZipArchive::open(path, *archive_limits)?;
            let idx = archive
                .entries()
                .iter()
                .find(|e| !e.is_dir && e.normalized_path.to_ascii_lowercase().ends_with("sleep.csv"))
                .map(|e| e.index)
                .ok_or_else(|| {
                    ImportError::UnsupportedFormat("Withings archive missing sleep.csv".into())
                })?;
            archive.stream_entry(idx, cancel, |r| {
                parse_withings_sleep_csv(r, streaming_limits, cancel, now, &mut batch, &mut invalid_records)
            })?;
        } else {
            let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
            parse_withings_sleep_csv(file, streaming_limits, cancel, now, &mut batch, &mut invalid_records)?;
        }

        Ok(ParsedImportOutput {
            provider_id: HealthProviderId::Withings,
            export_format: if is_zip {
                "withings_zip".to_string()
            } else {
                "withings_sleep_csv".to_string()
            },
            format_version: Some("1.0".to_string()),
            batch,
            invalid_records,
            missing_fields: Vec::new(),
            unsupported_fields: Vec::new(),
            timezone_assumptions: Vec::new(),
            row_errors: Vec::new(),
        })
    }
}

fn parse_withings_sleep_csv<R: Read>(
    reader: R,
    limits: &StreamingParserLimits,
    cancel: &ImportCancellationToken,
    now_ms: i64,
    batch: &mut NormalizedIngestionBatch,
    invalid_records: &mut usize,
) -> Result<(), ImportError> {
    let mut csv = CsvStreamReader::new(reader, ',', *limits);
    let Some(headers) = csv.next_row()? else {
        return Err(ImportError::InvalidInput("Withings sleep.csv is empty".into()));
    };
    let col: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim().to_ascii_lowercase(), i))
        .collect();
    let from_idx = *col
        .get("from")
        .ok_or_else(|| ImportError::InvalidInput("Withings CSV missing 'from'".into()))?;
    let to_idx = *col
        .get("to")
        .ok_or_else(|| ImportError::InvalidInput("Withings CSV missing 'to'".into()))?;

    while let Some(row) = csv.next_row()? {
        cancel.check()?;
        let get = |name: &str| -> Option<&str> {
            col.get(name).and_then(|&i| row.get(i)).map(|s| s.trim())
        };
        let Ok((start_ms, s_off)) = parse_timestamp_with_offset(row.get(from_idx).map(|s| s.as_str()).unwrap_or("")) else {
            *invalid_records += 1;
            continue;
        };
        let Ok((end_ms, e_off)) = parse_timestamp_with_offset(row.get(to_idx).map(|s| s.as_str()).unwrap_or("")) else {
            *invalid_records += 1;
            continue;
        };
        if end_ms <= start_ms {
            *invalid_records += 1;
            continue;
        }

        let light_mins = get("light (s)").and_then(|v| v.parse::<f64>().ok()).map(|s| s / 60.0);
        let deep_mins = get("deep (s)").and_then(|v| v.parse::<f64>().ok()).map(|s| s / 60.0);
        let rem_mins = get("rem (s)").and_then(|v| v.parse::<f64>().ok()).map(|s| s / 60.0);
        let awake_mins = get("awake (s)").and_then(|v| v.parse::<f64>().ok()).map(|s| s / 60.0);
        let span_mins = (end_ms - start_ms) as f64 / 60_000.0;
        let asleep_sum = light_mins.unwrap_or(0.0) + deep_mins.unwrap_or(0.0) + rem_mins.unwrap_or(0.0);
        let duration_mins = if asleep_sum > 0.0 { asleep_sum } else { span_mins };

        let ext_id = format!("withings_sleep_{start_ms}_{end_ms}");
        let mut flags = Vec::new();
        if asleep_sum > 0.0 {
            flags.push(SleepQualityFlag::AggregateStageDurationsOnly);
        } else {
            flags.push(SleepQualityFlag::MissingStages);
        }

        batch.sleep_sessions.push(RawSleepSession {
            id: format!("imp_{ext_id}"),
            provider_id: HealthProviderId::Withings,
            device_id: None,
            external_record_id: ext_id,
            source_app_bundle: Some("Withings".to_string()),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: s_off,
            end_tz_offset_secs: e_off.or(s_off),
            duration_mins,
            time_in_bed_mins: Some(span_mins),
            sleep_efficiency_pct: Some(((duration_mins / span_mins) * 100.0).clamp(0.0, 100.0)),
            awake_mins,
            light_mins,
            deep_mins,
            rem_mins,
            sleep_kind: if duration_mins < 180.0 { SleepKind::Nap } else { SleepKind::MainSleep },
            provider_sleep_kind: None,
            quality_flags: flags,
            quality_score: 0.88,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms: now_ms,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: false,
            stages: Vec::new(),
        });

        if let Some(hr) = get("average heart rate")
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v > 0.0)
        {
            let p_ext = format!("withings_hr_{end_ms}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{p_ext}"),
                provider_id: HealthProviderId::Withings,
                device_id: None,
                external_record_id: p_ext,
                metric_type: PhysiologicalMetricType::HeartRate,
                value: hr,
                unit: "bpm".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: end_ms,
                period_start_ms: Some(start_ms),
                period_end_ms: Some(end_ms),
                tz_offset_secs: e_off.or(s_off),
                aggregation_method: Some("sleep_mean".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms: now_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
            });
        }
    }
    Ok(())
}
