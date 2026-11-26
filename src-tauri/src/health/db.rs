//! Isolated SQLite Health Vault (`<app_data_dir>/health/health.db`).
//!
//! Physically isolated from `plethora.db` so cloud backups (`BackupManager`),
//! E2EE library sync (`sync_outbox`), semantic indexes (`semantic_chunks`),
//! and `MEMORY.md` can never ingest wearable records.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Pool, Row, Sqlite, SqliteConnection};

use super::migrations::run_health_migrations;
use super::models::{
    CanonicalSleepEpisode, DuplicateRelationship, HealthConnection, HealthConsentRecord,
    HealthDataCategory, HealthDevice, HealthPrivacySettings, HealthProviderId,
    HealthSourcePreference, HealthSyncBatch, HrvMethod, PhysiologicalMetricType,
    PhysiologicalObservation, ProviderReadinessState, RawSleepSession, RecoveryObservation,
    SleepEpisodeMember, SleepKind, SleepQualityFlag, SleepStageInterval, SleepStageType,
};
use super::provider::NormalizedIngestionBatch;
use super::reconciliation::reconcile_sleep_sessions;
use super::token_store::HealthTokenStore;

pub const HEALTH_DB_FILE_NAME: &str = "health.db";

#[derive(Clone)]
pub struct HealthVault {
    pub(crate) pool: Pool<Sqlite>,
    health_dir: Option<PathBuf>,
    pub(crate) token_store: HealthTokenStore,
}

impl HealthVault {
    pub async fn open(app_data_dir: &Path) -> Result<Self, String> {
        let health_dir = app_data_dir.join("health");
        std::fs::create_dir_all(&health_dir)
            .map_err(|e| format!("Failed creating health vault directory: {e}"))?;

        let db_path = health_dir.join(HEALTH_DB_FILE_NAME);
        let opts = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(30))
            .foreign_keys(true)
            .pragma("secure_delete", "ON");

        let max_conns = if cfg!(any(target_os = "ios", target_os = "android")) {
            2
        } else {
            6
        };

        let pool = SqlitePoolOptions::new()
            .max_connections(max_conns)
            .connect_with(opts)
            .await
            .map_err(|e| format!("Failed opening health.db: {e}"))?;

        run_health_migrations(&pool).await?;

        let vault = Self {
            pool,
            health_dir: Some(health_dir.clone()),
            token_store: HealthTokenStore::new(health_dir),
        };
        vault.ensure_defaults().await?;
        Ok(vault)
    }

    pub async fn new_in_memory() -> Result<Self, String> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .map_err(|e| format!("Failed creating in-memory health DB: {e}"))?;
        sqlx::query("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await
            .map_err(|e| format!("Failed enabling foreign_keys: {e}"))?;
        run_health_migrations(&pool).await?;

        let temp_dir =
            std::env::temp_dir().join(format!("plethora-health-test-{}", uuid::Uuid::new_v4()));
        let vault = Self {
            pool,
            health_dir: None,
            token_store: HealthTokenStore::new(temp_dir),
        };
        vault.ensure_defaults().await?;
        Ok(vault)
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    pub fn health_dir(&self) -> Option<&Path> {
        self.health_dir.as_deref()
    }

    pub fn token_store(&self) -> &HealthTokenStore {
        &self.token_store
    }

    async fn ensure_defaults(&self) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT OR IGNORE INTO health_privacy_settings
             (id, ai_sharing_enabled, cloud_sync_enabled, demo_mode_enabled, retention_days, updated_at_ms)
             VALUES (1, 0, 0, 0, NULL, ?1)",
        )
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed initializing health privacy defaults: {e}"))?;

        let default_sleep_order = serde_json::to_string(&vec![
            HealthProviderId::Manual,
            HealthProviderId::Oura,
            HealthProviderId::Whoop,
            HealthProviderId::Garmin,
            HealthProviderId::GoogleHealth,
            HealthProviderId::AppleHealthkit,
            HealthProviderId::AndroidHealthConnect,
            HealthProviderId::FileImport,
        ])
        .unwrap_or_else(|_| "[]".into());

        sqlx::query(
            "INSERT OR IGNORE INTO health_source_preferences (category, ordered_provider_ids_json, updated_at_ms)
             VALUES ('sleep', ?1, ?2)",
        )
        .bind(&default_sleep_order)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed initializing source preference defaults: {e}"))?;

        Ok(())
    }

    pub async fn get_privacy_settings(&self) -> Result<HealthPrivacySettings, String> {
        let row = sqlx::query(
            "SELECT ai_sharing_enabled, cloud_sync_enabled, demo_mode_enabled, retention_days, updated_at_ms
             FROM health_privacy_settings WHERE id = 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed querying health privacy settings: {e}"))?;

        Ok(match row {
            Some(r) => HealthPrivacySettings {
                ai_sharing_enabled: r.get::<i64, _>("ai_sharing_enabled") != 0,
                cloud_sync_enabled: r.get::<i64, _>("cloud_sync_enabled") != 0,
                demo_mode_enabled: r.get::<i64, _>("demo_mode_enabled") != 0,
                retention_days: r.get("retention_days"),
                updated_at_ms: r.get("updated_at_ms"),
            },
            None => HealthPrivacySettings::default(),
        })
    }

    pub async fn update_privacy_settings(
        &self,
        settings: HealthPrivacySettings,
    ) -> Result<HealthPrivacySettings, String> {
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO health_privacy_settings
             (id, ai_sharing_enabled, cloud_sync_enabled, demo_mode_enabled, retention_days, updated_at_ms)
             VALUES (1, ?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               ai_sharing_enabled = excluded.ai_sharing_enabled,
               cloud_sync_enabled = excluded.cloud_sync_enabled,
               demo_mode_enabled = excluded.demo_mode_enabled,
               retention_days = excluded.retention_days,
               updated_at_ms = excluded.updated_at_ms",
        )
        .bind(if settings.ai_sharing_enabled { 1 } else { 0 })
        .bind(if settings.cloud_sync_enabled { 1 } else { 0 })
        .bind(if settings.demo_mode_enabled { 1 } else { 0 })
        .bind(settings.retention_days)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed updating health privacy settings: {e}"))?;
        self.get_privacy_settings().await
    }

    pub async fn get_source_preferences(&self) -> Result<Vec<HealthSourcePreference>, String> {
        let rows = sqlx::query(
            "SELECT category, ordered_provider_ids_json, updated_at_ms FROM health_source_preferences",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed reading source preferences: {e}"))?;

        let mut prefs = Vec::with_capacity(rows.len());
        for row in rows {
            let json: String = row.get("ordered_provider_ids_json");
            let ordered: Vec<HealthProviderId> = serde_json::from_str(&json).unwrap_or_default();
            prefs.push(HealthSourcePreference {
                category: row.get("category"),
                ordered_provider_ids: ordered,
                updated_at_ms: row.get("updated_at_ms"),
            });
        }
        Ok(prefs)
    }

    pub async fn set_source_preference(
        &self,
        category: &str,
        ordered: Vec<HealthProviderId>,
    ) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp_millis();
        let json = serde_json::to_string(&ordered).map_err(|e| e.to_string())?;
        sqlx::query(
            "INSERT INTO health_source_preferences (category, ordered_provider_ids_json, updated_at_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(category) DO UPDATE SET
               ordered_provider_ids_json = excluded.ordered_provider_ids_json,
               updated_at_ms = excluded.updated_at_ms",
        )
        .bind(category)
        .bind(&json)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed updating source preference: {e}"))?;

        Self::reconcile_sleep_transaction(&mut tx).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn record_consent(&self, record: &HealthConsentRecord) -> Result<(), String> {
        let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
        Self::record_consent_on(&mut conn, record).await
    }

    async fn record_consent_on(
        conn: &mut SqliteConnection,
        record: &HealthConsentRecord,
    ) -> Result<(), String> {
        let cats_json = serde_json::to_string(&record.categories).unwrap_or_else(|_| "[]".into());
        sqlx::query(
            "INSERT INTO health_consent_log
             (id, provider_id, action, categories_json, purpose, policy_version, recorded_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&record.id)
        .bind(record.provider_id.as_str())
        .bind(&record.action)
        .bind(&cats_json)
        .bind(&record.purpose)
        .bind(&record.policy_version)
        .bind(record.recorded_at_ms)
        .execute(conn)
        .await
        .map_err(|e| format!("Failed recording consent log: {e}"))?;
        Ok(())
    }

    pub async fn get_consent_log(&self, limit: i64) -> Result<Vec<HealthConsentRecord>, String> {
        let rows = sqlx::query(
            "SELECT id, provider_id, action, categories_json, purpose, policy_version, recorded_at_ms
             FROM health_consent_log ORDER BY recorded_at_ms DESC LIMIT ?1",
        )
        .bind(limit.clamp(1, 500))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed loading consent log: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let p_str: String = row.get("provider_id");
            let provider_id =
                HealthProviderId::from_str(&p_str).unwrap_or(HealthProviderId::Manual);
            let cats_json: String = row.get("categories_json");
            let categories: Vec<HealthDataCategory> =
                serde_json::from_str(&cats_json).unwrap_or_default();
            out.push(HealthConsentRecord {
                id: row.get("id"),
                provider_id,
                action: row.get("action"),
                categories,
                purpose: row.get("purpose"),
                policy_version: row.get("policy_version"),
                recorded_at_ms: row.get("recorded_at_ms"),
            });
        }
        Ok(out)
    }

    pub async fn upsert_connection(&self, conn: &HealthConnection) -> Result<(), String> {
        let mut db = self.pool.acquire().await.map_err(|e| e.to_string())?;
        Self::upsert_connection_on(&mut db, conn).await
    }

    pub async fn save_connection_with_consent(
        &self,
        connection: &HealthConnection,
        consent: &HealthConsentRecord,
    ) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        Self::upsert_connection_on(&mut tx, connection).await?;
        Self::record_consent_on(&mut tx, consent).await?;
        tx.commit().await.map_err(|e| e.to_string())
    }

    async fn upsert_connection_on(
        db: &mut SqliteConnection,
        conn: &HealthConnection,
    ) -> Result<(), String> {
        let status_json =
            serde_json::to_string(&conn.status).unwrap_or_else(|_| "\"available\"".into());
        let req_json =
            serde_json::to_string(&conn.requested_categories).unwrap_or_else(|_| "[]".into());
        let grant_json =
            serde_json::to_string(&conn.granted_categories).unwrap_or_else(|_| "[]".into());
        sqlx::query(
            "INSERT INTO health_connections (
               provider_id, status, auth_state, requested_categories_json, granted_categories_json,
               last_sync_at_ms, last_success_at_ms, sync_cursor, account_subject_hint,
               last_error_code, last_error_message, history_limit_days, background_sync_enabled, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(provider_id) DO UPDATE SET
               status = excluded.status,
               auth_state = excluded.auth_state,
               requested_categories_json = excluded.requested_categories_json,
               granted_categories_json = excluded.granted_categories_json,
               last_sync_at_ms = excluded.last_sync_at_ms,
               last_success_at_ms = excluded.last_success_at_ms,
               sync_cursor = excluded.sync_cursor,
               account_subject_hint = excluded.account_subject_hint,
               last_error_code = excluded.last_error_code,
               last_error_message = excluded.last_error_message,
               history_limit_days = excluded.history_limit_days,
               background_sync_enabled = excluded.background_sync_enabled,
               updated_at_ms = excluded.updated_at_ms",
        )
        .bind(conn.provider_id.as_str())
        .bind(status_json.trim_matches('"'))
        .bind(&conn.auth_state)
        .bind(&req_json)
        .bind(&grant_json)
        .bind(conn.last_sync_at_ms)
        .bind(conn.last_success_at_ms)
        .bind(&conn.sync_cursor)
        .bind(&conn.account_subject_hint)
        .bind(&conn.last_error_code)
        .bind(&conn.last_error_message)
        .bind(conn.history_limit_days)
        .bind(if conn.background_sync_enabled { 1 } else { 0 })
        .bind(conn.updated_at_ms)
        .execute(db)
        .await
        .map_err(|e| format!("Failed saving health connection: {e}"))?;
        Ok(())
    }

    pub async fn get_connections(&self) -> Result<Vec<HealthConnection>, String> {
        let rows = sqlx::query(
            "SELECT provider_id, status, auth_state, requested_categories_json, granted_categories_json,
                    last_sync_at_ms, last_success_at_ms, sync_cursor, account_subject_hint,
                    last_error_code, last_error_message, history_limit_days, background_sync_enabled, updated_at_ms
             FROM health_connections ORDER BY provider_id ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed querying health connections: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let p_str: String = row.get("provider_id");
            let Some(provider_id) = HealthProviderId::from_str(&p_str) else {
                continue;
            };
            let status_str: String = row.get("status");
            let status: ProviderReadinessState = serde_json::from_str(&format!("\"{status_str}\""))
                .unwrap_or(ProviderReadinessState::Available);
            let req_json: String = row.get("requested_categories_json");
            let grant_json: String = row.get("granted_categories_json");
            out.push(HealthConnection {
                provider_id,
                status,
                auth_state: row.get("auth_state"),
                requested_categories: serde_json::from_str(&req_json).unwrap_or_default(),
                granted_categories: serde_json::from_str(&grant_json).unwrap_or_default(),
                last_sync_at_ms: row.get("last_sync_at_ms"),
                last_success_at_ms: row.get("last_success_at_ms"),
                sync_cursor: row.get("sync_cursor"),
                account_subject_hint: row.get("account_subject_hint"),
                last_error_code: row.get("last_error_code"),
                last_error_message: row.get("last_error_message"),
                history_limit_days: row.get("history_limit_days"),
                background_sync_enabled: row.get::<i64, _>("background_sync_enabled") != 0,
                updated_at_ms: row.get("updated_at_ms"),
            });
        }
        Ok(out)
    }

    pub async fn get_connection(
        &self,
        provider_id: HealthProviderId,
    ) -> Result<Option<HealthConnection>, String> {
        Ok(self
            .get_connections()
            .await?
            .into_iter()
            .find(|c| c.provider_id == provider_id))
    }

    pub async fn list_devices(&self) -> Result<Vec<HealthDevice>, String> {
        let rows = sqlx::query(
            "SELECT id, provider_id, external_device_id, manufacturer, model, source_app_bundle, platform_source_id, metadata_json
             FROM health_devices ORDER BY provider_id ASC, model ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed reading health devices: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let p_str: String = row.get("provider_id");
            let Some(provider_id) = HealthProviderId::from_str(&p_str) else {
                continue;
            };
            out.push(HealthDevice {
                id: row.get("id"),
                provider_id,
                external_device_id: row.get("external_device_id"),
                manufacturer: row.get("manufacturer"),
                model: row.get("model"),
                source_app_bundle: row.get("source_app_bundle"),
                platform_source_id: row.get("platform_source_id"),
                metadata_json: row.get("metadata_json"),
            });
        }
        Ok(out)
    }

    /// Persist a normalized ingestion batch idempotently inside one transaction and reconcile sleep episodes.
    pub async fn ingest_batch(
        &self,
        provider_id: HealthProviderId,
        sync_kind: &str,
        batch: NormalizedIngestionBatch,
    ) -> Result<super::models::HealthSyncReport, String> {
        self.ingest_with_consent(provider_id, sync_kind, batch, None)
            .await
    }

    pub(super) async fn ingest_with_consent(
        &self,
        provider_id: HealthProviderId,
        sync_kind: &str,
        batch: NormalizedIngestionBatch,
        consent: Option<&HealthConsentRecord>,
    ) -> Result<super::models::HealthSyncReport, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let report = Self::ingest_on(&mut tx, provider_id, sync_kind, batch, consent).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(report)
    }

    pub async fn ingest_provider_sync(
        &self,
        batch: NormalizedIngestionBatch,
        connection: &HealthConnection,
        consent: Option<&HealthConsentRecord>,
    ) -> Result<super::models::HealthSyncReport, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let report =
            Self::ingest_on(&mut tx, connection.provider_id, "provider", batch, consent).await?;
        Self::upsert_connection_on(&mut tx, connection).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(report)
    }

    pub async fn ingest_healthkit_delta(
        &self,
        mut payload: super::native_healthkit::HealthKitPayload,
        connection: &HealthConnection,
        consent: Option<&HealthConsentRecord>,
    ) -> Result<super::models::HealthSyncReport, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let changing_sleep = !payload.sleep_samples.is_empty() || !payload.deleted_uuids.is_empty();
        for sample in &payload.sleep_samples {
            let json = serde_json::to_string(sample).map_err(|e| e.to_string())?;
            sqlx::query(
                "INSERT INTO health_healthkit_sleep_samples (uuid, sample_json) VALUES (?, ?)
                 ON CONFLICT(uuid) DO UPDATE SET sample_json = excluded.sample_json",
            )
            .bind(&sample.uuid)
            .bind(json)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
        for id in &payload.deleted_uuids {
            sqlx::query("DELETE FROM health_healthkit_sleep_samples WHERE uuid = ?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
        if changing_sleep {
            let rows: Vec<String> =
                sqlx::query_scalar("SELECT sample_json FROM health_healthkit_sleep_samples")
                    .fetch_all(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
            payload.sleep_samples = rows
                .into_iter()
                .map(|json| serde_json::from_str(&json).map_err(|e| e.to_string()))
                .collect::<Result<_, _>>()?;
        }

        let mut batch = super::native_healthkit::normalize_healthkit_payload(
            payload,
            connection.updated_at_ms,
            None,
        );
        batch.deleted_sleep_external_ids.clear();
        if changing_sleep {
            let existing: Vec<String> = sqlx::query_scalar(
                "SELECT external_record_id FROM health_raw_sleep_sessions
                 WHERE provider_id = 'apple_healthkit' AND external_record_id GLOB 'hk_sleep_*'
                   AND is_deleted = 0",
            )
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            let retained: std::collections::HashSet<_> = batch
                .sleep_sessions
                .iter()
                .map(|sleep| sleep.external_record_id.as_str())
                .collect();
            batch.deleted_sleep_external_ids = existing
                .into_iter()
                .filter(|id| !retained.contains(id.as_str()))
                .collect();
        }
        let report =
            Self::ingest_on(&mut tx, connection.provider_id, "native", batch, consent).await?;
        Self::upsert_connection_on(&mut tx, connection).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(report)
    }

    pub(crate) async fn ingest_on(
        tx: &mut SqliteConnection,
        provider_id: HealthProviderId,
        sync_kind: &str,
        batch: NormalizedIngestionBatch,
        consent: Option<&HealthConsentRecord>,
    ) -> Result<super::models::HealthSyncReport, String> {
        let batch_id = format!("batch_{}", uuid::Uuid::new_v4());
        let now = chrono::Utc::now().timestamp_millis();

        sqlx::query(
            "INSERT INTO health_sync_batches (id, provider_id, sync_kind, started_at_ms, status)
             VALUES (?1, ?2, ?3, ?4, 'running')",
        )
        .bind(&batch_id)
        .bind(provider_id.as_str())
        .bind(sync_kind)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed recording sync batch start: {e}"))?;

        // Map (provider_id, external_device_id) -> canonical device id
        let mut device_id_map: HashMap<(HealthProviderId, &str), String> = HashMap::new();
        for dev in &batch.devices {
            sqlx::query(
                "INSERT INTO health_devices (id, provider_id, external_device_id, manufacturer, model, source_app_bundle, platform_source_id, metadata_json)
                 VALUES (CASE WHEN EXISTS (
                     SELECT 1 FROM health_devices
                     WHERE id = ?1 AND (provider_id != ?2 OR external_device_id != ?3)
                   ) THEN lower(hex(randomblob(16))) ELSE ?1 END, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(provider_id, external_device_id) DO UPDATE SET
                   manufacturer = COALESCE(excluded.manufacturer, health_devices.manufacturer),
                   model = COALESCE(excluded.model, health_devices.model),
                   source_app_bundle = COALESCE(excluded.source_app_bundle, health_devices.source_app_bundle),
                   platform_source_id = COALESCE(excluded.platform_source_id, health_devices.platform_source_id),
                   metadata_json = COALESCE(excluded.metadata_json, health_devices.metadata_json)",
            )
            .bind(&dev.id)
            .bind(dev.provider_id.as_str())
            .bind(&dev.external_device_id)
            .bind(&dev.manufacturer)
            .bind(&dev.model)
            .bind(&dev.source_app_bundle)
            .bind(&dev.platform_source_id)
            .bind(&dev.metadata_json)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed upserting health device: {e}"))?;

            let actual_id: String = sqlx::query_scalar(
                "SELECT id FROM health_devices WHERE provider_id = ?1 AND external_device_id = ?2",
            )
            .bind(dev.provider_id.as_str())
            .bind(&dev.external_device_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Failed resolving device id: {e}"))?;
            device_id_map.insert((dev.provider_id, dev.id.as_str()), actual_id.clone());
            device_id_map.insert(
                (dev.provider_id, dev.external_device_id.as_str()),
                actual_id,
            );
        }

        let mut sleep_upserts = 0usize;
        for sess in &batch.sleep_sessions {
            if sess.end_at_ms <= sess.start_at_ms {
                continue;
            }
            let resolved_device_id = sess
                .device_id
                .as_ref()
                .and_then(|d| device_id_map.get(&(sess.provider_id, d.as_str())))
                .cloned();
            let flags_json =
                serde_json::to_string(&sess.quality_flags).unwrap_or_else(|_| "[]".into());
            sqlx::query(
                "INSERT INTO health_raw_sleep_sessions (
                   id, provider_id, device_id, external_record_id, source_app_bundle,
                   start_at_ms, end_at_ms, start_tz_offset_secs, end_tz_offset_secs,
                   duration_mins, time_in_bed_mins, sleep_efficiency_pct,
                   awake_mins, light_mins, deep_mins, rem_mins,
                   sleep_kind, provider_sleep_kind, quality_flags_json, quality_score,
                   notes, subjective_quality, acquisition_at_ms, sync_batch_id, is_deleted, is_synthetic
                 ) VALUES (CASE WHEN EXISTS (
                     SELECT 1 FROM health_raw_sleep_sessions
                     WHERE id = ?1 AND (provider_id != ?2 OR external_record_id != ?4)
                   ) THEN lower(hex(randomblob(16))) ELSE ?1 END, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)
                 ON CONFLICT(provider_id, external_record_id) DO UPDATE SET
                   device_id = excluded.device_id,
                   source_app_bundle = excluded.source_app_bundle,
                   start_at_ms = excluded.start_at_ms,
                   end_at_ms = excluded.end_at_ms,
                   start_tz_offset_secs = excluded.start_tz_offset_secs,
                   end_tz_offset_secs = excluded.end_tz_offset_secs,
                   duration_mins = excluded.duration_mins,
                   time_in_bed_mins = excluded.time_in_bed_mins,
                   sleep_efficiency_pct = excluded.sleep_efficiency_pct,
                   awake_mins = excluded.awake_mins,
                   light_mins = excluded.light_mins,
                   deep_mins = excluded.deep_mins,
                   rem_mins = excluded.rem_mins,
                   sleep_kind = excluded.sleep_kind,
                   provider_sleep_kind = excluded.provider_sleep_kind,
                   quality_flags_json = excluded.quality_flags_json,
                   quality_score = excluded.quality_score,
                   notes = excluded.notes,
                   subjective_quality = excluded.subjective_quality,
                   acquisition_at_ms = excluded.acquisition_at_ms,
                   sync_batch_id = excluded.sync_batch_id,
                   is_deleted = excluded.is_deleted,
                   is_synthetic = excluded.is_synthetic",
            )
            .bind(&sess.id)
            .bind(sess.provider_id.as_str())
            .bind(&resolved_device_id)
            .bind(&sess.external_record_id)
            .bind(&sess.source_app_bundle)
            .bind(sess.start_at_ms)
            .bind(sess.end_at_ms)
            .bind(sess.start_tz_offset_secs)
            .bind(sess.end_tz_offset_secs)
            .bind(sess.duration_mins)
            .bind(sess.time_in_bed_mins)
            .bind(sess.sleep_efficiency_pct)
            .bind(sess.awake_mins)
            .bind(sess.light_mins)
            .bind(sess.deep_mins)
            .bind(sess.rem_mins)
            .bind(sess.sleep_kind.as_str())
            .bind(&sess.provider_sleep_kind)
            .bind(&flags_json)
            .bind(sess.quality_score)
            .bind(&sess.notes)
            .bind(sess.subjective_quality)
            .bind(sess.acquisition_at_ms)
            .bind(&batch_id)
            .bind(if sess.is_deleted { 1 } else { 0 })
            .bind(if sess.is_synthetic { 1 } else { 0 })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed upserting sleep session: {e}"))?;

            let actual_raw_id: String = sqlx::query_scalar(
                "SELECT id FROM health_raw_sleep_sessions WHERE provider_id = ?1 AND external_record_id = ?2",
            )
            .bind(sess.provider_id.as_str())
            .bind(&sess.external_record_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Failed resolving raw sleep id: {e}"))?;

            sqlx::query("DELETE FROM health_sleep_stage_intervals WHERE raw_session_id = ?1")
                .bind(&actual_raw_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Failed clearing prior stage intervals: {e}"))?;

            for stage in &sess.stages {
                if stage.end_at_ms <= stage.start_at_ms {
                    continue;
                }
                sqlx::query(
                    "INSERT INTO health_sleep_stage_intervals
                     (id, raw_session_id, stage_type, start_at_ms, end_at_ms, provider_stage_code)
                     VALUES (CASE WHEN EXISTS (
                       SELECT 1 FROM health_sleep_stage_intervals WHERE id = ?1
                     ) THEN lower(hex(randomblob(16))) ELSE ?1 END, ?2, ?3, ?4, ?5, ?6)",
                )
                .bind(&stage.id)
                .bind(&actual_raw_id)
                .bind(stage.stage_type.as_str())
                .bind(stage.start_at_ms)
                .bind(stage.end_at_ms)
                .bind(&stage.provider_stage_code)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Failed inserting stage interval: {e}"))?;
            }
            sleep_upserts += 1;
        }

        let mut sleep_deletes = 0usize;
        for ext_id in &batch.deleted_sleep_external_ids {
            let res = sqlx::query(
                "UPDATE health_raw_sleep_sessions SET is_deleted = 1, sync_batch_id = ?1
                 WHERE provider_id = ?2 AND external_record_id = ?3 AND is_deleted = 0",
            )
            .bind(&batch_id)
            .bind(provider_id.as_str())
            .bind(ext_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed marking sleep deletion: {e}"))?;
            sleep_deletes += res.rows_affected() as usize;
        }

        let mut physio_upserts = 0usize;
        for obs in &batch.physio_observations {
            if !obs.value.is_finite() {
                continue;
            }
            let resolved_device_id = obs
                .device_id
                .as_ref()
                .and_then(|d| device_id_map.get(&(obs.provider_id, d.as_str())))
                .cloned();
            let q_json = serde_json::to_string(&obs.quality_flags).unwrap_or_else(|_| "[]".into());
            sqlx::query(
                "INSERT INTO health_physiological_observations (
                   id, provider_id, device_id, external_record_id, metric_type, value, unit, hrv_method,
                   measured_at_ms, period_start_ms, period_end_ms, tz_offset_secs, aggregation_method,
                   quality_flags_json, acquisition_at_ms, sync_batch_id, is_deleted, is_synthetic
                 ) VALUES (CASE WHEN EXISTS (
                     SELECT 1 FROM health_physiological_observations
                     WHERE id = ?1 AND (provider_id != ?2 OR external_record_id != ?4)
                   ) THEN lower(hex(randomblob(16))) ELSE ?1 END, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
                 ON CONFLICT(provider_id, external_record_id) DO UPDATE SET
                   device_id = excluded.device_id,
                   metric_type = excluded.metric_type,
                   value = excluded.value,
                   unit = excluded.unit,
                   hrv_method = excluded.hrv_method,
                   measured_at_ms = excluded.measured_at_ms,
                   period_start_ms = excluded.period_start_ms,
                   period_end_ms = excluded.period_end_ms,
                   tz_offset_secs = excluded.tz_offset_secs,
                   aggregation_method = excluded.aggregation_method,
                   quality_flags_json = excluded.quality_flags_json,
                   acquisition_at_ms = excluded.acquisition_at_ms,
                   sync_batch_id = excluded.sync_batch_id,
                   is_deleted = excluded.is_deleted,
                   is_synthetic = excluded.is_synthetic",
            )
            .bind(&obs.id)
            .bind(obs.provider_id.as_str())
            .bind(&resolved_device_id)
            .bind(&obs.external_record_id)
            .bind(obs.metric_type.as_str())
            .bind(obs.value)
            .bind(&obs.unit)
            .bind(obs.hrv_method.as_str())
            .bind(obs.measured_at_ms)
            .bind(obs.period_start_ms)
            .bind(obs.period_end_ms)
            .bind(obs.tz_offset_secs)
            .bind(&obs.aggregation_method)
            .bind(&q_json)
            .bind(obs.acquisition_at_ms)
            .bind(&batch_id)
            .bind(if obs.is_deleted { 1 } else { 0 })
            .bind(if obs.is_synthetic { 1 } else { 0 })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed upserting physiological observation: {e}"))?;
            physio_upserts += 1;
        }

        for ext_id in &batch.deleted_physio_external_ids {
            sqlx::query(
                "UPDATE health_physiological_observations SET is_deleted = 1, sync_batch_id = ?1
                 WHERE provider_id = ?2 AND (external_record_id = ?3
                    OR (?2 = 'android_health_connect' AND metric_type = 'heart_rate'
                        AND substr(external_record_id, 1, length(?3) + 1) = ?3 || '_'))",
            )
            .bind(&batch_id)
            .bind(provider_id.as_str())
            .bind(ext_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed deleting physio record: {e}"))?;
        }

        let mut recovery_upserts = 0usize;
        for rec in &batch.recovery_observations {
            sqlx::query(
                "INSERT INTO health_recovery_observations (
                   id, provider_id, external_record_id, score_name, score_value, scale_min, scale_max,
                   score_state, algorithm_id, represented_date, measured_at_ms, underlying_metrics_json,
                   acquisition_at_ms, is_synthetic
                 ) VALUES (CASE WHEN EXISTS (
                     SELECT 1 FROM health_recovery_observations
                     WHERE id = ?1 AND (provider_id != ?2 OR external_record_id != ?3)
                   ) THEN lower(hex(randomblob(16))) ELSE ?1 END, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(provider_id, external_record_id) DO UPDATE SET
                   score_name = excluded.score_name,
                   score_value = excluded.score_value,
                   scale_min = excluded.scale_min,
                   scale_max = excluded.scale_max,
                   score_state = excluded.score_state,
                   algorithm_id = excluded.algorithm_id,
                   represented_date = excluded.represented_date,
                   measured_at_ms = excluded.measured_at_ms,
                   underlying_metrics_json = excluded.underlying_metrics_json,
                   acquisition_at_ms = excluded.acquisition_at_ms,
                   is_synthetic = excluded.is_synthetic",
            )
            .bind(&rec.id)
            .bind(rec.provider_id.as_str())
            .bind(&rec.external_record_id)
            .bind(&rec.score_name)
            .bind(rec.score_value)
            .bind(rec.scale_min)
            .bind(rec.scale_max)
            .bind(&rec.score_state)
            .bind(&rec.algorithm_id)
            .bind(&rec.represented_date)
            .bind(rec.measured_at_ms)
            .bind(&rec.underlying_metrics_json)
            .bind(rec.acquisition_at_ms)
            .bind(if rec.is_synthetic { 1 } else { 0 })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed upserting recovery observation: {e}"))?;
            recovery_upserts += 1;
        }

        let done_ms = chrono::Utc::now().timestamp_millis();
        sqlx::query(
            "UPDATE health_sync_batches
             SET completed_at_ms = ?1, status = 'completed',
                 sleep_upserts = ?2, sleep_deletes = ?3,
                 physio_upserts = ?4, recovery_upserts = ?5
             WHERE id = ?6",
        )
        .bind(done_ms)
        .bind(sleep_upserts as i64)
        .bind(sleep_deletes as i64)
        .bind(physio_upserts as i64)
        .bind(recovery_upserts as i64)
        .bind(&batch_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed finalizing sync batch: {e}"))?;

        if let Some(record) = consent {
            Self::record_consent_on(tx, record).await?;
        }
        let reconciled_episodes = Self::reconcile_sleep_transaction(tx).await?;

        Ok(super::models::HealthSyncReport {
            batch_id,
            provider_id,
            sleep_upserts,
            sleep_deletes,
            physio_upserts,
            recovery_upserts,
            reconciled_episodes,
            warnings: batch.warnings,
            next_cursor: batch.next_cursor,
        })
    }

    pub async fn load_raw_sleep_sessions(
        &self,
        include_deleted: bool,
    ) -> Result<Vec<RawSleepSession>, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let sessions = Self::load_raw_sleep_sessions_on(&mut tx, include_deleted).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(sessions)
    }

    async fn load_raw_sleep_sessions_on(
        conn: &mut SqliteConnection,
        include_deleted: bool,
    ) -> Result<Vec<RawSleepSession>, String> {
        let query = if include_deleted {
            "SELECT * FROM health_raw_sleep_sessions ORDER BY start_at_ms ASC"
        } else {
            "SELECT * FROM health_raw_sleep_sessions WHERE is_deleted = 0 ORDER BY start_at_ms ASC"
        };
        let rows = sqlx::query(query)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| format!("Failed reading raw sleep sessions: {e}"))?;

        let stage_rows = sqlx::query(
            "SELECT id, raw_session_id, stage_type, start_at_ms, end_at_ms, provider_stage_code
             FROM health_sleep_stage_intervals ORDER BY start_at_ms ASC",
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| format!("Failed reading stage intervals: {e}"))?;

        let mut stage_map: HashMap<String, Vec<SleepStageInterval>> = HashMap::new();
        for sr in stage_rows {
            let sid: String = sr.get("raw_session_id");
            let st_str: String = sr.get("stage_type");
            stage_map
                .entry(sid.clone())
                .or_default()
                .push(SleepStageInterval {
                    id: sr.get("id"),
                    raw_session_id: sid,
                    stage_type: SleepStageType::from_str(&st_str),
                    start_at_ms: sr.get("start_at_ms"),
                    end_at_ms: sr.get("end_at_ms"),
                    provider_stage_code: sr.get("provider_stage_code"),
                });
        }

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let id: String = row.get("id");
            let p_str: String = row.get("provider_id");
            let provider_id =
                HealthProviderId::from_str(&p_str).unwrap_or(HealthProviderId::Manual);
            let kind_str: String = row.get("sleep_kind");
            let flags_json: String = row.get("quality_flags_json");
            let quality_flags: Vec<SleepQualityFlag> =
                serde_json::from_str(&flags_json).unwrap_or_default();

            out.push(RawSleepSession {
                id: id.clone(),
                provider_id,
                device_id: row.get("device_id"),
                external_record_id: row.get("external_record_id"),
                source_app_bundle: row.get("source_app_bundle"),
                start_at_ms: row.get("start_at_ms"),
                end_at_ms: row.get("end_at_ms"),
                start_tz_offset_secs: row.get("start_tz_offset_secs"),
                end_tz_offset_secs: row.get("end_tz_offset_secs"),
                duration_mins: row.get("duration_mins"),
                time_in_bed_mins: row.get("time_in_bed_mins"),
                sleep_efficiency_pct: row.get("sleep_efficiency_pct"),
                awake_mins: row.get("awake_mins"),
                light_mins: row.get("light_mins"),
                deep_mins: row.get("deep_mins"),
                rem_mins: row.get("rem_mins"),
                sleep_kind: SleepKind::from_str(&kind_str),
                provider_sleep_kind: row.get("provider_sleep_kind"),
                quality_flags,
                quality_score: row.get("quality_score"),
                notes: row.get("notes"),
                subjective_quality: row.get("subjective_quality"),
                acquisition_at_ms: row.get("acquisition_at_ms"),
                sync_batch_id: row.get("sync_batch_id"),
                is_deleted: row.get::<i64, _>("is_deleted") != 0,
                is_synthetic: row.get::<i64, _>("is_synthetic") != 0,
                stages: stage_map.remove(&id).unwrap_or_default(),
            });
        }
        Ok(out)
    }

    pub async fn reconcile_all_sleep(&self) -> Result<usize, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let count = Self::reconcile_sleep_transaction(&mut tx).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(count)
    }

    pub(crate) async fn reconcile_sleep_transaction(tx: &mut SqliteConnection) -> Result<usize, String> {
        sqlx::query("DELETE FROM health_sleep_episode_members")
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed clearing episode members: {e}"))?;
        sqlx::query("DELETE FROM health_canonical_sleep_episodes")
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed clearing canonical episodes: {e}"))?;

        let raw_sessions = Self::load_raw_sleep_sessions_on(tx, false).await?;
        let preferred_order = sqlx::query_scalar::<_, String>(
            "SELECT ordered_provider_ids_json FROM health_source_preferences WHERE category = 'sleep'",
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("Failed reading source preferences: {e}"))?
        .and_then(|json| serde_json::from_str::<Vec<HealthProviderId>>(&json).ok())
        .unwrap_or_default();
        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT raw_session_id, sleep_kind FROM health_sleep_kind_overrides")
                .fetch_all(&mut *tx)
                .await
                .map_err(|e| format!("Failed reading sleep kind overrides: {e}"))?;
        let overrides = rows
            .into_iter()
            .map(|(id, kind)| (id, SleepKind::from_str(&kind)))
            .collect();
        let episodes = reconcile_sleep_sessions(&raw_sessions, &preferred_order, &overrides);

        for ep in &episodes {
            let flags_json =
                serde_json::to_string(&ep.quality_flags).unwrap_or_else(|_| "[]".into());
            sqlx::query(
                "INSERT INTO health_canonical_sleep_episodes (
                   id, primary_raw_session_id, primary_provider_id, start_at_ms, end_at_ms,
                   start_tz_offset_secs, end_tz_offset_secs, anchor_local_date, sleep_kind,
                   user_sleep_kind_override, total_sleep_mins, time_in_bed_mins,
                   sleep_efficiency_pct, waso_mins, stage_coverage_ratio,
                   awake_mins, light_mins, deep_mins, rem_mins,
                   has_source_conflict, conflict_duration_diff_mins, quality_flags_json, is_synthetic
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
            )
            .bind(&ep.id)
            .bind(&ep.primary_raw_session_id)
            .bind(ep.primary_provider_id.as_str())
            .bind(ep.start_at_ms)
            .bind(ep.end_at_ms)
            .bind(ep.start_tz_offset_secs)
            .bind(ep.end_tz_offset_secs)
            .bind(&ep.anchor_local_date)
            .bind(ep.sleep_kind.as_str())
            .bind(ep.user_sleep_kind_override.map(|k| k.as_str()))
            .bind(ep.total_sleep_mins)
            .bind(ep.time_in_bed_mins)
            .bind(ep.sleep_efficiency_pct)
            .bind(ep.waso_mins)
            .bind(ep.stage_coverage_ratio)
            .bind(ep.awake_mins)
            .bind(ep.light_mins)
            .bind(ep.deep_mins)
            .bind(ep.rem_mins)
            .bind(if ep.has_source_conflict { 1 } else { 0 })
            .bind(ep.conflict_duration_diff_mins)
            .bind(&flags_json)
            .bind(if ep.is_synthetic { 1 } else { 0 })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed inserting canonical episode: {e}"))?;

            for m in &ep.members {
                sqlx::query(
                    "INSERT INTO health_sleep_episode_members (
                       canonical_episode_id, raw_session_id, provider_id, source_app_bundle,
                       duration_mins, relationship, priority_rank
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .bind(&m.canonical_episode_id)
                .bind(&m.raw_session_id)
                .bind(m.provider_id.as_str())
                .bind(&m.source_app_bundle)
                .bind(m.duration_mins)
                .bind(m.relationship.as_str())
                .bind(m.priority_rank)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Failed inserting episode member: {e}"))?;
            }
        }

        Ok(episodes.len())
    }

    pub async fn query_canonical_sleep_episodes(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
        include_synthetic: bool,
    ) -> Result<Vec<CanonicalSleepEpisode>, String> {
        let mut sql = String::from("SELECT * FROM health_canonical_sleep_episodes WHERE 1=1");
        if !include_synthetic {
            sql.push_str(" AND is_synthetic = 0");
        }
        if let Some(s) = start_ms {
            sql.push_str(&format!(" AND end_at_ms >= {s}"));
        }
        if let Some(e) = end_ms {
            sql.push_str(&format!(" AND start_at_ms <= {e}"));
        }
        sql.push_str(" ORDER BY start_at_ms ASC");

        let mut tx = self.pool.begin().await.map_err(|error| error.to_string())?;
        let rows = sqlx::query(&sql)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| format!("Failed reading canonical episodes: {e}"))?;

        if rows.is_empty() {
            return Ok(Vec::new());
        }

        let member_rows = sqlx::query(
            "SELECT canonical_episode_id, raw_session_id, provider_id, source_app_bundle,
                    duration_mins, relationship, priority_rank
             FROM health_sleep_episode_members ORDER BY priority_rank ASC",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| format!("Failed reading episode members: {e}"))?;
        let mut members_map: HashMap<String, Vec<SleepEpisodeMember>> = HashMap::new();
        for mr in member_rows {
            let cid: String = mr.get("canonical_episode_id");
            let p_str: String = mr.get("provider_id");
            let rel_str: String = mr.get("relationship");
            members_map
                .entry(cid.clone())
                .or_default()
                .push(SleepEpisodeMember {
                    canonical_episode_id: cid,
                    raw_session_id: mr.get("raw_session_id"),
                    provider_id: HealthProviderId::from_str(&p_str)
                        .unwrap_or(HealthProviderId::Manual),
                    source_app_bundle: mr.get("source_app_bundle"),
                    duration_mins: mr.get("duration_mins"),
                    relationship: DuplicateRelationship::from_str(&rel_str),
                    priority_rank: mr.get("priority_rank"),
                });
        }

        let stage_rows = sqlx::query(
            "SELECT id, raw_session_id, stage_type, start_at_ms, end_at_ms, provider_stage_code
             FROM health_sleep_stage_intervals ORDER BY start_at_ms ASC",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| format!("Failed reading canonical stages: {e}"))?;
        let mut stage_map: HashMap<String, Vec<SleepStageInterval>> = HashMap::new();
        for sr in stage_rows {
            let sid: String = sr.get("raw_session_id");
            let st_str: String = sr.get("stage_type");
            stage_map
                .entry(sid.clone())
                .or_default()
                .push(SleepStageInterval {
                    id: sr.get("id"),
                    raw_session_id: sid,
                    stage_type: SleepStageType::from_str(&st_str),
                    start_at_ms: sr.get("start_at_ms"),
                    end_at_ms: sr.get("end_at_ms"),
                    provider_stage_code: sr.get("provider_stage_code"),
                });
        }

        tx.commit().await.map_err(|error| error.to_string())?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let id: String = row.get("id");
            let primary_raw_id: String = row.get("primary_raw_session_id");
            let p_str: String = row.get("primary_provider_id");
            let kind_str: String = row.get("sleep_kind");
            let ovr_str: Option<String> = row.get("user_sleep_kind_override");
            let flags_json: String = row.get("quality_flags_json");
            out.push(CanonicalSleepEpisode {
                id: id.clone(),
                primary_raw_session_id: primary_raw_id.clone(),
                primary_provider_id: HealthProviderId::from_str(&p_str)
                    .unwrap_or(HealthProviderId::Manual),
                start_at_ms: row.get("start_at_ms"),
                end_at_ms: row.get("end_at_ms"),
                start_tz_offset_secs: row.get("start_tz_offset_secs"),
                end_tz_offset_secs: row.get("end_tz_offset_secs"),
                anchor_local_date: row.get("anchor_local_date"),
                sleep_kind: SleepKind::from_str(&kind_str),
                user_sleep_kind_override: ovr_str.as_deref().map(SleepKind::from_str),
                total_sleep_mins: row.get("total_sleep_mins"),
                time_in_bed_mins: row.get("time_in_bed_mins"),
                sleep_efficiency_pct: row.get("sleep_efficiency_pct"),
                waso_mins: row.get("waso_mins"),
                stage_coverage_ratio: row.get("stage_coverage_ratio"),
                awake_mins: row.get("awake_mins"),
                light_mins: row.get("light_mins"),
                deep_mins: row.get("deep_mins"),
                rem_mins: row.get("rem_mins"),
                has_source_conflict: row.get::<i64, _>("has_source_conflict") != 0,
                conflict_duration_diff_mins: row.get("conflict_duration_diff_mins"),
                quality_flags: serde_json::from_str(&flags_json).unwrap_or_default(),
                is_synthetic: row.get::<i64, _>("is_synthetic") != 0,
                stages: stage_map.remove(&primary_raw_id).unwrap_or_default(),
                members: members_map.remove(&id).unwrap_or_default(),
            });
        }
        Ok(out)
    }

    pub async fn query_physiological_observations(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
        include_synthetic: bool,
    ) -> Result<Vec<PhysiologicalObservation>, String> {
        let mut sql =
            String::from("SELECT * FROM health_physiological_observations WHERE is_deleted = 0");
        if !include_synthetic {
            sql.push_str(" AND is_synthetic = 0");
        }
        if let Some(s) = start_ms {
            sql.push_str(&format!(" AND measured_at_ms >= {s}"));
        }
        if let Some(e) = end_ms {
            sql.push_str(&format!(" AND measured_at_ms <= {e}"));
        }
        sql.push_str(" ORDER BY measured_at_ms ASC");

        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed querying physio observations: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let p_str: String = r.get("provider_id");
            let m_str: String = r.get("metric_type");
            let hrv_str: String = r.get("hrv_method");
            let q_json: String = r.get("quality_flags_json");
            let Some(metric_type) = PhysiologicalMetricType::from_str(&m_str) else {
                continue;
            };
            out.push(PhysiologicalObservation {
                id: r.get("id"),
                provider_id: HealthProviderId::from_str(&p_str).unwrap_or(HealthProviderId::Manual),
                device_id: r.get("device_id"),
                external_record_id: r.get("external_record_id"),
                metric_type,
                value: r.get("value"),
                unit: r.get("unit"),
                hrv_method: HrvMethod::from_str(Some(&hrv_str)),
                measured_at_ms: r.get("measured_at_ms"),
                period_start_ms: r.get("period_start_ms"),
                period_end_ms: r.get("period_end_ms"),
                tz_offset_secs: r.get("tz_offset_secs"),
                aggregation_method: r.get("aggregation_method"),
                quality_flags: serde_json::from_str(&q_json).unwrap_or_default(),
                acquisition_at_ms: r.get("acquisition_at_ms"),
                sync_batch_id: r.get("sync_batch_id"),
                is_deleted: r.get::<i64, _>("is_deleted") != 0,
                is_synthetic: r.get::<i64, _>("is_synthetic") != 0,
            });
        }
        Ok(out)
    }

    pub async fn query_recovery_observations(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
        include_synthetic: bool,
    ) -> Result<Vec<RecoveryObservation>, String> {
        let mut sql = String::from("SELECT * FROM health_recovery_observations WHERE 1=1");
        if !include_synthetic {
            sql.push_str(" AND is_synthetic = 0");
        }
        if let Some(s) = start_ms {
            sql.push_str(&format!(" AND measured_at_ms >= {s}"));
        }
        if let Some(e) = end_ms {
            sql.push_str(&format!(" AND measured_at_ms <= {e}"));
        }
        sql.push_str(" ORDER BY measured_at_ms ASC");

        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed querying recovery observations: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let p_str: String = r.get("provider_id");
            out.push(RecoveryObservation {
                id: r.get("id"),
                provider_id: HealthProviderId::from_str(&p_str).unwrap_or(HealthProviderId::Manual),
                external_record_id: r.get("external_record_id"),
                score_name: r.get("score_name"),
                score_value: r.get("score_value"),
                scale_min: r.get("scale_min"),
                scale_max: r.get("scale_max"),
                score_state: r.get("score_state"),
                algorithm_id: r.get("algorithm_id"),
                represented_date: r.get("represented_date"),
                measured_at_ms: r.get("measured_at_ms"),
                underlying_metrics_json: r.get("underlying_metrics_json"),
                acquisition_at_ms: r.get("acquisition_at_ms"),
                is_synthetic: r.get::<i64, _>("is_synthetic") != 0,
            });
        }
        Ok(out)
    }

    pub async fn set_sleep_kind_override(
        &self,
        raw_session_id: &str,
        sleep_kind: SleepKind,
    ) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO health_sleep_kind_overrides (raw_session_id, sleep_kind, updated_at_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(raw_session_id) DO UPDATE SET
               sleep_kind = excluded.sleep_kind,
               updated_at_ms = excluded.updated_at_ms",
        )
        .bind(raw_session_id)
        .bind(sleep_kind.as_str())
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed setting sleep kind override: {e}"))?;

        Self::reconcile_sleep_transaction(&mut tx).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn delete_manual_sleep(&self, raw_session_id: &str) -> Result<bool, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let res = sqlx::query(
            "DELETE FROM health_raw_sleep_sessions WHERE id = ?1 AND provider_id = 'manual'",
        )
        .bind(raw_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed deleting manual sleep session: {e}"))?;
        let removed = res.rows_affected() > 0;
        if removed {
            Self::reconcile_sleep_transaction(&mut tx).await?;
        }
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(removed)
    }

    pub async fn clear_synthetic_data(&self) -> Result<(), String> {
        sqlx::query("DELETE FROM health_canonical_sleep_episodes WHERE is_synthetic = 1")
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed clearing synthetic canonical sleep: {e}"))?;
        sqlx::query("DELETE FROM health_raw_sleep_sessions WHERE is_synthetic = 1")
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed clearing synthetic raw sleep: {e}"))?;
        sqlx::query("DELETE FROM health_physiological_observations WHERE is_synthetic = 1")
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed clearing synthetic physio: {e}"))?;
        sqlx::query("DELETE FROM health_recovery_observations WHERE is_synthetic = 1")
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed clearing synthetic recovery: {e}"))?;

        let mut settings = self.get_privacy_settings().await?;
        settings.demo_mode_enabled = false;
        self.update_privacy_settings(settings).await?;
        self.reconcile_all_sleep().await?;
        Ok(())
    }

    pub async fn disconnect_provider(&self, provider_id: HealthProviderId) -> Result<(), String> {
        self.token_store.remove_token(provider_id).await?;
        sqlx::query("DELETE FROM health_connections WHERE provider_id = ?")
            .bind(provider_id.as_str())
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn delete_provider_data(&self, provider_id: HealthProviderId) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        if provider_id == HealthProviderId::AppleHealthkit {
            sqlx::query("DELETE FROM health_healthkit_sleep_samples")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
        let p = provider_id.as_str();
        sqlx::query("DELETE FROM health_raw_sleep_sessions WHERE provider_id = ?1")
            .bind(p)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed deleting provider sleep sessions: {e}"))?;
        sqlx::query("DELETE FROM health_physiological_observations WHERE provider_id = ?1")
            .bind(p)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed deleting provider physio observations: {e}"))?;
        sqlx::query("DELETE FROM health_recovery_observations WHERE provider_id = ?1")
            .bind(p)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed deleting provider recovery observations: {e}"))?;
        sqlx::query("DELETE FROM health_devices WHERE provider_id = ?1")
            .bind(p)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed deleting provider devices: {e}"))?;
        sqlx::query("DELETE FROM health_sync_batches WHERE provider_id = ?1")
            .bind(p)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed deleting provider sync batches: {e}"))?;
        sqlx::query("DELETE FROM health_connections WHERE provider_id = ?1")
            .bind(p)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed deleting provider connection: {e}"))?;

        Self::reconcile_sleep_transaction(&mut tx).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        self.token_store.remove_token(provider_id).await?;
        Ok(())
    }

    pub async fn wipe_all_health_data(&self) -> Result<(), String> {
        let mut db = self.pool.acquire().await.map_err(|e| e.to_string())?;
        let mut tx = sqlx::Connection::begin(&mut *db)
            .await
            .map_err(|e| e.to_string())?;
        let tables = [
            "health_watched_import_files",
            "health_watched_import_folders",
            "health_csv_mapping_profiles",
            "health_import_batch_records",
            "health_import_batches",
            "health_healthkit_sleep_samples",
            "health_sleep_kind_overrides",
            "health_sleep_episode_members",
            "health_canonical_sleep_episodes",
            "health_sleep_stage_intervals",
            "health_raw_sleep_sessions",
            "health_physiological_observations",
            "health_recovery_observations",
            "health_devices",
            "health_sync_batches",
            "health_connections",
            "health_consent_log",
            "health_source_preferences",
            "health_privacy_settings",
        ];
        for table in tables {
            sqlx::query(&format!("DELETE FROM {table}"))
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Failed wiping {table}: {e}"))?;
        }

        tx.commit().await.map_err(|e| e.to_string())?;
        sqlx::query("VACUUM")
            .execute(&mut *db)
            .await
            .map_err(|e| e.to_string())?;
        let (busy, _, _): (i32, i32, i32) = sqlx::query_as("PRAGMA wal_checkpoint(TRUNCATE)")
            .fetch_one(&mut *db)
            .await
            .map_err(|e| e.to_string())?;
        if busy != 0 {
            return Err("The health vault is busy. Retry to finish erasing it.".into());
        }
        drop(db);
        self.token_store.remove_all_tokens().await?;
        self.ensure_defaults().await?;
        Ok(())
    }

    pub async fn list_sync_batches(&self, limit: i64) -> Result<Vec<HealthSyncBatch>, String> {
        let rows = sqlx::query(
            "SELECT id, provider_id, sync_kind, started_at_ms, completed_at_ms, status,
                    sleep_upserts, sleep_deletes, physio_upserts, recovery_upserts, error_message
             FROM health_sync_batches ORDER BY started_at_ms DESC LIMIT ?1",
        )
        .bind(limit.clamp(1, 100))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed listing sync batches: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let p_str: String = r.get("provider_id");
            out.push(HealthSyncBatch {
                id: r.get("id"),
                provider_id: HealthProviderId::from_str(&p_str).unwrap_or(HealthProviderId::Manual),
                sync_kind: r.get("sync_kind"),
                started_at_ms: r.get("started_at_ms"),
                completed_at_ms: r.get("completed_at_ms"),
                status: r.get("status"),
                sleep_upserts: r.get("sleep_upserts"),
                sleep_deletes: r.get("sleep_deletes"),
                physio_upserts: r.get("physio_upserts"),
                recovery_upserts: r.get("recovery_upserts"),
                error_message: r.get("error_message"),
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::time::parse_timestamp_with_offset;

    #[tokio::test]
    async fn healthkit_anchor_and_grouped_sleep_deletion_commit_together() {
        let vault = HealthVault::new_in_memory().await.unwrap();
        let mut connection =
            crate::commands::health_sources::new_connection(HealthProviderId::AppleHealthkit);
        connection.sync_cursor = Some("anchor-one".into());
        let first = serde_json::from_value(serde_json::json!({
            "sleepSamples": [
                {"uuid":"a", "startAtMs":1_800_000_000_000i64,"endAtMs":1_800_003_600_000i64,"stageType":"light","sourceBundleId":"test.watch"},
                {"uuid":"b", "startAtMs":1_800_003_600_000i64,"endAtMs":1_800_007_200_000i64,"stageType":"deep","sourceBundleId":"test.watch"}
            ],
            "nextAnchorJson":"anchor-one"
        })).unwrap();
        vault
            .ingest_healthkit_delta(first, &connection, None)
            .await
            .unwrap();
        let episodes = vault
            .query_canonical_sleep_episodes(None, None, false)
            .await
            .unwrap();
        assert_eq!(episodes.len(), 1);
        assert_eq!(episodes[0].total_sleep_mins, 120.0);

        connection.sync_cursor = Some("anchor-two".into());
        let second = serde_json::from_value(serde_json::json!({
            "deletedUuids":["a"], "nextAnchorJson":"anchor-two"
        }))
        .unwrap();
        vault
            .ingest_healthkit_delta(second, &connection, None)
            .await
            .unwrap();
        let remaining = vault
            .query_canonical_sleep_episodes(None, None, false)
            .await
            .unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].total_sleep_mins, 60.0);
        assert_eq!(
            vault
                .get_connection(HealthProviderId::AppleHealthkit)
                .await
                .unwrap()
                .unwrap()
                .sync_cursor
                .as_deref(),
            Some("anchor-two")
        );
        vault
            .delete_provider_data(HealthProviderId::AppleHealthkit)
            .await
            .unwrap();
        let cache_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM health_healthkit_sleep_samples")
                .fetch_one(vault.pool())
                .await
                .unwrap();
        assert_eq!(cache_count, 0);
    }

    #[tokio::test]
    async fn idempotent_ingest_and_full_wipe() {
        let vault = HealthVault::new_in_memory().await.unwrap();
        let (s_ms, s_off) = parse_timestamp_with_offset("2026-11-18T23:00:00Z").unwrap();
        let (e_ms, e_off) = parse_timestamp_with_offset("2026-11-19T07:00:00Z").unwrap();

        let batch = NormalizedIngestionBatch {
            sleep_sessions: vec![RawSleepSession {
                id: "s1".into(),
                provider_id: HealthProviderId::Oura,
                device_id: None,
                external_record_id: "ext-1".into(),
                source_app_bundle: None,
                start_at_ms: s_ms,
                end_at_ms: e_ms,
                start_tz_offset_secs: s_off,
                end_tz_offset_secs: e_off,
                duration_mins: 480.0,
                time_in_bed_mins: Some(495.0),
                sleep_efficiency_pct: Some(96.9),
                awake_mins: None,
                light_mins: None,
                deep_mins: None,
                rem_mins: None,
                sleep_kind: SleepKind::MainSleep,
                provider_sleep_kind: Some("long_sleep".into()),
                quality_flags: Vec::new(),
                quality_score: 1.0,
                notes: None,
                subjective_quality: None,
                acquisition_at_ms: e_ms,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: false,
                stages: Vec::new(),
            }],
            ..Default::default()
        };

        vault
            .ingest_batch(HealthProviderId::Oura, "manual", batch.clone())
            .await
            .unwrap();
        // Repeat identical external_record_id -> must stay 1 episode
        vault
            .ingest_batch(HealthProviderId::Oura, "manual", batch)
            .await
            .unwrap();

        let eps = vault
            .query_canonical_sleep_episodes(None, None, false)
            .await
            .unwrap();
        assert_eq!(eps.len(), 1);

        // Full wipe removes everything
        vault.wipe_all_health_data().await.unwrap();
        let eps_after = vault
            .query_canonical_sleep_episodes(None, None, true)
            .await
            .unwrap();
        assert!(eps_after.is_empty());
    }

    #[tokio::test]
    async fn isolated_vault_survives_reopen_and_scopes_ids_by_provider() {
        let dir = tempfile::tempdir().unwrap();
        let vault = HealthVault::open(dir.path()).await.unwrap();
        let mut batch = crate::health::fixtures::generate_demo_batch(1, 1_800_000_000_000, 10);
        let mut other = batch.sleep_sessions[0].clone();
        other.provider_id = HealthProviderId::Whoop;
        other.device_id = None;
        batch.sleep_sessions.push(other);

        vault
            .ingest_batch(HealthProviderId::Oura, "test", batch)
            .await
            .unwrap();
        assert_eq!(vault.load_raw_sleep_sessions(false).await.unwrap().len(), 2);
        assert!(!dir
            .path()
            .join(crate::database::connection::DB_FILE_NAME)
            .exists());
        vault.pool().close().await;

        let vault = HealthVault::open(dir.path()).await.unwrap();
        let migrations: Vec<String> =
            sqlx::query_scalar("SELECT name FROM _health_schema_migrations")
                .fetch_all(vault.pool())
                .await
                .unwrap();
        assert_eq!(migrations.len(), 2);
        assert!(migrations.iter().any(|m| m == "002_healthkit_samples"));
        let episodes = vault
            .query_canonical_sleep_episodes(None, None, true)
            .await
            .unwrap();
        assert_eq!(episodes.len(), 1);
        assert_eq!(episodes[0].members.len(), 2);

        vault
            .delete_provider_data(HealthProviderId::Oura)
            .await
            .unwrap();
        let episodes = vault
            .query_canonical_sleep_episodes(None, None, true)
            .await
            .unwrap();
        assert_eq!(episodes[0].primary_provider_id, HealthProviderId::Whoop);
        vault.wipe_all_health_data().await.unwrap();
        assert!(vault
            .load_raw_sleep_sessions(false)
            .await
            .unwrap()
            .is_empty());
    }
}
