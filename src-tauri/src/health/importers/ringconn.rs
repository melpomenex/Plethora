//! RingConn consumer export adapter (`sleep.csv` + `vitals.csv` ZIP).

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

pub struct RingConnExportAdapter;

impl WearableImportAdapter for RingConnExportAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "ringconn_consumer_export".to_string(),
            provider_id: HealthProviderId::Ringconn,
            display_name: "RingConn".to_string(),
            format_id: "ringconn_csv_export".to_string(),
            format_label: "RingConn Data Export (ZIP / CSV)".to_string(),
            format_version: "1.0".to_string(),
            verification_status: VerificationStatus::ImplementedFixtureTested,
            capabilities: ImportCapabilities {
                supports_archive: true,
                supports_standalone: true,
                supports_detailed_stages: false,
                supports_stage_totals_only: true,
                supports_timezone: false,
                supported_extensions: vec!["zip".to_string(), "csv".to_string()],
                supported_categories: vec![
                    HealthDataCategory::Sleep,
                    HealthDataCategory::HeartRate,
                    HealthDataCategory::RestingHeartRate,
                    HealthDataCategory::Hrv,
                    HealthDataCategory::Recovery,
                ],
                known_limitations: vec![
                    "RingConn CSV exports provide daily sleep stage totals without per-epoch hypnogram intervals.".to_string(),
                ],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip {
            let has_ringconn = inspection.zip_samples.iter().any(|(path, sample)| {
                let l = path.to_ascii_lowercase();
                (l.ends_with("sleep.csv") && sample.contains("Time Asleep") && sample.contains("Deep Sleep"))
                    || (l.ends_with("vitals.csv") && sample.contains("Average HRV"))
            });
            if has_ringconn {
                return Some(DetectionCandidate {
                    provider_id: HealthProviderId::Ringconn,
                    adapter_id: "ringconn_consumer_export".to_string(),
                    format_id: "ringconn_zip".to_string(),
                    format_label: "RingConn Data Export (.zip)".to_string(),
                    confidence: DetectionConfidence::Confident,
                    score: 96,
                    reasons: vec!["Archive contains RingConn sleep.csv / vitals.csv".to_string()],
                });
            }
            return None;
        }

        let headers_lower: Vec<String> = inspection
            .csv_headers
            .iter()
            .map(|h| h.trim().to_ascii_lowercase())
            .collect();
        if headers_lower.iter().any(|h| h == "date")
            && headers_lower.iter().any(|h| h == "time asleep" || h == "total sleep time")
            && headers_lower.iter().any(|h| h == "deep sleep")
        {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::Ringconn,
                adapter_id: "ringconn_consumer_export".to_string(),
                format_id: "ringconn_sleep_csv".to_string(),
                format_label: "RingConn sleep.csv".to_string(),
                confidence: DetectionConfidence::Probable,
                score: 88,
                reasons: vec!["CSV headers match RingConn sleep summary".to_string()],
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
        let mut tz_assumptions = Vec::new();
        let now = chrono::Utc::now().timestamp_millis();

        if is_zip {
            let mut archive = SafeZipArchive::open(path, *archive_limits)?;
            let sleep_idx = archive
                .entries()
                .iter()
                .find(|e| !e.is_dir && e.normalized_path.to_ascii_lowercase().ends_with("sleep.csv"))
                .map(|e| e.index);
            let vitals_idx = archive
                .entries()
                .iter()
                .find(|e| !e.is_dir && e.normalized_path.to_ascii_lowercase().ends_with("vitals.csv"))
                .map(|e| e.index);

            if sleep_idx.is_none() && vitals_idx.is_none() {
                return Err(ImportError::UnsupportedFormat(
                    "RingConn archive missing sleep.csv and vitals.csv".into(),
                ));
            }

            if let Some(idx) = sleep_idx {
                archive.stream_entry(idx, cancel, |r| {
                    parse_ringconn_sleep_csv(r, streaming_limits, cancel, now, &mut batch, &mut invalid_records, &mut tz_assumptions)
                })?;
            }
            if let Some(idx) = vitals_idx {
                archive.stream_entry(idx, cancel, |r| {
                    parse_ringconn_vitals_csv(r, streaming_limits, cancel, now, &mut batch)
                })?;
            }
        } else {
            let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
            parse_ringconn_sleep_csv(
                file,
                streaming_limits,
                cancel,
                now,
                &mut batch,
                &mut invalid_records,
                &mut tz_assumptions,
            )?;
        }

        Ok(ParsedImportOutput {
            provider_id: HealthProviderId::Ringconn,
            export_format: if is_zip {
                "ringconn_zip".to_string()
            } else {
                "ringconn_sleep_csv".to_string()
            },
            format_version: Some("1.0".to_string()),
            batch,
            invalid_records,
            missing_fields: Vec::new(),
            unsupported_fields: Vec::new(),
            timezone_assumptions: tz_assumptions,
            row_errors: Vec::new(),
        })
    }
}

fn parse_ringconn_sleep_csv<R: Read>(
    reader: R,
    limits: &StreamingParserLimits,
    cancel: &ImportCancellationToken,
    now_ms: i64,
    batch: &mut NormalizedIngestionBatch,
    invalid_records: &mut usize,
    tz_assumptions: &mut Vec<String>,
) -> Result<(), ImportError> {
    let mut csv = CsvStreamReader::new(reader, ',', *limits);
    let Some(headers) = csv.next_row()? else {
        return Err(ImportError::InvalidInput("RingConn sleep.csv is empty".into()));
    };
    let col: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim().to_ascii_lowercase(), i))
        .collect();
    let Some(&date_idx) = col.get("date") else {
        return Err(ImportError::InvalidInput("RingConn sleep.csv missing Date".into()));
    };

    let mut noted = false;
    while let Some(row) = csv.next_row()? {
        cancel.check()?;
        let get = |name: &str| -> Option<&str> {
            col.get(name).and_then(|&i| row.get(i)).map(|s| s.trim())
        };
        let Some(date_str) = row.get(date_idx).map(|s| s.trim()).filter(|s| !s.is_empty()) else {
            *invalid_records += 1;
            continue;
        };
        let Some(total_mins) = get("time asleep")
            .or_else(|| get("total sleep time"))
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|m| m.is_finite() && *m > 0.0)
        else {
            *invalid_records += 1;
            continue;
        };

        let Ok((end_ms, _)) = parse_timestamp_with_offset(&format!("{date_str}T07:00:00Z")) else {
            *invalid_records += 1;
            continue;
        };
        let start_ms = end_ms - (total_mins * 60_000.0).round() as i64;
        if !noted {
            noted = true;
            tz_assumptions.push(
                "RingConn sleep.csv provides daily totals keyed by Date without exact bedtime/wake timestamps; sessions are anchored to 07:00 UTC on the recorded date.".to_string(),
            );
        }

        let deep_mins = get("deep sleep").and_then(|v| v.parse::<f64>().ok());
        let rem_mins = get("rem sleep").and_then(|v| v.parse::<f64>().ok());
        let light_mins = get("light sleep").and_then(|v| v.parse::<f64>().ok());
        let awake_mins = get("awake time").and_then(|v| v.parse::<f64>().ok());

        let ext_id = format!("ringconn_sleep_{date_str}");
        batch.sleep_sessions.push(RawSleepSession {
            id: format!("imp_{ext_id}"),
            provider_id: HealthProviderId::Ringconn,
            device_id: None,
            external_record_id: ext_id,
            source_app_bundle: Some("RingConn".to_string()),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: None,
            end_tz_offset_secs: None,
            duration_mins: total_mins,
            time_in_bed_mins: awake_mins.map(|a| total_mins + a),
            sleep_efficiency_pct: awake_mins.map(|a| ((total_mins / (total_mins + a)) * 100.0).clamp(0.0, 100.0)),
            awake_mins,
            light_mins,
            deep_mins,
            rem_mins,
            sleep_kind: if total_mins < 180.0 { SleepKind::Nap } else { SleepKind::MainSleep },
            provider_sleep_kind: None,
            quality_flags: vec![
                SleepQualityFlag::AggregateStageDurationsOnly,
                SleepQualityFlag::IncompleteBoundaries,
            ],
            quality_score: 0.85,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms: now_ms,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: false,
            stages: Vec::new(),
        });
    }
    Ok(())
}

fn parse_ringconn_vitals_csv<R: Read>(
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
    let Some(&date_idx) = col.get("date") else {
        return Ok(());
    };

    while let Some(row) = csv.next_row()? {
        cancel.check()?;
        let get = |name: &str| -> Option<&str> {
            col.get(name).and_then(|&i| row.get(i)).map(|s| s.trim())
        };
        let Some(date_str) = row.get(date_idx).map(|s| s.trim()).filter(|s| !s.is_empty()) else {
            continue;
        };
        let Ok((ts, _)) = parse_timestamp_with_offset(&format!("{date_str}T07:00:00Z")) else {
            continue;
        };

        if let Some(hrv) = get("average hrv").and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && *v > 0.0) {
            let ext = format!("ringconn_hrv_{date_str}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{ext}"),
                provider_id: HealthProviderId::Ringconn,
                device_id: None,
                external_record_id: ext,
                metric_type: PhysiologicalMetricType::Hrv,
                value: hrv,
                unit: "ms".to_string(),
                hrv_method: HrvMethod::Rmssd,
                measured_at_ms: ts,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: None,
                aggregation_method: Some("daily_mean".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms: now_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
            });
        }

        if let Some(rhr) = get("minimum heart rate")
            .or_else(|| get("resting heart rate"))
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v > 0.0)
        {
            let ext = format!("ringconn_rhr_{date_str}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{ext}"),
                provider_id: HealthProviderId::Ringconn,
                device_id: None,
                external_record_id: ext,
                metric_type: PhysiologicalMetricType::RestingHeartRate,
                value: rhr,
                unit: "bpm".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: ts,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: None,
                aggregation_method: Some("daily_min".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms: now_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
            });
        }

        if let Some(spo2) = get("spo2").and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && *v > 0.0) {
            let ext = format!("ringconn_spo2_{date_str}");
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("obs_{ext}"),
                provider_id: HealthProviderId::Ringconn,
                device_id: None,
                external_record_id: ext,
                metric_type: PhysiologicalMetricType::Spo2,
                value: spo2,
                unit: "%".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: ts,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: None,
                aggregation_method: Some("daily_mean".to_string()),
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
