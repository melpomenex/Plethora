//! Transactional schema migrations for the isolated Health Vault (`health.db`).

use sqlx::{Pool, Sqlite};

pub struct HealthMigration {
    pub name: &'static str,
    pub sql: &'static str,
}

pub const HEALTH_MIGRATIONS: &[HealthMigration] = &[
    HealthMigration {
        name: "001_health_foundation",
        sql: r#"
        CREATE TABLE IF NOT EXISTS health_connections (
            provider_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            auth_state TEXT NOT NULL,
            requested_categories_json TEXT NOT NULL DEFAULT '[]',
            granted_categories_json TEXT NOT NULL DEFAULT '[]',
            last_sync_at_ms INTEGER,
            last_success_at_ms INTEGER,
            sync_cursor TEXT,
            account_subject_hint TEXT,
            last_error_code TEXT,
            last_error_message TEXT,
            history_limit_days INTEGER,
            background_sync_enabled INTEGER NOT NULL DEFAULT 0,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS health_devices (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            external_device_id TEXT NOT NULL,
            manufacturer TEXT,
            model TEXT,
            source_app_bundle TEXT,
            platform_source_id TEXT,
            metadata_json TEXT,
            UNIQUE(provider_id, external_device_id)
        );

        CREATE TABLE IF NOT EXISTS health_consent_log (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            action TEXT NOT NULL,
            categories_json TEXT NOT NULL DEFAULT '[]',
            purpose TEXT NOT NULL,
            policy_version TEXT NOT NULL,
            recorded_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_health_consent_log_time
            ON health_consent_log(recorded_at_ms DESC);

        CREATE TABLE IF NOT EXISTS health_sync_batches (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            sync_kind TEXT NOT NULL,
            started_at_ms INTEGER NOT NULL,
            completed_at_ms INTEGER,
            status TEXT NOT NULL,
            sleep_upserts INTEGER NOT NULL DEFAULT 0,
            sleep_deletes INTEGER NOT NULL DEFAULT 0,
            physio_upserts INTEGER NOT NULL DEFAULT 0,
            recovery_upserts INTEGER NOT NULL DEFAULT 0,
            error_message TEXT
        );

        CREATE TABLE IF NOT EXISTS health_raw_sleep_sessions (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            device_id TEXT REFERENCES health_devices(id) ON DELETE SET NULL,
            external_record_id TEXT NOT NULL,
            source_app_bundle TEXT,
            start_at_ms INTEGER NOT NULL,
            end_at_ms INTEGER NOT NULL,
            start_tz_offset_secs INTEGER,
            end_tz_offset_secs INTEGER,
            duration_mins REAL NOT NULL,
            time_in_bed_mins REAL,
            sleep_efficiency_pct REAL,
            awake_mins REAL,
            light_mins REAL,
            deep_mins REAL,
            rem_mins REAL,
            sleep_kind TEXT NOT NULL,
            provider_sleep_kind TEXT,
            quality_flags_json TEXT NOT NULL DEFAULT '[]',
            quality_score REAL NOT NULL DEFAULT 1.0,
            notes TEXT,
            subjective_quality INTEGER,
            acquisition_at_ms INTEGER NOT NULL,
            sync_batch_id TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            is_synthetic INTEGER NOT NULL DEFAULT 0,
            UNIQUE(provider_id, external_record_id)
        );
        CREATE INDEX IF NOT EXISTS idx_raw_sleep_time
            ON health_raw_sleep_sessions(start_at_ms, end_at_ms);
        CREATE INDEX IF NOT EXISTS idx_raw_sleep_provider
            ON health_raw_sleep_sessions(provider_id, is_deleted);
        CREATE INDEX IF NOT EXISTS idx_raw_sleep_synthetic
            ON health_raw_sleep_sessions(is_synthetic);

        CREATE TABLE IF NOT EXISTS health_sleep_stage_intervals (
            id TEXT PRIMARY KEY,
            raw_session_id TEXT NOT NULL REFERENCES health_raw_sleep_sessions(id) ON DELETE CASCADE,
            stage_type TEXT NOT NULL,
            start_at_ms INTEGER NOT NULL,
            end_at_ms INTEGER NOT NULL,
            provider_stage_code TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_stage_intervals_session
            ON health_sleep_stage_intervals(raw_session_id, start_at_ms);

        CREATE TABLE IF NOT EXISTS health_canonical_sleep_episodes (
            id TEXT PRIMARY KEY,
            primary_raw_session_id TEXT NOT NULL REFERENCES health_raw_sleep_sessions(id) ON DELETE CASCADE,
            primary_provider_id TEXT NOT NULL,
            start_at_ms INTEGER NOT NULL,
            end_at_ms INTEGER NOT NULL,
            start_tz_offset_secs INTEGER,
            end_tz_offset_secs INTEGER,
            anchor_local_date TEXT NOT NULL,
            sleep_kind TEXT NOT NULL,
            user_sleep_kind_override TEXT,
            total_sleep_mins REAL NOT NULL,
            time_in_bed_mins REAL,
            sleep_efficiency_pct REAL,
            waso_mins REAL,
            stage_coverage_ratio REAL NOT NULL DEFAULT 0.0,
            awake_mins REAL,
            light_mins REAL,
            deep_mins REAL,
            rem_mins REAL,
            has_source_conflict INTEGER NOT NULL DEFAULT 0,
            conflict_duration_diff_mins REAL,
            quality_flags_json TEXT NOT NULL DEFAULT '[]',
            is_synthetic INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_sleep_anchor
            ON health_canonical_sleep_episodes(anchor_local_date);
        CREATE INDEX IF NOT EXISTS idx_canonical_sleep_time
            ON health_canonical_sleep_episodes(start_at_ms, end_at_ms);
        CREATE INDEX IF NOT EXISTS idx_canonical_sleep_synthetic
            ON health_canonical_sleep_episodes(is_synthetic);

        CREATE TABLE IF NOT EXISTS health_sleep_episode_members (
            canonical_episode_id TEXT NOT NULL REFERENCES health_canonical_sleep_episodes(id) ON DELETE CASCADE,
            raw_session_id TEXT NOT NULL REFERENCES health_raw_sleep_sessions(id) ON DELETE CASCADE,
            provider_id TEXT NOT NULL,
            source_app_bundle TEXT,
            duration_mins REAL NOT NULL,
            relationship TEXT NOT NULL,
            priority_rank INTEGER NOT NULL,
            PRIMARY KEY (canonical_episode_id, raw_session_id)
        );

        CREATE TABLE IF NOT EXISTS health_physiological_observations (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            device_id TEXT REFERENCES health_devices(id) ON DELETE SET NULL,
            external_record_id TEXT NOT NULL,
            metric_type TEXT NOT NULL,
            value REAL NOT NULL,
            unit TEXT NOT NULL,
            hrv_method TEXT NOT NULL DEFAULT 'unknown',
            measured_at_ms INTEGER NOT NULL,
            period_start_ms INTEGER,
            period_end_ms INTEGER,
            tz_offset_secs INTEGER,
            aggregation_method TEXT,
            quality_flags_json TEXT NOT NULL DEFAULT '[]',
            acquisition_at_ms INTEGER NOT NULL,
            sync_batch_id TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            is_synthetic INTEGER NOT NULL DEFAULT 0,
            UNIQUE(provider_id, external_record_id)
        );
        CREATE INDEX IF NOT EXISTS idx_physio_metric_time
            ON health_physiological_observations(metric_type, measured_at_ms);
        CREATE INDEX IF NOT EXISTS idx_physio_synthetic
            ON health_physiological_observations(is_synthetic);

        CREATE TABLE IF NOT EXISTS health_recovery_observations (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            external_record_id TEXT NOT NULL,
            score_name TEXT NOT NULL,
            score_value REAL,
            scale_min REAL NOT NULL,
            scale_max REAL NOT NULL,
            score_state TEXT NOT NULL,
            algorithm_id TEXT,
            represented_date TEXT NOT NULL,
            measured_at_ms INTEGER NOT NULL,
            underlying_metrics_json TEXT,
            acquisition_at_ms INTEGER NOT NULL,
            is_synthetic INTEGER NOT NULL DEFAULT 0,
            UNIQUE(provider_id, external_record_id)
        );
        CREATE INDEX IF NOT EXISTS idx_recovery_date
            ON health_recovery_observations(represented_date, provider_id);

        CREATE TABLE IF NOT EXISTS health_source_preferences (
            category TEXT PRIMARY KEY,
            ordered_provider_ids_json TEXT NOT NULL DEFAULT '[]',
            updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS health_privacy_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            ai_sharing_enabled INTEGER NOT NULL DEFAULT 0,
            cloud_sync_enabled INTEGER NOT NULL DEFAULT 0,
            demo_mode_enabled INTEGER NOT NULL DEFAULT 0,
            retention_days INTEGER,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS health_sleep_kind_overrides (
            raw_session_id TEXT PRIMARY KEY REFERENCES health_raw_sleep_sessions(id) ON DELETE CASCADE,
            sleep_kind TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
    "#,
    },
    HealthMigration {
        name: "002_healthkit_samples",
        sql: r#"
        CREATE TABLE health_healthkit_sleep_samples (
            uuid TEXT PRIMARY KEY NOT NULL,
            sample_json TEXT NOT NULL
        );
    "#,
    },
];

pub async fn run_health_migrations(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS _health_schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed creating _health_schema_migrations: {e}"))?;

    let applied: Vec<String> =
        sqlx::query_as::<_, (String,)>("SELECT name FROM _health_schema_migrations")
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed reading _health_schema_migrations: {e}"))?
            .into_iter()
            .map(|(n,)| n)
            .collect();

    for migration in HEALTH_MIGRATIONS {
        if applied.iter().any(|n| n == migration.name) {
            continue;
        }
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| format!("Failed starting health migration tx: {e}"))?;

        for stmt in migration.sql.split(';') {
            let trimmed = stmt.trim();
            if trimmed.is_empty() {
                continue;
            }
            sqlx::query(trimmed)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Health migration {} failed: {e}", migration.name))?;
        }

        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO _health_schema_migrations (name, applied_at) VALUES (?1, ?2)")
            .bind(migration.name)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed recording health migration: {e}"))?;

        tx.commit()
            .await
            .map_err(|e| format!("Failed committing health migration: {e}"))?;
    }

    Ok(())
}
