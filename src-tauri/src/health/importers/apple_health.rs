//! Streaming Apple Health `export.xml` and `export.zip` importer (no 50 MB limit).

use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use crate::health::models::{
    HealthDataCategory, HealthDevice, HealthProviderId, HrvMethod, PhysiologicalMetricType,
    PhysiologicalObservation, RawSleepSession, SleepKind, SleepStageInterval, SleepStageType,
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

pub struct AppleHealthAdapter;

impl WearableImportAdapter for AppleHealthAdapter {
    fn descriptor(&self) -> ImportAdapterDescriptor {
        ImportAdapterDescriptor {
            adapter_id: "apple_health_export".to_string(),
            provider_id: HealthProviderId::AppleHealthkit,
            display_name: "Apple Health / Apple Watch".to_string(),
            format_id: "apple_health_xml_zip".to_string(),
            format_label: "Apple Health Export (XML / ZIP)".to_string(),
            format_version: "1.0".to_string(),
            verification_status: VerificationStatus::ImplementedFixtureTested,
            capabilities: ImportCapabilities {
                supports_archive: true,
                supports_standalone: true,
                supports_detailed_stages: true,
                supports_stage_totals_only: false,
                supports_timezone: true,
                supported_extensions: vec!["xml".to_string(), "zip".to_string()],
                supported_categories: vec![
                    HealthDataCategory::Sleep,
                    HealthDataCategory::SleepStages,
                    HealthDataCategory::HeartRate,
                    HealthDataCategory::RestingHeartRate,
                    HealthDataCategory::Hrv,
                    HealthDataCategory::RespiratoryRate,
                    HealthDataCategory::Activity,
                ],
                known_limitations: vec![
                    "Apple Health HRV is SDNN rather than RMSSD".to_string(),
                    "Apple Health does not export proprietary sleep or readiness scores".to_string(),
                ],
            },
        }
    }

    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate> {
        if inspection.is_zip {
            let has_export_xml = inspection.zip_paths.iter().any(|p| {
                let l = p.to_ascii_lowercase();
                l == "apple_health_export/export.xml" || l.ends_with("/export.xml") || l == "export.xml"
            });
            if has_export_xml {
                return Some(DetectionCandidate {
                    provider_id: HealthProviderId::AppleHealthkit,
                    adapter_id: "apple_health_export".to_string(),
                    format_id: "apple_health_zip".to_string(),
                    format_label: "Apple Health Export Archive (.zip)".to_string(),
                    confidence: DetectionConfidence::Confident,
                    score: 98,
                    reasons: vec!["Archive contains Apple Health export.xml".to_string()],
                });
            }
            return None;
        }

        if inspection.text_sample.contains("<HealthData") {
            return Some(DetectionCandidate {
                provider_id: HealthProviderId::AppleHealthkit,
                adapter_id: "apple_health_export".to_string(),
                format_id: "apple_health_xml".to_string(),
                format_label: "Apple Health export.xml".to_string(),
                confidence: DetectionConfidence::Confident,
                score: 98,
                reasons: vec!["XML contains <HealthData> root element".to_string()],
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

        if is_zip {
            let mut archive = SafeZipArchive::open(path, *archive_limits)?;
            let idx = archive
                .entries()
                .iter()
                .find(|e| {
                    !e.is_dir && {
                        let l = e.normalized_path.to_ascii_lowercase();
                        l == "apple_health_export/export.xml"
                            || l.ends_with("/export.xml")
                            || l == "export.xml"
                    }
                })
                .map(|e| e.index)
                .ok_or_else(|| {
                    ImportError::InvalidInput(
                        "Apple Health archive does not contain export.xml".to_string(),
                    )
                })?;

            return archive.stream_entry(idx, cancel, |reader| {
                stream_apple_health_xml_reader(reader, cancel, progress, job_id, "apple_health_zip")
            });
        }

        let meta = std::fs::metadata(path).map_err(|e| ImportError::Io(e.to_string()))?;
        if meta.len() > streaming_limits.max_xml_bytes {
            return Err(ImportError::SecurityViolation(format!(
                "Apple Health XML exceeds {} byte streaming limit",
                streaming_limits.max_xml_bytes
            )));
        }

        let file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
        let reader = BufReader::with_capacity(64 * 1024, file);
        stream_apple_health_xml_reader(reader, cancel, progress, job_id, "apple_health_xml")
    }
}

pub fn stream_apple_health_xml_reader<R: Read>(
    raw_reader: R,
    cancel: &ImportCancellationToken,
    progress: Option<&dyn Fn(ImportProgressEvent)>,
    job_id: &str,
    format_id: &str,
) -> Result<ParsedImportOutput, ImportError> {
    let mut reader = Reader::from_reader(BufReader::with_capacity(64 * 1024, raw_reader));
    reader.config_mut().trim_text(true);

    let mut depth: usize = 0;
    let mut found_root = false;
    let mut buf = Vec::with_capacity(8192);
    let mut sleep_samples_by_source: HashMap<
        String,
        Vec<(i64, i64, Option<i32>, Option<i32>, SleepStageType, String)>,
    > = HashMap::new();
    let mut physio = Vec::new();
    let mut devices_map: HashMap<String, HealthDevice> = HashMap::new();
    let mut skipped = 0usize;
    let mut event_count = 0usize;
    let now = chrono::Utc::now().timestamp_millis();

    loop {
        event_count += 1;
        if event_count % 4096 == 0 {
            cancel.check()?;
            if event_count % 24576 == 0 {
                if let Some(cb) = progress {
                    cb(ImportProgressEvent {
                        job_id: job_id.to_string(),
                        phase: "parsing".to_string(),
                        processed: event_count,
                        total: None,
                        message: format!("Streaming Apple Health XML ({event_count} elements)..."),
                    });
                }
            }
        }

        let event = reader.read_event_into(&mut buf).map_err(|e| {
            if e.to_string().contains("Import cancelled") {
                ImportError::Cancelled
            } else {
                ImportError::InvalidInput("Malformed Apple Health export.xml".to_string())
            }
        })?;

        let is_start = matches!(&event, Event::Start(_));
        match event {
            Event::Start(e) | Event::Empty(e) => {
                let name = e.name();
                if depth == 0 {
                    if found_root || name.as_ref() != b"HealthData" {
                        return Err(ImportError::InvalidInput(
                            "Expected one HealthData root in Apple Health export.xml".into(),
                        ));
                    }
                    found_root = true;
                }
                if is_start {
                    depth += 1;
                }
                if name.as_ref() == b"Record" {
                    let mut rec_type = String::new();
                    let mut source_name = String::from("Apple Health");
                    let mut device_name: Option<String> = None;
                    let mut unit = String::new();
                    let mut value = String::new();
                    let mut start_date = String::new();
                    let mut end_date = String::new();

                    for attr in e.attributes() {
                        let attr = attr.map_err(|_| {
                            ImportError::InvalidInput("Malformed Apple Health record attribute".into())
                        })?;
                        let key = attr.key.as_ref();
                        let val = attr
                            .unescape_value()
                            .map_err(|_| {
                                ImportError::InvalidInput(
                                    "Malformed Apple Health record attribute value".into(),
                                )
                            })?
                            .into_owned();
                        match key {
                            b"type" => rec_type = val,
                            b"sourceName" => source_name = val,
                            b"device" => device_name = Some(val),
                            b"unit" => unit = val,
                            b"value" => value = val,
                            b"startDate" => start_date = val,
                            b"endDate" => end_date = val,
                            _ => {}
                        }
                    }

                    if !devices_map.contains_key(&source_name) {
                        devices_map.insert(
                            source_name.clone(),
                            HealthDevice {
                                id: format!("dev_ah_{}", sanitize_id(&source_name)),
                                provider_id: HealthProviderId::AppleHealthkit,
                                external_device_id: source_name.clone(),
                                manufacturer: device_name.as_deref().and_then(|d| {
                                    if d.contains("Apple") {
                                        Some("Apple Inc.".to_string())
                                    } else {
                                        None
                                    }
                                }),
                                model: device_name.clone(),
                                source_app_bundle: Some(source_name.clone()),
                                platform_source_id: Some("apple_health_export".to_string()),
                                metadata_json: None,
                            },
                        );
                    }

                    if rec_type == "HKCategoryTypeIdentifierSleepAnalysis" {
                        match (
                            parse_timestamp_with_offset(&start_date),
                            parse_timestamp_with_offset(&end_date),
                        ) {
                            (Ok((s_ms, s_off)), Ok((e_ms, e_off))) if e_ms > s_ms => {
                                let stage = map_hk_xml_sleep_value(&value);
                                sleep_samples_by_source
                                    .entry(source_name)
                                    .or_default()
                                    .push((s_ms, e_ms, s_off, e_off, stage, value));
                            }
                            _ => skipped += 1,
                        }
                    } else if let Some((metric, hrv_method)) = map_hk_xml_metric(&rec_type) {
                        if let (Ok((s_ms, s_off)), Ok((e_ms, _)), Ok(num_val)) = (
                            parse_timestamp_with_offset(&start_date),
                            parse_timestamp_with_offset(&end_date),
                            value.trim().parse::<f64>(),
                        ) {
                            if num_val.is_finite() {
                                let normalized_val = if rec_type
                                    == "HKQuantityTypeIdentifierOxygenSaturation"
                                    && num_val <= 1.0
                                {
                                    num_val * 100.0
                                } else {
                                    num_val
                                };
                                let ext_id = format!(
                                    "hkxml_{}_{}_{}",
                                    metric.as_str(),
                                    s_ms,
                                    sanitize_id(&source_name)
                                );
                                physio.push(PhysiologicalObservation {
                                    id: format!("obs_{ext_id}"),
                                    provider_id: HealthProviderId::AppleHealthkit,
                                    device_id: devices_map.get(&source_name).map(|d| d.id.clone()),
                                    external_record_id: ext_id,
                                    metric_type: metric,
                                    value: normalized_val,
                                    unit: if unit.is_empty() {
                                        default_unit_for(metric).to_string()
                                    } else {
                                        unit
                                    },
                                    hrv_method,
                                    measured_at_ms: e_ms,
                                    period_start_ms: Some(s_ms),
                                    period_end_ms: Some(e_ms),
                                    tz_offset_secs: s_off,
                                    aggregation_method: None,
                                    quality_flags: Vec::new(),
                                    acquisition_at_ms: now,
                                    sync_batch_id: None,
                                    is_deleted: false,
                                    is_synthetic: false,
                                });
                            }
                        }
                    }
                }
            }
            Event::DocType(declaration) => {
                let declaration = std::str::from_utf8(declaration.as_ref()).map_err(|_| {
                    ImportError::SecurityViolation("Malformed Apple Health document type".into())
                })?;
                let allowed = declaration.trim_start().starts_with("HealthData")
                    && !["ENTITY", "SYSTEM", "PUBLIC", "%"]
                        .iter()
                        .any(|pattern| declaration.contains(pattern));
                if found_root || !allowed {
                    return Err(ImportError::SecurityViolation(
                        "Unsafe Apple Health XML document type".into(),
                    ));
                }
            }
            Event::End(_) => {
                depth = depth.checked_sub(1).ok_or_else(|| {
                    ImportError::InvalidInput("Unexpected XML closing tag".into())
                })?;
            }
            Event::Text(text) if depth == 0 && !text.iter().all(u8::is_ascii_whitespace) => {
                return Err(ImportError::InvalidInput(
                    "Unexpected text outside the Apple Health XML root".into(),
                ));
            }
            Event::Eof if depth == 0 && found_root => break,
            Event::Eof => {
                return Err(ImportError::InvalidInput(
                    "Incomplete Apple Health export.xml".into(),
                ))
            }
            _ => {}
        }
        buf.clear();
    }

    let mut sessions = Vec::new();
    let max_gap_ms: i64 = 45 * 60_000;
    for (source_name, mut segments) in sleep_samples_by_source {
        segments.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        let mut current = Vec::new();
        let dev_id = devices_map.get(&source_name).map(|d| d.id.clone());
        for seg in segments {
            if let Some(last_end) = current.iter().map(|s: &(i64, i64, Option<i32>, Option<i32>, SleepStageType, String)| s.1).max() {
                if seg.0 - last_end > max_gap_ms {
                    if let Some(sess) = build_session(&source_name, dev_id.as_deref(), &current, now) {
                        sessions.push(sess);
                    }
                    current.clear();
                }
            }
            current.push(seg);
        }
        if let Some(sess) = build_session(&source_name, dev_id.as_deref(), &current, now) {
            sessions.push(sess);
        }
    }

    Ok(ParsedImportOutput {
        provider_id: HealthProviderId::AppleHealthkit,
        export_format: format_id.to_string(),
        format_version: Some("1.0".to_string()),
        batch: NormalizedIngestionBatch {
            devices: devices_map.into_values().collect(),
            sleep_sessions: sessions,
            physio_observations: physio,
            ..Default::default()
        },
        invalid_records: skipped,
        missing_fields: Vec::new(),
        unsupported_fields: Vec::new(),
        timezone_assumptions: Vec::new(),
        row_errors: Vec::new(),
    })
}

fn build_session(
    source_name: &str,
    device_id: Option<&str>,
    segs: &[(i64, i64, Option<i32>, Option<i32>, SleepStageType, String)],
    now_ms: i64,
) -> Option<RawSleepSession> {
    if segs.is_empty() {
        return None;
    }
    let start_ms = segs.iter().map(|s| s.0).min()?;
    let end_ms = segs.iter().map(|s| s.1).max()?;
    if end_ms <= start_ms {
        return None;
    }
    let start_off = segs.first()?.2;
    let end_off = segs.last()?.3.or(start_off);
    let ext_id = format!("hkxml_sleep_{}_{}", sanitize_id(source_name), start_ms);
    let raw_id = format!("imp_{ext_id}");

    let stages: Vec<SleepStageInterval> = normalize_stage_intervals(
        segs.iter()
            .enumerate()
            .map(|(idx, s)| SleepStageInterval {
                id: format!("{raw_id}_st_{idx}"),
                raw_session_id: raw_id.clone(),
                stage_type: s.4,
                start_at_ms: s.0,
                end_at_ms: s.1,
                provider_stage_code: Some(s.5.clone()),
            })
            .collect(),
    );

    let asleep_ms: i64 = stages
        .iter()
        .filter(|s| s.stage_type.counts_as_asleep())
        .map(|s| s.end_at_ms - s.start_at_ms)
        .sum();
    let span_mins = (end_ms - start_ms) as f64 / 60_000.0;
    let duration_mins = if asleep_ms > 0 {
        asleep_ms as f64 / 60_000.0
    } else {
        span_mins
    };

    Some(RawSleepSession {
        id: raw_id,
        provider_id: HealthProviderId::AppleHealthkit,
        device_id: device_id.map(ToString::to_string),
        external_record_id: ext_id,
        source_app_bundle: Some(source_name.to_string()),
        start_at_ms: start_ms,
        end_at_ms: end_ms,
        start_tz_offset_secs: start_off,
        end_tz_offset_secs: end_off,
        duration_mins,
        time_in_bed_mins: Some(span_mins),
        sleep_efficiency_pct: Some(((duration_mins / span_mins) * 100.0).clamp(0.0, 100.0)),
        awake_mins: None,
        light_mins: None,
        deep_mins: None,
        rem_mins: None,
        sleep_kind: SleepKind::Unknown,
        provider_sleep_kind: None,
        quality_flags: Vec::new(),
        quality_score: 0.9,
        notes: None,
        subjective_quality: None,
        acquisition_at_ms: now_ms,
        sync_batch_id: None,
        is_deleted: false,
        is_synthetic: false,
        stages,
    })
}

fn sanitize_id(raw: &str) -> String {
    raw.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

fn map_hk_xml_sleep_value(raw: &str) -> SleepStageType {
    match raw {
        "HKCategoryValueSleepAnalysisAsleepCore" => SleepStageType::Light,
        "HKCategoryValueSleepAnalysisAsleepDeep" => SleepStageType::Deep,
        "HKCategoryValueSleepAnalysisAsleepREM" => SleepStageType::Rem,
        "HKCategoryValueSleepAnalysisAsleep" | "HKCategoryValueSleepAnalysisAsleepUnspecified" => {
            SleepStageType::AsleepUnknown
        }
        "HKCategoryValueSleepAnalysisAwake" => SleepStageType::Awake,
        "HKCategoryValueSleepAnalysisInBed" => SleepStageType::InBed,
        _ => SleepStageType::Unknown,
    }
}

fn map_hk_xml_metric(rec_type: &str) -> Option<(PhysiologicalMetricType, HrvMethod)> {
    match rec_type {
        "HKQuantityTypeIdentifierHeartRate" => {
            Some((PhysiologicalMetricType::HeartRate, HrvMethod::Unknown))
        }
        "HKQuantityTypeIdentifierRestingHeartRate" => Some((
            PhysiologicalMetricType::RestingHeartRate,
            HrvMethod::Unknown,
        )),
        "HKQuantityTypeIdentifierHeartRateVariabilitySDNN" => {
            Some((PhysiologicalMetricType::Hrv, HrvMethod::Sdnn))
        }
        "HKQuantityTypeIdentifierRespiratoryRate" => Some((
            PhysiologicalMetricType::RespiratoryRate,
            HrvMethod::Unknown,
        )),
        "HKQuantityTypeIdentifierOxygenSaturation" => {
            Some((PhysiologicalMetricType::Spo2, HrvMethod::Unknown))
        }
        "HKQuantityTypeIdentifierAppleSleepingWristTemperature" => Some((
            PhysiologicalMetricType::SkinTempDeviation,
            HrvMethod::Unknown,
        )),
        "HKQuantityTypeIdentifierStepCount" => {
            Some((PhysiologicalMetricType::Steps, HrvMethod::Unknown))
        }
        "HKQuantityTypeIdentifierActiveEnergyBurned" => {
            Some((PhysiologicalMetricType::ActiveCalories, HrvMethod::Unknown))
        }
        _ => None,
    }
}

fn default_unit_for(metric: PhysiologicalMetricType) -> &'static str {
    match metric {
        PhysiologicalMetricType::HeartRate | PhysiologicalMetricType::RestingHeartRate => "bpm",
        PhysiologicalMetricType::Hrv => "ms",
        PhysiologicalMetricType::Spo2 => "%",
        PhysiologicalMetricType::SkinTempDeviation => "C",
        PhysiologicalMetricType::RespiratoryRate => "brpm",
        PhysiologicalMetricType::Steps => "count",
        PhysiologicalMetricType::ActiveCalories => "kcal",
    }
}
