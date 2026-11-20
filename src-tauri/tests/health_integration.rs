use std::time::{Duration, Instant};

use plethora_tauri_lib::{
    database::Database,
    health::{
        db::HealthVault,
        fixtures::generate_demo_batch,
        import_export::{export_json_bundle, import_json_bundle, upsert_manual_sleep},
        learning_analytics::compute_learning_insights,
        models::{HealthProviderId, ManualSleepInput, SleepKind},
        telemetry::{LearningTelemetrySnapshot, RawReviewEvent},
        token_store::HealthOAuthToken,
    },
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

const DAY_MS: i64 = 86_400_000;
const START_MS: i64 = 1_700_006_400_000;

#[tokio::test]
async fn health_records_stay_out_of_library_snapshots_and_are_erased_locally() {
    let dir = tempfile::tempdir().unwrap();
    let database = Database::new(dir.path().join("plethora.db")).await.unwrap();
    plethora_tauri_lib::database::migrations::run_migrations(database.pool())
        .await
        .unwrap();
    let vault = HealthVault::open(dir.path()).await.unwrap();
    const CANARY: &str = "vault-only-sleep-note-426";
    upsert_manual_sleep(
        &vault,
        ManualSleepInput {
            id: None,
            start_iso: "2026-11-19T23:00:00+00:00".into(),
            end_iso: "2026-11-20T07:00:00+00:00".into(),
            tz_offset_minutes: None,
            sleep_kind: Some(SleepKind::MainSleep),
            time_in_bed_mins: None,
            subjective_quality: Some(4),
            notes: Some(CANARY.into()),
        },
    )
    .await
    .unwrap();
    assert!(dir.path().join("health/health.db").is_file());
    let privacy = vault.get_privacy_settings().await.unwrap();
    assert!(!privacy.ai_sharing_enabled && !privacy.cloud_sync_enabled);
    let schema_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sqlite_schema WHERE name GLOB 'health_*'")
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(schema_count, 0);
    for table in ["sync_outbox", "semantic_chunks"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(database.pool())
            .await
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }

    let snapshot = dir.path().join("backup.db");
    sqlx::query("VACUUM INTO ?")
        .bind(snapshot.to_str().unwrap())
        .execute(database.pool())
        .await
        .unwrap();
    let contents = std::fs::read(&snapshot).unwrap();
    assert!(!contents
        .windows(CANARY.len())
        .any(|candidate| candidate == CANARY.as_bytes()));
    let snapshot_db = SqlitePoolOptions::new()
        .connect_with(
            SqliteConnectOptions::new()
                .filename(snapshot)
                .read_only(true),
        )
        .await
        .unwrap();
    let schema_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sqlite_schema WHERE name GLOB 'health_*'")
            .fetch_one(&snapshot_db)
            .await
            .unwrap();
    assert_eq!(schema_count, 0);

    let export = export_json_bundle(&vault).await.unwrap();
    assert_eq!(export.sleep_sessions.len(), 1);
    let mut poisoned = serde_json::to_value(&export).unwrap();
    poisoned["sleepSessions"][0]["endAtMs"] = 0.into();
    assert!(import_json_bundle(&vault, &poisoned.to_string())
        .await
        .is_err());
    assert_eq!(
        export_json_bundle(&vault)
            .await
            .unwrap()
            .sleep_sessions
            .len(),
        1
    );

    let token = HealthOAuthToken {
        access_token: "private-access-canary".into(),
        refresh_token: Some("private-refresh-canary".into()),
        expires_at_ms: None,
        token_type: "Bearer".into(),
        scope: None,
        account_subject_hint: None,
    };
    assert!(!format!("{token:?}").contains("canary"));
    vault
        .token_store()
        .store_token(HealthProviderId::Oura, &token)
        .await
        .unwrap();
    let export = serde_json::to_string(&export_json_bundle(&vault).await.unwrap()).unwrap();
    assert!(
        !export.contains("private-access-canary") && !export.contains("private-refresh-canary")
    );
    vault.wipe_all_health_data().await.unwrap();
    assert!(vault
        .token_store()
        .get_token(HealthProviderId::Oura)
        .await
        .unwrap()
        .is_none());
    assert!(vault
        .query_canonical_sleep_episodes(None, None, false)
        .await
        .unwrap()
        .is_empty());
    assert!(vault.get_consent_log(10).await.unwrap().is_empty());
}

#[tokio::test]
async fn health_vault_and_twenty_thousand_reviews_complete_within_local_budgets() {
    let vault = HealthVault::new_in_memory().await.unwrap();
    let mut batch = generate_demo_batch(1, START_MS, 74);
    let template = batch.sleep_sessions.pop().unwrap();
    for day in 0..1095_i64 {
        let mut night = template.clone();
        night.id = format!("night-{day}");
        night.external_record_id = night.id.clone();
        night.start_at_ms += day * DAY_MS;
        night.end_at_ms += day * DAY_MS;
        for (index, stage) in night.stages.iter_mut().enumerate() {
            stage.id = format!("{}-{index}", night.id);
            stage.raw_session_id = night.id.clone();
            stage.start_at_ms += day * DAY_MS;
            stage.end_at_ms += day * DAY_MS;
        }
        night.is_synthetic = false;
        batch.sleep_sessions.push(night.clone());
        if day % 5 == 0 && day < 1000 {
            night.id = format!("nap-{day}");
            night.external_record_id = night.id.clone();
            night.start_at_ms = START_MS + day * DAY_MS + 14 * 3_600_000;
            night.end_at_ms = night.start_at_ms + 30 * 60_000;
            night.duration_mins = 30.0;
            night.time_in_bed_mins = Some(30.0);
            night.sleep_kind = SleepKind::Nap;
            night.provider_sleep_kind = Some("nap".into());
            night.stages.clear();
            batch.sleep_sessions.push(night);
        }
    }
    let samples = std::mem::take(&mut batch.physio_observations);
    batch.physio_observations = (0..100_000_i64)
        .map(|index| {
            let mut sample = samples[index as usize % samples.len()].clone();
            sample.id = format!("sample-{index}");
            sample.external_record_id = sample.id.clone();
            sample.measured_at_ms = START_MS + 1095 * DAY_MS * index / 100_000;
            sample.period_start_ms = None;
            sample.period_end_ms = None;
            sample.value += (index % 19) as f64 * 0.1;
            sample.is_synthetic = false;
            sample
        })
        .collect();

    let started = Instant::now();
    vault
        .ingest_batch(HealthProviderId::Oura, "fixture", batch)
        .await
        .unwrap();
    let ingest = started.elapsed();
    let episodes = vault
        .query_canonical_sleep_episodes(None, None, false)
        .await
        .unwrap();
    let physio = vault
        .query_physiological_observations(None, None, false)
        .await
        .unwrap();
    assert_eq!(episodes.len(), 1295);
    assert_eq!(
        episodes
            .iter()
            .filter(|episode| episode.sleep_kind == SleepKind::Nap)
            .count(),
        200
    );
    assert_eq!(physio.len(), 100_000);
    let telemetry = LearningTelemetrySnapshot {
        reviews: (0..20_000_i64)
            .map(|index| RawReviewEvent {
                id: format!("review-{index}"),
                item_id: format!("item-{}", index % 180),
                rating: if index % 7 == 0 { 1 } else { 3 },
                time_taken_secs: 6 + index % 40,
                reviewed_at_ms: START_MS
                    + (index / 20) * DAY_MS
                    + (9 + (index % 20) / 5 * 3) * 3_600_000
                    + (index % 5) * 60_000,
                base_difficulty: 4.0 + (index % 50) as f64 * 0.02,
                document_id: None,
                tags: Vec::new(),
                plan_ids: vec!["fixture-plan".into()],
            })
            .collect(),
        ..Default::default()
    };

    let started = Instant::now();
    let report = compute_learning_insights(
        &telemetry,
        &episodes,
        &physio,
        &[],
        None,
        None,
        None,
        Some(0),
        false,
    )
    .unwrap();
    let analysis = started.elapsed();
    assert!(report.sufficiency.total_sessions > 3_000);
    eprintln!(
        "Wearable 3-year fixture: ingestion/reconciliation {ingest:?}, analysis {analysis:?}"
    );
    assert!(ingest < Duration::from_secs(60), "{ingest:?}");
    assert!(analysis < Duration::from_secs(15), "{analysis:?}");
}
