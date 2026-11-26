//! Garmin Account Data Management export adapter (`DI_CONNECT/DI-Connect-Wellness/*_sleepData.json`).

use serde_json::Value;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use crate::health::models::{
    HealthDataCategory, HealthProviderId, HrvMethod, PhysiologicalMetricType,
    PhysiologicalObservation, RawSleepSession, RecoveryObservation, SleepKind, SleepQualityFlag,
    SleepStageInterval, SleepStageType,
};
use crate::health::provider::NormalizedIngestionBatch;
use crate::health::reconciliation::normalize_stage_intervals;
use crate::health::time::parse_timestamp_with_offset;

use super::archive::SafeZipArchive;
use super::detector::ImportInspection;
use super::limits::{ArchiveSecurityLimits, StreamingParserLimits};
use super::registry::WearableImportAdapter;
use super::types::{
    DetectionCandidate, DetectionConfidence, ImportAdapterDescriptor, ImportCancellationToken,
    ImportCapabilities, ImportError, ImportProgressEvent, ParsedImportOutput, VerificationStatus,
};

pub struct GarminExportAdapter;

impl WearableImportAdapter for GarminExportAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "garmin_account_export".to_string(),
            provider_id: HealthProviderId::Garmin,
            display_name: "Garmin".to_string(),
            format_id: "garmin_connect_export".to_string(),
            format_label: "Garmin Account Data Export (ZIP / sleepData.json)".to_string(),
            format_version: "1.0".to_string(),
            verification_status: VerificationStatus::ImplementedFixtureTested,
            capabilities: ImportCapabilities {
                supports_archive: true,
                supports_standalone: true,
                supports_detailed_stages: true,
                supports_stage_totals_only: true,
                supports_timezone: true,
                supported_extensions: vec!["zip".to_string(), "json".to_string()],
                supported_categories: vec![
                    HealthDataCategory::Sleep,
                    HealthDataCategory::SleepStages,
                    HealthDataCategory::RestingHeartRate,
                    HealthDataCategory::Hrv,
                    HealthDataCategory::RespiratoryRate,
                    HealthDataCategory::Recovery,
                ],
                known_limitations: vec![
                    "Workout .fit files do not contain sleep data; export your full Garmin account archive.".to_string(),
                ],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip {
            let has_garmin_dir = inspection.zip_paths.iter().any(|p| {
                let l = p.to_ascii_lowercase();
                (l.contains("di_connect") || l.contains("di-connect-wellness"))
                    && l.contains("sleepdata")
                    && l.ends_with(".json")
            });
            if has_garmin_dir {
                return Some(DetectionCandidate {
                    provider_id: HealthProviderId::Garmin,
                    adapter_id: "garmin_account_export".to_string(),
                    format_id: "garmin_connect_zip".to_string(),
                    format_label: "Garmin Connect Account Export (.zip)".to_string(),
                    confidence: DetectionConfidence::Confident,
                    score: 98,
                    reasons: vec!["Archive contains DI_CONNECT/DI-Connect-Wellness sleepData JSON".to_string()],
                });
            }
            return None;
        }

        if inspection.extension == "json"
            && (inspection.text_sample.contains("\"sleepStartTimestampGMT\"")
                || inspection.text_sample.contains("\"sleepLevelsMap\"")
                || inspection.text_sample.contains("\"deepSleepSeconds\""))
        {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::Garmin,
                adapter_id: "garmin_account_export".to_string(),
                format_id: "garmin_sleep_json".to_string(),
                format_label: "Garmin sleepData.json".to_string(),
                confidence: DetectionConfidence::Confident,
                score: 95,
                reasons: vec!["JSON contains Garmin sleepData keys (sleepStartTimestampGMT / deepSleepSeconds)".to_string()],
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
        progress: Option<&dyn Fn(ImportProgressEvent)>,
        job_id: &str,
    ) -> Result<ParsedImportOutput, ImportError> {
        cancel.check()?;
        let is_zip = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("zip"));

        let mut batch = NormalizedIngestionBatch::default();
        let mut invalid_records = 0usize;
        let mut row_errors = Vec::new();
        let now = chrono::Utc::now().timestamp_millis();

        if is_zip {
            let mut archive = SafeZipArchive::open(path, *archive_limits)?;
            let sleep_indices: Vec<usize> = archive
                .entries()
                .iter()
                .filter(|e| {
                    !e.is_dir && {
                        let l = e.normalized_path.to_ascii_lowercase();
                        l.contains("sleepdata") && l.ends_with(".json")
                    }
                })
                .map(|e| e.index)
                .collect();

            if sleep_indices.is_empty() {
                return Err(ImportError::UnsupportedFormat(
                    "No Garmin sleepData JSON files were found in this archive.".to_string(),
                ));
            }

            let total = sleep_indices.len();
            for (pos, idx) in sleep_indices.into_iter().enumerate() {
                cancel.check()?;
                if let Some(cb) = progress {
                    cb(ImportProgressEvent {
                        job_id: job_id.to_string(),
                        phase: "parsing".to_string(),
                        processed: pos + 1,
                        total: Some(total),
                        message: format!("Parsing Garmin sleep file {} of {total}...", pos + 1),
                    });
                }
                let bytes = archive.read_entry_bytes(
                    idx,
                    streaming_limits.max_json_bytes.min(usize::MAX as u64) as usize,
                    cancel,
                )?;
                let val: Value = serde_json::from_slice(&bytes).map_err(|e| {
                    ImportError::InvalidInput(format!("Invalid Garmin sleep JSON: {e}"))
                })?;
                parse_garmin_sleep_value(&val, now, &mut batch, &mut invalid_records, &mut row_errors);
            }

            return Ok(ParsedImportOutput {
                provider_id: HealthProviderId::Garmin,
                export_format: "garmin_connect_zip".to_string(),
                format_version: Some("1.0".to_string()),
                batch,
                invalid_records,
                missing_fields: Vec::new(),
                unsupported_fields: Vec::new(),
                timezone_assumptions: Vec::new(),
                row_errors,
            });
        }

        let meta = std::fs::metadata(path).map_err(|e| ImportError::Io(e.to_string()))?;
        if meta.len() > streaming_limits.max_json_bytes {
            return Err(ImportError::SecurityViolation(format!(
                "Garmin JSON exceeds {} byte limit",
                streaming_limits.max_json_bytes
            )));
        }
        let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
        let val: Value = serde_json::from_reader(BufReader::new(file))
            .map_err(|e| ImportError::InvalidInput(format!("Invalid Garmin sleep JSON: {e}")))?;
        parse_garmin_sleep_value(&val, now, &mut batch, &mut invalid_records, &mut row_errors);

        Ok(ParsedImportOutput {
            provider_id: HealthProviderId::Garmin,
            export_format: "garmin_sleep_json".to_string(),
            format_version: Some("1.0".to_string()),
            batch,
            invalid_records,
            missing_fields: Vec::new(),
            unsupported_fields: Vec::new(),
            timezone_assumptions: Vec::new(),
            row_errors,
        })
    }
}

fn parse_garmin_sleep_value(
    val: &Value,
    now_ms: i64,
    batch: &mut NormalizedIngestionBatch,
    invalid_records: &mut usize,
    row_errors: &mut Vec<String>,
) {
    let Some(items) = val.as_array() else {
        *invalid_records += 1;
        row_errors.push("Expected JSON array in Garmin sleepData file".to_string());
        return;
    };

    for (idx, item) in items.iter().enumerate() {
        let Some(start_ms) = parse_garmin_ts(item.get("sleepStartTimestampGMT")) else {
            *invalid_records += 1;
            if row_errors.len() < 25 {
                row_errors.push(format!("Record {}: missing sleepStartTimestampGMT", idx + 1));
            }
            continue;
        };
        let Some(end_ms) = parse_garmin_ts(item.get("sleepEndTimestampGMT")) else {
            *invalid_records += 1;
            continue;
        };
        if end_ms <= start_ms {
            *invalid_records += 1;
            continue;
        }

        let tz_off = item
            .get("timeOffset")
            .and_then(|v| v.as_i64())
            .and_then(|s| i32::try_from(s).ok())
            .filter(|s| (-64_800..=64_800).contains(s));

        let deep_mins = item
            .get("deepSleepSeconds")
            .and_then(|v| v.as_f64())
            .map(|s| s / 60.0);
        let light_mins = item
            .get("lightSleepSeconds")
            .and_then(|v| v.as_f64())
            .map(|s| s / 60.0);
        let rem_mins = item
            .get("remSleepSeconds")
            .and_then(|v| v.as_f64())
            .map(|s| s / 60.0);
        let awake_mins = item
            .get("awakeSleepSeconds")
            .and_then(|v| v.as_f64())
            .map(|s| s / 60.0);

        let span_mins = (end_ms - start_ms) as f64 / 60_000.0;
        let duration_mins = item
            .get("sleepTimeSeconds")
            .and_then(|v| v.as_f64())
            .map(|s| s / 60.0)
            .filter(|m| *m > 0.0)
            .unwrap_or_else(|| {
                let stage_sum =
                    light_mins.unwrap_or(0.0) + deep_mins.unwrap_or(0.0) + rem_mins.unwrap_or(0.0);
                if stage_sum > 0.0 {
                    stage_sum
                } else {
                    span_mins
                }
            });

        let ext_id = format!("garmin_sleep_{start_ms}_{end_ms}");
        let raw_id = format!("imp_{ext_id}");

        let mut stages = Vec::new();
        if let Some(map) = item.get("sleepLevelsMap").and_then(|v| v.as_object()) {
            for (stage_key, stage_type) in [
                ("deep", SleepStageType::Deep),
                ("light", SleepStageType::Light),
                ("rem", SleepStageType::Rem),
                ("awake", SleepStageType::Awake),
            ] {
                if let Some(arr) = map.get(stage_key).and_then(|v| v.as_array()) {
                    for seg in arr {
                        let s = parse_garmin_ts(seg.get("start").or_else(|| seg.get("startGMT")));
                        let e = parse_garmin_ts(seg.get("end").or_else(|| seg.get("endGMT")));
                        if let (Some(s_ms), Some(e_ms)) = (s, e) {
                            if e_ms > s_ms {
                                stages.push(SleepStageInterval {
                                    id: format!("{raw_id}_st_{}", stages.len()),
                                    raw_session_id: raw_id.clone(),
                                    stage_type,
                                    start_at_ms: s_ms,
                                    end_at_ms: e_ms,
                                    provider_stage_code: Some(stage_key.to_string()),
                                });
                            }
                        }
                    }
                }
            }
        }
        stages = normalize_stage_intervals(stages);

        let mut flags = Vec::new();
        if stages.is_empty()
            && (light_mins.unwrap_or(0.0) + deep_mins.unwrap_or(0.0) + rem_mins.unwrap_or(0.0))
                > 0.0
        {
            flags.push(SleepQualityFlag::AggregateStageDurationsOnly);
        }

        let is_nap = item
            .get("napTimeSeconds")
            .and_then(|v| v.as_f64())
            .is_some_and(|n| n > 0.0 && item.get("sleepTimeSeconds").and_then(|s| s.as_f64()).unwrap_or(0.0) <= 0.0);

        batch.sleep_sessions.push(RawSleepSession {
            id: raw_id,
            provider_id: HealthProviderId::Garmin,
            device_id: None,
            external_record_id: ext_id,
            source_app_bundle: Some("Garmin Connect".to_string()),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: tz_off,
            end_tz_offset_secs: tz_off,
            duration_mins,
            time_in_bed_mins: Some(span_mins),
            sleep_efficiency_pct: Some(((duration_mins / span_mins) * 100.0).clamp(0.0, 100.0)),
            awake_mins,
            light_mins,
            deep_mins,
            rem_mins,
            sleep_kind: if is_nap { SleepKind::Nap } else { SleepKind::MainSleep },
            provider_sleep_kind: Some("garmin_sleep".to_string()),
            quality_flags: flags,
            quality_score: 0.9,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms: now_ms,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: false,
            stages,
        });

        let cal_date = item
            .get("calendarDate")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
            .unwrap_or_else(|| crate::health::time::local_date_string(end_ms, tz_off));

        if let Some(score_val) = item
            .get("sleepScores")
            .and_then(|s| s.get("overall"))
            .and_then(|o| o.get("value"))
            .and_then(|v| v.as_f64())
        {
            let rec_ext = format!("garmin_sleep_score_{cal_date}");
            batch.recovery_observations.push(RecoveryObservation {
                id: format!("rec_{rec_ext}"),
                provider_id: HealthProviderId::Garmin,
                external_record_id: rec_ext,
                score_name: "Garmin Sleep Score".to_string(),
                score_value: Some(score_val),
                scale_min: 0.0,
                scale_max: 100.0,
                score_state: "SCORED".to_string(),
                algorithm_id: Some("garmin_sleep_score_v1".to_string()),
                represented_date: cal_date.clone(),
                measured_at_ms: end_ms,
                underlying_metrics_json: None,
                acquisition_at_ms: now_ms,
                is_synthetic: false,
            });
        }

        if let Some(resp) = item.get("averageRespirationValue").and_then(|v| v.as_f64()) {
            if resp.is_finite() && resp > 0.0 {
                let p_ext = format!("garmin_resp_{end_ms}");
                batch.physio_observations.push(PhysiologicalObservation {
                    id: format!("obs_{p_ext}"),
                    provider_id: HealthProviderId::Garmin,
                    device_id: None,
                    external_record_id: p_ext,
                    metric_type: PhysiologicalMetricType::RespiratoryRate,
                    value: resp,
                    unit: "brpm".to_string(),
                    hrv_method: HrvMethod::Unknown,
                    measured_at_ms: end_ms,
                    period_start_ms: Some(start_ms),
                    period_end_ms: Some(end_ms),
                    tz_offset_secs: tz_off,
                    aggregation_method: Some("sleep_mean".to_string()),
                    quality_flags: Vec::new(),
                    acquisition_at_ms: now_ms,
                    sync_batch_id: None,
                    is_deleted: false,
                    is_synthetic: false,
                });
            }
        }

        if let Some(spo2) = item.get("averageSpO2Value").and_then(|v| v.as_f64()) {
            if spo2.is_finite() && spo2 > 0.0 {
                let p_ext = format!("garmin_spo2_{end_ms}");
                batch.physio_observations.push(PhysiologicalObservation {
                    id: format!("obs_{p_ext}"),
                    provider_id: HealthProviderId::Garmin,
                    device_id: None,
                    external_record_id: p_ext,
                    metric_type: PhysiologicalMetricType::Spo2,
                    value: spo2,
                    unit: "%".to_string(),
                    hrv_method: HrvMethod::Unknown,
                    measured_at_ms: end_ms,
                    period_start_ms: Some(start_ms),
                    period_end_ms: Some(end_ms),
                    tz_offset_secs: tz_off,
                    aggregation_method: Some("sleep_mean".to_string()),
                    quality_flags: Vec::new(),
                    acquisition_at_ms: now_ms,
                    sync_batch_id: None,
                    is_deleted: false,
                    is_synthetic: false,
                });
            }
        }

        if let Some(rhr) = item.get("restingHeartRate").and_then(|v| v.as_f64()) {
            if rhr.is_finite() && rhr > 0.0 {
                let p_ext = format!("garmin_rhr_{end_ms}");
                batch.physio_observations.push(PhysiologicalObservation {
                    id: format!("obs_{p_ext}"),
                    provider_id: HealthProviderId::Garmin,
                    device_id: None,
                    external_record_id: p_ext,
                    metric_type: PhysiologicalMetricType::RestingHeartRate,
                    value: rhr,
                    unit: "bpm".to_string(),
                    hrv_method: HrvMethod::Unknown,
                    measured_at_ms: end_ms,
                    period_start_ms: Some(start_ms),
                    period_end_ms: Some(end_ms),
                    tz_offset_secs: tz_off,
                    aggregation_method: Some("overnight".to_string()),
                    quality_flags: Vec::new(),
                    acquisition_at_ms: now_ms,
                    sync_batch_id: None,
                    is_deleted: false,
                    is_synthetic: false,
                });
            }
        }

        if let Some(hrv) = item.get("avgOvernightHrv").and_then(|v| v.as_f64()) {
            if hrv.is_finite() && hrv > 0.0 {
                let p_ext = format!("garmin_hrv_{end_ms}");
                batch.physio_observations.push(PhysiologicalObservation {
                    id: format!("obs_{p_ext}"),
                    provider_id: HealthProviderId::Garmin,
                    device_id: None,
                    external_record_id: p_ext,
                    metric_type: PhysiologicalMetricType::Hrv,
                    value: hrv,
                    unit: "ms".to_string(),
                    hrv_method: HrvMethod::Rmssd,
                    measured_at_ms: end_ms,
                    period_start_ms: Some(start_ms),
                    period_end_ms: Some(end_ms),
                    tz_offset_secs: tz_off,
                    aggregation_method: Some("overnight_mean".to_string()),
                    quality_flags: Vec::new(),
                    acquisition_at_ms: now_ms,
                    sync_batch_id: None,
                    is_deleted: false,
                    is_synthetic: false,
                });
            }
        }
    }
}

fn parse_garmin_ts(val: Option<&Value>) -> Option<i64> {
    let v = val?;
    if let Some(num) = v.as_i64() {
        // Distinguish seconds (< 1e11) vs milliseconds (>= 1e11)
        if num > 0 && num < 100_000_000_000 {
            return Some(num * 1000);
        }
        return Some(num);
    }
    if let Some(s) = v.as_str() {
        return parse_timestamp_with_offset(s).ok().map(|(ms, _)| ms);
    }
    None
}
