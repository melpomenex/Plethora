//! Expanded generic CSV adapter with RFC-4180 streaming and custom `CsvMappingProfile` support.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::health::models::{
    HealthDataCategory, HealthProviderId, HrvMethod, PhysiologicalMetricType,
    PhysiologicalObservation, RawSleepSession, RecoveryObservation, SleepKind, SleepQualityFlag,
};
use crate::health::provider::NormalizedIngestionBatch;
use crate::health::time::{elapsed_minutes, is_plausible_sleep_duration, parse_timestamp_with_offset};

use super::csv_reader::{detect_csv_delimiter, CsvStreamReader};
use super::detector::ImportInspection;
use super::limits::{ArchiveSecurityLimits, StreamingParserLimits};
use super::registry::WearableImportAdapter;
use super::types::{
    CsvMappingProfile, DetectionCandidate, DetectionConfidence, ImportAdapterDescriptor,
    ImportCancellationToken, ImportCapabilities, ImportError, ImportProgressEvent,
    ParsedImportOutput, VerificationStatus,
};

pub struct GenericCsvAdapter;

impl WearableImportAdapter for GenericCsvAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "generic_csv".to_string(),
            provider_id: HealthProviderId::FileImport,
            display_name: "Generic Sleep & Health CSV".to_string(),
            format_id: "plethora_generic_csv".to_string(),
            format_label: "Plethora / Generic Sleep CSV".to_string(),
            format_version: "2.0".to_string(),
            verification_status: VerificationStatus::ImplementedFixtureTested,
            capabilities: ImportCapabilities {
                supports_archive: false,
                supports_standalone: true,
                supports_detailed_stages: false,
                supports_stage_totals_only: true,
                supports_timezone: true,
                supported_extensions: vec!["csv".to_string(), "tsv".to_string()],
                supported_categories: vec![
                    HealthDataCategory::Sleep,
                    HealthDataCategory::RestingHeartRate,
                    HealthDataCategory::Hrv,
                    HealthDataCategory::RespiratoryRate,
                    HealthDataCategory::Temperature,
                    HealthDataCategory::Recovery,
                ],
                known_limitations: vec![
                    "Generic CSV provides aggregate stage totals rather than per-epoch hypnogram timelines.".to_string(),
                ],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip || inspection.csv_headers.is_empty() {
            return None;
        }
        let lower: Vec<String> = inspection
            .csv_headers
            .iter()
            .map(|h| h.trim().to_ascii_lowercase())
            .collect();
        let has_start = lower.iter().any(|h| {
            matches!(
                h.as_str(),
                "start" | "start_time" | "bedtime_start" | "start_iso"
            )
        });
        let has_end = lower.iter().any(|h| {
            matches!(h.as_str(), "end" | "end_time" | "bedtime_end" | "end_iso")
        });
        if has_start && has_end {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::FileImport,
                adapter_id: "generic_csv".to_string(),
                format_id: "plethora_generic_csv".to_string(),
                format_label: "Plethora Sleep CSV".to_string(),
                confidence: DetectionConfidence::Probable,
                score: 70,
                reasons: vec!["CSV contains standard start and end sleep columns".to_string()],
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
        parse_csv_with_mapping(path, None, streaming_limits, cancel)
    }
}

pub fn parse_csv_with_mapping(
    path: &Path,
    mapping: Option<&CsvMappingProfile>,
    streaming_limits: &StreamingParserLimits,
    cancel: &ImportCancellationToken,
) -> Result<ParsedImportOutput, ImportError> {
    let mut file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
    let mut prefix = vec![0u8; 8192];
    let n = file.read(&mut prefix).map_err(|e| ImportError::Io(e.to_string()))?;
    prefix.truncate(n);
    let sample = String::from_utf8_lossy(&prefix);
    let delimiter = mapping
        .and_then(|m| m.delimiter)
        .unwrap_or_else(|| detect_csv_delimiter(&sample));

    let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
    parse_csv_reader_with_mapping(file, delimiter, mapping, streaming_limits, cancel)
}

pub fn parse_csv_reader_with_mapping<R: Read>(
    reader: R,
    delimiter: char,
    mapping: Option<&CsvMappingProfile>,
    streaming_limits: &StreamingParserLimits,
    cancel: &ImportCancellationToken,
) -> Result<ParsedImportOutput, ImportError> {
    cancel.check()?;
    let mut csv = CsvStreamReader::new(reader, delimiter, *streaming_limits);
    let Some(headers) = csv.next_row()? else {
        return Err(ImportError::InvalidInput("CSV file is empty".into()));
    };

    let col: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim().to_ascii_lowercase(), i))
        .collect();

    let find_col = |mapped: Option<&str>, aliases: &[&str]| -> Option<usize> {
        if let Some(name) = mapped {
            if let Some(&idx) = col.get(&name.trim().to_ascii_lowercase()) {
                return Some(idx);
            }
        }
        for alias in aliases {
            if let Some(&idx) = col.get(*alias) {
                return Some(idx);
            }
        }
        None
    };

    let start_idx = find_col(
        mapping.and_then(|m| m.start_column.as_deref()),
        &["start", "start_time", "bedtime_start", "start_iso", "sleep_start"],
    );
    let end_idx = find_col(
        mapping.and_then(|m| m.end_column.as_deref()),
        &["end", "end_time", "bedtime_end", "end_iso", "sleep_end"],
    );
    let duration_idx = find_col(
        mapping.and_then(|m| m.duration_column.as_deref()),
        &["duration_mins", "duration", "total_sleep_mins", "sleep_minutes"],
    );
    let date_idx = find_col(
        mapping.and_then(|m| m.date_column.as_deref()),
        &["date", "sleep_date"],
    );

    if start_idx.is_none() || (end_idx.is_none() && duration_idx.is_none()) {
        if date_idx.is_none() || duration_idx.is_none() {
            return Err(ImportError::InvalidInput(
                "CSV is missing required start/end timestamps or date+duration columns. Use the CSV Column Mapping Wizard.".into(),
            ));
        }
    }

    let tib_idx = find_col(
        mapping.and_then(|m| m.time_in_bed_column.as_deref()),
        &["time_in_bed_mins", "in_bed_mins", "time_in_bed"],
    );
    let awake_idx = find_col(
        mapping.and_then(|m| m.awake_column.as_deref()),
        &["awake_mins", "awake_minutes", "awake"],
    );
    let light_idx = find_col(
        mapping.and_then(|m| m.light_column.as_deref()),
        &["light_mins", "light_sleep_mins", "light"],
    );
    let deep_idx = find_col(
        mapping.and_then(|m| m.deep_column.as_deref()),
        &["deep_mins", "deep_sleep_mins", "deep"],
    );
    let rem_idx = find_col(
        mapping.and_then(|m| m.rem_column.as_deref()),
        &["rem_mins", "rem_sleep_mins", "rem"],
    );
    let eff_idx = find_col(
        mapping.and_then(|m| m.efficiency_column.as_deref()),
        &["sleep_efficiency_pct", "efficiency"],
    );
    let kind_idx = find_col(
        mapping.and_then(|m| m.sleep_kind_column.as_deref()),
        &["kind", "sleep_kind", "type"],
    );
    let nap_idx = find_col(
        mapping.and_then(|m| m.nap_indicator_column.as_deref()),
        &["is_nap", "nap"],
    );
    let hrv_idx = find_col(
        mapping.and_then(|m| m.hrv_column.as_deref()),
        &["hrv", "hrv_ms", "average_hrv"],
    );
    let rhr_idx = find_col(
        mapping.and_then(|m| m.resting_hr_column.as_deref()),
        &["resting_hr", "resting_heart_rate", "rhr"],
    );
    let resp_idx = find_col(
        mapping.and_then(|m| m.respiratory_rate_column.as_deref()),
        &["respiratory_rate", "breath_rate"],
    );
    let spo2_idx = find_col(
        mapping.and_then(|m| m.spo2_column.as_deref()),
        &["spo2", "blood_oxygen"],
    );
    let temp_idx = find_col(
        mapping.and_then(|m| m.temperature_column.as_deref()),
        &["temperature", "temp_deviation", "skin_temp"],
    );
    let score_idx = find_col(
        mapping.and_then(|m| m.sleep_score_column.as_deref()),
        &["sleep_score", "score"],
    );
    let source_idx = find_col(
        mapping.and_then(|m| m.source_column.as_deref()),
        &["source", "device"],
    );
    let notes_idx = find_col(
        mapping.and_then(|m| m.notes_column.as_deref()),
        &["notes", "note"],
    );

    let duration_unit = mapping
        .and_then(|m| m.duration_unit.as_deref())
        .unwrap_or("minutes")
        .to_ascii_lowercase();
    let duration_scale = match duration_unit.as_str() {
        "seconds" | "s" => 1.0 / 60.0,
        "hours" | "h" => 60.0,
        _ => 1.0,
    };

    let temp_unit = mapping
        .and_then(|m| m.temperature_unit.as_deref())
        .unwrap_or("C")
        .to_ascii_uppercase();

    let fallback_tz_secs = mapping
        .and_then(|m| m.fallback_tz_offset_minutes)
        .filter(|m| (-1080..=1080).contains(m))
        .map(|m| m * 60);

    let provider_id = mapping
        .and_then(|m| m.provider_id)
        .unwrap_or(HealthProviderId::FileImport);

    let hrv_method = match mapping
        .and_then(|m| m.hrv_method.as_deref())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("rmssd") => HrvMethod::Rmssd,
        Some("sdnn") => HrvMethod::Sdnn,
        _ => HrvMethod::Unknown,
    };

    let mut batch = NormalizedIngestionBatch::default();
    let mut invalid_records = 0usize;
    let mut row_errors = Vec::new();
    let mut tz_assumptions = Vec::new();
    let now = chrono::Utc::now().timestamp_millis();
    let mut row_num = 1usize;

    while let Some(row) = csv.next_row()? {
        row_num += 1;
        if row_num % 1000 == 0 {
            cancel.check()?;
        }

        let parse_ts = |raw: &str| -> Result<(i64, Option<i32>), String> {
            let (ms, off) = parse_timestamp_with_offset(raw)?;
            if off.is_none() {
                if let Some(fb) = fallback_tz_secs {
                    return Ok((ms - i64::from(fb) * 1000, Some(fb)));
                }
            }
            Ok((ms, off))
        };

        let (start_ms, start_off, end_ms, end_off) = if let (Some(si), Some(ei)) = (start_idx, end_idx) {
            let s_raw = row.get(si).map(|s| s.as_str()).unwrap_or("");
            let e_raw = row.get(ei).map(|s| s.as_str()).unwrap_or("");
            let Ok((s_ms, s_off)) = parse_ts(s_raw) else {
                invalid_records += 1;
                if row_errors.len() < 25 {
                    row_errors.push(format!("Row {row_num}: invalid start timestamp"));
                }
                continue;
            };
            let Ok((e_ms, e_off)) = parse_ts(e_raw) else {
                invalid_records += 1;
                if row_errors.len() < 25 {
                    row_errors.push(format!("Row {row_num}: invalid end timestamp"));
                }
                continue;
            };
            (s_ms, s_off, e_ms, e_off)
        } else if let (Some(si), Some(di)) = (start_idx, duration_idx) {
            let s_raw = row.get(si).map(|s| s.as_str()).unwrap_or("");
            let Ok((s_ms, s_off)) = parse_ts(s_raw) else {
                invalid_records += 1;
                continue;
            };
            let Some(dur_raw) = row.get(di).and_then(|v| v.trim().parse::<f64>().ok()) else {
                invalid_records += 1;
                continue;
            };
            let mins = dur_raw * duration_scale;
            if !mins.is_finite() || mins <= 0.0 {
                invalid_records += 1;
                continue;
            }
            (s_ms, s_off, s_ms + (mins * 60_000.0).round() as i64, s_off)
        } else if let (Some(date_i), Some(di)) = (date_idx, duration_idx) {
            let date_raw = row.get(date_i).map(|s| s.trim()).unwrap_or("");
            let Ok((e_ms, e_off)) = parse_ts(&format!("{date_raw}T07:00:00")) else {
                invalid_records += 1;
                continue;
            };
            let Some(dur_raw) = row.get(di).and_then(|v| v.trim().parse::<f64>().ok()) else {
                invalid_records += 1;
                continue;
            };
            let mins = dur_raw * duration_scale;
            if !mins.is_finite() || mins <= 0.0 {
                invalid_records += 1;
                continue;
            }
            let s_ms = e_ms - (mins * 60_000.0).round() as i64;
            (s_ms, e_off, e_ms, e_off)
        } else {
            invalid_records += 1;
            continue;
        };

        if start_off.is_none() && fallback_tz_secs.is_none() && tz_assumptions.is_empty() {
            tz_assumptions.push(
                "Some CSV timestamps do not include a timezone offset; UTC was assumed.".to_string(),
            );
        }

        let Ok(elapsed_mins) = elapsed_minutes(start_ms, end_ms) else {
            invalid_records += 1;
            if row_errors.len() < 25 {
                row_errors.push(format!("Row {row_num}: end timestamp must be after start"));
            }
            continue;
        };

        let explicit_dur = duration_idx
            .and_then(|i| row.get(i))
            .and_then(|v| v.trim().parse::<f64>().ok())
            .map(|v| v * duration_scale)
            .filter(|v| v.is_finite() && *v > 0.0);
        let dur_mins = explicit_dur.unwrap_or(elapsed_mins);

        let tib = tib_idx
            .and_then(|i| row.get(i))
            .and_then(|v| v.trim().parse::<f64>().ok())
            .map(|v| v * duration_scale)
            .filter(|v| v.is_finite() && *v > 0.0);
        let awake_mins = awake_idx
            .and_then(|i| row.get(i))
            .and_then(|v| v.trim().parse::<f64>().ok())
            .map(|v| v * duration_scale);
        let light_mins = light_idx
            .and_then(|i| row.get(i))
            .and_then(|v| v.trim().parse::<f64>().ok())
            .map(|v| v * duration_scale);
        let deep_mins = deep_idx
            .and_then(|i| row.get(i))
            .and_then(|v| v.trim().parse::<f64>().ok())
            .map(|v| v * duration_scale);
        let rem_mins = rem_idx
            .and_then(|i| row.get(i))
            .and_then(|v| v.trim().parse::<f64>().ok())
            .map(|v| v * duration_scale);
        let eff = eff_idx
            .and_then(|i| row.get(i))
            .and_then(|v| v.trim().parse::<f64>().ok())
            .or_else(|| tib.map(|t| ((dur_mins / t) * 100.0).clamp(0.0, 100.0)));

        let is_nap_flag = nap_idx
            .and_then(|i| row.get(i))
            .is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "true" | "1" | "yes" | "nap"));
        let kind = if is_nap_flag {
            SleepKind::Nap
        } else {
            kind_idx
                .and_then(|i| row.get(i))
                .map(|v| SleepKind::from_str(v))
                .unwrap_or_else(|| {
                    if dur_mins < 180.0 {
                        SleepKind::Nap
                    } else {
                        SleepKind::MainSleep
                    }
                })
        };

        let src_note = source_idx
            .and_then(|i| row.get(i))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let notes = notes_idx
            .and_then(|i| row.get(i))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let has_stage_totals =
            light_mins.unwrap_or(0.0) + deep_mins.unwrap_or(0.0) + rem_mins.unwrap_or(0.0) > 0.0;
        let mut flags = vec![if has_stage_totals {
            SleepQualityFlag::AggregateStageDurationsOnly
        } else {
            SleepQualityFlag::MissingStages
        }];
        if !is_plausible_sleep_duration(dur_mins) {
            flags.push(SleepQualityFlag::ImplausibleDuration);
        }

        let ext_id = format!("csv_{start_ms}_{end_ms}");
        batch.sleep_sessions.push(RawSleepSession {
            id: format!("imp_{}_{ext_id}", provider_id.as_str()),
            provider_id,
            device_id: None,
            external_record_id: ext_id,
            source_app_bundle: src_note,
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: start_off,
            end_tz_offset_secs: end_off.or(start_off),
            duration_mins: dur_mins,
            time_in_bed_mins: tib,
            sleep_efficiency_pct: eff,
            awake_mins,
            light_mins,
            deep_mins,
            rem_mins,
            sleep_kind: kind,
            provider_sleep_kind: None,
            quality_flags: flags,
            quality_score: 0.78,
            notes,
            subjective_quality: None,
            acquisition_at_ms: now,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: false,
            stages: Vec::new(),
        });

        let add_physio = |batch: &mut NormalizedIngestionBatch,
                          idx: Option<usize>,
                          metric: PhysiologicalMetricType,
                          unit: &str,
                          hm: HrvMethod| {
            if let Some(val) = idx
                .and_then(|i| row.get(i))
                .and_then(|v| v.trim().parse::<f64>().ok())
                .filter(|v| v.is_finite())
            {
                let normalized_val = if metric == PhysiologicalMetricType::SkinTempDeviation && temp_unit == "F" {
                    (val - 32.0) * 5.0 / 9.0
                } else {
                    val
                };
                let p_ext = format!("csv_{}_{end_ms}", metric.as_str());
                batch.physio_observations.push(PhysiologicalObservation {
                    id: format!("obs_{}_{p_ext}", provider_id.as_str()),
                    provider_id,
                    device_id: None,
                    external_record_id: p_ext,
                    metric_type: metric,
                    value: normalized_val,
                    unit: unit.to_string(),
                    hrv_method: hm,
                    measured_at_ms: end_ms,
                    period_start_ms: Some(start_ms),
                    period_end_ms: Some(end_ms),
                    tz_offset_secs: end_off.or(start_off),
                    aggregation_method: Some("csv_import".to_string()),
                    quality_flags: Vec::new(),
                    acquisition_at_ms: now,
                    sync_batch_id: None,
                    is_deleted: false,
                    is_synthetic: false,
                });
            }
        };

        add_physio(&mut batch, hrv_idx, PhysiologicalMetricType::Hrv, "ms", hrv_method);
        add_physio(&mut batch, rhr_idx, PhysiologicalMetricType::RestingHeartRate, "bpm", HrvMethod::Unknown);
        add_physio(&mut batch, resp_idx, PhysiologicalMetricType::RespiratoryRate, "brpm", HrvMethod::Unknown);
        add_physio(&mut batch, spo2_idx, PhysiologicalMetricType::Spo2, "%", HrvMethod::Unknown);
        add_physio(&mut batch, temp_idx, PhysiologicalMetricType::SkinTempDeviation, "C", HrvMethod::Unknown);

        if let Some(score) = score_idx
            .and_then(|i| row.get(i))
            .and_then(|v| v.trim().parse::<f64>().ok())
        {
            let rep_date = crate::health::time::local_date_string(end_ms, end_off.or(start_off));
            let r_ext = format!("csv_score_{end_ms}");
            batch.recovery_observations.push(RecoveryObservation {
                id: format!("rec_{}_{r_ext}", provider_id.as_str()),
                provider_id,
                external_record_id: r_ext,
                score_name: format!("{} Sleep Score", provider_id.display_name()),
                score_value: Some(score),
                scale_min: 0.0,
                scale_max: 100.0,
                score_state: "SCORED".to_string(),
                algorithm_id: Some("csv_imported_score".to_string()),
                represented_date: rep_date,
                measured_at_ms: end_ms,
                underlying_metrics_json: None,
                acquisition_at_ms: now,
                is_synthetic: false,
            });
        }
    }

    Ok(ParsedImportOutput {
        provider_id,
        export_format: "csv".to_string(),
        format_version: Some("2.0".to_string()),
        batch,
        invalid_records,
        missing_fields: Vec::new(),
        unsupported_fields: Vec::new(),
        timezone_assumptions: tz_assumptions,
        row_errors,
    })
}
