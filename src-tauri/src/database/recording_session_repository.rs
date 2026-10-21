//! Recording ingestion reuses the ordinary document transaction and policy.
use super::Repository;
use crate::models::recording_session::*;
use crate::models::{Document, FileType};
use serde::de::DeserializeOwned;
use sqlx::{sqlite::SqliteRow, Row};
use std::path::{Component, Path};

type SessionResult<T> = std::result::Result<T, SessionOperationError>;

fn unavailable() -> SessionOperationError {
    SessionOperationError::source_unavailable()
}

fn read_enum<T: DeserializeOwned>(row: &SqliteRow, column: &str) -> SessionResult<T> {
    let value: String = row.try_get(column)?;
    serde_json::from_value(serde_json::Value::String(value)).map_err(|_| unavailable())
}

fn read_session(row: &SqliteRow) -> SessionResult<RecordingSession> {
    let content_type: SessionContentType = read_enum(row, "content_type")?;
    let raw: String = row.try_get("content_type")?;
    Ok(RecordingSession {
        id: row.try_get("id")?,
        document_id: row.try_get("document_id")?,
        origin: read_enum(row, "origin")?,
        content_type,
        original_content_type: (content_type == SessionContentType::Other && raw != "other")
            .then_some(raw),
        profile_json: row.try_get("profile_json")?,
        capture_state: read_enum(row, "capture_state")?,
        ingestion_state: read_enum(row, "ingestion_state")?,
        transcript_id: row.try_get("transcript_id")?,
        media_asset_id: row.try_get("media_asset_id")?,
        transcript_revision: row.try_get("transcript_revision")?,
        overview_json: row.try_get("overview_json")?,
        overview_revision: row.try_get("overview_revision")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        version: row.try_get("version")?,
    })
}

fn validate_profile(content_type: &str, profile_json: &str) -> SessionResult<()> {
    if content_type.is_empty() || content_type.len() > 64 || profile_json.len() > 65_536 {
        return Err(unavailable());
    }
    let profile: serde_json::Value =
        serde_json::from_str(profile_json).map_err(|_| unavailable())?;
    if !profile.is_object() {
        return Err(unavailable());
    }
    Ok(())
}

/// Lexical validation only. The writer also checks canonical roots/symlinks.
pub(crate) fn validate_recording_relative_path(value: &str) -> SessionResult<()> {
    if value.is_empty()
        || value.len() > 1024
        || value.contains(['\\', ':', '\0'])
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || Path::new(value)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(unavailable());
    }
    Ok(())
}

fn decode_cursor<T: DeserializeOwned>(cursor: &str) -> SessionResult<T> {
    if cursor.len() > 2048 {
        return Err(unavailable());
    }
    serde_json::from_str(cursor).map_err(|_| unavailable())
}

fn read_words(
    value: Option<String>,
    kind: &str,
) -> SessionResult<Option<Vec<SessionTranscriptWord>>> {
    let Some(value) = value else { return Ok(None) };
    let words: Vec<serde_json::Value> = serde_json::from_str(&value).map_err(|_| unavailable())?;
    let source = match kind {
        "measured" => SessionTimingSource::Measured,
        "imported" => SessionTimingSource::Imported,
        _ => return Err(unavailable()),
    };
    words
        .iter()
        .map(|word| {
            let text = word
                .get("text")
                .or_else(|| word.get("word"))
                .and_then(|v| v.as_str())
                .ok_or_else(unavailable)?;
            let start_ms = word
                .get("startMs")
                .or_else(|| word.get("start_ms"))
                .and_then(|v| v.as_i64())
                .ok_or_else(unavailable)?;
            let end_ms = word
                .get("endMs")
                .or_else(|| word.get("end_ms"))
                .and_then(|v| v.as_i64())
                .ok_or_else(unavailable)?;
            if start_ms < 0 || end_ms < start_ms {
                return Err(unavailable());
            }
            Ok(SessionTranscriptWord {
                text: text.to_owned(),
                start_ms,
                end_ms,
                source: source.clone(),
            })
        })
        .collect::<SessionResult<Vec<_>>>()
        .map(Some)
}

fn read_segment(row: &SqliteRow) -> SessionResult<SessionTranscriptSegment> {
    let kind: String = row.try_get("timing_kind")?;
    let timing = match kind.as_str() {
        "measured" => SessionTranscriptTiming::Measured {
            start_ms: row.try_get("start_ms")?,
            end_ms: row.try_get("end_ms")?,
        },
        "imported" => SessionTranscriptTiming::Imported {
            start_ms: row.try_get("start_ms")?,
            end_ms: row.try_get("end_ms")?,
        },
        "none" => SessionTranscriptTiming::None {},
        _ => return Err(unavailable()),
    };
    Ok(SessionTranscriptSegment {
        segment_key: row.try_get("segment_key")?,
        transcript_id: row.try_get("transcript_id")?,
        ordinal: row.try_get("ordinal")?,
        revision: row.try_get("revision")?,
        text: row.try_get("text")?,
        timing,
        speaker_id: row.try_get("speaker_id")?,
        confidence: row.try_get("confidence")?,
        words: read_words(row.try_get("words_json")?, &kind)?,
    })
}

fn read_marker(row: &SqliteRow) -> SessionResult<RecordingSessionMarker> {
    let evidence_raw: Option<String> = row.try_get("evidence_json")?;
    let evidence = evidence_raw.and_then(|s| serde_json::from_str(&s).ok());
    Ok(RecordingSessionMarker {
        id: row.try_get("id")?,
        session_id: row.try_get("session_id")?,
        kind: read_enum(row, "kind")?,
        media_ms: row.try_get("media_ms")?,
        window_ms: row.try_get("window_ms")?,
        part_sequence: row.try_get("part_sequence")?,
        note: row.try_get("note")?,
        evidence,
        state: read_enum(row, "state")?,
        created_at: row.try_get("created_at")?,
    })
}

impl Repository {
    pub async fn create_recording_session(
        &self,
        request: &CreateRecordingSession,
    ) -> SessionResult<RecordingSession> {
        uuid::Uuid::parse_str(&request.id).map_err(|_| unavailable())?;
        validate_profile(&request.content_type, &request.profile_json)?;
        if request.title.trim().is_empty() || request.title.len() > 2048 {
            return Err(unavailable());
        }
        let mut tx = self.pool().begin().await?;
        if let Some(collection) = &request.collection_id {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM collections WHERE id = ?1)")
                    .bind(collection)
                    .fetch_one(&mut *tx)
                    .await?;
            if !exists {
                return Err(unavailable());
            }
        }
        let existing = sqlx::query("SELECT * FROM recording_sessions WHERE id = ?1")
            .bind(&request.id)
            .fetch_optional(&mut *tx)
            .await?;
        if let Some(row) = existing {
            let session = read_session(&row)?;
            if session.origin != request.origin
                || request
                    .document_id
                    .as_ref()
                    .is_some_and(|id| *id != session.document_id)
            {
                return Err(SessionOperationError::stale());
            }
            return Ok(session);
        }
        let document_id = if let Some(id) = &request.document_id {
            let row = sqlx::query("SELECT * FROM documents WHERE id = ?1")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(unavailable)?;
            let document = Self::row_to_document(&row).map_err(|_| unavailable())?;
            if request
                .collection_id
                .as_ref()
                .is_some_and(|collection| *collection != document.collection_id)
            {
                return Err(unavailable());
            }
            if let Some(row) =
                sqlx::query("SELECT * FROM recording_sessions WHERE document_id = ?1")
                    .bind(id)
                    .fetch_optional(&mut *tx)
                    .await?
            {
                return read_session(&row);
            }
            sqlx::query("UPDATE documents SET is_local_only = 1 WHERE id = ?1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            id.clone()
        } else {
            let kind = if request.origin == SessionOrigin::Transcript {
                FileType::Other
            } else {
                FileType::Audio
            };
            let mut document = Document::with_collection(
                request.title.trim().to_owned(),
                String::new(),
                kind,
                request.collection_id.clone(),
            );
            document.is_local_only = true;
            Self::create_document_tx(&mut tx, &document)
                .await
                .map_err(|_| SessionOperationError {
                    code: "StorageUnavailable",
                    stage: "ingestion",
                    session_id: None,
                    retryable: true,
                    message_key: "recording.storageUnavailable",
                })?;
            document.id
        };
        let now = chrono::Utc::now().to_rfc3339();
        let origin = serde_json::to_value(request.origin).map_err(|_| unavailable())?;
        sqlx::query("INSERT INTO recording_sessions (id, document_id, origin, content_type, profile_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)")
            .bind(&request.id).bind(&document_id).bind(origin.as_str().ok_or_else(unavailable)?)
            .bind(&request.content_type).bind(&request.profile_json).bind(now).execute(&mut *tx).await?;
        let row = sqlx::query("SELECT * FROM recording_sessions WHERE id = ?1")
            .bind(&request.id)
            .fetch_one(&mut *tx)
            .await?;
        let session = read_session(&row)?;
        tx.commit().await?;
        Ok(session)
    }

    pub async fn get_recording_session(&self, id: &str) -> SessionResult<RecordingSession> {
        let row = sqlx::query("SELECT s.* FROM recording_sessions s JOIN documents d ON d.id = s.document_id WHERE s.id = ?1")
            .bind(id).fetch_optional(self.pool()).await?.ok_or_else(unavailable)?;
        read_session(&row)
    }

    pub async fn find_session_by_document_id(
        &self,
        document_id: &str,
    ) -> SessionResult<Option<RecordingSession>> {
        let row = sqlx::query(
            "SELECT s.* FROM recording_sessions s
             JOIN documents d ON d.id = s.document_id
             WHERE s.document_id = ?1
             ORDER BY s.created_at DESC
             LIMIT 1",
        )
        .bind(document_id)
        .fetch_optional(self.pool())
        .await?;

        match row {
            Some(r) => Ok(Some(read_session(&r)?)),
            None => Ok(None),
        }
    }

    pub async fn find_session_by_media_hash(
        &self,
        sha256: &str,
        collection_id: Option<&str>,
    ) -> SessionResult<Option<RecordingSession>> {
        let row = sqlx::query(
            "SELECT s.* FROM recording_sessions s
             JOIN documents d ON d.id = s.document_id
             JOIN media_assets a ON a.session_id = s.id
             WHERE a.sha256 = ?1
             ORDER BY CASE WHEN ?2 IS NOT NULL AND d.collection_id = ?2 THEN 0 ELSE 1 END, s.created_at DESC
             LIMIT 1",
        )
        .bind(sha256)
        .bind(collection_id)
        .fetch_optional(self.pool())
        .await?;

        match row {
            Some(r) => Ok(Some(read_session(&r)?)),
            None => Ok(None),
        }
    }

    pub async fn list_recording_sessions(
        &self,
        collection_id: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> SessionResult<RecordingSessionPage> {
        let after: Option<(Option<String>, String, String)> =
            cursor.map(decode_cursor).transpose()?;
        if after
            .as_ref()
            .is_some_and(|value| value.0.as_deref() != collection_id)
        {
            return Err(unavailable());
        }
        let limit = limit.clamp(1, 100) as usize;
        let rows = sqlx::query("SELECT s.* FROM recording_sessions s JOIN documents d ON d.id = s.document_id WHERE (?1 IS NULL OR d.collection_id = ?1) AND (?2 IS NULL OR (s.created_at, s.id) < (?2, ?3)) ORDER BY s.created_at DESC, s.id DESC LIMIT ?4")
            .bind(collection_id).bind(after.as_ref().map(|value| &value.1)).bind(after.as_ref().map(|value| &value.2))
            .bind((limit + 1) as i64).fetch_all(self.pool()).await?;
        let more = rows.len() > limit;
        let items = rows
            .iter()
            .take(limit)
            .map(read_session)
            .collect::<SessionResult<Vec<_>>>()?;
        let next_cursor = if more {
            items
                .last()
                .map(|item| serde_json::to_string(&(collection_id, &item.created_at, &item.id)))
                .transpose()
                .map_err(|_| unavailable())?
        } else {
            None
        };
        Ok(RecordingSessionPage { items, next_cursor })
    }

    /// Profile edits use CAS; capture lifecycle transitions belong to the controller.
    pub async fn update_recording_session_profile(
        &self,
        id: &str,
        expected_version: i64,
        content_type: &str,
        profile_json: &str,
    ) -> SessionResult<RecordingSession> {
        validate_profile(content_type, profile_json)?;
        let mut tx = self.pool().begin().await?;
        let changed = sqlx::query("UPDATE recording_sessions SET content_type = ?1, profile_json = ?2, version = version + 1, updated_at = ?3 WHERE id = ?4 AND version = ?5")
            .bind(content_type).bind(profile_json).bind(chrono::Utc::now().to_rfc3339()).bind(id).bind(expected_version)
            .execute(&mut *tx).await?;
        if changed.rows_affected() != 1 {
            return Err(SessionOperationError::stale());
        }
        let row = sqlx::query("SELECT * FROM recording_sessions WHERE id = ?1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
        let session = read_session(&row)?;
        tx.commit().await?;
        Ok(session)
    }

    pub async fn update_recording_session_overview(
        &self,
        id: &str,
        overview_json: &str,
        overview_revision: i64,
    ) -> SessionResult<RecordingSession> {
        let mut tx = self.pool().begin().await?;
        let changed = sqlx::query("UPDATE recording_sessions SET overview_json = ?1, overview_revision = ?2, version = version + 1, updated_at = ?3 WHERE id = ?4")
            .bind(overview_json).bind(overview_revision).bind(chrono::Utc::now().to_rfc3339()).bind(id)
            .execute(&mut *tx).await?;
        if changed.rows_affected() != 1 {
            return Err(unavailable());
        }
        let row = sqlx::query("SELECT * FROM recording_sessions WHERE id = ?1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
        let session = read_session(&row)?;
        tx.commit().await?;
        Ok(session)
    }

    pub async fn get_session_segments(
        &self,
        id: &str,
        cursor: Option<&str>,
        limit: u32,
    ) -> SessionResult<SessionSegmentPage> {
        let after: Option<(String, i64, i64, i64)> = cursor.map(decode_cursor).transpose()?;
        let mut tx = self.pool().begin().await?;
        let row = sqlx::query("SELECT s.* FROM recording_sessions s JOIN documents d ON d.id = s.document_id WHERE s.id = ?1")
            .bind(id).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
        let session = read_session(&row)?;
        if after
            .as_ref()
            .is_some_and(|value| value.0 != id || value.1 != session.transcript_revision)
        {
            return Err(SessionOperationError::stale());
        }
        let Some(transcript_id) = session.transcript_id else {
            return Ok(SessionSegmentPage {
                items: vec![],
                revision: session.transcript_revision,
                next_cursor: None,
            });
        };
        let revision: i64 = sqlx::query_scalar(
            "SELECT revision FROM transcripts WHERE id = ?1 AND session_id = ?2",
        )
        .bind(transcript_id)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(unavailable)?;
        if revision != session.transcript_revision {
            return Err(SessionOperationError::stale());
        }
        let limit = limit.clamp(1, 500) as usize;
        let rows = sqlx::query("SELECT * FROM transcript_segments WHERE transcript_id = ?1 AND (?2 IS NULL OR (ordinal, id) > (?2, ?3)) ORDER BY ordinal, id LIMIT ?4")
            .bind(transcript_id).bind(after.as_ref().map(|value| value.2)).bind(after.as_ref().map(|value| value.3))
            .bind((limit + 1) as i64).fetch_all(&mut *tx).await?;
        let items = rows
            .iter()
            .take(limit)
            .map(read_segment)
            .collect::<SessionResult<Vec<_>>>()?;
        let next_cursor = if rows.len() > limit {
            let last = &rows[limit - 1];
            let ordinal: i64 = last.try_get("ordinal")?;
            let row_id: i64 = last.try_get("id")?;
            Some(
                serde_json::to_string(&(id, revision, ordinal, row_id))
                    .map_err(|_| unavailable())?,
            )
        } else {
            None
        };
        tx.commit().await?;
        Ok(SessionSegmentPage {
            items,
            revision,
            next_cursor,
        })
    }

    pub(crate) async fn get_recording_asset(
        &self,
        session_id: &str,
        asset_id: &str,
    ) -> SessionResult<SessionMediaAsset> {
        let row = sqlx::query("SELECT a.* FROM media_assets a JOIN recording_sessions s ON s.id = a.session_id WHERE a.id = ?1 AND s.id = ?2")
            .bind(asset_id).bind(session_id).fetch_optional(self.pool()).await?.ok_or_else(unavailable)?;
        let relative_path: String = row.try_get("relative_path")?;
        validate_recording_relative_path(&relative_path)?;
        Ok(SessionMediaAsset {
            id: row.try_get("id")?,
            session_id: row.try_get("session_id")?,
            kind: read_enum(&row, "kind")?,
            relative_path,
            mime: row.try_get("mime")?,
            byte_length: row.try_get("byte_length")?,
            sha256: row.try_get("sha256")?,
            duration_ms: row.try_get("duration_ms")?,
            state: read_enum(&row, "state")?,
            source_url: row.try_get("source_url")?,
            source_adapter: row.try_get("source_adapter")?,
            created_at: row.try_get("created_at")?,
        })
    }

    pub async fn get_session_document_privacy(
        &self,
        session_id: &str,
    ) -> SessionResult<SessionDocumentPrivacy> {
        let row: Option<(bool, bool, i64)> = sqlx::query_as(
            "SELECT d.is_local_only, d.is_ai_excluded, d.privacy_version FROM documents d JOIN recording_sessions s ON s.document_id = d.id WHERE s.id = ?1",
        )
        .bind(session_id)
        .fetch_optional(self.pool())
        .await?;
        let (is_local_only, is_ai_excluded, privacy_version) = row.ok_or_else(unavailable)?;
        Ok(SessionDocumentPrivacy {
            is_local_only,
            is_ai_excluded,
            privacy_version,
        })
    }

    pub async fn commit_session_unit(
        &self,
        job_id: &str,
        session_id: &str,
        expected_cancel_epoch: i64,
        lease_owner: &str,
        processed_duration_ms: i64,
        total_duration_ms: Option<i64>,
        segments: &[SessionTranscriptSegmentInput],
    ) -> SessionResult<usize> {
        let mut tx = self.pool().begin().await?;

        // 1. Verify lease, status, and cancel_epoch
        let queue_row: Option<(String, i64, Option<String>, i64, String)> = sqlx::query_as(
            "SELECT status, cancel_epoch, lease_owner, transcript_revision, document_id FROM transcription_queue WHERE id = ?1",
        )
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await?;

        let (status, cancel_epoch, current_lease_owner, transcript_revision, document_id) =
            queue_row.ok_or_else(unavailable)?;

        if status != "processing"
            || cancel_epoch != expected_cancel_epoch
            || current_lease_owner.as_deref() != Some(lease_owner)
        {
            return Err(SessionOperationError::cancelled());
        }

        // 2. Resolve or create transcript for session
        let existing_transcript_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM transcripts WHERE session_id = ?1 AND revision = ?2",
        )
        .bind(session_id)
        .bind(transcript_revision)
        .fetch_optional(&mut *tx)
        .await?;

        let transcript_id = match existing_transcript_id {
            Some(id) => id,
            None => {
                let chapter_id = format!("{document_id}:rev:{transcript_revision}");
                sqlx::query(
                    r#"
                    INSERT INTO transcripts (book_id, chapter_id, session_id, revision, model_used, language, status)
                    VALUES (?1, ?2, ?3, ?4, 'session', 'en', 'processing')
                    "#,
                )
                .bind(&document_id)
                .bind(&chapter_id)
                .bind(session_id)
                .bind(transcript_revision)
                .execute(&mut *tx)
                .await?;

                let new_id: i64 = sqlx::query_scalar(
                    "SELECT id FROM transcripts WHERE session_id = ?1 AND revision = ?2",
                )
                .bind(session_id)
                .bind(transcript_revision)
                .fetch_one(&mut *tx)
                .await?;

                sqlx::query(
                    "UPDATE recording_sessions SET transcript_id = ?1, transcript_revision = ?2, updated_at = ?3 WHERE id = ?4",
                )
                .bind(new_id)
                .bind(transcript_revision)
                .bind(chrono::Utc::now().to_rfc3339())
                .bind(session_id)
                .execute(&mut *tx)
                .await?;

                new_id
            }
        };

        // 3. Upsert segments
        let mut committed_count = 0usize;
        for seg in segments {
            let timing_kind = match seg.timing_kind.as_str() {
                "none" => "none",
                "imported" => "imported",
                _ => "measured",
            };

            let (start_ms, end_ms) = if timing_kind == "none" {
                (None, None)
            } else {
                (seg.start_ms, seg.end_ms)
            };

            sqlx::query(
                r#"
                INSERT INTO transcript_segments (
                    transcript_id, start_ms, end_ms, text, confidence, words_json,
                    segment_key, ordinal, speaker_id, timing_kind, revision, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ON CONFLICT(transcript_id, segment_key) DO UPDATE SET
                    start_ms = excluded.start_ms,
                    end_ms = excluded.end_ms,
                    text = excluded.text,
                    confidence = excluded.confidence,
                    words_json = excluded.words_json,
                    ordinal = excluded.ordinal,
                    speaker_id = excluded.speaker_id,
                    timing_kind = excluded.timing_kind,
                    revision = excluded.revision,
                    metadata_json = excluded.metadata_json
                "#,
            )
            .bind(transcript_id)
            .bind(start_ms)
            .bind(end_ms)
            .bind(&seg.text)
            .bind(seg.confidence)
            .bind(seg.words_json.as_deref())
            .bind(&seg.segment_key)
            .bind(seg.ordinal)
            .bind(seg.speaker_id.as_deref())
            .bind(timing_kind)
            .bind(seg.revision)
            .bind(seg.metadata_json.as_deref())
            .execute(&mut *tx)
            .await?;

            committed_count += 1;
        }

        // 4. Update queue checkpoint progress and duration atomically
        sqlx::query(
            r#"
            UPDATE transcription_queue
            SET processed_duration_ms = ?1,
                total_duration_ms = COALESCE(?2, total_duration_ms),
                progress = CASE WHEN ?2 > 0 THEN MIN(99, CAST((?1 * 100 / ?2) AS INTEGER)) ELSE progress END
            WHERE id = ?3 AND lease_owner = ?4 AND cancel_epoch = ?5 AND status = 'processing'
            "#,
        )
        .bind(processed_duration_ms)
        .bind(total_duration_ms)
        .bind(job_id)
        .bind(lease_owner)
        .bind(expected_cancel_epoch)
        .execute(&mut *tx)
        .await?;

        // 5. Update documents.content projection from canonical source
        sqlx::query(
            r#"
            UPDATE documents
            SET content = COALESCE((
                SELECT GROUP_CONCAT(text, ' ')
                FROM (
                    SELECT text FROM transcript_segments
                    WHERE transcript_id = ?1
                    ORDER BY ordinal, id
                )
            ), '')
            WHERE id = ?2
            "#,
        )
        .bind(transcript_id)
        .bind(&document_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("UPDATE ai_index_state SET state = 'stale' WHERE document_id = ?1 AND state = 'indexed'")
            .bind(&document_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        Ok(committed_count)
    }

    pub async fn import_session_transcript(
        &self,
        session_id: &str,
        segments: &[SessionTranscriptSegmentInput],
    ) -> SessionResult<usize> {
        let mut tx = self.pool().begin().await?;

        // 1. Fetch recording session to get document_id and current transcript_revision
        let session_row: Option<(String, Option<i64>)> = sqlx::query_as(
            "SELECT document_id, transcript_revision FROM recording_sessions WHERE id = ?1",
        )
        .bind(session_id)
        .fetch_optional(&mut *tx)
        .await?;

        let (document_id, prev_revision) = session_row.ok_or_else(unavailable)?;
        let new_revision = prev_revision.unwrap_or(0) + 1;

        // 2. Insert transcript row with status 'completed' and model 'imported'
        let chapter_id = format!("{document_id}:rev:{new_revision}");
        sqlx::query(
            r#"
            INSERT INTO transcripts (book_id, chapter_id, session_id, revision, model_used, language, status)
            VALUES (?1, ?2, ?3, ?4, 'imported', 'en', 'completed')
            "#,
        )
        .bind(&document_id)
        .bind(&chapter_id)
        .bind(session_id)
        .bind(new_revision)
        .execute(&mut *tx)
        .await?;

        let transcript_id: i64 = sqlx::query_scalar(
            "SELECT id FROM transcripts WHERE session_id = ?1 AND revision = ?2",
        )
        .bind(session_id)
        .bind(new_revision)
        .fetch_one(&mut *tx)
        .await?;

        // 3. Insert segments into transcript_segments
        let mut committed_count = 0usize;
        for seg in segments {
            let timing_kind = match seg.timing_kind.as_str() {
                "none" => "none",
                "imported" => "imported",
                _ => "measured",
            };

            let (start_ms, end_ms) = if timing_kind == "none" {
                (None, None)
            } else {
                (seg.start_ms, seg.end_ms)
            };

            sqlx::query(
                r#"
                INSERT INTO transcript_segments (
                    transcript_id, start_ms, end_ms, text, confidence, words_json,
                    segment_key, ordinal, speaker_id, timing_kind, revision, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ON CONFLICT(transcript_id, segment_key) DO UPDATE SET
                    start_ms = excluded.start_ms,
                    end_ms = excluded.end_ms,
                    text = excluded.text,
                    confidence = excluded.confidence,
                    words_json = excluded.words_json,
                    ordinal = excluded.ordinal,
                    speaker_id = excluded.speaker_id,
                    timing_kind = excluded.timing_kind,
                    revision = excluded.revision,
                    metadata_json = excluded.metadata_json
                "#,
            )
            .bind(transcript_id)
            .bind(start_ms)
            .bind(end_ms)
            .bind(&seg.text)
            .bind(seg.confidence)
            .bind(seg.words_json.as_deref())
            .bind(&seg.segment_key)
            .bind(seg.ordinal)
            .bind(seg.speaker_id.as_deref())
            .bind(timing_kind)
            .bind(new_revision)
            .bind(seg.metadata_json.as_deref())
            .execute(&mut *tx)
            .await?;

            committed_count += 1;
        }

        // 4. Update documents.content projection from newly committed transcript
        sqlx::query(
            r#"
            UPDATE documents
            SET content = COALESCE((
                SELECT GROUP_CONCAT(text, CHAR(10) || CHAR(10))
                FROM (
                    SELECT text FROM transcript_segments
                    WHERE transcript_id = ?1
                    ORDER BY ordinal, id
                )
            ), '')
            WHERE id = ?2
            "#,
        )
        .bind(transcript_id)
        .bind(&document_id)
        .execute(&mut *tx)
        .await?;

        // 5. Update recording session row with new transcript ID and revision
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE recording_sessions SET transcript_id = ?1, transcript_revision = ?2, ingestion_state = 'saved', updated_at = ?3 WHERE id = ?4",
        )
        .bind(transcript_id)
        .bind(new_revision)
        .bind(&now)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("UPDATE ai_index_state SET state = 'stale' WHERE document_id = ?1 AND state = 'indexed'")
            .bind(&document_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(committed_count)
    }

    pub async fn correct_session_segment(
        &self,
        session_id: &str,
        segment_key: &str,
        expected_revision: i64,
        text: &str,
        split_metadata_json: Option<&str>,
    ) -> SessionResult<i64> {
        let mut tx = self.pool().begin().await?;

        // 1. Fetch current session and transcript revision
        let session_row: Option<(String, Option<i64>, Option<i64>)> = sqlx::query_as(
            "SELECT document_id, transcript_id, transcript_revision FROM recording_sessions WHERE id = ?1",
        )
        .bind(session_id)
        .fetch_optional(&mut *tx)
        .await?;

        let (document_id, transcript_id_opt, current_revision_opt) =
            session_row.ok_or_else(unavailable)?;
        let transcript_id = transcript_id_opt.ok_or_else(unavailable)?;
        let current_revision = current_revision_opt.unwrap_or(0);

        // 2. Check revision conflict (optimistic concurrency control)
        if current_revision != expected_revision {
            return Err(SessionOperationError::stale_with_session(session_id));
        }

        let new_revision = current_revision + 1;

        // 3. Update segment text, revision and metadata in transcript_segments
        let rows_affected = sqlx::query(
            r#"
            UPDATE transcript_segments
            SET text = ?1, revision = ?2, metadata_json = COALESCE(?3, metadata_json)
            WHERE transcript_id = ?4 AND segment_key = ?5
            "#,
        )
        .bind(text)
        .bind(new_revision)
        .bind(split_metadata_json)
        .bind(transcript_id)
        .bind(segment_key)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        if rows_affected == 0 {
            return Err(unavailable());
        }

        // 4. Update recording_sessions row: transcript_revision and updated_at
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE recording_sessions SET transcript_revision = ?1, updated_at = ?2 WHERE id = ?3",
        )
        .bind(new_revision)
        .bind(&now)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

        // 5. Update transcripts table revision
        sqlx::query(
            "UPDATE transcripts SET revision = ?1 WHERE id = ?2",
        )
        .bind(new_revision)
        .bind(transcript_id)
        .execute(&mut *tx)
        .await?;

        // 6. Invalidate affected analysis runs / drafts if tables exist
        let has_analysis_runs: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='session_analysis_runs'",
        )
        .fetch_one(&mut *tx)
        .await
        .unwrap_or(false);

        if has_analysis_runs {
            let _ = sqlx::query(
                "UPDATE session_analysis_runs SET status = 'stale', updated_at = ?1 WHERE session_id = ?2 AND status = 'completed'",
            )
            .bind(&now)
            .bind(session_id)
            .execute(&mut *tx)
            .await;
        }

        let has_drafts: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='session_learning_drafts'",
        )
        .fetch_one(&mut *tx)
        .await
        .unwrap_or(false);

        if has_drafts {
            let _ = sqlx::query(
                "UPDATE session_learning_drafts SET status = 'stale', updated_at = ?1 WHERE session_id = ?2 AND status = 'proposed'",
            )
            .bind(&now)
            .bind(session_id)
            .execute(&mut *tx)
            .await;
        }

        // 7. Update documents.content projection from canonical transcript
        sqlx::query(
            r#"
            UPDATE documents
            SET content = COALESCE((
                SELECT GROUP_CONCAT(text, CHAR(10) || CHAR(10))
                FROM (
                    SELECT text FROM transcript_segments
                    WHERE transcript_id = ?1
                    ORDER BY ordinal, id
                )
            ), '')
            WHERE id = ?2
            "#,
        )
        .bind(transcript_id)
        .bind(&document_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("UPDATE ai_index_state SET state = 'stale' WHERE document_id = ?1 AND state = 'indexed'")
            .bind(&document_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(new_revision)
    }

    pub async fn create_or_extend_session_marker(
        &self,
        session_id: &str,
        kind: SessionMarkerKind,
        media_ms: i64,
        window_ms: Option<i64>,
        note: Option<String>,
    ) -> SessionResult<RecordingSessionMarker> {
        let pool = self.pool();
        let default_window = window_ms.unwrap_or(30_000).max(0);

        let kind_val = serde_json::to_value(kind).map_err(|_| unavailable())?;
        let kind_str = kind_val.as_str().ok_or_else(unavailable)?;

        // Check for existing pending marker of same session and kind within 5s
        let existing = sqlx::query(
            "SELECT * FROM recording_session_markers
             WHERE session_id = ?1 AND kind = ?2 AND abs(media_ms - ?3) <= 5000 AND state = 'pending'
             ORDER BY created_at DESC LIMIT 1"
        )
        .bind(session_id)
        .bind(kind_str)
        .bind(media_ms)
        .fetch_optional(pool)
        .await?;

        if let Some(row) = existing {
            let id: String = row.try_get("id")?;
            let current_window: i64 = row.try_get("window_ms")?;
            let extended_window = (current_window + default_window).min(90_000);
            let updated_note = match (row.try_get::<Option<String>, _>("note")?, note) {
                (Some(n), Some(new_n)) => Some(format!("{} | {}", n, new_n)),
                (Some(n), None) => Some(n),
                (None, Some(new_n)) => Some(new_n),
                (None, None) => None,
            };

            sqlx::query(
                "UPDATE recording_session_markers SET window_ms = ?1, note = ?2 WHERE id = ?3"
            )
            .bind(extended_window)
            .bind(&updated_note)
            .bind(&id)
            .execute(pool)
            .await?;

            let updated_row = sqlx::query("SELECT * FROM recording_session_markers WHERE id = ?1")
                .bind(&id)
                .fetch_one(pool)
                .await?;

            return read_marker(&updated_row);
        }

        // Fresh marker
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Check if canonical finalized text already exists within [media_ms - default_window, media_ms]
        let window_start = media_ms.saturating_sub(default_window);
        let segments = sqlx::query(
            "SELECT ts.segment_key, ts.text, ts.start_ms, ts.end_ms
             FROM transcript_segments ts
             JOIN transcripts t ON t.id = ts.transcript_id
             WHERE t.session_id = ?1 AND ts.start_ms <= ?2 AND ts.end_ms >= ?3
             ORDER BY ts.ordinal ASC LIMIT 3"
        )
        .bind(session_id)
        .bind(media_ms)
        .bind(window_start)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        let (state_str, evidence_json) = if !segments.is_empty() {
            let quote = segments
                .iter()
                .filter_map(|r| r.try_get::<String, _>("text").ok())
                .collect::<Vec<_>>()
                .join(" ");
            let evidence = serde_json::json!([{
                "quote": quote,
                "startMs": segments.first().and_then(|r| r.try_get::<Option<i64>, _>("start_ms").ok().flatten()).unwrap_or(window_start),
                "endMs": segments.last().and_then(|r| r.try_get::<Option<i64>, _>("end_ms").ok().flatten()).unwrap_or(media_ms),
            }]);
            ("resolved", Some(evidence.to_string()))
        } else {
            ("pending", None)
        };

        sqlx::query(
            "INSERT INTO recording_session_markers (id, session_id, kind, media_ms, window_ms, part_sequence, note, evidence_json, state, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9)"
        )
        .bind(&id)
        .bind(session_id)
        .bind(kind_str)
        .bind(media_ms)
        .bind(default_window.min(90_000))
        .bind(&note)
        .bind(&evidence_json)
        .bind(state_str)
        .bind(&now)
        .execute(pool)
        .await?;

        let row = sqlx::query("SELECT * FROM recording_session_markers WHERE id = ?1")
            .bind(&id)
            .fetch_one(pool)
            .await?;

        read_marker(&row)
    }

    pub async fn list_session_markers(
        &self,
        session_id: &str,
    ) -> SessionResult<Vec<RecordingSessionMarker>> {
        let pool = self.pool();
        let rows = sqlx::query(
            "SELECT * FROM recording_session_markers
             WHERE session_id = ?1
             ORDER BY media_ms ASC, created_at ASC"
        )
        .bind(session_id)
        .fetch_all(pool)
        .await?;

        rows.iter().map(read_marker).collect()
    }

    pub async fn resolve_pending_markers_for_session(
        &self,
        session_id: &str,
    ) -> SessionResult<Vec<RecordingSessionMarker>> {
        let pool = self.pool();
        let pending = sqlx::query(
            "SELECT * FROM recording_session_markers
             WHERE session_id = ?1 AND state = 'pending'"
        )
        .bind(session_id)
        .fetch_all(pool)
        .await?;

        for row in &pending {
            let id: String = row.try_get("id")?;
            let media_ms: i64 = row.try_get("media_ms")?;
            let window_ms: i64 = row.try_get("window_ms")?;
            let window_start = media_ms.saturating_sub(window_ms.min(90_000));

            let segments = sqlx::query(
                "SELECT ts.segment_key, ts.text, ts.start_ms, ts.end_ms
                 FROM transcript_segments ts
                 JOIN transcripts t ON t.id = ts.transcript_id
                 WHERE t.session_id = ?1 AND ts.start_ms <= ?2 AND ts.end_ms >= ?3
                 ORDER BY ts.ordinal ASC LIMIT 3"
            )
            .bind(session_id)
            .bind(media_ms)
            .bind(window_start)
            .fetch_all(pool)
            .await
            .unwrap_or_default();

            if !segments.is_empty() {
                let quote = segments
                    .iter()
                    .filter_map(|r| r.try_get::<String, _>("text").ok())
                    .collect::<Vec<_>>()
                    .join(" ");
                let evidence = serde_json::json!([{
                    "quote": quote,
                    "startMs": segments.first().and_then(|r| r.try_get::<Option<i64>, _>("start_ms").ok().flatten()).unwrap_or(window_start),
                    "endMs": segments.last().and_then(|r| r.try_get::<Option<i64>, _>("end_ms").ok().flatten()).unwrap_or(media_ms),
                }]);
                let evidence_str = evidence.to_string();
                let _ = sqlx::query(
                    "UPDATE recording_session_markers SET evidence_json = ?1, state = 'resolved' WHERE id = ?2"
                )
                .bind(&evidence_str)
                .bind(&id)
                .execute(pool)
                .await;
            }
        }

        self.list_session_markers(session_id).await
    }

    pub async fn delete_session_media(
        &self,
        data_dir: &std::path::Path,
        session_id: &str,
        expected_version: i64,
    ) -> SessionResult<DeleteSessionMediaResult> {
        let row = sqlx::query("SELECT version, media_asset_id FROM recording_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_optional(self.pool())
            .await?;

        let (version, media_asset_id): (i64, Option<String>) = match row {
            Some(r) => (r.get("version"), r.get("media_asset_id")),
            None => return Err(unavailable()),
        };

        if version != expected_version {
            return Err(SessionOperationError::stale_with_session(session_id));
        }

        if media_asset_id.is_none() {
            return Ok(DeleteSessionMediaResult {
                session_id: session_id.to_string(),
                version,
                deleted_assets_count: 0,
                transcript_preserved: true,
                cards_preserved: true,
            });
        }

        // Fetch all media assets and parts for this session
        let assets = sqlx::query("SELECT id, relative_path FROM media_assets WHERE session_id = ?1")
            .bind(session_id)
            .fetch_all(self.pool())
            .await?;

        let now = chrono::Utc::now().to_rfc3339();
        let mut journal_entries: Vec<(String, String, String)> = Vec::new();

        for asset_row in &assets {
            let a_id: String = asset_row.get("id");
            let rel_path: String = asset_row.get("relative_path");
            let j_id = format!("cleanup-{}", uuid::Uuid::new_v4());
            journal_entries.push((j_id, a_id.clone(), rel_path));

            let parts = sqlx::query("SELECT relative_path FROM recording_parts WHERE asset_id = ?1")
                .bind(&a_id)
                .fetch_all(self.pool())
                .await?;

            for p_row in parts {
                let p_rel: String = p_row.get("relative_path");
                let p_jid = format!("cleanup-{}", uuid::Uuid::new_v4());
                journal_entries.push((p_jid, a_id.clone(), p_rel));
            }
        }

        // Journal pending cleanup
        for (j_id, a_id, rel_path) in &journal_entries {
            let _ = sqlx::query(
                "INSERT OR IGNORE INTO recording_cleanup_journal (id, session_id, asset_id, relative_path, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5)"
            )
            .bind(j_id)
            .bind(session_id)
            .bind(a_id)
            .bind(rel_path)
            .bind(&now)
            .execute(self.pool())
            .await;
        }

        // Atomic DB transition: unlink media_asset_id, delete media_assets
        let mut tx = self.pool().begin().await?;
        let new_version = version + 1;
        sqlx::query(
            "UPDATE recording_sessions
             SET media_asset_id = NULL, version = ?1, updated_at = ?2
             WHERE id = ?3 AND version = ?4"
        )
        .bind(new_version)
        .bind(&now)
        .bind(session_id)
        .bind(version)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM media_assets WHERE session_id = ?1")
            .bind(session_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        // Physical cleanup
        for (j_id, _a_id, rel_path) in &journal_entries {
            let path_res = crate::recording::safe_resolve_recording_path(data_dir, session_id, rel_path);
            let update_status = match path_res {
                Ok(path) => {
                    if path.exists() {
                        let _ = std::fs::remove_file(&path);
                    }
                    "completed"
                }
                Err(_) => "failed",
            };

            let update_now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(
                "UPDATE recording_cleanup_journal SET status = ?1, updated_at = ?2 WHERE id = ?3"
            )
            .bind(update_status)
            .bind(&update_now)
            .bind(j_id)
            .execute(self.pool())
            .await;
        }

        // Also clean parts directory and manifest if present
        if let Ok(root) = crate::recording::managed_recording_root(data_dir, session_id) {
            let parts_dir = root.join("parts");
            if parts_dir.exists() {
                let _ = std::fs::remove_dir_all(&parts_dir);
            }
            let manifest_path = root.join("manifest.json");
            if manifest_path.exists() {
                let _ = std::fs::remove_file(&manifest_path);
            }
        }

        Ok(DeleteSessionMediaResult {
            session_id: session_id.to_string(),
            version: new_version,
            deleted_assets_count: assets.len(),
            transcript_preserved: true,
            cards_preserved: true,
        })
    }

    pub async fn delete_recording_session(
        &self,
        data_dir: &std::path::Path,
        session_id: &str,
        expected_version: i64,
        delete_document: bool,
    ) -> SessionResult<DeleteRecordingSessionResult> {
        let row = sqlx::query("SELECT version, document_id FROM recording_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_optional(self.pool())
            .await?;

        let (version, document_id): (i64, String) = match row {
            Some(r) => (r.get("version"), r.get("document_id")),
            None => return Err(unavailable()),
        };

        if version != expected_version {
            return Err(SessionOperationError::stale_with_session(session_id));
        }

        // Fetch media assets for journal
        let assets = sqlx::query("SELECT id, relative_path FROM media_assets WHERE session_id = ?1")
            .bind(session_id)
            .fetch_all(self.pool())
            .await?;

        let now = chrono::Utc::now().to_rfc3339();
        let mut journal_entries: Vec<(String, String, String)> = Vec::new();

        for asset_row in &assets {
            let a_id: String = asset_row.get("id");
            let rel_path: String = asset_row.get("relative_path");
            let j_id = format!("cleanup-{}", uuid::Uuid::new_v4());
            journal_entries.push((j_id, a_id.clone(), rel_path));

            let parts = sqlx::query("SELECT relative_path FROM recording_parts WHERE asset_id = ?1")
                .bind(&a_id)
                .fetch_all(self.pool())
                .await?;

            for p_row in parts {
                let p_rel: String = p_row.get("relative_path");
                let p_jid = format!("cleanup-{}", uuid::Uuid::new_v4());
                journal_entries.push((p_jid, a_id.clone(), p_rel));
            }
        }

        for (j_id, a_id, rel_path) in &journal_entries {
            let _ = sqlx::query(
                "INSERT OR IGNORE INTO recording_cleanup_journal (id, session_id, asset_id, relative_path, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5)"
            )
            .bind(j_id)
            .bind(session_id)
            .bind(a_id)
            .bind(rel_path)
            .bind(&now)
            .execute(self.pool())
            .await;
        }

        // Delete recording_sessions in transaction
        let mut tx = self.pool().begin().await?;
        sqlx::query("DELETE FROM recording_sessions WHERE id = ?1 AND version = ?2")
            .bind(session_id)
            .bind(version)
            .execute(&mut *tx)
            .await?;

        if delete_document {
            sqlx::query("DELETE FROM documents WHERE id = ?1")
                .bind(&document_id)
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;

        // Disk directory removal
        if let Ok(root) = crate::recording::managed_recording_root(data_dir, session_id) {
            if root.exists() {
                let _ = std::fs::remove_dir_all(&root);
            }
        }

        let update_now = chrono::Utc::now().to_rfc3339();
        for (j_id, _, _) in &journal_entries {
            let _ = sqlx::query(
                "UPDATE recording_cleanup_journal SET status = 'completed', updated_at = ?1 WHERE id = ?2"
            )
            .bind(&update_now)
            .bind(j_id)
            .execute(self.pool())
            .await;
        }

        Ok(DeleteRecordingSessionResult {
            session_id: session_id.to_string(),
            deleted: true,
            accepted_cards_retained: true,
        })
    }

    pub async fn process_cleanup_journal(
        &self,
        data_dir: &std::path::Path,
    ) -> SessionResult<CleanupJournalResult> {
        let pending_rows = sqlx::query(
            "SELECT id, session_id, relative_path FROM recording_cleanup_journal WHERE status IN ('pending', 'failed')"
        )
        .fetch_all(self.pool())
        .await?;

        let mut cleaned_count = 0;
        let mut failed_count = 0;

        for row in pending_rows {
            let j_id: String = row.get("id");
            let session_id: Option<String> = row.get("session_id");
            let relative_path: String = row.get("relative_path");

            let mut success = false;
            if let Some(s_id) = session_id {
                if let Ok(path) = crate::recording::safe_resolve_recording_path(data_dir, &s_id, &relative_path) {
                    if !path.exists() || std::fs::remove_file(&path).is_ok() {
                        success = true;
                    }
                }
            } else {
                success = true;
            }

            let now = chrono::Utc::now().to_rfc3339();
            if success {
                cleaned_count += 1;
                let _ = sqlx::query(
                    "UPDATE recording_cleanup_journal SET status = 'completed', updated_at = ?1 WHERE id = ?2"
                )
                .bind(&now)
                .bind(&j_id)
                .execute(self.pool())
                .await;
            } else {
                failed_count += 1;
                let _ = sqlx::query(
                    "UPDATE recording_cleanup_journal SET status = 'failed', error_code = 'file_delete_failed', updated_at = ?1 WHERE id = ?2"
                )
                .bind(&now)
                .bind(&j_id)
                .execute(self.pool())
                .await;
            }
        }

        Ok(CleanupJournalResult {
            cleaned_count,
            failed_count,
        })
    }

    pub async fn update_session_speaker(
        &self,
        session_id: &str,
        from_speaker_id: &str,
        to_speaker_id: Option<&str>,
    ) -> SessionResult<usize> {
        let row = sqlx::query("SELECT transcript_id FROM recording_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_optional(self.pool())
            .await?;

        let transcript_id: Option<i64> = match row {
            Some(r) => r.get("transcript_id"),
            None => return Err(unavailable()),
        };

        let t_id = match transcript_id {
            Some(id) => id,
            None => return Ok(0),
        };

        let res = sqlx::query(
            "UPDATE transcript_segments SET speaker_id = ?1, revision = revision + 1 WHERE transcript_id = ?2 AND speaker_id = ?3"
        )
        .bind(to_speaker_id)
        .bind(t_id)
        .bind(from_speaker_id)
        .execute(self.pool())
        .await?;

        let affected = res.rows_affected() as usize;
        if affected > 0 {
            let _ = sqlx::query(
                "UPDATE recording_sessions SET transcript_revision = transcript_revision + 1, updated_at = ?1 WHERE id = ?2"
            )
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(session_id)
            .execute(self.pool())
            .await;
        }

        Ok(affected)
    }

    pub async fn list_session_speakers(&self, session_id: &str) -> SessionResult<Vec<String>> {
        let row = sqlx::query("SELECT transcript_id FROM recording_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_optional(self.pool())
            .await?;

        let transcript_id: Option<i64> = match row {
            Some(r) => r.get("transcript_id"),
            None => return Err(unavailable()),
        };

        let t_id = match transcript_id {
            Some(id) => id,
            None => return Ok(Vec::new()),
        };

        let rows = sqlx::query(
            "SELECT DISTINCT speaker_id FROM transcript_segments WHERE transcript_id = ?1 AND speaker_id IS NOT NULL ORDER BY speaker_id"
        )
        .bind(t_id)
        .fetch_all(self.pool())
        .await?;

        let mut speakers = Vec::new();
        for r in rows {
            let spk: Option<String> = r.get("speaker_id");
            if let Some(s) = spk {
                speakers.push(s);
            }
        }
        Ok(speakers)
    }

    pub async fn associate_session_document(
        &self,
        session_id: &str,
        document_id: &str,
    ) -> SessionResult<Vec<SessionRelatedDocument>> {
        let row = sqlx::query("SELECT profile_json, document_id FROM recording_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_optional(self.pool())
            .await?;
        let (profile_json_str, session_doc_id): (String, String) = match row {
            Some(r) => (r.get("profile_json"), r.get("document_id")),
            None => return Err(unavailable()),
        };

        if document_id == session_doc_id {
            return Err(unavailable());
        }

        let doc_exists = sqlx::query("SELECT 1 FROM documents WHERE id = ?1")
            .bind(document_id)
            .fetch_optional(self.pool())
            .await?;
        if doc_exists.is_none() {
            return Err(unavailable());
        }

        let mut profile: serde_json::Value =
            serde_json::from_str(&profile_json_str).unwrap_or_else(|_| serde_json::json!({}));
        if !profile.is_object() {
            profile = serde_json::json!({});
        }

        if let Some(map) = profile.as_object_mut() {
            let ids = map
                .entry("relatedDocumentIds")
                .or_insert_with(|| serde_json::Value::Array(Vec::new()));

            if let Some(arr) = ids.as_array_mut() {
                if !arr.iter().any(|v| v.as_str() == Some(document_id)) {
                    arr.push(serde_json::Value::String(document_id.to_string()));
                }
            }
        }

        let updated_profile_json = profile.to_string();
        sqlx::query(
            "UPDATE recording_sessions SET profile_json = ?1, updated_at = ?2 WHERE id = ?3",
        )
        .bind(&updated_profile_json)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(session_id)
        .execute(self.pool())
        .await?;

        self.list_session_related_documents(session_id).await
    }

    pub async fn disassociate_session_document(
        &self,
        session_id: &str,
        document_id: &str,
    ) -> SessionResult<Vec<SessionRelatedDocument>> {
        let row = sqlx::query("SELECT profile_json FROM recording_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_optional(self.pool())
            .await?;
        let profile_json_str: String = match row {
            Some(r) => r.get("profile_json"),
            None => return Err(unavailable()),
        };

        let mut profile: serde_json::Value =
            serde_json::from_str(&profile_json_str).unwrap_or_else(|_| serde_json::json!({}));
        if let Some(arr) = profile.get_mut("relatedDocumentIds").and_then(|v| v.as_array_mut()) {
            arr.retain(|v| v.as_str() != Some(document_id));
        }

        let updated_profile_json = profile.to_string();
        sqlx::query(
            "UPDATE recording_sessions SET profile_json = ?1, updated_at = ?2 WHERE id = ?3",
        )
        .bind(&updated_profile_json)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(session_id)
        .execute(self.pool())
        .await?;

        self.list_session_related_documents(session_id).await
    }

    pub async fn list_session_related_documents(
        &self,
        session_id: &str,
    ) -> SessionResult<Vec<SessionRelatedDocument>> {
        let row = sqlx::query("SELECT profile_json FROM recording_sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_optional(self.pool())
            .await?;
        let profile_json_str: String = match row {
            Some(r) => r.get("profile_json"),
            None => return Err(unavailable()),
        };

        let profile: serde_json::Value =
            serde_json::from_str(&profile_json_str).unwrap_or_else(|_| serde_json::json!({}));
        let ids = match profile.get("relatedDocumentIds").and_then(|v| v.as_array()) {
            Some(arr) => arr,
            None => return Ok(Vec::new()),
        };

        let mut results = Vec::new();
        for id_val in ids {
            if let Some(doc_id) = id_val.as_str() {
                let doc_row = sqlx::query(
                    "SELECT id, title, file_type, is_local_only, is_ai_excluded FROM documents WHERE id = ?1",
                )
                .bind(doc_id)
                .fetch_optional(self.pool())
                .await?;

                match doc_row {
                    Some(r) => {
                        let is_local_only = r.try_get::<bool, _>("is_local_only")
                            .unwrap_or_else(|_| r.try_get::<i64, _>("is_local_only").map(|v| v != 0).unwrap_or(false));
                        let is_ai_excluded = r.try_get::<bool, _>("is_ai_excluded")
                            .unwrap_or_else(|_| r.try_get::<i64, _>("is_ai_excluded").map(|v| v != 0).unwrap_or(false));
                        results.push(SessionRelatedDocument {
                            id: r.get("id"),
                            title: r.get("title"),
                            file_type: r.get("file_type"),
                            is_local_only,
                            is_ai_excluded,
                            is_available: true,
                        });
                    }
                    None => {
                        results.push(SessionRelatedDocument {
                            id: doc_id.to_string(),
                            title: "(Document deleted from library)".to_string(),
                            file_type: "unknown".to_string(),
                            is_local_only: false,
                            is_ai_excluded: false,
                            is_available: false,
                        });
                    }
                }
            }
        }

        Ok(results)
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn repository() -> Repository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        Repository::new(pool)
    }

    #[tokio::test]
    async fn session_creation_and_idempotency_and_privacy() {
        let repo = repository().await;
        let id = uuid::Uuid::new_v4().to_string();
        let request = CreateRecordingSession {
            id: id.clone(),
            document_id: None,
            collection_id: None,
            title: "Lecture on Rust".into(),
            origin: SessionOrigin::Recorded,
            content_type: "lecture".into(),
            profile_json: "{}".into(),
        };
        let session = repo.create_recording_session(&request).await.unwrap();
        assert_eq!(session.id, id);
        assert_eq!(session.origin, SessionOrigin::Recorded);
        assert_eq!(session.content_type, SessionContentType::Lecture);

        // Verify document was created and defaulted to is_local_only = true
        let doc = repo.get_document(&session.document_id).await.unwrap().unwrap();
        assert!(doc.is_local_only);

        // Privacy lookup for the session
        let privacy = repo.get_session_document_privacy(&id).await.unwrap();
        assert!(privacy.is_local_only);
        assert_eq!(privacy.privacy_version, 1);

        // Idempotent retry with identical request succeeds
        let retried = repo.create_recording_session(&request).await.unwrap();
        assert_eq!(retried.id, session.id);
        assert_eq!(retried.document_id, session.document_id);

        // Retry with conflicting document_id returns StaleRevision
        let conflicting = CreateRecordingSession {
            id: id.clone(),
            document_id: Some("different-doc".into()),
            collection_id: None,
            title: "Lecture on Rust".into(),
            origin: SessionOrigin::Recorded,
            content_type: "lecture".into(),
            profile_json: "{}".into(),
        };
        assert_eq!(
            repo.create_recording_session(&conflicting).await.unwrap_err().code,
            "StaleRevision"
        );
    }

    #[tokio::test]
    async fn session_creation_with_existing_document() {
        let repo = repository().await;
        let doc = Document::new("Pre-existing audio".into(), "audio.mp3".into(), FileType::Audio);
        repo.create_document(&doc).await.unwrap();

        let id = uuid::Uuid::new_v4().to_string();
        let request = CreateRecordingSession {
            id: id.clone(),
            document_id: Some(doc.id.clone()),
            collection_id: None,
            title: "Imported session".into(),
            origin: SessionOrigin::File,
            content_type: "seminar".into(),
            profile_json: "{}".into(),
        };
        let session = repo.create_recording_session(&request).await.unwrap();
        assert_eq!(session.document_id, doc.id);

        // Target document is updated to is_local_only = true
        let reloaded = repo.get_document(&doc.id).await.unwrap().unwrap();
        assert!(reloaded.is_local_only);

        // Can find session by document ID
        let found = repo.find_session_by_document_id(&doc.id).await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, session.id);

        // Non-existent document returns None
        let not_found = repo.find_session_by_document_id("non-existent-doc").await.unwrap();
        assert!(not_found.is_none());
    }

    #[tokio::test]
    async fn session_profile_cas_update() {
        let repo = repository().await;
        let id = uuid::Uuid::new_v4().to_string();
        let request = CreateRecordingSession {
            id: id.clone(),
            document_id: None,
            collection_id: None,
            title: "Seminar".into(),
            origin: SessionOrigin::Recorded,
            content_type: "seminar".into(),
            profile_json: "{}".into(),
        };
        let session = repo.create_recording_session(&request).await.unwrap();
        assert_eq!(session.version, 1);

        // CAS update with expected version 1 succeeds
        let updated = repo
            .update_recording_session_profile(&id, 1, "interview", r#"{"notes":true}"#)
            .await
            .unwrap();
        assert_eq!(updated.version, 2);
        assert_eq!(updated.content_type, SessionContentType::Interview);

        // CAS update with stale expected version 1 fails
        let stale_err = repo
            .update_recording_session_profile(&id, 1, "lecture", "{}")
            .await
            .unwrap_err();
        assert_eq!(stale_err.code, "StaleRevision");

        // Invalid profile JSON fails
        let invalid_err = repo
            .update_recording_session_profile(&id, 2, "lecture", "not-json")
            .await
            .unwrap_err();
        assert_eq!(invalid_err.code, "SourceUnavailable");
    }

    #[tokio::test]
    async fn session_listing_and_paging() {
        let repo = repository().await;
        for i in 0..3 {
            let id = uuid::Uuid::new_v4().to_string();
            let request = CreateRecordingSession {
                id,
                document_id: None,
                collection_id: None,
                title: format!("Session {i}"),
                origin: SessionOrigin::Recorded,
                content_type: "lecture".into(),
                profile_json: "{}".into(),
            };
            repo.create_recording_session(&request).await.unwrap();
        }

        let page1 = repo.list_recording_sessions(None, None, 2).await.unwrap();
        assert_eq!(page1.items.len(), 2);
        assert!(page1.next_cursor.is_some());

        let page2 = repo
            .list_recording_sessions(None, page1.next_cursor.as_deref(), 2)
            .await
            .unwrap();
        assert_eq!(page2.items.len(), 1);
        assert!(page2.next_cursor.is_none());
    }

    #[tokio::test]
    async fn session_segments_paging_and_revisions() {
        let repo = repository().await;
        let id = uuid::Uuid::new_v4().to_string();
        let request = CreateRecordingSession {
            id: id.clone(),
            document_id: None,
            collection_id: None,
            title: "Session with Transcript".into(),
            origin: SessionOrigin::Recorded,
            content_type: "lecture".into(),
            profile_json: "{}".into(),
        };
        let session = repo.create_recording_session(&request).await.unwrap();

        // No transcript yet -> returns empty page
        let empty_page = repo.get_session_segments(&id, None, 10).await.unwrap();
        assert_eq!(empty_page.items.len(), 0);
        assert_eq!(empty_page.revision, 0);

        // Insert transcript and segments
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO transcripts (session_id, book_id, chapter_id, model_used, language, status, revision, created_at, updated_at) VALUES (?1, 'sess', 'chap', 'model', 'en', 'completed', 1, ?2, ?2)",
        )
        .bind(&id).bind(&now).execute(repo.pool()).await.unwrap();
        let transcript_id: i64 = sqlx::query_scalar("SELECT last_insert_rowid()").fetch_one(repo.pool()).await.unwrap();

        sqlx::query("UPDATE recording_sessions SET transcript_id = ?1, transcript_revision = 1 WHERE id = ?2")
            .bind(transcript_id).bind(&id).execute(repo.pool()).await.unwrap();

        for i in 0..3 {
            sqlx::query(
                "INSERT INTO transcript_segments (transcript_id, segment_key, ordinal, revision, text, timing_kind, start_ms, end_ms) VALUES (?1, ?2, ?3, 1, ?4, 'measured', ?5, ?6)",
            )
            .bind(transcript_id).bind(format!("seg_{i}")).bind(i).bind(format!("Segment {i}")).bind(i * 1000).bind((i + 1) * 1000)
            .execute(repo.pool()).await.unwrap();
        }

        // Page 1 with limit 2
        let p1 = repo.get_session_segments(&id, None, 2).await.unwrap();
        assert_eq!(p1.items.len(), 2);
        assert_eq!(p1.revision, 1);
        assert!(p1.next_cursor.is_some());

        // Page 2
        let p2 = repo.get_session_segments(&id, p1.next_cursor.as_deref(), 2).await.unwrap();
        assert_eq!(p2.items.len(), 1);
        assert!(p2.next_cursor.is_none());

        // Unknown session
        let err = repo.get_session_segments("unknown-id", None, 10).await.unwrap_err();
        assert_eq!(err.code, "SourceUnavailable");
    }

    #[tokio::test]
    async fn commit_session_unit_atomicity_idempotency_and_cancellation() {
        let repo = repository().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let request = CreateRecordingSession {
            id: session_id.clone(),
            document_id: None,
            collection_id: None,
            title: "Atomic Unit Test".into(),
            origin: SessionOrigin::Recorded,
            content_type: "lecture".into(),
            profile_json: "{}".into(),
        };
        let session = repo.create_recording_session(&request).await.unwrap();

        // Enqueue a job in transcription_queue
        let job_id = "job-unit-test-1";
        let entry = crate::models::TranscriptionQueueEntry {
            id: job_id.to_string(),
            document_id: session.document_id.clone(),
            chapter_id: None,
            audio_path: "/tmp/fake.wav".into(),
            provider: "local".into(),
            model_id: "whisper".into(),
            language: "en".into(),
            status: crate::models::TranscriptionJobStatus::Processing,
            error_message: None,
            priority: 0,
            created_at: chrono::Utc::now(),
            started_at: Some(chrono::Utc::now()),
            completed_at: None,
            retry_count: 0,
            progress: 0,
            processed_duration_ms: 0,
            total_duration_ms: Some(60_000),
            transcription_mode: "auto".into(),
            session_id: Some(session_id.clone()),
            asset_id: None,
            transcript_revision: 0,
            executor: Some("frontend-service".into()),
            plan_json: None,
            lease_owner: Some("worker-unit-test".into()),
            lease_expires_at: Some(chrono::Utc::now().timestamp_millis() + 30_000),
            cancel_epoch: 0,
            blocked_reason: None,
            authorization_json: None,
        };
        repo.enqueue_transcription(&entry).await.unwrap();

        // 1. Commit first unit with 2 segments (one timed with words, one untimed)
        let segments = vec![
            SessionTranscriptSegmentInput {
                segment_key: "u1:0".into(),
                ordinal: 0,
                start_ms: Some(0),
                end_ms: Some(5000),
                text: "First spoken unit".into(),
                confidence: Some(0.95),
                words_json: Some(r#"[{"text":"First","startMs":0,"endMs":1000,"source":"measured"},{"text":"spoken","startMs":1000,"endMs":3000,"source":"measured"}]"#.into()),
                speaker_id: Some("spk-1".into()),
                timing_kind: "measured".into(),
                revision: 0,
                metadata_json: None,
            },
            SessionTranscriptSegmentInput {
                segment_key: "u1:1".into(),
                ordinal: 1,
                start_ms: None,
                end_ms: None,
                text: "Untimed conclusion".into(),
                confidence: Some(0.88),
                words_json: None,
                speaker_id: Some("spk-1".into()),
                timing_kind: "none".into(),
                revision: 0,
                metadata_json: None,
            },
        ];

        let count = repo
            .commit_session_unit(
                job_id,
                &session_id,
                0,
                "worker-unit-test",
                30_000,
                Some(60_000),
                &segments,
            )
            .await
            .unwrap();
        assert_eq!(count, 2);

        // Verify segments roundtrip
        let page = repo.get_session_segments(&session_id, None, 10).await.unwrap();
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.items[0].segment_key, "u1:0");
        assert_eq!(page.items[0].text, "First spoken unit");
        assert_eq!(page.items[0].confidence, Some(0.95));
        assert_eq!(page.items[0].speaker_id.as_deref(), Some("spk-1"));
        assert!(matches!(page.items[0].timing, SessionTranscriptTiming::Measured { start_ms: 0, end_ms: 5000 }));
        assert_eq!(page.items[0].words.as_ref().unwrap().len(), 2);

        // Untimed output stays untimed
        assert!(matches!(page.items[1].timing, SessionTranscriptTiming::None {}));

        // Verify document content projection
        let doc = repo.get_document(&session.document_id).await.unwrap().unwrap();
        assert_eq!(doc.content.as_deref(), Some("First spoken unit Untimed conclusion"));

        // Verify queue progress checkpoint
        let queue_item = repo.get_transcription_queue_entry_by_id(job_id).await.unwrap().unwrap();
        assert_eq!(queue_item.processed_duration_ms, 30_000);
        assert_eq!(queue_item.progress, 50);

        // 2. Repeated unit commit with same keys updates in-place, does not duplicate
        let count_repeat = repo
            .commit_session_unit(
                job_id,
                &session_id,
                0,
                "worker-unit-test",
                30_000,
                Some(60_000),
                &segments,
            )
            .await
            .unwrap();
        assert_eq!(count_repeat, 2);
        let page_after_repeat = repo.get_session_segments(&session_id, None, 10).await.unwrap();
        assert_eq!(page_after_repeat.items.len(), 2);

        // 3. Stale epoch or wrong lease owner is rejected as cancelled
        let stale_err = repo
            .commit_session_unit(
                job_id,
                &session_id,
                999, // wrong epoch
                "worker-unit-test",
                35_000,
                Some(60_000),
                &segments,
            )
            .await
            .unwrap_err();
        assert_eq!(stale_err.code, "Cancelled");

        let wrong_worker_err = repo
            .commit_session_unit(
                job_id,
                &session_id,
                0,
                "wrong-worker", // wrong worker
                35_000,
                Some(60_000),
                &segments,
            )
            .await
            .unwrap_err();
        assert_eq!(wrong_worker_err.code, "Cancelled");
    }

    #[tokio::test]
    async fn import_session_transcript_atomicity_and_revision_increment() {
        let repo = repository().await;
        let session_id = uuid::Uuid::new_v4().to_string();

        let session = repo
            .create_recording_session(&CreateRecordingSession {
                id: session_id.clone(),
                document_id: None,
                title: "Import Transcript Test".into(),
                content_type: "lecture".into(),
                profile_json: "{}".into(),
                origin: SessionOrigin::Transcript,
                collection_id: None,
            })
            .await
            .unwrap();

        // 1. First import: 2 segments (one timed, one untimed)
        let segments_rev1 = vec![
            SessionTranscriptSegmentInput {
                segment_key: "seg_1".into(),
                ordinal: 0,
                start_ms: Some(1000),
                end_ms: Some(4000),
                text: "First imported cue".into(),
                confidence: None,
                words_json: None,
                speaker_id: None,
                timing_kind: "imported".into(),
                revision: 1,
                metadata_json: None,
            },
            SessionTranscriptSegmentInput {
                segment_key: "seg_2".into(),
                ordinal: 1,
                start_ms: None,
                end_ms: None,
                text: "Second untimed paragraph".into(),
                confidence: None,
                words_json: None,
                speaker_id: None,
                timing_kind: "none".into(),
                revision: 1,
                metadata_json: None,
            },
        ];

        let count1 = repo.import_session_transcript(&session_id, &segments_rev1).await.unwrap();
        assert_eq!(count1, 2);

        // Verify session transcript_revision and state
        let updated_sess1 = repo.get_recording_session(&session_id).await.unwrap();
        assert_eq!(updated_sess1.transcript_revision, 1);
        assert_eq!(updated_sess1.ingestion_state, SessionIngestionState::Saved);

        // Verify document content projection
        let doc1 = repo.get_document(&session.document_id).await.unwrap().unwrap();
        assert!(doc1.content.as_deref().unwrap().contains("First imported cue"));
        assert!(doc1.content.as_deref().unwrap().contains("Second untimed paragraph"));

        // 2. Second import: replacement revision increments revision to 2
        let segments_rev2 = vec![
            SessionTranscriptSegmentInput {
                segment_key: "seg_1".into(),
                ordinal: 0,
                start_ms: Some(1000),
                end_ms: Some(5000),
                text: "Updated first cue".into(),
                confidence: None,
                words_json: None,
                speaker_id: None,
                timing_kind: "imported".into(),
                revision: 2,
                metadata_json: None,
            },
        ];

        let count2 = repo.import_session_transcript(&session_id, &segments_rev2).await.unwrap();
        assert_eq!(count2, 1);

        let updated_sess2 = repo.get_recording_session(&session_id).await.unwrap();
        assert_eq!(updated_sess2.transcript_revision, 2);

        // 3. Nonexistent session returns error without corrupting state
        let nonexistent_id = uuid::Uuid::new_v4().to_string();
        let err = repo.import_session_transcript(&nonexistent_id, &segments_rev1).await.unwrap_err();
        assert_eq!(err.code, "SourceUnavailable");
    }

    #[tokio::test]
    async fn find_session_by_media_hash_lookup_and_collection_scoping() {
        let repo = repository().await;

        let hash_a = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let hash_b = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

        // Non-existent hash returns None
        let not_found = repo.find_session_by_media_hash(hash_a, None).await.unwrap();
        assert!(not_found.is_none());

        // Create collections
        let col_physics = repo.create_collection("Physics", None, None).await.unwrap();
        let col_math = repo.create_collection("Math", None, None).await.unwrap();

        let id1 = uuid::Uuid::new_v4().to_string();
        let id2 = uuid::Uuid::new_v4().to_string();

        // Create session 1 in collection col_physics
        let s1 = repo
            .create_recording_session(&CreateRecordingSession {
                id: id1.clone(),
                document_id: None,
                collection_id: Some(col_physics.id.clone()),
                origin: SessionOrigin::File,
                content_type: "lecture".into(),
                profile_json: "{}".into(),
                title: "Physics Lecture 1".into(),
            })
            .await
            .unwrap();

        // Insert media_asset with hash_a for session 1
        sqlx::query(
            "INSERT INTO media_assets (id, session_id, kind, relative_path, mime, byte_length, sha256, duration_ms, state, created_at)
             VALUES ('asset_h1', ?1, 'original', 'recordings/sess_hash_1/media.mp3', 'audio/mpeg', 1000, ?2, 5000, 'ready', '2026-10-20T10:00:00Z')"
        )
        .bind(&id1)
        .bind(hash_a)
        .execute(repo.pool())
        .await
        .unwrap();

        // Find session 1 by hash_a
        let found1 = repo.find_session_by_media_hash(hash_a, None).await.unwrap();
        assert!(found1.is_some());
        assert_eq!(found1.unwrap().id, id1);

        // Create session 2 in collection col_math with duplicate hash_a (separate session)
        let _s2 = repo
            .create_recording_session(&CreateRecordingSession {
                id: id2.clone(),
                document_id: None,
                collection_id: Some(col_math.id.clone()),
                origin: SessionOrigin::File,
                content_type: "lecture".into(),
                profile_json: "{}".into(),
                title: "Math Lecture 1".into(),
            })
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO media_assets (id, session_id, kind, relative_path, mime, byte_length, sha256, duration_ms, state, created_at)
             VALUES ('asset_h2', ?1, 'original', 'recordings/sess_hash_2/media.mp3', 'audio/mpeg', 1000, ?2, 5000, 'ready', '2026-10-20T11:00:00Z')"
        )
        .bind(&id2)
        .bind(hash_a)
        .execute(repo.pool())
        .await
        .unwrap();

        // When collection_id of col_physics is specified, sess_hash_1 is prioritized
        let scoped_physics = repo.find_session_by_media_hash(hash_a, Some(&col_physics.id)).await.unwrap();
        assert_eq!(scoped_physics.unwrap().id, id1);

        // When collection_id of col_math is specified, sess_hash_2 is prioritized
        let scoped_math = repo.find_session_by_media_hash(hash_a, Some(&col_math.id)).await.unwrap();
        assert_eq!(scoped_math.unwrap().id, id2);

        // Hash B still not found
        let not_found_b = repo.find_session_by_media_hash(hash_b, None).await.unwrap();
        assert!(not_found_b.is_none());
    }

    #[test]
    fn relative_path_traversal_validation() {
        assert!(validate_recording_relative_path("recordings/part1.wav").is_ok());
        assert!(validate_recording_relative_path("audio.wav").is_ok());
        assert!(validate_recording_relative_path("").is_err());
        assert!(validate_recording_relative_path("/abs/path").is_err());
        assert!(validate_recording_relative_path("../escape").is_err());
        assert!(validate_recording_relative_path("foo/../bar").is_err());
        assert!(validate_recording_relative_path("foo/./bar").is_err());
        assert!(validate_recording_relative_path("foo:bar").is_err());
    }

    #[tokio::test]
    async fn session_marker_lifecycle_extension_and_resolution() {
        let repo = repository().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let session = repo
            .create_recording_session(&CreateRecordingSession {
                id: session_id.clone(),
                document_id: None,
                collection_id: None,
                origin: SessionOrigin::Recorded,
                content_type: "lecture".into(),
                profile_json: "{}".into(),
                title: "Marker Test Session".into(),
            })
            .await
            .unwrap();

        // 1. Create a marker at 45s before any STT exists
        let marker1 = repo
            .create_or_extend_session_marker(
                &session.id,
                SessionMarkerKind::Confusing,
                45_000,
                Some(30_000),
                Some("What is Paxos?".into()),
            )
            .await
            .unwrap();

        assert_eq!(marker1.state, SessionMarkerState::Pending);
        assert_eq!(marker1.window_ms, 30_000);
        assert_eq!(marker1.note.as_deref(), Some("What is Paxos?"));

        // 2. Repeated invoke within 5s extends window up to 90s and appends note
        let marker2 = repo
            .create_or_extend_session_marker(
                &session.id,
                SessionMarkerKind::Confusing,
                47_000,
                Some(30_000),
                Some("Need clarification".into()),
            )
            .await
            .unwrap();

        assert_eq!(marker2.id, marker1.id);
        assert_eq!(marker2.window_ms, 60_000);
        assert_eq!(
            marker2.note.as_deref(),
            Some("What is Paxos? | Need clarification")
        );

        // Repeated again reaches 90s cap
        let marker3 = repo
            .create_or_extend_session_marker(
                &session.id,
                SessionMarkerKind::Confusing,
                48_000,
                Some(40_000),
                None,
            )
            .await
            .unwrap();
        assert_eq!(marker3.window_ms, 90_000);

        // 3. Import transcript segments
        let segments = vec![SessionTranscriptSegmentInput {
            segment_key: "seg-paxos-1".into(),
            ordinal: 0,
            text: "Paxos is a consensus protocol for state machine replication.".into(),
            start_ms: Some(10_000),
            end_ms: Some(50_000),
            speaker_id: Some("Professor".into()),
            confidence: Some(0.95),
            words_json: None,
            timing_kind: "measured".into(),
            revision: 1,
            metadata_json: None,
        }];
        repo.import_session_transcript(&session.id, &segments).await.unwrap();

        // 4. Resolve pending markers
        let resolved_markers = repo
            .resolve_pending_markers_for_session(&session.id)
            .await
            .unwrap();

        assert_eq!(resolved_markers.len(), 1);
        let resolved = &resolved_markers[0];
        assert_eq!(resolved.state, SessionMarkerState::Resolved);
        assert!(resolved.evidence.is_some());
        let ev_str = serde_json::to_string(&resolved.evidence).unwrap();
        assert!(ev_str.contains("Paxos is a consensus protocol"));
    }

    #[tokio::test]
    async fn transcript_segment_correction_revision_conflict_and_immutable_evidence() {
        let repo = repository().await;
        let session_id = uuid::Uuid::new_v4().to_string();

        // 1. Create recording session
        let session = repo
            .create_recording_session(&CreateRecordingSession {
                id: session_id.clone(),
                document_id: None,
                collection_id: None,
                origin: SessionOrigin::Recorded,
                content_type: "lecture".into(),
                profile_json: "{}".into(),
                title: "Quantum Physics Lecture".into(),
            })
            .await
            .unwrap();

        // 2. Import initial transcript
        let seg_key = "seg-quantum-1".to_string();
        let initial_text = "Initial technical term: quantum decoherence.";
        let segments = vec![SessionTranscriptSegmentInput {
            segment_key: seg_key.clone(),
            ordinal: 0,
            text: initial_text.into(),
            start_ms: Some(1000),
            end_ms: Some(5000),
            speaker_id: Some("Speaker 1".into()),
            confidence: Some(0.99),
            words_json: None,
            timing_kind: "measured".into(),
            revision: 1,
            metadata_json: None,
        }];

        repo.import_session_transcript(&session.id, &segments).await.unwrap();

        let s_after_import = repo.get_recording_session(&session.id).await.unwrap();
        assert_eq!(s_after_import.transcript_revision, 1);

        // 3. Create an extract representing an accepted learning object
        let mut ext = crate::models::Extract::new(
            session.document_id.clone(),
            initial_text.to_string(),
        );
        ext.notes = Some("Important physics concept".to_string());
        ext.selection_context = Some(serde_json::json!({ "type": "session_transcript" }));
        let extract = repo.create_extract(&ext).await.unwrap();
        assert_eq!(extract.content, initial_text);

        // 4. Test concurrent edit conflict: expected_revision 0 is stale (current is 1)
        let conflict_err = repo
            .correct_session_segment(
                &session.id,
                &seg_key,
                0, // wrong/stale expected revision
                "Conflict attempt",
                None,
            )
            .await
            .unwrap_err();

        assert_eq!(conflict_err.code, "StaleRevision");

        // 5. Apply valid correction with expected_revision 1
        // Includes technical term, emoji 🔬, and LaTeX math notation
        let corrected_text = "Initial technical term: quantum entanglement 🔬 with math $\\psi = \\alpha |0\\rangle + \\beta |1\\rangle$.";
        let new_rev = repo
            .correct_session_segment(
                &session.id,
                &seg_key,
                1, // expected current revision
                corrected_text,
                Some("{\"split\": false}"),
            )
            .await
            .unwrap();

        assert_eq!(new_rev, 2);

        // 6. Verify session transcript revision updated to 2
        let s_after_correct = repo.get_recording_session(&session.id).await.unwrap();
        assert_eq!(s_after_correct.transcript_revision, 2);

        // 7. Verify document content projection refreshed
        let doc = repo.get_document(&session.document_id).await.unwrap().unwrap();
        assert_eq!(doc.content.as_deref(), Some(corrected_text));

        // 8. Verify document_search (FTS5) has refreshed content via triggers
        let fts_match: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM document_search WHERE document_id = ?1 AND content LIKE '%quantum entanglement%'"
        )
        .bind(&session.document_id)
        .fetch_one(repo.pool())
        .await
        .unwrap();
        assert_eq!(fts_match, 1);

        // 9. Verify accepted extract remains immutable with original snapshot wording
        let saved_extract = repo.get_extract(&extract.id).await.unwrap().unwrap();
        assert_eq!(saved_extract.content, initial_text);

        // 10. Further correction with stale expected_revision 1 fails, while 2 succeeds
        let second_conflict = repo
            .correct_session_segment(
                &session.id,
                &seg_key,
                1, // stale now
                "Another conflict",
                None,
            )
            .await
            .unwrap_err();
        assert_eq!(second_conflict.code, "StaleRevision");

        let third_rev = repo
            .correct_session_segment(
                &session.id,
                &seg_key,
                2, // matches revision 2
                "Final verified wording.",
                None,
            )
            .await
            .unwrap();
        assert_eq!(third_rev, 3);
    }

    #[tokio::test]
    async fn session_media_only_deletion_and_full_deletion_with_journal_replay() {
        let repo = repository().await;
        let temp_dir = tempfile::TempDir::new().unwrap();
        let data_dir = temp_dir.path();

        let session_id = uuid::Uuid::new_v4().to_string();
        let request = CreateRecordingSession {
            id: session_id.clone(),
            document_id: None,
            collection_id: None,
            title: "Operating Systems Lecture".into(),
            origin: SessionOrigin::Recorded,
            content_type: "lecture".into(),
            profile_json: "{}".into(),
        };
        let _session = repo.create_recording_session(&request).await.unwrap();

        // 1. Stage an asset for this session
        let source_file = data_dir.join("temp_audio.wav");
        std::fs::write(&source_file, b"RIFF dummy wav audio data").unwrap();
        let staged_asset = crate::recording::stage_session_media(
            data_dir,
            repo.pool(),
            &session_id,
            &source_file,
            "audio/wav",
        )
        .await
        .unwrap();

        // Verify media file exists on disk
        let asset_disk_path = crate::recording::safe_resolve_recording_path(
            data_dir,
            &session_id,
            &staged_asset.relative_path,
        )
        .unwrap();
        assert!(asset_disk_path.exists());

        // 2. Commit transcript unit to give session a transcript
        let committed = repo
            .import_session_transcript(
                &session_id,
                &[SessionTranscriptSegmentInput {
                    segment_key: "seg:1".into(),
                    ordinal: 0,
                    start_ms: Some(1000),
                    end_ms: Some(4000),
                    text: "Virtual memory maps virtual addresses to physical pages.".into(),
                    confidence: Some(0.95),
                    words_json: None,
                    speaker_id: None,
                    timing_kind: "measured".into(),
                    revision: 0,
                    metadata_json: None,
                }],
            )
            .await
            .unwrap();
        assert_eq!(committed, 1);

        // Fetch reloaded session
        let reloaded = repo.get_recording_session(&session_id).await.unwrap();
        assert!(reloaded.media_asset_id.is_some());
        assert_eq!(reloaded.transcript_revision, 1);

        // Stale expected version fails
        let stale_err = repo
            .delete_session_media(data_dir, &session_id, reloaded.version + 99)
            .await
            .unwrap_err();
        assert_eq!(stale_err.code, "StaleRevision");

        // 3. Delete media only
        let media_del_result = repo
            .delete_session_media(data_dir, &session_id, reloaded.version)
            .await
            .unwrap();
        assert_eq!(media_del_result.deleted_assets_count, 1);
        assert!(media_del_result.transcript_preserved);
        assert!(media_del_result.cards_preserved);

        // Verify media file on disk is gone
        assert!(!asset_disk_path.exists());

        // Verify session row updated: media_asset_id is None, version incremented
        let after_media_del = repo.get_recording_session(&session_id).await.unwrap();
        assert!(after_media_del.media_asset_id.is_none());
        assert_eq!(after_media_del.version, reloaded.version + 1);

        // Verify transcript and segments are still intact!
        assert_eq!(after_media_del.transcript_revision, 1);
        let segments = repo.get_session_segments(&session_id, None, 10).await.unwrap();
        assert_eq!(segments.items.len(), 1);
        assert_eq!(segments.items[0].text, "Virtual memory maps virtual addresses to physical pages.");

        // Verify cleanup journal was completed
        let journal_status: String = sqlx::query_scalar(
            "SELECT status FROM recording_cleanup_journal WHERE session_id = ?1 LIMIT 1"
        )
        .bind(&session_id)
        .fetch_one(repo.pool())
        .await
        .unwrap();
        assert_eq!(journal_status, "completed");

        // 4. Test full session deletion
        let full_del_result = repo
            .delete_recording_session(data_dir, &session_id, after_media_del.version, false)
            .await
            .unwrap();
        assert!(full_del_result.deleted);
        assert!(full_del_result.accepted_cards_retained);

        // Verify session row is gone
        let missing = repo.get_recording_session(&session_id).await;
        assert!(missing.is_err());

        // Verify cleanup journal replay works cleanly
        let cleanup_replay = repo.process_cleanup_journal(data_dir).await.unwrap();
        assert_eq!(cleanup_replay.failed_count, 0);
    }

    #[tokio::test]
    async fn test_session_speaker_rename_and_merge() {
        let repo = repository().await;
        let session_id = uuid::Uuid::new_v4().to_string();
        let _ = repo
            .create_recording_session(&CreateRecordingSession {
                id: session_id.clone(),
                document_id: None,
                collection_id: None,
                title: "Meeting".into(),
                origin: SessionOrigin::Recorded,
                content_type: "meeting".into(),
                profile_json: "{}".into(),
            })
            .await
            .unwrap();

        let segments = vec![
            SessionTranscriptSegmentInput {
                segment_key: "seg-1".into(),
                ordinal: 0,
                start_ms: Some(0),
                end_ms: Some(1000),
                text: "Hello everyone.".into(),
                confidence: Some(0.95),
                words_json: None,
                speaker_id: Some("Speaker 1".into()),
                timing_kind: "measured".into(),
                revision: 1,
                metadata_json: None,
            },
            SessionTranscriptSegmentInput {
                segment_key: "seg-2".into(),
                ordinal: 1,
                start_ms: Some(1000),
                end_ms: Some(2000),
                text: "Thanks for joining.".into(),
                confidence: Some(0.92),
                words_json: None,
                speaker_id: Some("Speaker 2".into()),
                timing_kind: "measured".into(),
                revision: 1,
                metadata_json: None,
            },
        ];

        repo.import_session_transcript(&session_id, &segments).await.unwrap();

        let speakers = repo.list_session_speakers(&session_id).await.unwrap();
        assert_eq!(speakers, vec!["Speaker 1", "Speaker 2"]);

        // Rename "Speaker 1" -> "Alice"
        let renamed = repo.update_session_speaker(&session_id, "Speaker 1", Some("Alice")).await.unwrap();
        assert_eq!(renamed, 1);

        let speakers_after = repo.list_session_speakers(&session_id).await.unwrap();
        assert_eq!(speakers_after, vec!["Alice", "Speaker 2"]);

        // Merge "Speaker 2" -> "Alice"
        let merged = repo.update_session_speaker(&session_id, "Speaker 2", Some("Alice")).await.unwrap();
        assert_eq!(merged, 1);

        let speakers_final = repo.list_session_speakers(&session_id).await.unwrap();
        assert_eq!(speakers_final, vec!["Alice"]);
    }

    #[tokio::test]
    async fn test_session_related_document_association_and_separate_identities() {
        let repo = repository().await;
        let session_id = "sess-related-test".to_string();
        let session_doc_id = "doc-session-main".to_string();
        let pdf_doc_id = "doc-slides-pdf".to_string();
        let epub_doc_id = "doc-reading-epub".to_string();

        // 1. Insert documents
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, is_local_only, is_ai_excluded, date_added, date_modified)
             VALUES (?1, 'Lecture Audio Doc', '/tmp/audio.mp3', 'audio', 0, 0, '2026-10-20', '2026-10-20')"
        )
        .bind(&session_doc_id)
        .execute(repo.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, is_local_only, is_ai_excluded, date_added, date_modified)
             VALUES (?1, 'Lecture 01 Slides', '/tmp/slides.pdf', 'pdf', 1, 0, '2026-10-20', '2026-10-20')"
        )
        .bind(&pdf_doc_id)
        .execute(repo.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, is_local_only, is_ai_excluded, date_added, date_modified)
             VALUES (?1, 'Recommended Chapter', '/tmp/chapter.epub', 'epub', 0, 1, '2026-10-20', '2026-10-20')"
        )
        .bind(&epub_doc_id)
        .execute(repo.pool())
        .await
        .unwrap();

        // 2. Insert session
        sqlx::query(
            "INSERT INTO recording_sessions (id, document_id, origin, content_type, profile_json, created_at, updated_at)
             VALUES (?1, ?2, 'recorded', 'lecture', '{}', '2026-10-20', '2026-10-20')"
        )
        .bind(&session_id)
        .bind(&session_doc_id)
        .execute(repo.pool())
        .await
        .unwrap();

        // 3. Initially no related documents
        let initial = repo.list_session_related_documents(&session_id).await.unwrap();
        assert!(initial.is_empty());

        // 4. Associate slides PDF
        let after_pdf = repo.associate_session_document(&session_id, &pdf_doc_id).await.unwrap();
        assert_eq!(after_pdf.len(), 1);
        assert_eq!(after_pdf[0].id, pdf_doc_id);
        assert_eq!(after_pdf[0].title, "Lecture 01 Slides");
        assert_eq!(after_pdf[0].file_type, "pdf");
        assert!(after_pdf[0].is_local_only);
        assert!(!after_pdf[0].is_ai_excluded);
        assert!(after_pdf[0].is_available);

        // 5. Associate epub (has independent privacy: is_ai_excluded=true, is_local_only=false)
        let after_both = repo.associate_session_document(&session_id, &epub_doc_id).await.unwrap();
        assert_eq!(after_both.len(), 2);
        assert_eq!(after_both[1].id, epub_doc_id);
        assert!(!after_both[1].is_local_only);
        assert!(after_both[1].is_ai_excluded);

        // 6. Associating session's own document is rejected
        assert!(repo.associate_session_document(&session_id, &session_doc_id).await.is_err());

        // 7. Associating non-existent document is rejected
        assert!(repo.associate_session_document(&session_id, "non-existent-doc").await.is_err());

        // 8. Delete PDF from library documents table to verify graceful unavailable handling
        sqlx::query("DELETE FROM documents WHERE id = ?1")
            .bind(&pdf_doc_id)
            .execute(repo.pool())
            .await
            .unwrap();

        let after_delete = repo.list_session_related_documents(&session_id).await.unwrap();
        assert_eq!(after_delete.len(), 2);
        assert_eq!(after_delete[0].id, pdf_doc_id);
        assert!(!after_delete[0].is_available);
        assert_eq!(after_delete[0].title, "(Document deleted from library)");
        assert!(after_delete[1].is_available);

        // 9. Disassociate deleted PDF
        let after_disassociate = repo.disassociate_session_document(&session_id, &pdf_doc_id).await.unwrap();
        assert_eq!(after_disassociate.len(), 1);
        assert_eq!(after_disassociate[0].id, epub_doc_id);
    }
}
