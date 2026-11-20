//! Manual sleep entry, validated JSON/CSV/Apple Health XML importers,
//! and passphrase-encrypted portable `.plethora-health.enc` transfer bundles.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng, Payload},
    AeadCore, Aes256Gcm, Nonce,
};
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use quick_xml::events::Event;
use quick_xml::Reader;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::io::BufReader;

use super::db::HealthVault;
use super::models::{
    HealthConsentRecord, HealthDataCategory, HealthDevice, HealthFileImportResult,
    HealthProviderId, HrvMethod, ManualSleepInput, PhysiologicalMetricType,
    PhysiologicalObservation, RawSleepSession, RecoveryObservation, SleepKind, SleepQualityFlag,
    SleepStageInterval, SleepStageType,
};
use super::provider::NormalizedIngestionBatch;
use super::reconciliation::normalize_stage_intervals;
use super::time::{elapsed_minutes, is_plausible_sleep_duration, parse_timestamp_with_offset};

pub const MAX_IMPORT_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_ENCRYPTED_IMPORT_BYTES: usize = (MAX_IMPORT_BYTES + 52).div_ceil(3) * 4;
pub const MAX_CSV_ROWS: usize = 500_000;
const ENCRYPTED_BUNDLE_MAGIC: &[u8; 8] = b"PLHLTHV1";
const ENCRYPTED_BUNDLE_AAD: &[u8] = b"plethora-health-export-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthExportBundleV1 {
    pub schema_version: u32,
    pub exported_at_ms: i64,
    pub source_platform: String,
    pub contains_healthkit_derived: bool,
    pub devices: Vec<HealthDevice>,
    pub sleep_sessions: Vec<RawSleepSession>,
    pub physiological_observations: Vec<PhysiologicalObservation>,
    pub recovery_observations: Vec<RecoveryObservation>,
}

/// Create or update a manual sleep/nap session.
pub async fn upsert_manual_sleep(
    vault: &HealthVault,
    input: ManualSleepInput,
) -> Result<super::models::HealthSyncReport, String> {
    let (start_ms, parsed_start_off) = parse_timestamp_with_offset(&input.start_iso)?;
    let (end_ms, parsed_end_off) = parse_timestamp_with_offset(&input.end_iso)?;
    let override_off = match input.tz_offset_minutes {
        Some(minutes) if (-1080..=1080).contains(&minutes) => Some(minutes * 60),
        Some(_) => return Err("Invalid timezone offset".into()),
        None => None,
    };
    let start_ms = start_ms
        - i64::from(
            override_off
                .filter(|_| parsed_start_off.is_none())
                .unwrap_or_default(),
        ) * 1000;
    let end_ms = end_ms
        - i64::from(
            override_off
                .filter(|_| parsed_end_off.is_none())
                .unwrap_or_default(),
        ) * 1000;
    let duration_mins = elapsed_minutes(start_ms, end_ms)?;
    if duration_mins > 2_880.0 || !valid_timestamp(start_ms) || !valid_timestamp(end_ms) {
        return Err("Manual sleep must be within a 48-hour period".into());
    }
    let start_tz = parsed_start_off.or(override_off);
    let end_tz = parsed_end_off.or(override_off).or(start_tz);

    let sleep_kind = input.sleep_kind.unwrap_or_else(|| {
        if duration_mins < 180.0 {
            SleepKind::Nap
        } else {
            SleepKind::MainSleep
        }
    });

    let mut quality_flags = vec![
        SleepQualityFlag::UserEntered,
        SleepQualityFlag::MissingStages,
    ];
    if !is_plausible_sleep_duration(duration_mins) {
        quality_flags.push(SleepQualityFlag::ImplausibleDuration);
    }

    let efficiency = input.time_in_bed_mins.and_then(|tib| {
        if tib > 0.0 && tib >= duration_mins {
            Some(((duration_mins / tib) * 100.0).clamp(0.0, 100.0))
        } else {
            None
        }
    });

    let rec_id = input
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("manual_{}", uuid::Uuid::new_v4()));

    let now = chrono::Utc::now().timestamp_millis();
    let consent = HealthConsentRecord {
        id: format!("consent_{}", uuid::Uuid::new_v4()),
        provider_id: HealthProviderId::Manual,
        action: "manual_entry".to_string(),
        categories: vec![HealthDataCategory::Sleep],
        purpose: "Personal sleep log for Sleep Chart and learning correlation".to_string(),
        policy_version: "1.0".to_string(),
        recorded_at_ms: now,
    };

    let session = RawSleepSession {
        id: rec_id.clone(),
        provider_id: HealthProviderId::Manual,
        device_id: None,
        external_record_id: rec_id,
        source_app_bundle: Some("com.plethora.app.manual".to_string()),
        start_at_ms: start_ms,
        end_at_ms: end_ms,
        start_tz_offset_secs: start_tz,
        end_tz_offset_secs: end_tz,
        duration_mins,
        time_in_bed_mins: input.time_in_bed_mins,
        sleep_efficiency_pct: efficiency,
        awake_mins: None,
        light_mins: None,
        deep_mins: None,
        rem_mins: None,
        sleep_kind,
        provider_sleep_kind: Some(sleep_kind.as_str().to_string()),
        quality_flags,
        quality_score: 0.92,
        notes: input.notes,
        subjective_quality: input.subjective_quality.map(|q| q.clamp(1, 5)),
        acquisition_at_ms: now,
        sync_batch_id: None,
        is_deleted: false,
        is_synthetic: false,
        stages: Vec::new(),
    };

    vault
        .ingest_with_consent(
            HealthProviderId::Manual,
            "manual",
            NormalizedIngestionBatch {
                sleep_sessions: vec![session],
                ..Default::default()
            },
            Some(&consent),
        )
        .await
}

/// Export non-synthetic local health data to canonical JSON bundle.
pub async fn export_json_bundle(vault: &HealthVault) -> Result<HealthExportBundleV1, String> {
    let raw_sessions: Vec<RawSleepSession> = vault
        .load_raw_sleep_sessions(false)
        .await?
        .into_iter()
        .filter(|s| !s.is_synthetic)
        .collect();
    let physio = vault
        .query_physiological_observations(None, None, false)
        .await?;
    let recovery = vault.query_recovery_observations(None, None, false).await?;
    let devices = vault.list_devices().await?;
    let contains_healthkit_derived = raw_sessions.iter().any(|s| {
        s.provider_id == HealthProviderId::AppleHealthkit
            || s.external_record_id.starts_with("hkxml_")
    }) || physio.iter().any(|p| {
        p.provider_id == HealthProviderId::AppleHealthkit
            || p.external_record_id.starts_with("hkxml_")
    });

    Ok(HealthExportBundleV1 {
        schema_version: 1,
        exported_at_ms: chrono::Utc::now().timestamp_millis(),
        source_platform: std::env::consts::OS.to_string(),
        contains_healthkit_derived,
        devices,
        sleep_sessions: raw_sessions,
        physiological_observations: physio,
        recovery_observations: recovery,
    })
}

/// Encrypt canonical health JSON bundle into portable base64 `.plethora-health.enc` payload.
pub fn encrypt_export_bundle(
    bundle: &HealthExportBundleV1,
    passphrase: &str,
) -> Result<String, String> {
    if passphrase.trim().len() < 8 {
        return Err(
            "Passphrase must be at least 8 characters for encrypted health transfer".to_string(),
        );
    }
    let json = serde_json::to_vec(bundle).map_err(|e| format!("Failed serializing bundle: {e}"))?;
    if json.len() > MAX_IMPORT_BYTES {
        return Err("Health bundle exceeds the 50 MB payload limit".into());
    }
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), &salt, 100_000, &mut key);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("AES init error: {e}"))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: &json,
                aad: ENCRYPTED_BUNDLE_AAD,
            },
        )
        .map_err(|e| format!("Failed encrypting health bundle: {e}"))?;

    let mut raw = Vec::with_capacity(8 + 16 + 12 + ciphertext.len());
    raw.extend_from_slice(ENCRYPTED_BUNDLE_MAGIC);
    raw.extend_from_slice(&salt);
    raw.extend_from_slice(&nonce);
    raw.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(raw))
}

pub fn decrypt_export_bundle(
    encoded: &str,
    passphrase: &str,
) -> Result<HealthExportBundleV1, String> {
    if encoded.len() > MAX_ENCRYPTED_IMPORT_BYTES {
        return Err("Encrypted health bundle exceeds the payload limit".into());
    }
    let raw = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|_| "Invalid encrypted health bundle encoding".to_string())?;
    if raw.len() < 8 + 16 + 12 + 16 || &raw[..8] != ENCRYPTED_BUNDLE_MAGIC {
        return Err("Unrecognized or corrupt encrypted health bundle header".to_string());
    }
    let salt = &raw[8..24];
    let nonce = Nonce::from_slice(&raw[24..36]);
    let ciphertext = &raw[36..];
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, 100_000, &mut key);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("AES init error: {e}"))?;
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: ENCRYPTED_BUNDLE_AAD,
            },
        )
        .map_err(|_| "Decryption failed: wrong passphrase or tampered bundle".to_string())?;
    if plaintext.len() > MAX_IMPORT_BYTES {
        return Err("Health bundle exceeds the 50 MB payload limit".into());
    }
    serde_json::from_slice::<HealthExportBundleV1>(&plaintext)
        .map_err(|e| format!("Corrupt health bundle JSON payload: {e}"))
}

pub async fn import_json_bundle(
    vault: &HealthVault,
    json_str: &str,
) -> Result<HealthFileImportResult, String> {
    if json_str.len() > MAX_IMPORT_BYTES {
        return Err("Health JSON file exceeds maximum 50 MB size limit".to_string());
    }
    let bundle: HealthExportBundleV1 =
        serde_json::from_str(json_str).map_err(|e| format!("Invalid health JSON bundle: {e}"))?;
    ingest_export_bundle(vault, bundle, "json").await
}

pub async fn ingest_export_bundle(
    vault: &HealthVault,
    bundle: HealthExportBundleV1,
    format_name: &str,
) -> Result<HealthFileImportResult, String> {
    if bundle.schema_version != 1 {
        return Err(format!(
            "Unsupported health bundle schema version: {}",
            bundle.schema_version
        ));
    }
    let now = chrono::Utc::now().timestamp_millis();
    let consent = HealthConsentRecord {
        id: format!("consent_{}", uuid::Uuid::new_v4()),
        provider_id: HealthProviderId::FileImport,
        action: "file_import".to_string(),
        categories: vec![HealthDataCategory::Sleep, HealthDataCategory::Hrv],
        purpose: format!("User-initiated {format_name} health bundle import"),
        policy_version: "1.0".to_string(),
        recorded_at_ms: now,
    };

    for (index, session) in bundle.sleep_sessions.iter().enumerate() {
        let duration = elapsed_minutes(session.start_at_ms, session.end_at_ms);
        if session.external_record_id.is_empty()
            || session.is_synthetic
            || !valid_timestamp(session.start_at_ms)
            || !valid_timestamp(session.end_at_ms)
            || !duration.is_ok_and(|mins| (0.0..=2_880.0).contains(&mins))
            || !session.duration_mins.is_finite()
            || !(0.0..=2_880.0).contains(&session.duration_mins)
            || session.stages.iter().any(|stage| {
                stage.end_at_ms <= stage.start_at_ms
                    || stage.start_at_ms < session.start_at_ms
                    || stage.end_at_ms > session.end_at_ms
            })
        {
            return Err(format!("Invalid sleep record at row {}", index + 1));
        }
    }
    for (index, observation) in bundle.physiological_observations.iter().enumerate() {
        if observation.external_record_id.is_empty()
            || observation.is_synthetic
            || !observation.value.is_finite()
            || !valid_timestamp(observation.measured_at_ms)
        {
            return Err(format!("Invalid physiological record at row {}", index + 1));
        }
    }
    for (index, observation) in bundle.recovery_observations.iter().enumerate() {
        if observation.external_record_id.is_empty()
            || observation.is_synthetic
            || !valid_timestamp(observation.measured_at_ms)
        {
            return Err(format!("Invalid recovery record at row {}", index + 1));
        }
    }

    let report = vault
        .ingest_with_consent(
            HealthProviderId::FileImport,
            format_name,
            NormalizedIngestionBatch {
                devices: bundle.devices,
                sleep_sessions: bundle.sleep_sessions,
                physio_observations: bundle.physiological_observations,
                recovery_observations: bundle.recovery_observations,
                ..Default::default()
            },
            Some(&consent),
        )
        .await?;

    Ok(HealthFileImportResult {
        format: format_name.to_string(),
        sleep_imported: report.sleep_upserts,
        sleep_skipped: 0,
        physio_imported: report.physio_upserts,
        recovery_imported: report.recovery_upserts,
        warnings: report.warnings,
        row_errors: Vec::new(),
    })
}

fn valid_timestamp(ms: i64) -> bool {
    chrono::DateTime::from_timestamp_millis(ms).is_some()
}

/// Validate and parse CSV sleep imports.
/// Supported columns (case-insensitive header): `start,end,kind,time_in_bed_mins,source,notes`
/// (or `bedtime_start,bedtime_end,sleep_kind,...`).
pub async fn import_sleep_csv(
    vault: &HealthVault,
    csv_text: &str,
) -> Result<HealthFileImportResult, String> {
    if csv_text.len() > MAX_IMPORT_BYTES {
        return Err("CSV file exceeds maximum 50 MB size limit".to_string());
    }
    let mut lines = csv_text.lines().filter(|l| !l.trim().is_empty());
    let Some(header_line) = lines.next() else {
        return Err("CSV file is empty".to_string());
    };
    let headers: Vec<String> = split_csv_line(header_line)?
        .into_iter()
        .map(|h| h.trim().to_ascii_lowercase())
        .collect();

    let start_idx = headers
        .iter()
        .position(|h| {
            matches!(
                h.as_str(),
                "start" | "start_time" | "bedtime_start" | "start_iso"
            )
        })
        .ok_or_else(|| {
            "CSV header missing required start timestamp column (start / bedtime_start)".to_string()
        })?;
    let end_idx = headers
        .iter()
        .position(|h| matches!(h.as_str(), "end" | "end_time" | "bedtime_end" | "end_iso"))
        .ok_or_else(|| {
            "CSV header missing required end timestamp column (end / bedtime_end)".to_string()
        })?;
    let kind_idx = headers
        .iter()
        .position(|h| matches!(h.as_str(), "kind" | "sleep_kind" | "type"));
    let tib_idx = headers
        .iter()
        .position(|h| matches!(h.as_str(), "time_in_bed_mins" | "in_bed_mins"));
    let source_idx = headers.iter().position(|h| h == "source");
    let notes_idx = headers.iter().position(|h| h == "notes");

    let mut sessions = Vec::new();
    let mut row_errors = Vec::new();
    let mut skipped = 0usize;
    let now = chrono::Utc::now().timestamp_millis();

    for (idx, line) in lines.enumerate() {
        if idx >= MAX_CSV_ROWS {
            return Err("CSV row count exceeds 500,000 row limit".to_string());
        }
        let cols = split_csv_line(line)?;
        let row_num = idx + 2;
        if cols.len() <= start_idx.max(end_idx) {
            skipped += 1;
            row_errors.push(format!("Row {row_num}: missing start/end column"));
            continue;
        }
        // Defend against CSV spreadsheet formula injection in string cells
        for cell in &cols {
            let trimmed = cell.trim_start();
            if trimmed.starts_with('=') || trimmed.starts_with("@SUM") {
                return Err(format!("Row {row_num}: rejected unsafe formula expression"));
            }
        }
        let (start_ms, start_off) = match parse_timestamp_with_offset(&cols[start_idx]) {
            Ok(v) => v,
            Err(e) => {
                skipped += 1;
                row_errors.push(format!("Row {row_num}: {e}"));
                continue;
            }
        };
        let (end_ms, end_off) = match parse_timestamp_with_offset(&cols[end_idx]) {
            Ok(v) => v,
            Err(e) => {
                skipped += 1;
                row_errors.push(format!("Row {row_num}: {e}"));
                continue;
            }
        };
        let dur_mins = match elapsed_minutes(start_ms, end_ms) {
            Ok(d) => d,
            Err(e) => {
                skipped += 1;
                row_errors.push(format!("Row {row_num}: {e}"));
                continue;
            }
        };
        let kind = kind_idx
            .and_then(|i| cols.get(i))
            .map(|v| SleepKind::from_str(v))
            .unwrap_or_else(|| {
                if dur_mins < 180.0 {
                    SleepKind::Nap
                } else {
                    SleepKind::MainSleep
                }
            });
        let tib = tib_idx
            .and_then(|i| cols.get(i))
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v > 0.0);
        let src_note = source_idx
            .and_then(|i| cols.get(i))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let notes = notes_idx
            .and_then(|i| cols.get(i))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let mut flags = vec![SleepQualityFlag::MissingStages];
        if !is_plausible_sleep_duration(dur_mins) {
            flags.push(SleepQualityFlag::ImplausibleDuration);
        }

        let ext_id = format!("csv_{start_ms}_{end_ms}");
        sessions.push(RawSleepSession {
            id: format!("imp_{ext_id}"),
            provider_id: HealthProviderId::FileImport,
            device_id: None,
            external_record_id: ext_id,
            source_app_bundle: src_note,
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: start_off,
            end_tz_offset_secs: end_off,
            duration_mins: dur_mins,
            time_in_bed_mins: tib,
            sleep_efficiency_pct: tib.map(|t| ((dur_mins / t) * 100.0).clamp(0.0, 100.0)),
            awake_mins: None,
            light_mins: None,
            deep_mins: None,
            rem_mins: None,
            sleep_kind: kind,
            provider_sleep_kind: None,
            quality_flags: flags,
            quality_score: 0.75,
            notes,
            subjective_quality: None,
            acquisition_at_ms: now,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: false,
            stages: Vec::new(),
        });
    }

    if sessions.is_empty() || !row_errors.is_empty() {
        return Err(row_errors
            .first()
            .cloned()
            .unwrap_or_else(|| "No valid sleep rows found in CSV".to_string()));
    }

    let consent = HealthConsentRecord {
        id: format!("consent_{}", uuid::Uuid::new_v4()),
        provider_id: HealthProviderId::FileImport,
        action: "csv_import".to_string(),
        categories: vec![HealthDataCategory::Sleep],
        purpose: "User-initiated CSV sleep import".to_string(),
        policy_version: "1.0".to_string(),
        recorded_at_ms: now,
    };

    let report = vault
        .ingest_with_consent(
            HealthProviderId::FileImport,
            "csv",
            NormalizedIngestionBatch {
                sleep_sessions: sessions,
                ..Default::default()
            },
            Some(&consent),
        )
        .await?;

    Ok(HealthFileImportResult {
        format: "csv".to_string(),
        sleep_imported: report.sleep_upserts,
        sleep_skipped: skipped,
        physio_imported: 0,
        recovery_imported: 0,
        warnings: report.warnings,
        row_errors: row_errors.into_iter().take(25).collect(),
    })
}

fn split_csv_line(line: &str) -> Result<Vec<String>, String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    current.push('"');
                    let _ = chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => {
                fields.push(std::mem::take(&mut current));
            }
            _ => current.push(c),
        }
    }
    if in_quotes {
        return Err("CSV contains an unterminated quoted field".into());
    }
    fields.push(current);
    Ok(fields)
}

/// Streaming Apple Health `export.xml` importer (uses `quick-xml`).
/// Parses `SleepAnalysis`, `HeartRate`, `RestingHeartRate`, `HeartRateVariabilitySDNN`,
/// and `StepCount`, grouping contiguous sleep stage samples per source into sleep sessions.
pub async fn import_apple_health_xml(
    vault: &HealthVault,
    xml_bytes: &[u8],
) -> Result<HealthFileImportResult, String> {
    if xml_bytes.len() > MAX_IMPORT_BYTES {
        return Err("Apple Health export.xml exceeds 50 MB safety limit".to_string());
    }

    let mut reader = Reader::from_reader(BufReader::new(xml_bytes));
    reader.config_mut().trim_text(true);

    let mut depth: usize = 0;
    let mut found_root = false;
    let mut buf = Vec::with_capacity(4096);
    let mut sleep_samples_by_source: HashMap<
        String,
        Vec<(i64, i64, Option<i32>, Option<i32>, SleepStageType, String)>,
    > = HashMap::new();
    let mut physio = Vec::new();
    let mut skipped = 0usize;
    let now = chrono::Utc::now().timestamp_millis();

    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|_| "Malformed Apple Health export.xml")?;
        let is_start = matches!(&event, Event::Start(_));
        match event {
            Event::Start(e) | Event::Empty(e) => {
                let name = e.name();
                if depth == 0 {
                    if found_root || name.as_ref() != b"HealthData" {
                        return Err(
                            "Expected one HealthData root in Apple Health export.xml".into()
                        );
                    }
                    found_root = true;
                }
                if is_start {
                    depth += 1;
                }
                if name.as_ref() == b"Record" {
                    let mut rec_type = String::new();
                    let mut source_name = String::from("Apple Health");
                    let mut unit = String::new();
                    let mut value = String::new();
                    let mut start_date = String::new();
                    let mut end_date = String::new();

                    for attr in e.attributes() {
                        let attr = attr.map_err(|_| "Malformed Apple Health record attribute")?;
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        let val = attr
                            .unescape_value()
                            .map_err(|_| "Malformed Apple Health record attribute value")?
                            .into_owned();
                        match key.as_str() {
                            "type" => rec_type = val,
                            "sourceName" => source_name = val,
                            "unit" => unit = val,
                            "value" => value = val,
                            "startDate" => start_date = val,
                            "endDate" => end_date = val,
                            _ => {}
                        }
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
                                let ext_id =
                                    format!("hkxml_{}_{}_{}", metric.as_str(), s_ms, source_name);
                                physio.push(PhysiologicalObservation {
                                    id: format!("obs_{ext_id}"),
                                    provider_id: HealthProviderId::FileImport,
                                    device_id: None,
                                    external_record_id: ext_id,
                                    metric_type: metric,
                                    value: num_val,
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
                let declaration = std::str::from_utf8(declaration.as_ref())
                    .map_err(|_| "Malformed Apple Health document type")?;
                let allowed = declaration.trim_start().starts_with("HealthData")
                    && !["ENTITY", "SYSTEM", "PUBLIC", "%"]
                        .iter()
                        .any(|pattern| declaration.contains(pattern));
                if found_root || !allowed {
                    return Err("Unsafe Apple Health XML document type".into());
                }
            }
            Event::End(_) => depth = depth.checked_sub(1).ok_or("Unexpected XML closing tag")?,
            Event::Text(text) if depth == 0 && !text.iter().all(u8::is_ascii_whitespace) => {
                return Err("Unexpected text outside the Apple Health XML root".into());
            }
            Event::Eof if depth == 0 && found_root => break,
            Event::Eof => return Err("Incomplete Apple Health export.xml".into()),
            _ => {}
        }
        buf.clear();
    }

    // Group contiguous sleep segments (gap <= 45 min) per source into sessions
    let mut sessions = Vec::new();
    let max_gap_ms: i64 = 45 * 60_000;
    for (source_name, mut segments) in sleep_samples_by_source {
        segments.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        let mut current: Vec<(i64, i64, Option<i32>, Option<i32>, SleepStageType, String)> =
            Vec::new();
        for seg in segments {
            if let Some(last_end) = current.iter().map(|s| s.1).max() {
                if seg.0 - last_end > max_gap_ms {
                    if let Some(sess) = build_session_from_hk_group(&source_name, &current, now) {
                        sessions.push(sess);
                    }
                    current.clear();
                }
            }
            current.push(seg);
        }
        if let Some(sess) = build_session_from_hk_group(&source_name, &current, now) {
            sessions.push(sess);
        }
    }

    let consent = HealthConsentRecord {
        id: format!("consent_{}", uuid::Uuid::new_v4()),
        provider_id: HealthProviderId::FileImport,
        action: "apple_health_xml_import".to_string(),
        categories: vec![
            HealthDataCategory::Sleep,
            HealthDataCategory::SleepStages,
            HealthDataCategory::HeartRate,
            HealthDataCategory::Hrv,
        ],
        purpose: "User-initiated Apple Health export.xml import".to_string(),
        policy_version: "1.0".to_string(),
        recorded_at_ms: now,
    };

    let report = vault
        .ingest_with_consent(
            HealthProviderId::FileImport,
            "apple_health_xml",
            NormalizedIngestionBatch {
                sleep_sessions: sessions,
                physio_observations: physio,
                ..Default::default()
            },
            Some(&consent),
        )
        .await?;

    Ok(HealthFileImportResult {
        format: "apple_health_xml".to_string(),
        sleep_imported: report.sleep_upserts,
        sleep_skipped: skipped,
        physio_imported: report.physio_upserts,
        recovery_imported: 0,
        warnings: report.warnings,
        row_errors: Vec::new(),
    })
}

fn build_session_from_hk_group(
    source_name: &str,
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
    let ext_id = format!("hkxml_sleep_{}_{}", source_name, start_ms);
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
    let sleep_kind = SleepKind::Unknown;

    Some(RawSleepSession {
        id: raw_id,
        provider_id: HealthProviderId::FileImport,
        device_id: None,
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
        sleep_kind,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn manual_sleep_csv_xml_and_encrypted_transfer() {
        let vault = HealthVault::new_in_memory().await.unwrap();

        upsert_manual_sleep(
            &vault,
            ManualSleepInput {
                id: None,
                start_iso: "2026-11-10T23:15:00Z".into(),
                end_iso: "2026-11-11T07:05:00Z".into(),
                tz_offset_minutes: None,
                sleep_kind: None,
                time_in_bed_mins: Some(480.0),
                subjective_quality: Some(4),
                notes: Some("Slept well".into()),
            },
        )
        .await
        .unwrap();

        let csv_data =
            "start,end,kind,notes\n2026-11-12T13:30:00Z,2026-11-12T14:00:00Z,nap,power nap\n";
        let csv_res = import_sleep_csv(&vault, csv_data).await.unwrap();
        assert_eq!(csv_res.sleep_imported, 1);

        let hk_xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-11-14 23:00:00 +0000" endDate="2026-11-15 03:00:00 +0000"/>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" value="HKCategoryValueSleepAnalysisAsleepDeep" startDate="2026-11-15 03:00:00 +0000" endDate="2026-11-15 04:30:00 +0000"/>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" value="HKCategoryValueSleepAnalysisAsleepREM" startDate="2026-11-15 04:30:00 +0000" endDate="2026-11-15 06:30:00 +0000"/>
  <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Apple Watch" unit="ms" value="48.5" startDate="2026-11-15 06:20:00 +0000" endDate="2026-11-15 06:20:00 +0000"/>
</HealthData>"#;
        let xml_res = import_apple_health_xml(&vault, hk_xml).await.unwrap();
        assert_eq!(xml_res.sleep_imported, 1);
        assert_eq!(xml_res.physio_imported, 1);

        let bundle = export_json_bundle(&vault).await.unwrap();
        assert_eq!(bundle.sleep_sessions.len(), 3);
        let enc = encrypt_export_bundle(&bundle, "strong-passphrase-123").unwrap();
        assert!(decrypt_export_bundle(&enc, "wrong-passphrase").is_err());

        let dest = HealthVault::new_in_memory().await.unwrap();
        let dec = decrypt_export_bundle(&enc, "strong-passphrase-123").unwrap();
        let imp = ingest_export_bundle(&dest, dec, "encrypted_bundle")
            .await
            .unwrap();
        assert_eq!(imp.sleep_imported, 3);
        assert_eq!(imp.physio_imported, 1);
    }

    #[tokio::test]
    async fn rejects_csv_formula_injection_and_bad_rows() {
        let vault = HealthVault::new_in_memory().await.unwrap();
        let malicious_csv =
            "start,end,notes\n2026-11-10T23:00:00Z,2026-11-11T07:00:00Z,=CMD('calc')\n";
        assert!(import_sleep_csv(&vault, malicious_csv).await.is_err());

        let bad_xml =
            b"<HealthData><!DOCTYPE foo [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]></HealthData>";
        assert!(import_apple_health_xml(&vault, bad_xml).await.is_err());

        let mixed_csv = "start,end\n2026-11-10T23:00:00Z,2026-11-11T07:00:00Z\n2026-11-11T23:00:00Z,2026-11-11T07:00:00Z\n";
        assert!(import_sleep_csv(&vault, mixed_csv).await.is_err());
        assert!(import_apple_health_xml(&vault, b"<HealthData><Record/>")
            .await
            .is_err());
        assert!(vault
            .load_raw_sleep_sessions(false)
            .await
            .unwrap()
            .is_empty());
        assert!(vault.get_consent_log(10).await.unwrap().is_empty());
    }
}
