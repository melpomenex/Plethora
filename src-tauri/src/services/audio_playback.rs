//! Local checkpoint authority and atomic projection into existing source progress.
use crate::error::{PlethoraError, Result};
use crate::sync::{
    journal::{journal_entity, notify_after_commit},
    payload,
    types::{EntityType, SyncOperation},
};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AudioSourceKind {
    Audiobook,
    Podcast,
    AudioEdition,
    Recording,
}

impl AudioSourceKind {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Audiobook => "audiobook",
            Self::Podcast => "podcast",
            Self::AudioEdition => "audio_edition",
            Self::Recording => "recording",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioSourceKey {
    pub profile_key: String,
    pub kind: AudioSourceKind,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioCheckpoint {
    pub schema_version: u32,
    pub source_key: AudioSourceKey,
    pub owner_epoch: String,
    pub checkpoint_sequence: i64,
    pub session_id: String,
    pub media_revision: String,
    pub part_index: u32,
    pub time_in_part: f64,
    pub position_sec: Option<f64>,
    pub duration_sec: Option<f64>,
    pub playback_rate: f64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedAudioSession {
    pub schema_version: u32,
    pub current: Option<AudioSourceKey>,
    pub queue: Vec<AudioSourceKey>,
    pub playback_rate: f64,
    pub volume: f64,
    pub sleep_deadline_ms: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAudioSessionRecord {
    pub owner_epoch: String,
    pub session: Option<SavedAudioSession>,
    pub invalid_session: bool,
}

impl SavedAudioSession {
    pub fn validate(&self, profile: &str) -> Result<()> {
        if self.schema_version != 1
            || self.queue.len() > 256
            || self.updated_at < 0
            || !self.playback_rate.is_finite()
            || !(0.5..=3.0).contains(&self.playback_rate)
            || !self.volume.is_finite()
            || !(0.0..=1.0).contains(&self.volume)
            || self.sleep_deadline_ms.is_some_and(|deadline| deadline < 0)
        {
            return Err(invalid("Malformed audio recovery session"));
        }
        for key in self.current.iter().chain(self.queue.iter()) {
            key.validate()?;
            if key.profile_key != profile {
                return Err(invalid("Audio recovery profile mismatch"));
            }
        }
        Ok(())
    }
}

fn invalid(message: &str) -> PlethoraError {
    PlethoraError::InvalidInput(message.to_owned())
}
fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 512 && !value.contains('\0')
}

impl AudioSourceKey {
    pub fn validate(&self) -> Result<()> {
        if !valid_id(&self.profile_key) || !valid_id(&self.source_id) {
            return Err(invalid("Invalid audio source identity"));
        }
        Ok(())
    }
}

impl AudioCheckpoint {
    pub fn validate(&self) -> Result<()> {
        self.source_key.validate()?;
        let valid_time = |value: f64| value.is_finite() && value >= 0.0;
        if self.schema_version != 1
            || self.checkpoint_sequence < 0
            || self.updated_at < 0
            || !valid_id(&self.owner_epoch)
            || !valid_id(&self.session_id)
            || self.media_revision.len() > 4096
            || self.part_index > 100_000
            || !valid_time(self.time_in_part)
            || self.position_sec.is_some_and(|value| !valid_time(value))
            || self.duration_sec.is_some_and(|value| {
                !valid_time(value) || self.position_sec.is_some_and(|position| position > value)
            })
            || !self.playback_rate.is_finite()
            || !(0.5..=3.0).contains(&self.playback_rate)
        {
            return Err(invalid("Malformed audio checkpoint"));
        }
        Ok(())
    }
}

/// CAS handover is explicit. An old process cannot reclaim authority by sending a late checkpoint.
pub async fn claim_owner(
    pool: &Pool<Sqlite>,
    profile: &str,
    epoch: &str,
    previous: Option<&str>,
) -> Result<bool> {
    if !valid_id(profile) || !valid_id(epoch) {
        return Err(invalid("Invalid audio owner"));
    }
    let changed = sqlx::query(
        "INSERT INTO audio_playback_session(profile_key, owner_epoch, schema_version, payload_json, updated_at_ms) VALUES (?1, ?2, 1, '{}', ?4) ON CONFLICT(profile_key) DO UPDATE SET owner_epoch = excluded.owner_epoch, updated_at_ms = excluded.updated_at_ms WHERE audio_playback_session.owner_epoch = ?3 OR audio_playback_session.owner_epoch = ?2"
    ).bind(profile).bind(epoch).bind(previous).bind(chrono::Utc::now().timestamp_millis()).execute(pool).await?;
    Ok(changed.rows_affected() == 1)
}

pub async fn get_session(
    pool: &Pool<Sqlite>,
    profile: &str,
) -> Result<Option<SavedAudioSessionRecord>> {
    if !valid_id(profile) {
        return Err(invalid("Invalid audio profile"));
    }
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT owner_epoch, payload_json FROM audio_playback_session WHERE profile_key = ?1",
    )
    .bind(profile)
    .fetch_optional(pool)
    .await?;
    row.map(|(owner_epoch, payload)| {
        let session = serde_json::from_str::<SavedAudioSession>(&payload)
            .ok()
            .filter(|session| session.validate(profile).is_ok());
        let invalid_session = payload != "{}" && session.is_none();
        Ok(SavedAudioSessionRecord {
            owner_epoch,
            session,
            invalid_session,
        })
    })
    .transpose()
}

/// Called only with authority read directly from the service journal, never frontend-supplied order.
pub(crate) async fn claim_native_owner(
    pool: &Pool<Sqlite>,
    profile: &str,
    epoch: &str,
    sequence: i64,
) -> Result<bool> {
    if !valid_id(profile) || !valid_id(epoch) || sequence <= 0 {
        return Err(invalid("Invalid native audio authority"));
    }
    let changed = sqlx::query("INSERT INTO audio_playback_session(profile_key, owner_epoch, native_owner_epoch, native_owner_sequence, schema_version, payload_json, updated_at_ms) VALUES (?1, ?2, ?2, ?3, 1, '{}', ?4) ON CONFLICT(profile_key) DO UPDATE SET owner_epoch = excluded.owner_epoch, native_owner_epoch = excluded.native_owner_epoch, native_owner_sequence = excluded.native_owner_sequence, updated_at_ms = excluded.updated_at_ms WHERE excluded.native_owner_sequence > audio_playback_session.native_owner_sequence OR (excluded.native_owner_sequence = audio_playback_session.native_owner_sequence AND audio_playback_session.owner_epoch = excluded.owner_epoch AND audio_playback_session.native_owner_epoch = excluded.native_owner_epoch)")
        .bind(profile).bind(epoch).bind(sequence).bind(chrono::Utc::now().timestamp_millis()).execute(pool).await?;
    Ok(changed.rows_affected() == 1)
}

pub async fn save_session(
    pool: &Pool<Sqlite>,
    profile: &str,
    epoch: &str,
    session: &SavedAudioSession,
) -> Result<bool> {
    session.validate(profile)?;
    let changed = sqlx::query("UPDATE audio_playback_session SET payload_json = ?1, updated_at_ms = ?2 WHERE profile_key = ?3 AND owner_epoch = ?4")
        .bind(serde_json::to_string(session)?).bind(session.updated_at).bind(profile).bind(epoch).execute(pool).await?;
    Ok(changed.rows_affected() == 1)
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CheckpointDisposition {
    Accepted,
    Duplicate,
    Stale,
}

/// Episode, verified promoted document, sync outbox and checkpoint commit together or roll back.
pub async fn commit_checkpoint(
    pool: &Pool<Sqlite>,
    checkpoint: &AudioCheckpoint,
) -> Result<CheckpointDisposition> {
    commit_checkpoint_under_authority(pool, checkpoint, &checkpoint.owner_epoch).await
}

pub(crate) async fn import_native_checkpoint(
    pool: &Pool<Sqlite>,
    checkpoint: &AudioCheckpoint,
    authority_epoch: &str,
) -> Result<CheckpointDisposition> {
    commit_checkpoint_under_authority(pool, checkpoint, authority_epoch).await
}

async fn commit_checkpoint_under_authority(
    pool: &Pool<Sqlite>,
    checkpoint: &AudioCheckpoint,
    authority_epoch: &str,
) -> Result<CheckpointDisposition> {
    checkpoint.validate()?;
    let mut tx = pool.begin().await?;
    // Acquire the SQLite write lock before reading CAS/sequence state.
    let active = sqlx::query("UPDATE audio_playback_session SET updated_at_ms = updated_at_ms WHERE profile_key = ?1 AND owner_epoch = ?2")
        .bind(&checkpoint.source_key.profile_key).bind(authority_epoch).execute(&mut *tx).await?;
    if active.rows_affected() == 0 {
        return Ok(CheckpointDisposition::Stale);
    }
    let source = &checkpoint.source_key;
    let encoded = serde_json::to_string(checkpoint)?;
    let changed = sqlx::query(
        "INSERT INTO audio_playback_checkpoint(profile_key, source_kind, source_id, schema_version, checkpoint_sequence, owner_epoch, payload_json, updated_at_ms) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7) ON CONFLICT(profile_key,source_kind,source_id) DO UPDATE SET checkpoint_sequence = excluded.checkpoint_sequence, owner_epoch = excluded.owner_epoch, payload_json = excluded.payload_json, updated_at_ms = excluded.updated_at_ms WHERE (audio_playback_checkpoint.owner_epoch = excluded.owner_epoch AND audio_playback_checkpoint.checkpoint_sequence < excluded.checkpoint_sequence) OR (audio_playback_checkpoint.owner_epoch != excluded.owner_epoch AND (audio_playback_checkpoint.owner_epoch != ?8 OR excluded.owner_epoch = ?8))"
    ).bind(&source.profile_key).bind(source.kind.as_str()).bind(&source.source_id).bind(checkpoint.checkpoint_sequence).bind(&checkpoint.owner_epoch).bind(encoded).bind(checkpoint.updated_at).bind(authority_epoch).execute(&mut *tx).await?;
    if changed.rows_affected() == 0 {
        return Ok(CheckpointDisposition::Duplicate);
    }

    let documents: Vec<String> = match (&source.kind, checkpoint.position_sec) {
        (AudioSourceKind::Podcast, Some(_)) => {
            let changed =
                sqlx::query("UPDATE podcast_episodes SET playback_position = ?1 WHERE id = ?2")
                    .bind(checkpoint.position_sec)
                    .bind(&source.source_id)
                    .execute(&mut *tx)
                    .await?;
            if changed.rows_affected() != 1 {
                return Err(invalid("Podcast episode unavailable"));
            }
            sqlx::query_scalar("SELECT id FROM documents WHERE file_type = 'audio' AND json_valid(metadata) AND json_extract(metadata, '$.source') = ?1")
                .bind(format!("podcast:{}", source.source_id)).fetch_all(&mut *tx).await?
        }
        (AudioSourceKind::Audiobook, Some(_)) => {
            let exists: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM documents WHERE id = ?1 AND file_type = 'audio'",
            )
            .bind(&source.source_id)
            .fetch_one(&mut *tx)
            .await?;
            if exists != 1 {
                return Err(invalid("Audiobook unavailable"));
            }
            vec![source.source_id.clone()]
        }
        // Editions/recordings never modify text-reader coordinates or reading percentage.
        _ => vec![],
    };
    for document_id in documents {
        let mut position =
            serde_json::json!({ "type": "time", "seconds": checkpoint.position_sec });
        if let Some(duration) = checkpoint.duration_sec {
            position["total_duration"] = serde_json::json!(duration);
        }
        let position = serde_json::to_string(&position)?;
        let progress = checkpoint
            .duration_sec
            .filter(|value| *value > 0.0)
            .map(|duration| checkpoint.position_sec.unwrap_or(0.0) / duration * 100.0);
        sqlx::query("UPDATE documents SET position_json = ?1, progress_percent = COALESCE(?2, progress_percent), date_modified = datetime('now') WHERE id = ?3")
            .bind(&position).bind(progress).bind(&document_id).execute(&mut *tx).await?;
        let encoded = payload::document_position_payload(
            &document_id,
            Some(&position),
            progress,
            None,
            None,
            None,
        )?;
        journal_entity(
            &mut tx,
            EntityType::Document,
            &document_id,
            SyncOperation::Update,
            None,
            encoded,
        )
        .await?;
    }
    tx.commit().await?;
    notify_after_commit();
    Ok(CheckpointDisposition::Accepted)
}

pub async fn get_checkpoint(
    pool: &Pool<Sqlite>,
    source: &AudioSourceKey,
) -> Result<Option<AudioCheckpoint>> {
    source.validate()?;
    let raw: Option<String> = sqlx::query_scalar("SELECT payload_json FROM audio_playback_checkpoint WHERE profile_key = ?1 AND source_kind = ?2 AND source_id = ?3")
        .bind(&source.profile_key).bind(source.kind.as_str()).bind(&source.source_id).fetch_optional(pool).await?;
    raw.map(|raw| {
        let checkpoint: AudioCheckpoint = serde_json::from_str(&raw)?;
        checkpoint.validate()?;
        Ok(checkpoint)
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn database() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::migrations::run_migrations(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO documents(id,title,file_path,file_type,date_added,date_modified,metadata) VALUES ('book','Book','book.mp3','audio','2026-10-23','2026-10-23',NULL), ('promoted','Podcast','podcast.mp3','audio','2026-10-23','2026-10-23','{\"source\":\"podcast:episode\"}'), ('text','Text','book.epub','epub','2026-10-23','2026-10-23',NULL)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO podcast_feeds(id,title,feed_url) VALUES ('feed','Feed','https://example.test/feed')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO podcast_episodes(id,feed_id,title,audio_url) VALUES ('episode','feed','Episode','https://example.test/episode.mp3'), ('standalone','feed','Standalone','https://example.test/standalone.mp3')").execute(&pool).await.unwrap();
        assert!(claim_owner(&pool, "profile", "epoch-1", None)
            .await
            .unwrap());
        pool
    }

    fn checkpoint(kind: AudioSourceKind, id: &str) -> AudioCheckpoint {
        AudioCheckpoint {
            schema_version: 1,
            source_key: AudioSourceKey {
                profile_key: "profile".into(),
                kind,
                source_id: id.into(),
            },
            owner_epoch: "epoch-1".into(),
            checkpoint_sequence: 1,
            session_id: "incarnation-1".into(),
            media_revision: "media-1".into(),
            part_index: 0,
            time_in_part: 30.0,
            position_sec: Some(30.0),
            duration_sec: Some(120.0),
            playback_rate: 1.0,
            updated_at: 1,
        }
    }

    #[tokio::test]
    async fn audio_playback_migration_preserves_legacy_reading_and_rejects_malformed_payload() {
        let pool = database().await;
        sqlx::query("UPDATE documents SET position_json = '{\"type\":\"cfi\",\"cfi\":\"epubcfi(/6/2)\"}', progress_percent = 41 WHERE id = 'text'").execute(&pool).await.unwrap();
        let mut value = checkpoint(AudioSourceKind::AudioEdition, "edition");
        assert_eq!(
            commit_checkpoint(&pool, &value).await.unwrap(),
            CheckpointDisposition::Accepted
        );
        let reading: (String, f64) = sqlx::query_as(
            "SELECT position_json, progress_percent FROM documents WHERE id = 'text'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(reading.0.contains("epubcfi"));
        assert_eq!(reading.1, 41.0);
        value.position_sec = Some(f64::NAN);
        assert!(commit_checkpoint(&pool, &value).await.is_err());
        value.position_sec = Some(-1.0);
        assert!(commit_checkpoint(&pool, &value).await.is_err());
        assert!(serde_json::from_str::<AudioCheckpoint>("{\"schemaVersion\":2}").is_err());
    }

    #[tokio::test]
    async fn audio_playback_epoch_cas_rejects_late_old_owner_and_duplicate_sequence() {
        let pool = database().await;
        let mut value = checkpoint(AudioSourceKind::Audiobook, "book");
        assert_eq!(
            commit_checkpoint(&pool, &value).await.unwrap(),
            CheckpointDisposition::Accepted
        );
        assert_eq!(
            commit_checkpoint(&pool, &value).await.unwrap(),
            CheckpointDisposition::Duplicate
        );
        assert!(!claim_owner(&pool, "profile", "epoch-2", Some("wrong"))
            .await
            .unwrap());
        assert!(claim_owner(&pool, "profile", "epoch-2", Some("epoch-1"))
            .await
            .unwrap());
        value.checkpoint_sequence = 500;
        assert_eq!(
            commit_checkpoint(&pool, &value).await.unwrap(),
            CheckpointDisposition::Stale
        );
        value.owner_epoch = "epoch-2".into();
        value.checkpoint_sequence = 1;
        value.position_sec = Some(8.0);
        value.time_in_part = 8.0;
        assert_eq!(
            commit_checkpoint(&pool, &value).await.unwrap(),
            CheckpointDisposition::Accepted
        );
        assert_eq!(
            get_checkpoint(&pool, &value.source_key)
                .await
                .unwrap()
                .unwrap()
                .position_sec,
            Some(8.0)
        );
    }

    #[tokio::test]
    async fn audio_playback_podcast_transaction_updates_only_verified_document_mapping() {
        let pool = database().await;
        let value = checkpoint(AudioSourceKind::Podcast, "episode");
        assert_eq!(
            commit_checkpoint(&pool, &value).await.unwrap(),
            CheckpointDisposition::Accepted
        );
        let episode: f64 = sqlx::query_scalar(
            "SELECT playback_position FROM podcast_episodes WHERE id = 'episode'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let position: String =
            sqlx::query_scalar("SELECT position_json FROM documents WHERE id = 'promoted'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(episode, 30.0);
        assert!(position.contains("30.0"));
        let outbox: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sync_outbox WHERE entity_id = 'promoted'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(outbox > 0);
        let standalone = checkpoint(AudioSourceKind::Podcast, "standalone");
        assert_eq!(
            commit_checkpoint(&pool, &standalone).await.unwrap(),
            CheckpointDisposition::Accepted
        );
        let synthetic: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM documents WHERE id IN ('episode','standalone')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(synthetic, 0);
    }

    #[tokio::test]
    async fn audio_playback_document_projection_failure_rolls_back_episode_and_checkpoint() {
        let pool = database().await;
        sqlx::query("CREATE TRIGGER reject_audio_projection BEFORE UPDATE ON documents WHEN NEW.id = 'promoted' BEGIN SELECT RAISE(ABORT, 'injected document write failure'); END").execute(&pool).await.unwrap();
        let value = checkpoint(AudioSourceKind::Podcast, "episode");
        assert!(commit_checkpoint(&pool, &value).await.is_err());
        let position: f64 = sqlx::query_scalar(
            "SELECT playback_position FROM podcast_episodes WHERE id = 'episode'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(position, 0.0);
        assert!(get_checkpoint(&pool, &value.source_key)
            .await
            .unwrap()
            .is_none());
        let outbox: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sync_outbox WHERE entity_id = 'promoted'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(outbox, 0);
    }

    #[tokio::test]
    async fn audio_playback_unknown_global_position_keeps_exact_part_without_overwriting_legacy_time(
    ) {
        let pool = database().await;
        sqlx::query("UPDATE documents SET position_json = '{\"type\":\"time\",\"seconds\":40}' WHERE id = 'book'").execute(&pool).await.unwrap();
        let mut value = checkpoint(AudioSourceKind::Audiobook, "book");
        value.position_sec = None;
        value.duration_sec = None;
        value.part_index = 2;
        value.time_in_part = 15.0;
        assert_eq!(
            commit_checkpoint(&pool, &value).await.unwrap(),
            CheckpointDisposition::Accepted
        );
        let saved = get_checkpoint(&pool, &value.source_key)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.part_index, 2);
        assert_eq!(saved.time_in_part, 15.0);
        assert!(saved.position_sec.is_none());
        let position: String =
            sqlx::query_scalar("SELECT position_json FROM documents WHERE id = 'book'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(position.contains("40"));
    }

    #[tokio::test]
    async fn audio_playback_invalid_recovery_intent_does_not_prevent_owner_handover() {
        let pool = database().await;
        sqlx::query("UPDATE audio_playback_session SET payload_json = '{broken' WHERE profile_key = 'profile'").execute(&pool).await.unwrap();
        let recovered = get_session(&pool, "profile").await.unwrap().unwrap();
        assert!(recovered.invalid_session);
        assert!(recovered.session.is_none());
        assert_eq!(recovered.owner_epoch, "epoch-1");
        assert!(
            claim_owner(&pool, "profile", "epoch-2", Some(&recovered.owner_epoch))
                .await
                .unwrap()
        );
        let session = SavedAudioSession {
            schema_version: 1,
            current: Some(checkpoint(AudioSourceKind::Audiobook, "book").source_key),
            queue: vec![],
            playback_rate: 1.5,
            volume: 0.8,
            sleep_deadline_ms: None,
            updated_at: 2,
        };
        assert!(!save_session(&pool, "profile", "epoch-1", &session)
            .await
            .unwrap());
        assert!(save_session(&pool, "profile", "epoch-2", &session)
            .await
            .unwrap());
        assert!(
            !get_session(&pool, "profile")
                .await
                .unwrap()
                .unwrap()
                .invalid_session
        );
        assert!(save_session(&pool, "other-profile", "epoch-2", &session)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn audio_playback_native_handover_rejects_old_incarnations_without_clock_comparisons() {
        let pool = database().await;
        assert!(claim_native_owner(&pool, "profile", "native-1", 1)
            .await
            .unwrap());
        assert!(claim_native_owner(&pool, "profile", "native-2", 2)
            .await
            .unwrap());
        assert!(!claim_native_owner(&pool, "profile", "native-1", 1)
            .await
            .unwrap());
        assert!(claim_native_owner(&pool, "profile", "native-2", 2)
            .await
            .unwrap());
        assert!(
            claim_owner(&pool, "profile", "html-fallback", Some("native-2"))
                .await
                .unwrap()
        );
        assert!(!claim_native_owner(&pool, "profile", "native-2", 2)
            .await
            .unwrap());
        assert!(claim_native_owner(&pool, "profile", "native-3", 3)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn audio_playback_native_import_keeps_dirty_prior_sources_without_replaying_over_new_progress(
    ) {
        let pool = database().await;
        assert!(claim_native_owner(&pool, "profile", "native-2", 2)
            .await
            .unwrap());
        let mut old = checkpoint(AudioSourceKind::Audiobook, "book");
        old.owner_epoch = "native-1".into();
        assert_eq!(
            import_native_checkpoint(&pool, &old, "native-2")
                .await
                .unwrap(),
            CheckpointDisposition::Accepted
        );
        assert_eq!(
            import_native_checkpoint(&pool, &old, "native-2")
                .await
                .unwrap(),
            CheckpointDisposition::Duplicate
        );
        let mut fresh = old.clone();
        fresh.owner_epoch = "native-2".into();
        fresh.position_sec = Some(8.0);
        fresh.time_in_part = 8.0;
        assert_eq!(
            import_native_checkpoint(&pool, &fresh, "native-2")
                .await
                .unwrap(),
            CheckpointDisposition::Accepted
        );
        old.checkpoint_sequence = 999;
        assert_eq!(
            import_native_checkpoint(&pool, &old, "native-2")
                .await
                .unwrap(),
            CheckpointDisposition::Duplicate
        );
        assert_eq!(
            get_checkpoint(&pool, &fresh.source_key)
                .await
                .unwrap()
                .unwrap()
                .position_sec,
            Some(8.0)
        );
        assert_eq!(
            import_native_checkpoint(&pool, &old, "native-1")
                .await
                .unwrap(),
            CheckpointDisposition::Stale
        );
    }
}
