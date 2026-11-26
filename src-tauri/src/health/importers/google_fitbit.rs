//! Google Takeout / Fitbit consumer export adapter (`sleep-*.json`, `sleep_score.csv`, HRV CSVs).

use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
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
use super::csv_reader::CsvStreamReader;
use super::detector::ImportInspection;
use super::limits::{ArchiveSecurityLimits, StreamingParserLimits};
use super::registry::WearableImportAdapter;
use super::types::{
    DetectionCandidate, DetectionConfidence, ImportAdapterDescriptor, ImportCancellationToken,
    ImportCapabilities, ImportError, ImportProgressEvent, ParsedImportOutput, VerificationStatus,
};

pub struct GoogleFitbitExportAdapter;

impl WearableImportAdapter for GoogleFitbitExportAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "google_fitbit_takeout".to_string(),
            provider_id: HealthProviderId::GoogleHealth,
            display_name: "Google Health / Fitbit".to_string(),
            format_id: "fitbit_takeout".to_string(),
            format_label: "Google Takeout Fitbit Export (ZIP / sleep-*.json)".to_string(),
            format_version: "1.0".to_string(),
            verification_status: VerificationStatus::ImplementedFixtureTested,
            capabilities: ImportCapabilities {
                supports_archive: true,
                supports_standalone: true,
                supports_detailed_stages: true,
                supports_stage_totals_only: true,
                supports_timezone: false,
                supported_extensions: vec!["zip".to_string(), "json".to_string()],
                supported_categories: vec![
                    HealthDataCategory::Sleep,
                    HealthDataCategory::SleepStages,
                    HealthDataCategory::Hrv,
                    HealthDataCategory::Recovery,
                ],
                known_limitations: vec![
                    "Fitbit Takeout sleep JSON timestamps often omit UTC offsets; Plethora flags this assumption during preview.".to_string(),
                ],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip {
            let has_fitbit = inspection.zip_paths.iter().any(|p| {
                let l = p.to_ascii_lowercase();
                (l.contains("fitbit/") && l.contains("sleep-") && l.ends_with(".json"))
                    || (l.contains("fitbit/") && l.ends_with("sleep_score.csv"))
            });
            if has_fitbit {
                return Some(DetectionCandidate {
                    provider_id: HealthProviderId::GoogleHealth,
                    adapter_id: "google_fitbit_takeout".to_string(),
                    format_id: "fitbit_takeout_zip".to_string(),
                    format_label: "Google Takeout Fitbit Archive (.zip)".to_string(),
                    confidence: DetectionConfidence::Confident,
                    score: 98,
                    reasons: vec!["Archive contains Takeout Fitbit sleep-*.json / sleep_score.csv".to_string()],
                });
            }
            return None;
        }

        if inspection.extension == "json"
            && inspection.text_sample.contains("\"dateOfSleep\"")
            && (inspection.text_sample.contains("\"logId\"")
                || inspection.text_sample.contains("\"isMainSleep\""))
        {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::GoogleHealth,
                adapter_id: "google_fitbit_takeout".to_string(),
                format_id: "fitbit_sleep_json".to_string(),
                format_label: "Fitbit sleep-*.json".to_string(),
                confidence: DetectionConfidence::Confident,
                score: 96,
                reasons: vec!["JSON contains Fitbit sleep keys (dateOfSleep / logId / isMainSleep)".to_string()],
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
        let mut tz_assumptions = Vec::new();
        let now = chrono::Utc::now().timestamp_millis();

        if is_zip {
            let mut archive = SafeZipArchive::open(path, *archive_limits)?;
            let sleep_indices: Vec<usize> = archive
                .entries()
                .iter()
                .filter(|e| {
                    !e.is_dir && {
                        let l = e.normalized_path.to_ascii_lowercase();
                        let fname = l.rsplit('/').next().unwrap_or("");
                        fname.starts_with("sleep-") && fname.ends_with(".json")
                    }
                })
                .map(|e| e.index)
                .collect();

            let score_idx = archive
                .entries()
                .iter()
                .find(|e| !e.is_dir && e.normalized_path.to_ascii_lowercase().ends_with("sleep_score.csv"))
                .map(|e| e.index);

            let hrv_indices: Vec<usize> = archive
                .entries()
                .iter()
                .filter(|e| {
                    !e.is_dir && {
                        let l = e.normalized_path.to_ascii_lowercase();
                        l.contains("daily heart rate variability summary") && l.ends_with(".csv")
                    }
                })
                .map(|e| e.index)
                .collect();

            if sleep_indices.is_empty() && score_idx.is_none() && hrv_indices.is_empty() {
                return Err(ImportError::UnsupportedFormat(
                    "No Fitbit sleep-*.json or HRV summary files found in archive.".into(),
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
                        message: format!("Parsing Fitbit sleep file {} of {total}...", pos + 1),
                    });
                }
                let bytes = archive.read_entry_bytes(
                    idx,
                    streaming_limits.max_json_bytes.min(usize::MAX as u64) as usize,
                    cancel,
                )?;
                let val: Value = serde_json::from_slice(&bytes).map_err(|e| {
                    ImportError::InvalidInput(format!("Invalid Fitbit sleep JSON: {e}"))
                })?;
                parse_fitbit_sleep_json(
                    &val,
                    now,
                    &mut batch,
                    &mut invalid_records,
                    &mut row_errors,
                    &mut tz_assumptions,
                );
            }

            if let Some(idx) = score_idx {
                archive.stream_entry(idx, cancel, |r| {
                    parse_fitbit_score_csv(r, streaming_limits, cancel, now, &mut batch)
                })?;
            }

            for idx in hrv_indices {
                archive.stream_entry(idx, cancel, |r| {
                    parse_fitbit_hrv_csv(r, streaming_limits, cancel, now, &mut batch)
                })?;
            }

            return Ok(ParsedImportOutput {
                provider_id: HealthProviderId::GoogleHealth,
                export_format: "fitbit_takeout_zip".to_string(),
                format_version: Some("1.0".to_string()),
                batch,
                invalid_records,
                missing_fields: Vec::new(),
                unsupported_fields: Vec::new(),
                timezone_assumptions: tz_assumptions,
                row_errors,
            });
        }

        let meta = std::fs::metadata(path).map_err(|e| ImportError::Io(e.to_string()))?;
        if meta.len() > streaming_limits.max_json_bytes {
            return Err(ImportError::SecurityViolation(format!(
                "Fitbit JSON exceeds {} byte limit",
                streaming_limits.max_json_bytes
            )));
        }
        let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
        let val: Value = serde_json::from_reader(BufReader::new(file))
            .map_err(|e| ImportError::InvalidInput(format!("Invalid Fitbit sleep JSON: {e}")))?;
        parse_fitbit_sleep_json(
            &val,
            now,
            &mut batch,
            &mut invalid_records,
            &mut row_errors,
            &mut tz_assumptions,
        );

        Ok(ParsedImportOutput {
            provider_id: HealthProviderId::GoogleHealth,
            export_format: "fitbit_sleep_json".to_string(),
            format_version: Some("1.0".to_string()),
            batch,
            invalid_records,
            missing_fields: Vec::new(),
            unsupported_fields: Vec::new(),
            timezone_assumptions: tz_assumptions,
            row_errors,
        })
    }
}

fn parse_fitbit_sleep_json(
    val: &Value,
    now_ms: i64,
    batch: &mut NormalizedIngestionBatch,
    invalid_records: &mut usize,
    row_errors: &mut Vec<String>,
    tz_assumptions: &mut Vec<String>,
) {
    let Some(items) = val.as_array() else {
        *invalid_records += 1;
        row_errors.push("Expected JSON array in Fitbit sleep file".to_string());
        return;
    };

    let mut noted_missing_offset = false;
    for item in items {
        let Some(start_str) = item.get("startTime").and_then(|v| v.as_str()) else {
            *invalid_records += 1;
            continue;
        };
        let Some(end_str) = item.get("endTime").and_then(|v| v.as_str()) else {
            *invalid_records += 1;
            continue;
        };
        let Ok((start_ms, start_off)) = parse_timestamp_with_offset(start_str) else {
            *invalid_records += 1;
            continue;
        };
        let Ok((end_ms, end_off)) = parse_timestamp_with_offset(end_str) else {
            *invalid_records += 1;
            continue;
        };
        if end_ms <= start_ms {
            *invalid_records += 1;
            continue;
        }
        if start_off.is_none() && !noted_missing_offset {
            noted_missing_offset = true;
            let msg = "Fitbit Takeout sleep JSON timestamps do not include UTC offsets; local wall-clock times were anchored as exported.".to_string();
            if !tz_assumptions.contains(&msg) {
                tz_assumptions.push(msg);
            }
        }

        let span_mins = (end_ms - start_ms) as f64 / 60_000.0;
        let minutes_asleep = item
            .get("minutesAsleep")
            .and_then(|v| v.as_f64())
            .filter(|m| *m > 0.0)
            .unwrap_or(span_mins);
        let time_in_bed = item.get("timeInBed").and_then(|v| v.as_f64()).or(Some(span_mins));
        let eff = item.get("efficiency").and_then(|v| v.as_f64());
        let is_main = item
            .get("isMainSleep")
            .and_then(|v| v.as_bool())
            .unwrap_or(minutes_asleep >= 180.0);

        let log_id = item
            .get("logId")
            .and_then(|v| v.as_i64())
            .map(|id| id.to_string())
            .unwrap_or_else(|| format!("{start_ms}_{end_ms}"));
        let ext_id = format!("fitbit_sleep_{log_id}");
        let raw_id = format!("imp_{ext_id}");

        let summary = item.get("levels").and_then(|l| l.get("summary"));
        let deep_mins = summary
            .and_then(|s| s.get("deep"))
            .and_then(|d| d.get("minutes"))
            .and_then(|m| m.as_f64());
        let light_mins = summary
            .and_then(|s| s.get("light"))
            .and_then(|d| d.get("minutes"))
            .and_then(|m| m.as_f64());
        let rem_mins = summary
            .and_then(|s| s.get("rem"))
            .and_then(|d| d.get("minutes"))
            .and_then(|m| m.as_f64());
        let awake_mins = summary
            .and_then(|s| s.get("wake"))
            .and_then(|d| d.get("minutes"))
            .and_then(|m| m.as_f64())
            .or_else(|| item.get("minutesAwake").and_then(|v| v.as_f64()));

        let mut stages = Vec::new();
        if let Some(data) = item
            .get("levels")
            .and_then(|l| l.get("data"))
            .and_then(|d| d.as_array())
        {
            for seg in data {
                let Some(dt_str) = seg.get("dateTime").and_then(|v| v.as_str()) else {
                    continue;
                };
                let Some(secs) = seg.get("seconds").and_then(|v| v.as_i64()) else {
                    continue;
                };
                let Some(level) = seg.get("level").and_then(|v| v.as_str()) else {
                    continue;
                };
                if let Ok((seg_start, _)) = parse_timestamp_with_offset(dt_str) {
                    let seg_end = seg_start + secs * 1000;
                    if seg_end > seg_start {
                        let st = match level.to_ascii_lowercase().as_str() {
                            "wake" | "awake" => SleepStageType::Awake,
                            "light" | "restless" => SleepStageType::Light,
                            "deep" => SleepStageType::Deep,
                            "rem" => SleepStageType::Rem,
                            "asleep" => SleepStageType::AsleepUnknown,
                            _ => SleepStageType::Unknown,
                        };
                        stages.push(SleepStageInterval {
                            id: format!("{raw_id}_st_{}", stages.len()),
                            raw_session_id: raw_id.clone(),
                            stage_type: st,
                            start_at_ms: seg_start,
                            end_at_ms: seg_end,
                            provider_stage_code: Some(level.to_string()),
                        });
                    }
                }
            }
        }
        stages = normalize_stage_intervals(stages);

        let mut flags = Vec::new();
        if stages.is_empty()
            && (light_mins.unwrap_or(0.0) + deep_mins.unwrap_or(0.0) + rem_mins.unwrap_or(0.0)) > 0.0
        {
            flags.push(SleepQualityFlag::AggregateStageDurationsOnly);
        }

        batch.sleep_sessions.push(RawSleepSession {
            id: raw_id,
            provider_id: HealthProviderId::GoogleHealth,
            device_id: None,
            external_record_id: ext_id,
            source_app_bundle: Some("Fitbit".to_string()),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: start_off,
            end_tz_offset_secs: end_off.or(start_off),
            duration_mins: minutes_asleep,
            time_in_bed_mins: time_in_bed,
            sleep_efficiency_pct: eff,
            awake_mins,
            light_mins,
            deep_mins,
            rem_mins,
            sleep_kind: if is_main {
                SleepKind::MainSleep
            } else {
                SleepKind::Nap
            },
            provider_sleep_kind: item
                .get("type")
                .and_then(|v| v.as_str())
                .map(ToString::to_string),
            quality_flags: flags,
            quality_score: 0.92,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms: now_ms,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: false,
            stages,
        });
    }
}

fn parse_fitbit_score_csv<R: Read>(
    reader: R,
    limits: &StreamingParserLimits,
    cancel: &ImportCancellationToken,
    now_ms: i64,
    batch: &mut NormalizedIngestionBatch,
) -> Result<(), ImportError> {
    let mut csv = CsvStreamReader::new(reader, ',', *limits);
    let Some(headers) = csv.next_row()? else {
        return Ok(());
    };
    let col: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim().to_ascii_lowercase(), i))
        .collect();
    let Some(&ts_idx) = col.get("timestamp") else {
        return Ok(());
    };
    let Some(&score_idx) = col.get("overall_score") else {
        return Ok(());
    };

    while let Some(row) = csv.next_row()? {
        cancel.check()?;
        let Some(ts_str) = row.get(ts_idx).map(|s| s.trim()) else {
            continue;
        };
        let Ok((ms, off)) = parse_timestamp_with_offset(ts_str) else {
            continue;
        };
        if let Some(score) = row.get(score_idx).and_then(|s| s.trim().parse::<f64>().ok()) {
            let day = crate::health::time::local_date_string(ms, off);
            let ext = format!("fitbit_sleep_score_{day}");
            batch.recovery_observations.push(RecoveryObservation {
                id: format!("rec_{ext}"),
                provider_id: HealthProviderId::GoogleHealth,
                external_record_id: ext,
                score_name: "Fitbit Sleep Score".to_string(),
                score_value: Some(score),
                scale_min: 0.0,
                scale_max: 100.0,
                score_state: "SCORED".to_string(),
                algorithm_id: Some("fitbit_sleep_score".to_string()),
                represented_date: day,
                measured_at_ms: ms,
                underlying_metrics_json: None,
                acquisition_at_ms: now_ms,
                is_synthetic: false,
            });
        }
    }
    Ok(())
}

fn parse_fitbit_hrv_csv<R: Read>(
    reader: R,
    limits: &StreamingParserLimits,
    cancel: &ImportCancellationToken,
    now_ms: i64,
    batch: &mut NormalizedIngestionBatch,
) -> Result<(), ImportError> {
    let mut csv = CsvStreamReader::new(reader, ',', *limits);
    let Some(headers) = csv.next_row()? else {
        return Ok(());
    };
    let col: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim().to_ascii_lowercase(), i))
        .collect();
    let Some(&ts_idx) = col.get("timestamp") else {
        return Ok(());
    };
    let Some(&rmssd_idx) = col.get("rmssd") else {
        return Ok(());
    };

    while let Some(row) = csv.next_row()? {
        cancel.check()?;
        let Some(ts_str) = row.get(ts_idx).map(|s| s.trim()) else {
            continue;
        };
        let Ok((ms, off)) = parse_timestamp_with_offset(ts_str) else {
            continue;
        };
        if let Some(val) = row
            .get(rmssd_idx)
            .and_then(|s| s.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v > 0.0)
        {
            let ext = format!("fitbit_hrv_{ms}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{ext}"),
                provider_id: HealthProviderId::GoogleHealth,
                device_id: None,
                external_record_id: ext,
                metric_type: PhysiologicalMetricType::Hrv,
                value: val,
                unit: "ms".to_string(),
                hrv_method: HrvMethod::Rmssd,
                measured_at_ms: ms,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: off,
                aggregation_method: Some("overnight_rmssd".to_string()),
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
