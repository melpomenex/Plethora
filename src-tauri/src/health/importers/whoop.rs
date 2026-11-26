//! WHOOP consumer data export adapter (`sleeps.csv`, `physiological_cycles.csv`, ZIP).

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::health::models::{
    HealthDataCategory, HealthProviderId, HrvMethod, PhysiologicalMetricType,
    PhysiologicalObservation, RawSleepSession, RecoveryObservation, SleepKind, SleepQualityFlag,
};
use crate::health::provider::NormalizedIngestionBatch;
use crate::health::time::{parse_timestamp_with_offset, parse_utc_offset_secs};

use super::archive::SafeZipArchive;
use super::csv_reader::CsvStreamReader;
use super::detector::ImportInspection;
use super::limits::{ArchiveSecurityLimits, StreamingParserLimits};
use super::registry::WearableImportAdapter;
use super::types::{
    DetectionCandidate, DetectionConfidence, ImportAdapterDescriptor, ImportCancellationToken,
    ImportCapabilities, ImportError, ImportProgressEvent, ParsedImportOutput, VerificationStatus,
};

pub struct WhoopExportAdapter;

impl WearableImportAdapter for WhoopExportAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "whoop_consumer_export".to_string(),
            provider_id: HealthProviderId::Whoop,
            display_name: "WHOOP".to_string(),
            format_id: "whoop_data_export".to_string(),
            format_label: "WHOOP Data Export (ZIP / sleeps.csv / physiological_cycles.csv)".to_string(),
            format_version: "1.0".to_string(),
            verification_status: VerificationStatus::ImplementedFixtureTested,
            capabilities: ImportCapabilities {
                supports_archive: true,
                supports_standalone: true,
                supports_detailed_stages: false,
                supports_stage_totals_only: true,
                supports_timezone: true,
                supported_extensions: vec!["zip".to_string(), "csv".to_string()],
                supported_categories: vec![
                    HealthDataCategory::Sleep,
                    HealthDataCategory::RestingHeartRate,
                    HealthDataCategory::Hrv,
                    HealthDataCategory::Recovery,
                    HealthDataCategory::Temperature,
                    HealthDataCategory::RespiratoryRate,
                ],
                known_limitations: vec![
                    "WHOOP exports provide aggregate stage durations (Light, SWS, REM, Awake) without per-epoch hypnogram timestamps.".to_string(),
                ],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip {
            let has_whoop = inspection.zip_samples.iter().any(|(path, sample)| {
                let l = path.to_ascii_lowercase();
                (l.ends_with("sleeps.csv") || l.ends_with("physiological_cycles.csv"))
                    && (sample.contains("Sleep onset")
                        || sample.contains("Cycle start time")
                        || sample.contains("Recovery score %"))
            });
            if has_whoop {
                return Some(DetectionCandidate {
                    provider_id: HealthProviderId::Whoop,
                    adapter_id: "whoop_consumer_export".to_string(),
                    format_id: "whoop_zip".to_string(),
                    format_label: "WHOOP Data Export (.zip)".to_string(),
                    confidence: DetectionConfidence::Confident,
                    score: 98,
                    reasons: vec!["Archive contains WHOOP sleeps.csv / physiological_cycles.csv".to_string()],
                });
            }
            return None;
        }

        let headers_lower: Vec<String> = inspection
            .csv_headers
            .iter()
            .map(|h| h.trim().to_ascii_lowercase())
            .collect();
        if (headers_lower.iter().any(|h| h == "sleep onset")
            && headers_lower.iter().any(|h| h == "wake onset"))
            || (headers_lower.iter().any(|h| h == "cycle start time")
                && headers_lower.iter().any(|h| h == "recovery score %"))
        {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::Whoop,
                adapter_id: "whoop_consumer_export".to_string(),
                format_id: "whoop_csv".to_string(),
                format_label: "WHOOP CSV Export".to_string(),
                confidence: DetectionConfidence::Confident,
                score: 96,
                reasons: vec!["CSV headers match WHOOP sleeps.csv or physiological_cycles.csv".to_string()],
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
            let sleeps_idx = archive
                .entries()
                .iter()
                .find(|e| !e.is_dir && e.normalized_path.to_ascii_lowercase().ends_with("sleeps.csv"))
                .map(|e| e.index);
            let cycles_idx = archive
                .entries()
                .iter()
                .find(|e| {
                    !e.is_dir
                        && e.normalized_path
                            .to_ascii_lowercase()
                            .ends_with("physiological_cycles.csv")
                })
                .map(|e| e.index);

            if sleeps_idx.is_none() && cycles_idx.is_none() {
                return Err(ImportError::UnsupportedFormat(
                    "WHOOP archive does not contain sleeps.csv or physiological_cycles.csv".into(),
                ));
            }

            if let Some(idx) = sleeps_idx {
                if let Some(cb) = progress {
                    cb(ImportProgressEvent {
                        job_id: job_id.to_string(),
                        phase: "parsing".to_string(),
                        processed: 1,
                        total: Some(2),
                        message: "Parsing WHOOP sleeps.csv...".to_string(),
                    });
                }
                archive.stream_entry(idx, cancel, |r| {
                    parse_whoop_sleeps_csv(r, streaming_limits, cancel, now, &mut batch, &mut invalid_records, &mut row_errors)
                })?;
            }
            if let Some(idx) = cycles_idx {
                if let Some(cb) = progress {
                    cb(ImportProgressEvent {
                        job_id: job_id.to_string(),
                        phase: "parsing".to_string(),
                        processed: 2,
                        total: Some(2),
                        message: "Parsing WHOOP physiological_cycles.csv...".to_string(),
                    });
                }
                archive.stream_entry(idx, cancel, |r| {
                    parse_whoop_cycles_csv(r, streaming_limits, cancel, now, &mut batch)
                })?;
            }

            return Ok(ParsedImportOutput {
                provider_id: HealthProviderId::Whoop,
                export_format: "whoop_zip".to_string(),
                format_version: Some("1.0".to_string()),
                batch,
                invalid_records,
                missing_fields: Vec::new(),
                unsupported_fields: Vec::new(),
                timezone_assumptions: Vec::new(),
                row_errors,
            });
        }

        let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if file_name.contains("physiological_cycles") {
            parse_whoop_cycles_csv(file, streaming_limits, cancel, now, &mut batch)?;
        } else {
            parse_whoop_sleeps_csv(
                file,
                streaming_limits,
                cancel,
                now,
                &mut batch,
                &mut invalid_records,
                &mut row_errors,
            )?;
        }

        Ok(ParsedImportOutput {
            provider_id: HealthProviderId::Whoop,
            export_format: "whoop_csv".to_string(),
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

fn parse_whoop_sleeps_csv<R: Read>(
    reader: R,
    limits: &StreamingParserLimits,
    cancel: &ImportCancellationToken,
    now_ms: i64,
    batch: &mut NormalizedIngestionBatch,
    invalid_records: &mut usize,
    row_errors: &mut Vec<String>,
) -> Result<(), ImportError> {
    let mut csv = CsvStreamReader::new(reader, ',', *limits);
    let Some(headers) = csv.next_row()? else {
        return Err(ImportError::InvalidInput("WHOOP sleeps.csv is empty".into()));
    };
    let col: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim().to_ascii_lowercase(), i))
        .collect();

    let onset_idx = *col
        .get("sleep onset")
        .ok_or_else(|| ImportError::InvalidInput("WHOOP CSV missing 'Sleep onset'".into()))?;
    let wake_idx = *col
        .get("wake onset")
        .ok_or_else(|| ImportError::InvalidInput("WHOOP CSV missing 'Wake onset'".into()))?;

    let mut row_num = 1usize;
    while let Some(row) = csv.next_row()? {
        row_num += 1;
        if row_num % 500 == 0 {
            cancel.check()?;
        }
        let get = |name: &str| -> Option<&str> {
            col.get(name).and_then(|&i| row.get(i)).map(|s| s.trim())
        };
        let tz_off = get("cycle timezone").and_then(parse_utc_offset_secs);

        let Ok((start_ms, s_off)) = parse_timestamp_with_offset(row.get(onset_idx).map(|s| s.as_str()).unwrap_or("")) else {
            *invalid_records += 1;
            if row_errors.len() < 25 {
                row_errors.push(format!("Row {row_num}: invalid Sleep onset"));
            }
            continue;
        };
        let Ok((end_ms, e_off)) = parse_timestamp_with_offset(row.get(wake_idx).map(|s| s.as_str()).unwrap_or("")) else {
            *invalid_records += 1;
            continue;
        };
        if end_ms <= start_ms {
            *invalid_records += 1;
            continue;
        }

        let span_mins = (end_ms - start_ms) as f64 / 60_000.0;
        let asleep_mins = get("asleep duration (min)")
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|m| *m > 0.0)
            .unwrap_or(span_mins);
        let in_bed_mins = get("in bed duration (min)")
            .and_then(|v| v.parse::<f64>().ok())
            .or(Some(span_mins));
        let light_mins = get("light sleep duration (min)").and_then(|v| v.parse::<f64>().ok());
        let deep_mins = get("deep (sws) duration (min)").and_then(|v| v.parse::<f64>().ok());
        let rem_mins = get("rem duration (min)").and_then(|v| v.parse::<f64>().ok());
        let awake_mins = get("awake duration (min)").and_then(|v| v.parse::<f64>().ok());
        let eff = get("sleep efficiency %").and_then(|v| v.parse::<f64>().ok());
        let is_nap = get("nap").is_some_and(|v| v.eq_ignore_ascii_case("true") || v == "1");

        let has_totals =
            light_mins.unwrap_or(0.0) + deep_mins.unwrap_or(0.0) + rem_mins.unwrap_or(0.0) > 0.0;
        let mut flags = Vec::new();
        if has_totals {
            flags.push(SleepQualityFlag::AggregateStageDurationsOnly);
        } else {
            flags.push(SleepQualityFlag::MissingStages);
        }

        let ext_id = format!("whoop_sleep_{start_ms}_{end_ms}");
        batch.sleep_sessions.push(RawSleepSession {
            id: format!("imp_{ext_id}"),
            provider_id: HealthProviderId::Whoop,
            device_id: None,
            external_record_id: ext_id,
            source_app_bundle: Some("WHOOP".to_string()),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: s_off.or(tz_off),
            end_tz_offset_secs: e_off.or(tz_off),
            duration_mins: asleep_mins,
            time_in_bed_mins: in_bed_mins,
            sleep_efficiency_pct: eff,
            awake_mins,
            light_mins,
            deep_mins,
            rem_mins,
            sleep_kind: if is_nap { SleepKind::Nap } else { SleepKind::MainSleep },
            provider_sleep_kind: Some(if is_nap { "nap" } else { "sleep" }.to_string()),
            quality_flags: flags,
            quality_score: 0.93,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms: now_ms,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: false,
            stages: Vec::new(), // Never synthesize hypnogram intervals from WHOOP totals
        });

        if let Some(perf) = get("sleep performance %").and_then(|v| v.parse::<f64>().ok()) {
            let rec_ext = format!("whoop_sleep_perf_{end_ms}");
            let rep_date = crate::health::time::local_date_string(end_ms, e_off.or(tz_off));
            batch.recovery_observations.push(RecoveryObservation {
                id: format!("rec_{rec_ext}"),
                provider_id: HealthProviderId::Whoop,
                external_record_id: rec_ext,
                score_name: "WHOOP Sleep Performance".to_string(),
                score_value: Some(perf),
                scale_min: 0.0,
                scale_max: 100.0,
                score_state: "SCORED".to_string(),
                algorithm_id: Some("whoop_sleep_performance".to_string()),
                represented_date: rep_date,
                measured_at_ms: end_ms,
                underlying_metrics_json: None,
                acquisition_at_ms: now_ms,
                is_synthetic: false,
            });
        }

        if let Some(resp) = get("respiratory rate (rpm)").and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && *v > 0.0) {
            let p_ext = format!("whoop_resp_{end_ms}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{p_ext}"),
                provider_id: HealthProviderId::Whoop,
                device_id: None,
                external_record_id: p_ext,
                metric_type: PhysiologicalMetricType::RespiratoryRate,
                value: resp,
                unit: "brpm".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: end_ms,
                period_start_ms: Some(start_ms),
                period_end_ms: Some(end_ms),
                tz_offset_secs: e_off.or(tz_off),
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

fn parse_whoop_cycles_csv<R: Read>(
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
    let Some(&start_idx) = col.get("cycle start time") else {
        return Ok(());
    };

    while let Some(row) = csv.next_row()? {
        cancel.check()?;
        let get = |name: &str| -> Option<&str> {
            col.get(name).and_then(|&i| row.get(i)).map(|s| s.trim())
        };
        let tz_off = get("cycle timezone").and_then(parse_utc_offset_secs);
        let Ok((cycle_ms, c_off)) = parse_timestamp_with_offset(row.get(start_idx).map(|s| s.as_str()).unwrap_or("")) else {
            continue;
        };
        let rep_date = crate::health::time::local_date_string(cycle_ms, c_off.or(tz_off));

        if let Some(rec) = get("recovery score %").and_then(|v| v.parse::<f64>().ok()) {
            let ext = format!("whoop_recovery_{cycle_ms}");
            batch.recovery_observations.push(RecoveryObservation {
                id: format!("rec_{ext}"),
                provider_id: HealthProviderId::Whoop,
                external_record_id: ext,
                score_name: "WHOOP Recovery".to_string(),
                score_value: Some(rec),
                scale_min: 0.0,
                scale_max: 100.0,
                score_state: "SCORED".to_string(),
                algorithm_id: Some("whoop_recovery_v2".to_string()),
                represented_date: rep_date,
                measured_at_ms: cycle_ms,
                underlying_metrics_json: None,
                acquisition_at_ms: now_ms,
                is_synthetic: false,
            });
        }

        if let Some(hrv) = get("heart rate variability (ms)").and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && *v > 0.0) {
            let ext = format!("whoop_hrv_{cycle_ms}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{ext}"),
                provider_id: HealthProviderId::Whoop,
                device_id: None,
                external_record_id: ext,
                metric_type: PhysiologicalMetricType::Hrv,
                value: hrv,
                unit: "ms".to_string(),
                hrv_method: HrvMethod::Rmssd,
                measured_at_ms: cycle_ms,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: c_off.or(tz_off),
                aggregation_method: Some("sleep_rmssd".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms: now_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
            });
        }

        if let Some(rhr) = get("resting heart rate (bpm)").and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && *v > 0.0) {
            let ext = format!("whoop_rhr_{cycle_ms}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{ext}"),
                provider_id: HealthProviderId::Whoop,
                device_id: None,
                external_record_id: ext,
                metric_type: PhysiologicalMetricType::RestingHeartRate,
                value: rhr,
                unit: "bpm".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: cycle_ms,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: c_off.or(tz_off),
                aggregation_method: Some("cycle_resting".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms: now_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
            });
        }

        if let Some(spo2) = get("blood oxygen %").and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && *v > 0.0) {
            let ext = format!("whoop_spo2_{cycle_ms}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{ext}"),
                provider_id: HealthProviderId::Whoop,
                device_id: None,
                external_record_id: ext,
                metric_type: PhysiologicalMetricType::Spo2,
                value: spo2,
                unit: "%".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: cycle_ms,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: c_off.or(tz_off),
                aggregation_method: Some("cycle_mean".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms: now_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
            });
        }

        if let Some(temp) = get("skin temp (celsius)").and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite()) {
            let ext = format!("whoop_temp_{cycle_ms}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{ext}"),
                provider_id: HealthProviderId::Whoop,
                device_id: None,
                external_record_id: ext,
                metric_type: PhysiologicalMetricType::SkinTempDeviation,
                value: temp,
                unit: "C".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: cycle_ms,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: c_off.or(tz_off),
                aggregation_method: Some("cycle_mean".to_string()),
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
