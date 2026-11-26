//! Oura Ring consumer export adapter (`sleep.csv`, `daily_sleep.csv`, `daily_readiness.csv`, ZIP/JSON).

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
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

pub struct OuraExportAdapter;

impl WearableImportAdapter for OuraExportAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "oura_consumer_export".to_string(),
            provider_id: HealthProviderId::Oura,
            display_name: "Oura Ring".to_string(),
            format_id: "oura_web_export".to_string(),
            format_label: "Oura Web Export (ZIP / CSV / JSON)".to_string(),
            format_version: "1.0".to_string(),
            verification_status: VerificationStatus::ImplementedFixtureTested,
            capabilities: ImportCapabilities {
                supports_archive: true,
                supports_standalone: true,
                supports_detailed_stages: true,
                supports_stage_totals_only: true,
                supports_timezone: true,
                supported_extensions: vec!["zip".to_string(), "csv".to_string(), "json".to_string()],
                supported_categories: vec![
                    HealthDataCategory::Sleep,
                    HealthDataCategory::SleepStages,
                    HealthDataCategory::HeartRate,
                    HealthDataCategory::RestingHeartRate,
                    HealthDataCategory::Hrv,
                    HealthDataCategory::Temperature,
                    HealthDataCategory::RespiratoryRate,
                    HealthDataCategory::Recovery,
                ],
                known_limitations: vec![],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip {
            let has_oura_csv = inspection.zip_samples.iter().any(|(path, sample)| {
                let l = path.to_ascii_lowercase();
                (l.ends_with("sleep.csv") || l.ends_with("daily_readiness.csv"))
                    && (sample.contains("bedtime_start")
                        || sample.contains("BedtimeStart")
                        || sample.contains("sleep_phase_5_min")
                        || sample.contains("temperature_deviation"))
            });
            if has_oura_csv {
                return Some(DetectionCandidate {
                    provider_id: HealthProviderId::Oura,
                    adapter_id: "oura_consumer_export".to_string(),
                    format_id: "oura_web_zip".to_string(),
                    format_label: "Oura Web Data Export (.zip)".to_string(),
                    confidence: DetectionConfidence::Confident,
                    score: 97,
                    reasons: vec!["Archive contains Oura sleep.csv / daily_readiness.csv".to_string()],
                });
            }
            return None;
        }

        let headers_lower: Vec<String> = inspection
            .csv_headers
            .iter()
            .map(|h| h.trim().to_ascii_lowercase())
            .collect();
        if headers_lower.iter().any(|h| h == "bedtime_start" || h == "bedtimestart")
            && (headers_lower.iter().any(|h| h == "sleep_phase_5_min" || h == "average_hrv" || h == "lowest_heart_rate" || h == "total_sleep_duration" || h == "totalsleepduration"))
        {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::Oura,
                adapter_id: "oura_consumer_export".to_string(),
                format_id: "oura_sleep_csv".to_string(),
                format_label: "Oura sleep.csv".to_string(),
                confidence: DetectionConfidence::Confident,
                score: 96,
                reasons: vec!["CSV headers match Oura sleep export".to_string()],
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
            let sleep_idx = archive
                .entries()
                .iter()
                .find(|e| !e.is_dir && e.normalized_path.to_ascii_lowercase().ends_with("sleep.csv"))
                .map(|e| e.index);
            let daily_sleep_idx = archive
                .entries()
                .iter()
                .find(|e| !e.is_dir && e.normalized_path.to_ascii_lowercase().ends_with("daily_sleep.csv"))
                .map(|e| e.index);
            let readiness_idx = archive
                .entries()
                .iter()
                .find(|e| !e.is_dir && e.normalized_path.to_ascii_lowercase().ends_with("daily_readiness.csv"))
                .map(|e| e.index);

            if sleep_idx.is_none() && daily_sleep_idx.is_none() && readiness_idx.is_none() {
                return Err(ImportError::UnsupportedFormat(
                    "Archive does not contain Oura sleep.csv or daily_readiness.csv".into(),
                ));
            }

            if let Some(idx) = sleep_idx {
                if let Some(cb) = progress {
                    cb(ImportProgressEvent {
                        job_id: job_id.to_string(),
                        phase: "parsing".to_string(),
                        processed: 1,
                        total: Some(3),
                        message: "Parsing Oura sleep.csv...".to_string(),
                    });
                }
                archive.stream_entry(idx, cancel, |r| {
                    parse_oura_sleep_csv(r, streaming_limits, cancel, now, &mut batch, &mut invalid_records, &mut row_errors)
                })?;
            }
            if let Some(idx) = daily_sleep_idx {
                archive.stream_entry(idx, cancel, |r| {
                    parse_oura_score_csv(r, streaming_limits, cancel, now, "Oura Sleep Score", "oura_sleep_score_v2", &mut batch)
                })?;
            }
            if let Some(idx) = readiness_idx {
                archive.stream_entry(idx, cancel, |r| {
                    parse_oura_score_csv(r, streaming_limits, cancel, now, "Oura Readiness", "oura_readiness_v2", &mut batch)
                })?;
            }

            return Ok(ParsedImportOutput {
                provider_id: HealthProviderId::Oura,
                export_format: "oura_web_zip".to_string(),
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
        parse_oura_sleep_csv(
            file,
            streaming_limits,
            cancel,
            now,
            &mut batch,
            &mut invalid_records,
            &mut row_errors,
        )?;

        Ok(ParsedImportOutput {
            provider_id: HealthProviderId::Oura,
            export_format: "oura_sleep_csv".to_string(),
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

fn parse_oura_sleep_csv<R: Read>(
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
        return Err(ImportError::InvalidInput("Oura sleep.csv is empty".into()));
    };
    let col: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim().to_ascii_lowercase(), i))
        .collect();

    let start_col = *col
        .get("bedtime_start")
        .or_else(|| col.get("bedtimestart"))
        .ok_or_else(|| ImportError::InvalidInput("Oura CSV missing bedtime_start".into()))?;
    let end_col = *col
        .get("bedtime_end")
        .or_else(|| col.get("bedtimeend"))
        .ok_or_else(|| ImportError::InvalidInput("Oura CSV missing bedtime_end".into()))?;

    let mut row_num = 1usize;
    while let Some(row) = csv.next_row()? {
        row_num += 1;
        if row_num % 500 == 0 {
            cancel.check()?;
        }
        let get = |name: &str| -> Option<&str> {
            col.get(name).and_then(|&i| row.get(i)).map(|s| s.trim())
        };
        let Some(start_raw) = row.get(start_col) else {
            *invalid_records += 1;
            continue;
        };
        let Some(end_raw) = row.get(end_col) else {
            *invalid_records += 1;
            continue;
        };
        let Ok((start_ms, start_off)) = parse_timestamp_with_offset(start_raw) else {
            *invalid_records += 1;
            if row_errors.len() < 25 {
                row_errors.push(format!("Row {row_num}: invalid bedtime_start"));
            }
            continue;
        };
        let Ok((end_ms, end_off)) = parse_timestamp_with_offset(end_raw) else {
            *invalid_records += 1;
            continue;
        };
        if end_ms <= start_ms {
            *invalid_records += 1;
            continue;
        }

        let span_mins = (end_ms - start_ms) as f64 / 60_000.0;
        let total_sleep_mins = get("total_sleep_duration")
            .or_else(|| get("totalsleepduration"))
            .and_then(|v| v.parse::<f64>().ok())
            .map(|s| s / 60.0)
            .filter(|m| *m > 0.0)
            .unwrap_or(span_mins);
        let time_in_bed_mins = get("time_in_bed")
            .or_else(|| get("timeinbed"))
            .and_then(|v| v.parse::<f64>().ok())
            .map(|s| s / 60.0)
            .or(Some(span_mins));
        let awake_mins = get("awake_time").and_then(|v| v.parse::<f64>().ok()).map(|s| s / 60.0);
        let light_mins = get("light_sleep_duration").and_then(|v| v.parse::<f64>().ok()).map(|s| s / 60.0);
        let deep_mins = get("deep_sleep_duration").and_then(|v| v.parse::<f64>().ok()).map(|s| s / 60.0);
        let rem_mins = get("rem_sleep_duration").and_then(|v| v.parse::<f64>().ok()).map(|s| s / 60.0);
        let efficiency = get("efficiency").and_then(|v| v.parse::<f64>().ok());

        let kind_str = get("type").unwrap_or("long_sleep");
        let sleep_kind = match kind_str.to_ascii_lowercase().as_str() {
            "nap" | "late_nap" | "rest" => SleepKind::Nap,
            _ => SleepKind::MainSleep,
        };

        let ext_id = get("id")
            .filter(|s| !s.is_empty())
            .map(|s| format!("oura_csv_{s}"))
            .unwrap_or_else(|| format!("oura_csv_{start_ms}_{end_ms}"));
        let raw_id = format!("imp_{ext_id}");

        let mut stages = Vec::new();
        if let Some(hypno) = get("sleep_phase_5_min").filter(|s| !s.is_empty()) {
            let mut cursor = start_ms;
            for ch in hypno.chars() {
                let next = (cursor + 5 * 60_000).min(end_ms);
                if next <= cursor {
                    break;
                }
                let st = match ch {
                    '1' => SleepStageType::Deep,
                    '2' => SleepStageType::Light,
                    '3' => SleepStageType::Rem,
                    '4' => SleepStageType::Awake,
                    _ => SleepStageType::Unknown,
                };
                stages.push(SleepStageInterval {
                    id: format!("{raw_id}_st_{}", stages.len()),
                    raw_session_id: raw_id.clone(),
                    stage_type: st,
                    start_at_ms: cursor,
                    end_at_ms: next,
                    provider_stage_code: Some(ch.to_string()),
                });
                cursor = next;
            }
            stages = normalize_stage_intervals(stages);
        }

        let mut flags = Vec::new();
        if stages.is_empty()
            && (light_mins.unwrap_or(0.0) + deep_mins.unwrap_or(0.0) + rem_mins.unwrap_or(0.0)) > 0.0
        {
            flags.push(SleepQualityFlag::AggregateStageDurationsOnly);
        }

        batch.sleep_sessions.push(RawSleepSession {
            id: raw_id,
            provider_id: HealthProviderId::Oura,
            device_id: None,
            external_record_id: ext_id,
            source_app_bundle: Some("Oura".to_string()),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: start_off,
            end_tz_offset_secs: end_off.or(start_off),
            duration_mins: total_sleep_mins,
            time_in_bed_mins,
            sleep_efficiency_pct: efficiency,
            awake_mins,
            light_mins,
            deep_mins,
            rem_mins,
            sleep_kind,
            provider_sleep_kind: Some(kind_str.to_string()),
            quality_flags: flags,
            quality_score: 0.95,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms: now_ms,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: false,
            stages,
        });

        if let Some(hrv) = get("average_hrv").and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && *v > 0.0) {
            let p_ext = format!("oura_hrv_{end_ms}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{p_ext}"),
                provider_id: HealthProviderId::Oura,
                device_id: None,
                external_record_id: p_ext,
                metric_type: PhysiologicalMetricType::Hrv,
                value: hrv,
                unit: "ms".to_string(),
                hrv_method: HrvMethod::Rmssd,
                measured_at_ms: end_ms,
                period_start_ms: Some(start_ms),
                period_end_ms: Some(end_ms),
                tz_offset_secs: end_off.or(start_off),
                aggregation_method: Some("sleep_mean".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms: now_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
            });
        }

        if let Some(rhr) = get("lowest_heart_rate")
            .or_else(|| get("average_heart_rate"))
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v > 0.0)
        {
            let p_ext = format!("oura_rhr_{end_ms}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{p_ext}"),
                provider_id: HealthProviderId::Oura,
                device_id: None,
                external_record_id: p_ext,
                metric_type: PhysiologicalMetricType::RestingHeartRate,
                value: rhr,
                unit: "bpm".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: end_ms,
                period_start_ms: Some(start_ms),
                period_end_ms: Some(end_ms),
                tz_offset_secs: end_off.or(start_off),
                aggregation_method: Some("sleep_lowest".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms: now_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
            });
        }

        if let Some(breath) = get("average_breath").and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && *v > 0.0) {
            let p_ext = format!("oura_resp_{end_ms}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{p_ext}"),
                provider_id: HealthProviderId::Oura,
                device_id: None,
                external_record_id: p_ext,
                metric_type: PhysiologicalMetricType::RespiratoryRate,
                value: breath,
                unit: "brpm".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: end_ms,
                period_start_ms: Some(start_ms),
                period_end_ms: Some(end_ms),
                tz_offset_secs: end_off.or(start_off),
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

fn parse_oura_score_csv<R: Read>(
    reader: R,
    limits: &StreamingParserLimits,
    cancel: &ImportCancellationToken,
    now_ms: i64,
    score_name: &str,
    algo_id: &str,
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
    let Some(&day_idx) = col.get("day") else {
        return Ok(());
    };
    let Some(&score_idx) = col.get("score") else {
        return Ok(());
    };
    let temp_idx = col.get("temperature_deviation").copied();

    while let Some(row) = csv.next_row()? {
        cancel.check()?;
        let Some(day) = row.get(day_idx).map(|s| s.trim()).filter(|s| !s.is_empty()) else {
            continue;
        };
        let ts = parse_timestamp_with_offset(&format!("{day}T08:00:00Z"))
            .map(|(ms, _)| ms)
            .unwrap_or(now_ms);
        if let Some(score) = row.get(score_idx).and_then(|s| s.trim().parse::<f64>().ok()) {
            let ext_id = format!("{algo_id}_{day}");
            batch.recovery_observations.push(RecoveryObservation {
                id: format!("rec_{ext_id}"),
                provider_id: HealthProviderId::Oura,
                external_record_id: ext_id,
                score_name: score_name.to_string(),
                score_value: Some(score),
                scale_min: 0.0,
                scale_max: 100.0,
                score_state: "SCORED".to_string(),
                algorithm_id: Some(algo_id.to_string()),
                represented_date: day.to_string(),
                measured_at_ms: ts,
                underlying_metrics_json: None,
                acquisition_at_ms: now_ms,
                is_synthetic: false,
            });
        }
        if let Some(t_idx) = temp_idx {
            if let Some(temp) = row.get(t_idx).and_then(|s| s.trim().parse::<f64>().ok()) {
                let ext_id = format!("oura_temp_dev_{day}");
                batch.physio_observations.push(PhysiologicalObservation {
                    id: format!("obs_{ext_id}"),
                    provider_id: HealthProviderId::Oura,
                    device_id: None,
                    external_record_id: ext_id,
                    metric_type: PhysiologicalMetricType::SkinTempDeviation,
                    value: temp,
                    unit: "C".to_string(),
                    hrv_method: HrvMethod::Unknown,
                    measured_at_ms: ts,
                    period_start_ms: None,
                    period_end_ms: None,
                    tz_offset_secs: None,
                    aggregation_method: Some("daily_deviation".to_string()),
                    quality_flags: Vec::new(),
                    acquisition_at_ms: now_ms,
                    sync_batch_id: None,
                    is_deleted: false,
                    is_synthetic: false,
                });
            }
        }
    }
    Ok(())
}
