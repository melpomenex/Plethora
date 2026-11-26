//! Import orchestration: preview, transactional commit, batch management, CSV mapping profiles,
//! and optional desktop-only watched folder scanning.

use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::health::db::HealthVault;
use crate::health::models::{
    HealthConsentRecord, HealthDataCategory, HealthProviderId, PhysiologicalMetricType,
};

use super::apple_health::AppleHealthAdapter;
use super::detector::{detect_import_format, inspect_file_for_detection};
use super::garmin::GarminExportAdapter;
use super::generic_csv::{parse_csv_with_mapping, GenericCsvAdapter};
use super::google_fitbit::GoogleFitbitExportAdapter;
use super::limits::{ArchiveSecurityLimits, StreamingParserLimits};
use super::oura::OuraExportAdapter;
use super::plethora_json::PlethoraJsonAdapter;
use super::polar::PolarExportAdapter;
use super::registry::WearableImportAdapter;
use super::ringconn::RingConnExportAdapter;
use super::samsung_health::SamsungHealthExportAdapter;
use super::types::{
    AcquisitionMethod, CategoryCount, CsvMappingProfile, DetectionConfidence,
    ImportAdapterDescriptor, ImportBatchSummary, ImportCancellationToken, ImportCommitResult,
    ImportError, ImportPreview, ImportProgressEvent, ParsedImportOutput,
};
use super::whoop::WhoopExportAdapter;
use super::withings::WithingsExportAdapter;

pub fn all_adapters() -> Vec<Box<dyn WearableImportAdapter>> {
    vec![
        Box::new(PlethoraJsonAdapter),
        Box::new(AppleHealthAdapter),
        Box::new(GarminExportAdapter),
        Box::new(OuraExportAdapter),
        Box::new(WhoopExportAdapter),
        Box::new(GoogleFitbitExportAdapter),
        Box::new(SamsungHealthExportAdapter),
        Box::new(WithingsExportAdapter),
        Box::new(RingConnExportAdapter),
        Box::new(PolarExportAdapter),
        Box::new(GenericCsvAdapter),
    ]
}

pub fn list_adapter_descriptors() -> Vec<ImportAdapterDescriptor> {
    all_adapters().into_iter().map(|a| a.descriptor()).collect()
}

pub fn compute_file_sha256(path: &Path) -> Result<(String, u64), ImportError> {
    let mut file = File::open(path).map_err(|e| ImportError::Io(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let n = file.read(&mut buf).map_err(|e| ImportError::Io(e.to_string()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((format!("{:x}", hasher.finalize()), total))
}

pub async fn preview_wearable_import(
    vault: &HealthVault,
    path: &Path,
    override_adapter_id: Option<&str>,
    mapping_profile: Option<&CsvMappingProfile>,
    cancel: &ImportCancellationToken,
) -> Result<ImportPreview, ImportError> {
    cancel.check()?;
    let archive_limits = ArchiveSecurityLimits::default();
    let streaming_limits = StreamingParserLimits::default();

    let (file_hash, file_size_bytes) = compute_file_sha256(path)?;
    let inspection = inspect_file_for_detection(path, archive_limits)?;
    let adapters = all_adapters();
    let detection = detect_import_format(&inspection, &adapters);

    let chosen_adapter_id = override_adapter_id
        .map(ToString::to_string)
        .or_else(|| detection.primary.as_ref().map(|p| p.adapter_id.clone()));

    let mut warnings = Vec::new();
    if matches!(
        detection.confidence,
        DetectionConfidence::RecognizedUnsupported | DetectionConfidence::NoUsableSleepData
    ) {
        return Ok(ImportPreview {
            file_path: path.to_string_lossy().into_owned(),
            file_name: inspection.file_name,
            file_size_bytes,
            file_hash,
            detection,
            selected_provider_id: None,
            selected_adapter_id: None,
            date_range_start_ms: None,
            date_range_end_ms: None,
            available_categories: Vec::new(),
            sleep_sessions_count: 0,
            sleep_stages_count: 0,
            physio_observations_count: 0,
            recovery_observations_count: 0,
            estimated_new: 0,
            estimated_duplicates: 0,
            estimated_updates: 0,
            invalid_records: 0,
            missing_fields: Vec::new(),
            unsupported_fields: Vec::new(),
            timezone_assumptions: Vec::new(),
            warnings,
            sample_csv_headers: inspection.csv_headers,
            sample_csv_rows: inspection.csv_sample_rows,
            can_commit: false,
        });
    }

    if detection.requires_csv_mapping && mapping_profile.is_none() && override_adapter_id.is_none() {
        return Ok(ImportPreview {
            file_path: path.to_string_lossy().into_owned(),
            file_name: inspection.file_name,
            file_size_bytes,
            file_hash,
            detection,
            selected_provider_id: Some(HealthProviderId::FileImport),
            selected_adapter_id: Some("generic_csv".to_string()),
            date_range_start_ms: None,
            date_range_end_ms: None,
            available_categories: Vec::new(),
            sleep_sessions_count: 0,
            sleep_stages_count: 0,
            physio_observations_count: 0,
            recovery_observations_count: 0,
            estimated_new: 0,
            estimated_duplicates: 0,
            estimated_updates: 0,
            invalid_records: 0,
            missing_fields: Vec::new(),
            unsupported_fields: Vec::new(),
            timezone_assumptions: Vec::new(),
            warnings,
            sample_csv_headers: inspection.csv_headers,
            sample_csv_rows: inspection.csv_sample_rows,
            can_commit: false,
        });
    }

    let parsed = if let Some(mapping) = mapping_profile {
        parse_csv_with_mapping(path, Some(mapping), &streaming_limits, cancel)?
    } else if let Some(ref aid) = chosen_adapter_id {
        let adapter = adapters
            .iter()
            .find(|a| a.descriptor().adapter_id == *aid)
            .ok_or_else(|| ImportError::UnsupportedFormat(format!("Unknown adapter: {aid}")))?;
        adapter.parse_file(path, &archive_limits, &streaming_limits, cancel, None, "preview")?
    } else {
        return Ok(ImportPreview {
            file_path: path.to_string_lossy().into_owned(),
            file_name: inspection.file_name,
            file_size_bytes,
            file_hash,
            detection,
            selected_provider_id: None,
            selected_adapter_id: None,
            date_range_start_ms: None,
            date_range_end_ms: None,
            available_categories: Vec::new(),
            sleep_sessions_count: 0,
            sleep_stages_count: 0,
            physio_observations_count: 0,
            recovery_observations_count: 0,
            estimated_new: 0,
            estimated_duplicates: 0,
            estimated_updates: 0,
            invalid_records: 0,
            missing_fields: Vec::new(),
            unsupported_fields: Vec::new(),
            timezone_assumptions: Vec::new(),
            warnings,
            sample_csv_headers: inspection.csv_headers,
            sample_csv_rows: inspection.csv_sample_rows,
            can_commit: false,
        });
    };

    let (date_range_start_ms, date_range_end_ms) = parsed.date_range();
    let sleep_sessions_count = parsed.batch.sleep_sessions.len();
    let sleep_stages_count: usize = parsed
        .batch
        .sleep_sessions
        .iter()
        .map(|s| s.stages.len())
        .sum();
    let physio_observations_count = parsed.batch.physio_observations.len();
    let recovery_observations_count = parsed.batch.recovery_observations.len();

    let mut cat_counts: HashMap<HealthDataCategory, usize> = HashMap::new();
    if sleep_sessions_count > 0 {
        cat_counts.insert(HealthDataCategory::Sleep, sleep_sessions_count);
    }
    if sleep_stages_count > 0 {
        cat_counts.insert(HealthDataCategory::SleepStages, sleep_stages_count);
    }
    for obs in &parsed.batch.physio_observations {
        let cat = match obs.metric_type {
            PhysiologicalMetricType::HeartRate => HealthDataCategory::HeartRate,
            PhysiologicalMetricType::RestingHeartRate => HealthDataCategory::RestingHeartRate,
            PhysiologicalMetricType::Hrv => HealthDataCategory::Hrv,
            PhysiologicalMetricType::Spo2 => HealthDataCategory::Recovery,
            PhysiologicalMetricType::SkinTempDeviation => HealthDataCategory::Temperature,
            PhysiologicalMetricType::RespiratoryRate => HealthDataCategory::RespiratoryRate,
            PhysiologicalMetricType::Steps | PhysiologicalMetricType::ActiveCalories => {
                HealthDataCategory::Activity
            }
        };
        *cat_counts.entry(cat).or_insert(0) += 1;
    }
    if recovery_observations_count > 0 {
        *cat_counts.entry(HealthDataCategory::Recovery).or_insert(0) += recovery_observations_count;
    }
    let available_categories: Vec<CategoryCount> = cat_counts
        .into_iter()
        .map(|(category, count)| CategoryCount { category, count })
        .collect();

    // Estimate duplicates against existing health_raw_sleep_sessions
    let existing_ext_ids: HashSet<String> = sqlx::query_scalar(
        "SELECT external_record_id FROM health_raw_sleep_sessions WHERE provider_id = ?1 AND is_deleted = 0",
    )
    .bind(parsed.provider_id.as_str())
    .fetch_all(&vault.pool)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?
    .into_iter()
    .collect();

    let mut estimated_duplicates = 0usize;
    let mut estimated_new = 0usize;
    for s in &parsed.batch.sleep_sessions {
        if existing_ext_ids.contains(&s.external_record_id) {
            estimated_duplicates += 1;
        } else {
            estimated_new += 1;
        }
    }

    warnings.extend(parsed.batch.warnings.clone());
    if sleep_sessions_count == 0 && (physio_observations_count > 0 || recovery_observations_count > 0)
    {
        warnings.push(
            "No usable sleep sessions were found in this file; only physiological/recovery observations are available.".to_string(),
        );
    }

    let can_commit = sleep_sessions_count > 0
        || physio_observations_count > 0
        || recovery_observations_count > 0;

    Ok(ImportPreview {
        file_path: path.to_string_lossy().into_owned(),
        file_name: inspection.file_name,
        file_size_bytes,
        file_hash,
        detection,
        selected_provider_id: Some(parsed.provider_id),
        selected_adapter_id: chosen_adapter_id,
        date_range_start_ms,
        date_range_end_ms,
        available_categories,
        sleep_sessions_count,
        sleep_stages_count,
        physio_observations_count,
        recovery_observations_count,
        estimated_new,
        estimated_duplicates,
        estimated_updates: 0,
        invalid_records: parsed.invalid_records,
        missing_fields: parsed.missing_fields,
        unsupported_fields: parsed.unsupported_fields,
        timezone_assumptions: parsed.timezone_assumptions,
        warnings,
        sample_csv_headers: inspection.csv_headers,
        sample_csv_rows: inspection.csv_sample_rows,
        can_commit,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn commit_wearable_import(
    vault: &HealthVault,
    path: &Path,
    adapter_id: Option<&str>,
    provider_override: Option<HealthProviderId>,
    selected_categories: &[HealthDataCategory],
    mapping_profile: Option<&CsvMappingProfile>,
    cancel: &ImportCancellationToken,
    progress: Option<&(dyn Fn(ImportProgressEvent) + Send + Sync)>,
    job_id: &str,
) -> Result<ImportCommitResult, ImportError> {
    cancel.check()?;
    let archive_limits = ArchiveSecurityLimits::default();
    let streaming_limits = StreamingParserLimits::default();
    let (file_hash, file_size_bytes) = compute_file_sha256(path)?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("import")
        .to_string();

    if let Some(cb) = progress {
        cb(ImportProgressEvent {
            job_id: job_id.to_string(),
            phase: "inspecting".to_string(),
            processed: 0,
            total: None,
            message: format!("Inspecting {file_name}..."),
        });
    }

    let adapters = all_adapters();
    let mut parsed: ParsedImportOutput = if let Some(mapping) = mapping_profile {
        parse_csv_with_mapping(path, Some(mapping), &streaming_limits, cancel)?
    } else {
        let resolved_adapter_id = if let Some(aid) = adapter_id {
            aid.to_string()
        } else {
            let inspection = inspect_file_for_detection(path, archive_limits)?;
            let det = detect_import_format(&inspection, &adapters);
            det.primary
                .map(|p| p.adapter_id)
                .ok_or_else(|| ImportError::UnsupportedFormat(det.explanation))?
        };
        let adapter = adapters
            .iter()
            .find(|a| a.descriptor().adapter_id == resolved_adapter_id)
            .ok_or_else(|| {
                ImportError::UnsupportedFormat(format!("Unknown adapter: {resolved_adapter_id}"))
            })?;
        adapter.parse_file(
            path,
            &archive_limits,
            &streaming_limits,
            cancel,
            progress.map(|cb| cb as &dyn Fn(ImportProgressEvent)),
            job_id,
        )?
    };

    cancel.check()?;

    if let Some(p_override) = provider_override {
        parsed.provider_id = p_override;
        for s in &mut parsed.batch.sleep_sessions {
            s.provider_id = p_override;
        }
        for p in &mut parsed.batch.physio_observations {
            p.provider_id = p_override;
        }
        for r in &mut parsed.batch.recovery_observations {
            r.provider_id = p_override;
        }
    }

    parsed.filter_categories(selected_categories);

    let (date_range_start_ms, date_range_end_ms) = parsed.date_range();
    let has_usable_sleep = !parsed.batch.sleep_sessions.is_empty();
    let total_records = parsed.batch.sleep_sessions.len()
        + parsed.batch.physio_observations.len()
        + parsed.batch.recovery_observations.len();
    if total_records == 0 {
        return Err(ImportError::InvalidInput(
            "No usable health records matched the selected categories.".to_string(),
        ));
    }

    if let Some(cb) = progress {
        cb(ImportProgressEvent {
            job_id: job_id.to_string(),
            phase: "committing".to_string(),
            processed: 0,
            total: Some(total_records),
            message: format!("Writing {total_records} normalized records to Health Vault..."),
        });
    }

    cancel.check()?;

    let now = chrono::Utc::now().timestamp_millis();
    let import_batch_id = format!("impbatch_{}", uuid::Uuid::new_v4());
    let consent = HealthConsentRecord {
        id: format!("consent_{}", uuid::Uuid::new_v4()),
        provider_id: parsed.provider_id,
        action: "universal_file_import".to_string(),
        categories: if selected_categories.is_empty() {
            vec![HealthDataCategory::Sleep]
        } else {
            selected_categories.to_vec()
        },
        purpose: format!(
            "User-initiated local {} import ({})",
            parsed.export_format, file_name
        ),
        policy_version: "1.0".to_string(),
        recorded_at_ms: now,
    };

    let sleep_keys: Vec<(String, String)> = parsed
        .batch
        .sleep_sessions
        .iter()
        .map(|s| (s.provider_id.as_str().to_string(), s.external_record_id.clone()))
        .collect();
    let physio_keys: Vec<(String, String)> = parsed
        .batch
        .physio_observations
        .iter()
        .map(|p| (p.provider_id.as_str().to_string(), p.external_record_id.clone()))
        .collect();
    let recovery_keys: Vec<(String, String)> = parsed
        .batch
        .recovery_observations
        .iter()
        .map(|r| (r.provider_id.as_str().to_string(), r.external_record_id.clone()))
        .collect();

    let mut tx = vault
        .pool
        .begin()
        .await
        .map_err(|e| ImportError::Database(e.to_string()))?;

    let existing_sleep_before: HashSet<String> = sqlx::query_scalar(
        "SELECT external_record_id FROM health_raw_sleep_sessions WHERE provider_id = ?1 AND is_deleted = 0",
    )
    .bind(parsed.provider_id.as_str())
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?
    .into_iter()
    .collect();

    let sleep_updated = sleep_keys
        .iter()
        .filter(|(_, ext)| existing_sleep_before.contains(ext))
        .count();
    let sleep_added = sleep_keys.len().saturating_sub(sleep_updated);

    let report = HealthVault::ingest_on(
        &mut tx,
        parsed.provider_id,
        "file_import",
        parsed.batch,
        Some(&consent),
    )
    .await
    .map_err(ImportError::Database)?;

    let warnings_json =
        serde_json::to_string(&report.warnings).unwrap_or_else(|_| "[]".to_string());

    sqlx::query(
        "INSERT INTO health_import_batches
         (id, provider_id, acquisition_method, export_format, format_version, source_file_name,
          source_file_hash, file_size_bytes, imported_at_ms, date_range_start_ms, date_range_end_ms,
          sleep_added, sleep_updated, sleep_skipped, physio_imported, recovery_imported, warnings_json, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'completed')",
    )
    .bind(&import_batch_id)
    .bind(parsed.provider_id.as_str())
    .bind(AcquisitionMethod::FileImport.as_str())
    .bind(&parsed.export_format)
    .bind(&parsed.format_version)
    .bind(&file_name)
    .bind(&file_hash)
    .bind(file_size_bytes as i64)
    .bind(now)
    .bind(date_range_start_ms)
    .bind(date_range_end_ms)
    .bind(sleep_added as i64)
    .bind(sleep_updated as i64)
    .bind(parsed.invalid_records as i64)
    .bind(report.physio_upserts as i64)
    .bind(report.recovery_upserts as i64)
    .bind(&warnings_json)
    .execute(&mut *tx)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?;

    // Record batch-to-record ownership for safe reference-counted batch deletion
    for (prov, ext) in &sleep_keys {
        if let Some(rec_id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM health_raw_sleep_sessions WHERE provider_id = ?1 AND external_record_id = ?2",
        )
        .bind(prov)
        .bind(ext)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| ImportError::Database(e.to_string()))?
        {
            sqlx::query(
                "INSERT OR IGNORE INTO health_import_batch_records (batch_id, record_kind, record_id)
                 VALUES (?1, 'sleep', ?2)",
            )
            .bind(&import_batch_id)
            .bind(&rec_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ImportError::Database(e.to_string()))?;
        }
    }
    for (prov, ext) in &physio_keys {
        if let Some(rec_id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM health_physiological_observations WHERE provider_id = ?1 AND external_record_id = ?2",
        )
        .bind(prov)
        .bind(ext)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| ImportError::Database(e.to_string()))?
        {
            sqlx::query(
                "INSERT OR IGNORE INTO health_import_batch_records (batch_id, record_kind, record_id)
                 VALUES (?1, 'physio', ?2)",
            )
            .bind(&import_batch_id)
            .bind(&rec_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ImportError::Database(e.to_string()))?;
        }
    }
    for (prov, ext) in &recovery_keys {
        if let Some(rec_id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM health_recovery_observations WHERE provider_id = ?1 AND external_record_id = ?2",
        )
        .bind(prov)
        .bind(ext)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| ImportError::Database(e.to_string()))?
        {
            sqlx::query(
                "INSERT OR IGNORE INTO health_import_batch_records (batch_id, record_kind, record_id)
                 VALUES (?1, 'recovery', ?2)",
            )
            .bind(&import_batch_id)
            .bind(&rec_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ImportError::Database(e.to_string()))?;
        }
    }

    cancel.check()?;
    tx.commit()
        .await
        .map_err(|e| ImportError::Database(e.to_string()))?;

    Ok(ImportCommitResult {
        batch_id: import_batch_id,
        provider_id: parsed.provider_id,
        acquisition_method: AcquisitionMethod::FileImport,
        export_format: parsed.export_format,
        sleep_imported: sleep_added,
        sleep_updated,
        sleep_skipped: parsed.invalid_records,
        physio_imported: report.physio_upserts,
        recovery_imported: report.recovery_upserts,
        reconciled_episodes: report.reconciled_episodes,
        date_range_start_ms,
        date_range_end_ms,
        warnings: report.warnings,
        row_errors: parsed.row_errors,
        has_usable_sleep,
    })
}

pub async fn list_import_batches(
    vault: &HealthVault,
    limit: i64,
) -> Result<Vec<ImportBatchSummary>, ImportError> {
    let rows = sqlx::query(
        "SELECT id, provider_id, acquisition_method, export_format, format_version,
                source_file_name, file_size_bytes, imported_at_ms, date_range_start_ms,
                date_range_end_ms, sleep_added, sleep_updated, sleep_skipped,
                physio_imported, recovery_imported, warnings_json, status
         FROM health_import_batches
         ORDER BY imported_at_ms DESC
         LIMIT ?1",
    )
    .bind(limit.clamp(1, 200))
    .fetch_all(&vault.pool)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let p_str: String = r.get("provider_id");
        let acq_str: String = r.get("acquisition_method");
        let warnings_str: String = r.get("warnings_json");
        let warnings: Vec<String> = serde_json::from_str(&warnings_str).unwrap_or_default();
        out.push(ImportBatchSummary {
            id: r.get("id"),
            provider_id: HealthProviderId::from_str(&p_str)
                .unwrap_or(HealthProviderId::FileImport),
            acquisition_method: match acq_str.as_str() {
                "native_mobile" => AcquisitionMethod::NativeMobile,
                "cloud_oauth" => AcquisitionMethod::CloudOauth,
                "manual" => AcquisitionMethod::Manual,
                _ => AcquisitionMethod::FileImport,
            },
            export_format: r.get("export_format"),
            format_version: r.get("format_version"),
            source_file_name: r.get("source_file_name"),
            file_size_bytes: r.get("file_size_bytes"),
            imported_at_ms: r.get("imported_at_ms"),
            date_range_start_ms: r.get("date_range_start_ms"),
            date_range_end_ms: r.get("date_range_end_ms"),
            sleep_added: r.get("sleep_added"),
            sleep_updated: r.get("sleep_updated"),
            sleep_skipped: r.get("sleep_skipped"),
            physio_imported: r.get("physio_imported"),
            recovery_imported: r.get("recovery_imported"),
            warnings,
            status: r.get("status"),
        });
    }
    Ok(out)
}

/// Safely delete an import batch: only removes raw records that are NOT referenced by any other
/// import batch in `health_import_batch_records`, then re-runs sleep reconciliation.
pub async fn delete_import_batch(vault: &HealthVault, batch_id: &str) -> Result<bool, ImportError> {
    let mut tx = vault
        .pool
        .begin()
        .await
        .map_err(|e| ImportError::Database(e.to_string()))?;

    let exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM health_import_batches WHERE id = ?1")
            .bind(batch_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| ImportError::Database(e.to_string()))?;
    if exists.is_none() {
        return Ok(false);
    }

    // Delete raw sleep sessions exclusively owned by this batch
    sqlx::query(
        "DELETE FROM health_raw_sleep_sessions
         WHERE id IN (
             SELECT record_id FROM health_import_batch_records
             WHERE batch_id = ?1 AND record_kind = 'sleep'
         )
         AND NOT EXISTS (
             SELECT 1 FROM health_import_batch_records other
             WHERE other.record_kind = 'sleep'
               AND other.record_id = health_raw_sleep_sessions.id
               AND other.batch_id != ?1
         )",
    )
    .bind(batch_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?;

    // Delete raw physiological observations exclusively owned by this batch
    sqlx::query(
        "DELETE FROM health_physiological_observations
         WHERE id IN (
             SELECT record_id FROM health_import_batch_records
             WHERE batch_id = ?1 AND record_kind = 'physio'
         )
         AND NOT EXISTS (
             SELECT 1 FROM health_import_batch_records other
             WHERE other.record_kind = 'physio'
               AND other.record_id = health_physiological_observations.id
               AND other.batch_id != ?1
         )",
    )
    .bind(batch_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?;

    // Delete raw recovery observations exclusively owned by this batch
    sqlx::query(
        "DELETE FROM health_recovery_observations
         WHERE id IN (
             SELECT record_id FROM health_import_batch_records
             WHERE batch_id = ?1 AND record_kind = 'recovery'
         )
         AND NOT EXISTS (
             SELECT 1 FROM health_import_batch_records other
             WHERE other.record_kind = 'recovery'
               AND other.record_id = health_recovery_observations.id
               AND other.batch_id != ?1
         )",
    )
    .bind(batch_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?;

    sqlx::query("DELETE FROM health_import_batches WHERE id = ?1")
        .bind(batch_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ImportError::Database(e.to_string()))?;

    HealthVault::reconcile_sleep_transaction(&mut tx)
        .await
        .map_err(ImportError::Database)?;

    tx.commit()
        .await
        .map_err(|e| ImportError::Database(e.to_string()))?;

    Ok(true)
}

pub async fn save_csv_mapping_profile(
    vault: &HealthVault,
    mut profile: CsvMappingProfile,
) -> Result<CsvMappingProfile, ImportError> {
    let now = chrono::Utc::now().timestamp_millis();
    let id = profile
        .id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("csvprof_{}", uuid::Uuid::new_v4()));
    profile.id = Some(id.clone());
    let json = serde_json::to_string(&profile).map_err(|e| ImportError::InvalidInput(e.to_string()))?;

    sqlx::query(
        "INSERT INTO health_csv_mapping_profiles (id, name, provider_id, profile_json, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           provider_id = excluded.provider_id,
           profile_json = excluded.profile_json,
           updated_at_ms = excluded.updated_at_ms",
    )
    .bind(&id)
    .bind(&profile.name)
    .bind(profile.provider_id.map(|p| p.as_str().to_string()))
    .bind(&json)
    .bind(now)
    .execute(&vault.pool)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?;

    Ok(profile)
}

pub async fn list_csv_mapping_profiles(
    vault: &HealthVault,
) -> Result<Vec<CsvMappingProfile>, ImportError> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT profile_json FROM health_csv_mapping_profiles ORDER BY updated_at_ms DESC",
    )
    .fetch_all(&vault.pool)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?;

    Ok(rows
        .into_iter()
        .filter_map(|j| serde_json::from_str::<CsvMappingProfile>(&j).ok())
        .collect())
}

pub async fn delete_csv_mapping_profile(
    vault: &HealthVault,
    id: &str,
) -> Result<(), ImportError> {
    sqlx::query("DELETE FROM health_csv_mapping_profiles WHERE id = ?1")
        .bind(id)
        .execute(&vault.pool)
        .await
        .map_err(|e| ImportError::Database(e.to_string()))?;
    Ok(())
}
