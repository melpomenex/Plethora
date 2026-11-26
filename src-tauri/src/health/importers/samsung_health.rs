//! Samsung Health personal data export adapter (`com.samsung.health.sleep*.csv` + `sleep_stage*.csv`).

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::health::models::{
    HealthDataCategory, HealthProviderId, RawSleepSession, RecoveryObservation, SleepKind,
    SleepQualityFlag, SleepStageInterval, SleepStageType,
};
use crate::health::provider::NormalizedIngestionBatch;
use crate::health::reconciliation::normalize_stage_intervals;
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

pub struct SamsungHealthExportAdapter;

impl WearableImportAdapter for SamsungHealthExportAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "samsung_health_export".to_string(),
            provider_id: HealthProviderId::SamsungHealth,
            display_name: "Samsung Health (Galaxy Watch / Ring)".to_string(),
            format_id: "samsung_health_csv".to_string(),
            format_label: "Samsung Health Personal Data Export (ZIP / CSV)".to_string(),
            format_version: "1.0".to_string(),
            verification_status: VerificationStatus::ImplementedFixtureTested,
            capabilities: ImportCapabilities {
                supports_archive: true,
                supports_standalone: true,
                supports_detailed_stages: true,
                supports_stage_totals_only: false,
                supports_timezone: true,
                supported_extensions: vec!["zip".to_string(), "csv".to_string()],
                supported_categories: vec![
                    HealthDataCategory::Sleep,
                    HealthDataCategory::SleepStages,
                    HealthDataCategory::Recovery,
                ],
                known_limitations: vec![
                    "Galaxy Watch & Ring also sync directly to Android Health Connect.".to_string(),
                ],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip {
            let has_samsung = inspection.zip_paths.iter().any(|p| {
                let l = p.to_ascii_lowercase();
                l.contains("com.samsung.health.sleep") && l.ends_with(".csv")
            });
            if has_samsung {
                return Some(DetectionCandidate {
                    provider_id: HealthProviderId::SamsungHealth,
                    adapter_id: "samsung_health_export".to_string(),
                    format_id: "samsung_health_zip".to_string(),
                    format_label: "Samsung Health Export (.zip)".to_string(),
                    confidence: DetectionConfidence::Confident,
                    score: 98,
                    reasons: vec!["Archive contains com.samsung.health.sleep CSV files".to_string()],
                });
            }
            return None;
        }

        let fname = inspection.file_name.to_ascii_lowercase();
        if fname.contains("com.samsung.health.sleep")
            || inspection.text_sample.contains("com.samsung.health.sleep")
        {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::SamsungHealth,
                adapter_id: "samsung_health_export".to_string(),
                format_id: "samsung_health_csv".to_string(),
                format_label: "Samsung Health Sleep CSV".to_string(),
                confidence: DetectionConfidence::Confident,
                score: 95,
                reasons: vec!["File matches com.samsung.health.sleep CSV schema".to_string()],
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
        let mut stages_by_sleep_id: HashMap<String, Vec<(i64, i64, SleepStageType, String)>> =
            HashMap::new();
        let now = chrono::Utc::now().timestamp_millis();

        if is_zip {
            let mut archive = SafeZipArchive::open(path, *archive_limits)?;
            let sleep_idx = archive
                .entries()
                .iter()
                .find(|e| {
                    !e.is_dir && {
                        let l = e.normalized_path.to_ascii_lowercase();
                        l.contains("com.samsung.health.sleep.") && l.ends_with(".csv")
                    }
                })
                .map(|e| e.index);
            let stage_idx = archive
                .entries()
                .iter()
                .find(|e| {
                    !e.is_dir && {
                        let l = e.normalized_path.to_ascii_lowercase();
                        l.contains("com.samsung.health.sleep_stage") && l.ends_with(".csv")
                    }
                })
                .map(|e| e.index);

            if let Some(idx) = stage_idx {
                archive.stream_entry(idx, cancel, |r| {
                    parse_samsung_stages(r, streaming_limits, cancel, &mut stages_by_sleep_id)
                })?;
            }
            if let Some(idx) = sleep_idx {
                archive.stream_entry(idx, cancel, |r| {
                    parse_samsung_sleep(
                        r,
                        streaming_limits,
                        cancel,
                        now,
                        &stages_by_sleep_id,
                        &mut batch,
                        &mut invalid_records,
                    )
                })?;
            } else {
                return Err(ImportError::UnsupportedFormat(
                    "Samsung Health archive does not contain com.samsung.health.sleep CSV".into(),
                ));
            }
        } else {
            let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
            parse_samsung_sleep(
                file,
                streaming_limits,
                cancel,
                now,
                &stages_by_sleep_id,
                &mut batch,
                &mut invalid_records,
            )?;
        }

        Ok(ParsedImportOutput {
            provider_id: HealthProviderId::SamsungHealth,
            export_format: if is_zip {
                "samsung_health_zip".to_string()
            } else {
                "samsung_health_csv".to_string()
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

fn read_samsung_headers<R: Read>(
    csv: &mut CsvStreamReader<R>,
) -> Result<Option<HashMap<String, usize>>, ImportError> {
    let Some(first) = csv.next_row()? else {
        return Ok(None);
    };
    let headers = if first
        .first()
        .is_some_and(|c| c.trim().starts_with("com.samsung.health"))
    {
        match csv.next_row()? {
            Some(h) => h,
            None => return Ok(None),
        }
    } else {
        first
    };
    let map = headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim().to_ascii_lowercase(), i))
        .collect();
    Ok(Some(map))
}

fn parse_samsung_stages<R: Read>(
    reader: R,
    limits: &StreamingParserLimits,
    cancel: &ImportCancellationToken,
    out: &mut HashMap<String, Vec<(i64, i64, SleepStageType, String)>>,
) -> Result<(), ImportError> {
    let mut csv = CsvStreamReader::new(reader, ',', *limits);
    let Some(col) = read_samsung_headers(&mut csv)? else {
        return Ok(());
    };
    let Some(&start_idx) = col.get("start_time") else {
        return Ok(());
    };
    let Some(&end_idx) = col.get("end_time") else {
        return Ok(());
    };
    let Some(&stage_idx) = col.get("stage") else {
        return Ok(());
    };
    let sleep_id_idx = col.get("sleep_id").copied();

    while let Some(row) = csv.next_row()? {
        cancel.check()?;
        let Ok((s_ms, _)) = parse_timestamp_with_offset(row.get(start_idx).map(|s| s.as_str()).unwrap_or("")) else {
            continue;
        };
        let Ok((e_ms, _)) = parse_timestamp_with_offset(row.get(end_idx).map(|s| s.as_str()).unwrap_or("")) else {
            continue;
        };
        if e_ms <= s_ms {
            continue;
        }
        let raw_stage = row.get(stage_idx).map(|s| s.trim()).unwrap_or("");
        let st = match raw_stage.to_ascii_lowercase().as_str() {
            "40001" | "awake" => SleepStageType::Awake,
            "40002" | "light" => SleepStageType::Light,
            "40003" | "deep" => SleepStageType::Deep,
            "40004" | "rem" => SleepStageType::Rem,
            _ => SleepStageType::Unknown,
        };
        let key = sleep_id_idx
            .and_then(|i| row.get(i))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "__unlinked__".to_string());
        out.entry(key)
            .or_default()
            .push((s_ms, e_ms, st, raw_stage.to_string()));
    }
    Ok(())
}

fn parse_samsung_sleep<R: Read>(
    reader: R,
    limits: &StreamingParserLimits,
    cancel: &ImportCancellationToken,
    now_ms: i64,
    stages_by_sleep_id: &HashMap<String, Vec<(i64, i64, SleepStageType, String)>>,
    batch: &mut NormalizedIngestionBatch,
    invalid_records: &mut usize,
) -> Result<(), ImportError> {
    let mut csv = CsvStreamReader::new(reader, ',', *limits);
    let Some(col) = read_samsung_headers(&mut csv)? else {
        return Err(ImportError::InvalidInput(
            "Samsung Health sleep CSV is empty".into(),
        ));
    };
    let start_idx = *col
        .get("start_time")
        .ok_or_else(|| ImportError::InvalidInput("Samsung sleep CSV missing start_time".into()))?;
    let end_idx = *col
        .get("end_time")
        .ok_or_else(|| ImportError::InvalidInput("Samsung sleep CSV missing end_time".into()))?;

    while let Some(row) = csv.next_row()? {
        cancel.check()?;
        let get = |name: &str| -> Option<&str> {
            col.get(name).and_then(|&i| row.get(i)).map(|s| s.trim())
        };
        let tz_off = get("time_offset").and_then(parse_utc_offset_secs);

        let Ok((start_ms, s_off)) = parse_timestamp_with_offset(row.get(start_idx).map(|s| s.as_str()).unwrap_or("")) else {
            *invalid_records += 1;
            continue;
        };
        let Ok((end_ms, e_off)) = parse_timestamp_with_offset(row.get(end_idx).map(|s| s.as_str()).unwrap_or("")) else {
            *invalid_records += 1;
            continue;
        };
        if end_ms <= start_ms {
            *invalid_records += 1;
            continue;
        }

        let uuid_str = get("datauuid").filter(|s| !s.is_empty());
        let ext_id = uuid_str
            .map(|u| format!("samsung_sleep_{u}"))
            .unwrap_or_else(|| format!("samsung_sleep_{start_ms}_{end_ms}"));
        let raw_id = format!("imp_{ext_id}");

        let mut raw_stages = Vec::new();
        if let Some(u) = uuid_str {
            if let Some(list) = stages_by_sleep_id.get(u) {
                for (idx, (s, e, st, code)) in list.iter().enumerate() {
                    raw_stages.push(SleepStageInterval {
                        id: format!("{raw_id}_st_{idx}"),
                        raw_session_id: raw_id.clone(),
                        stage_type: *st,
                        start_at_ms: *s,
                        end_at_ms: *e,
                        provider_stage_code: Some(code.clone()),
                    });
                }
            }
        }
        if raw_stages.is_empty() {
            if let Some(unlinked) = stages_by_sleep_id.get("__unlinked__") {
                for (idx, (s, e, st, code)) in unlinked.iter().enumerate() {
                    if *s >= start_ms && *e <= end_ms {
                        raw_stages.push(SleepStageInterval {
                            id: format!("{raw_id}_st_{idx}"),
                            raw_session_id: raw_id.clone(),
                            stage_type: *st,
                            start_at_ms: *s,
                            end_at_ms: *e,
                            provider_stage_code: Some(code.clone()),
                        });
                    }
                }
            }
        }
        let stages = normalize_stage_intervals(raw_stages);
        let span_mins = (end_ms - start_ms) as f64 / 60_000.0;
        let asleep_mins: f64 = stages
            .iter()
            .filter(|s| s.stage_type.counts_as_asleep())
            .map(|s| (s.end_at_ms - s.start_at_ms) as f64 / 60_000.0)
            .sum();
        let duration_mins = if asleep_mins > 0.0 { asleep_mins } else { span_mins };
        let eff = get("efficiency").and_then(|v| v.parse::<f64>().ok());

        let mut flags = Vec::new();
        if stages.is_empty() {
            flags.push(SleepQualityFlag::MissingStages);
        }

        batch.sleep_sessions.push(RawSleepSession {
            id: raw_id,
            provider_id: HealthProviderId::SamsungHealth,
            device_id: None,
            external_record_id: ext_id,
            source_app_bundle: get("pkg_name").map(ToString::to_string).or_else(|| Some("Samsung Health".to_string())),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: s_off.or(tz_off),
            end_tz_offset_secs: e_off.or(tz_off),
            duration_mins,
            time_in_bed_mins: Some(span_mins),
            sleep_efficiency_pct: eff,
            awake_mins: None,
            light_mins: None,
            deep_mins: None,
            rem_mins: None,
            sleep_kind: if duration_mins < 180.0 { SleepKind::Nap } else { SleepKind::MainSleep },
            provider_sleep_kind: None,
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

        if let Some(score) = get("sleep_score").and_then(|v| v.parse::<f64>().ok()) {
            let rep_date = crate::health::time::local_date_string(end_ms, e_off.or(tz_off));
            let rec_ext = format!("samsung_sleep_score_{end_ms}");
            batch.recovery_observations.push(RecoveryObservation {
                id: format!("rec_{rec_ext}"),
                provider_id: HealthProviderId::SamsungHealth,
                external_record_id: rec_ext,
                score_name: "Samsung Sleep Score".to_string(),
                score_value: Some(score),
                scale_min: 0.0,
                scale_max: 100.0,
                score_state: "SCORED".to_string(),
                algorithm_id: Some("samsung_sleep_score".to_string()),
                represented_date: rep_date,
                measured_at_ms: end_ms,
                underlying_metrics_json: None,
                acquisition_at_ms: now_ms,
                is_synthetic: false,
            });
        }
    }
    Ok(())
}
