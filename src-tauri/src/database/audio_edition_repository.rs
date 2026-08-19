//! Audio Edition & Listening Session Repository

use crate::error::{PlethoraError, Result};
use crate::models::audio_edition::{
    AudioEdition, AudioEditionAnchor, AudioEditionSection, AudioEditionWithSections,
    ListeningSession, ListeningSessionItem, ListeningSessionItemUpdate,
    ListeningSessionWithItems,
};
use sqlx::{Pool, Sqlite};

#[derive(Clone)]
pub struct AudioEditionRepository {
    pool: Pool<Sqlite>,
}

impl AudioEditionRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    pub async fn create_audio_edition(
        &self,
        edition: &AudioEdition,
        sections: &[AudioEditionSection],
    ) -> Result<AudioEditionWithSections> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to start transaction: {}", e))
        })?;

        let id = if edition.id.trim().is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            edition.id.clone()
        };

        let now = chrono::Utc::now().timestamp_millis();
        let created_at = if edition.created_at > 0 {
            edition.created_at
        } else {
            now
        };
        let updated_at = if edition.updated_at > 0 {
            edition.updated_at
        } else {
            now
        };

        sqlx::query(
            r#"
            INSERT INTO audio_editions (
                id, source_document_id, source_revision_hash, provider, model, voice,
                quality_preset, generation_settings, total_duration_sec, status,
                created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
        )
        .bind(&id)
        .bind(&edition.source_document_id)
        .bind(&edition.source_revision_hash)
        .bind(&edition.provider)
        .bind(&edition.model)
        .bind(&edition.voice)
        .bind(&edition.quality_preset)
        .bind(&edition.generation_settings)
        .bind(edition.total_duration_sec)
        .bind(&edition.status)
        .bind(created_at)
        .bind(updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to insert audio edition: {}", e)))?;

        let mut inserted_sections = Vec::with_capacity(sections.len());
        for (i, sec) in sections.iter().enumerate() {
            let sec_id = if sec.id.trim().is_empty() {
                uuid::Uuid::new_v4().to_string()
            } else {
                sec.id.clone()
            };
            let sec_idx = if sec.section_index >= 0 {
                sec.section_index
            } else {
                i as i32
            };

            sqlx::query(
                r#"
                INSERT INTO audio_edition_sections (
                    id, edition_id, section_index, title, source_section_id,
                    source_start_anchor, source_end_anchor, character_count,
                    audio_file_path, audio_mime_type, duration_sec, generation_status,
                    failure_reason, retry_count, cache_key, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                "#,
            )
            .bind(&sec_id)
            .bind(&id)
            .bind(sec_idx)
            .bind(&sec.title)
            .bind(&sec.source_section_id)
            .bind(&sec.source_start_anchor)
            .bind(&sec.source_end_anchor)
            .bind(sec.character_count)
            .bind(&sec.audio_file_path)
            .bind(&sec.audio_mime_type)
            .bind(sec.duration_sec)
            .bind(&sec.generation_status)
            .bind(&sec.failure_reason)
            .bind(sec.retry_count)
            .bind(&sec.cache_key)
            .bind(created_at)
            .bind(updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to insert section: {}", e)))?;

            inserted_sections.push(AudioEditionSection {
                id: sec_id,
                edition_id: id.clone(),
                section_index: sec_idx,
                title: sec.title.clone(),
                source_section_id: sec.source_section_id.clone(),
                source_start_anchor: sec.source_start_anchor.clone(),
                source_end_anchor: sec.source_end_anchor.clone(),
                character_count: sec.character_count,
                audio_file_path: sec.audio_file_path.clone(),
                audio_mime_type: sec.audio_mime_type.clone(),
                duration_sec: sec.duration_sec,
                generation_status: sec.generation_status.clone(),
                failure_reason: sec.failure_reason.clone(),
                retry_count: sec.retry_count,
                cache_key: sec.cache_key.clone(),
                created_at,
                updated_at,
            });
        }

        tx.commit().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to commit transaction: {}", e))
        })?;

        Ok(AudioEditionWithSections {
            edition: AudioEdition {
                id,
                source_document_id: edition.source_document_id.clone(),
                source_revision_hash: edition.source_revision_hash.clone(),
                provider: edition.provider.clone(),
                model: edition.model.clone(),
                voice: edition.voice.clone(),
                quality_preset: edition.quality_preset.clone(),
                generation_settings: edition.generation_settings.clone(),
                total_duration_sec: edition.total_duration_sec,
                status: edition.status.clone(),
                created_at,
                updated_at,
            },
            sections: inserted_sections,
        })
    }

    pub async fn get_audio_edition(&self, id: &str) -> Result<Option<AudioEditionWithSections>> {
        let edition: Option<AudioEdition> = sqlx::query_as(
            r#"
            SELECT id, source_document_id, source_revision_hash, provider, model, voice,
                   quality_preset, generation_settings, total_duration_sec, status,
                   created_at, updated_at
            FROM audio_editions
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch audio edition: {}", e)))?;

        let Some(edition) = edition else {
            return Ok(None);
        };

        let sections: Vec<AudioEditionSection> = sqlx::query_as(
            r#"
            SELECT id, edition_id, section_index, title, source_section_id,
                   source_start_anchor, source_end_anchor, character_count,
                   audio_file_path, audio_mime_type, duration_sec, generation_status,
                   failure_reason, retry_count, cache_key, created_at, updated_at
            FROM audio_edition_sections
            WHERE edition_id = ?1
            ORDER BY section_index ASC
            "#,
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch sections: {}", e)))?;

        Ok(Some(AudioEditionWithSections { edition, sections }))
    }

    pub async fn get_audio_edition_by_document(
        &self,
        document_id: &str,
    ) -> Result<Option<AudioEditionWithSections>> {
        let edition: Option<AudioEdition> = sqlx::query_as(
            r#"
            SELECT id, source_document_id, source_revision_hash, provider, model, voice,
                   quality_preset, generation_settings, total_duration_sec, status,
                   created_at, updated_at
            FROM audio_editions
            WHERE source_document_id = ?1
            ORDER BY created_at DESC
            LIMIT 1
            "#,
        )
        .bind(document_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch audio edition by doc: {}", e)))?;

        let Some(edition) = edition else {
            return Ok(None);
        };

        let sections: Vec<AudioEditionSection> = sqlx::query_as(
            r#"
            SELECT id, edition_id, section_index, title, source_section_id,
                   source_start_anchor, source_end_anchor, character_count,
                   audio_file_path, audio_mime_type, duration_sec, generation_status,
                   failure_reason, retry_count, cache_key, created_at, updated_at
            FROM audio_edition_sections
            WHERE edition_id = ?1
            ORDER BY section_index ASC
            "#,
        )
        .bind(&edition.id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch sections: {}", e)))?;

        Ok(Some(AudioEditionWithSections { edition, sections }))
    }

    pub async fn list_audio_editions(&self) -> Result<Vec<AudioEditionWithSections>> {
        let editions: Vec<AudioEdition> = sqlx::query_as(
            r#"
            SELECT id, source_document_id, source_revision_hash, provider, model, voice,
                   quality_preset, generation_settings, total_duration_sec, status,
                   created_at, updated_at
            FROM audio_editions
            ORDER BY updated_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to list audio editions: {}", e)))?;

        let mut result = Vec::with_capacity(editions.len());
        for edition in editions {
            let sections: Vec<AudioEditionSection> = sqlx::query_as(
                r#"
                SELECT id, edition_id, section_index, title, source_section_id,
                       source_start_anchor, source_end_anchor, character_count,
                       audio_file_path, audio_mime_type, duration_sec, generation_status,
                       failure_reason, retry_count, cache_key, created_at, updated_at
                FROM audio_edition_sections
                WHERE edition_id = ?1
                ORDER BY section_index ASC
                "#,
            )
            .bind(&edition.id)
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default();

            result.push(AudioEditionWithSections { edition, sections });
        }

        Ok(result)
    }

    pub async fn update_audio_edition_status(
        &self,
        id: &str,
        status: &str,
        total_duration_sec: Option<f64>,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        if let Some(duration) = total_duration_sec {
            sqlx::query(
                r#"
                UPDATE audio_editions
                SET status = ?1, total_duration_sec = ?2, updated_at = ?3
                WHERE id = ?4
                "#,
            )
            .bind(status)
            .bind(duration)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to update audio edition: {}", e)))?;
        } else {
            sqlx::query(
                r#"
                UPDATE audio_editions
                SET status = ?1, updated_at = ?2
                WHERE id = ?3
                "#,
            )
            .bind(status)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to update audio edition: {}", e)))?;
        }
        Ok(())
    }

    pub async fn delete_audio_edition(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM audio_editions WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to delete audio edition: {}", e)))?;
        Ok(())
    }

    pub async fn get_audio_edition_section(&self, id: &str) -> Result<Option<AudioEditionSection>> {
        let sec: Option<AudioEditionSection> = sqlx::query_as(
            r#"
            SELECT id, edition_id, section_index, title, source_section_id,
                   source_start_anchor, source_end_anchor, character_count,
                   audio_file_path, audio_mime_type, duration_sec, generation_status,
                   failure_reason, retry_count, cache_key, created_at, updated_at
            FROM audio_edition_sections
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch section: {}", e)))?;

        Ok(sec)
    }

    pub async fn get_audio_edition_sections(
        &self,
        edition_id: &str,
    ) -> Result<Vec<AudioEditionSection>> {
        let sections: Vec<AudioEditionSection> = sqlx::query_as(
            r#"
            SELECT id, edition_id, section_index, title, source_section_id,
                   source_start_anchor, source_end_anchor, character_count,
                   audio_file_path, audio_mime_type, duration_sec, generation_status,
                   failure_reason, retry_count, cache_key, created_at, updated_at
            FROM audio_edition_sections
            WHERE edition_id = ?1
            ORDER BY section_index ASC
            "#,
        )
        .bind(edition_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch sections: {}", e)))?;

        Ok(sections)
    }

    pub async fn update_audio_edition_section_status(
        &self,
        id: &str,
        generation_status: &str,
        audio_file_path: Option<String>,
        duration_sec: Option<f64>,
        failure_reason: Option<String>,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let dur = duration_sec.unwrap_or(0.0);
        sqlx::query(
            r#"
            UPDATE audio_edition_sections
            SET generation_status = ?1,
                audio_file_path = COALESCE(?2, audio_file_path),
                duration_sec = CASE WHEN ?3 > 0.0 THEN ?3 ELSE duration_sec END,
                failure_reason = ?4,
                updated_at = ?5
            WHERE id = ?6
            "#,
        )
        .bind(generation_status)
        .bind(audio_file_path)
        .bind(dur)
        .bind(failure_reason)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to update section status: {}", e)))?;
        Ok(())
    }

    pub async fn save_audio_edition_anchors(
        &self,
        section_id: &str,
        anchors: &[AudioEditionAnchor],
    ) -> Result<()> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to start transaction: {}", e))
        })?;

        // Clear existing anchors for this section
        sqlx::query("DELETE FROM audio_edition_anchors WHERE section_id = ?1")
            .bind(section_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to clear old anchors: {}", e)))?;

        for anchor in anchors {
            let anchor_id = if anchor.id.trim().is_empty() {
                uuid::Uuid::new_v4().to_string()
            } else {
                anchor.id.clone()
            };

            sqlx::query(
                r#"
                INSERT INTO audio_edition_anchors (
                    id, section_id, audio_start_sec, audio_end_sec,
                    source_start_anchor, source_end_anchor, text_content
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
            )
            .bind(&anchor_id)
            .bind(section_id)
            .bind(anchor.audio_start_sec)
            .bind(anchor.audio_end_sec)
            .bind(&anchor.source_start_anchor)
            .bind(&anchor.source_end_anchor)
            .bind(&anchor.text_content)
            .execute(&mut *tx)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to insert anchor: {}", e)))?;
        }

        tx.commit().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to commit anchor transaction: {}", e))
        })?;

        Ok(())
    }

    pub async fn get_audio_edition_anchors(
        &self,
        section_id: &str,
    ) -> Result<Vec<AudioEditionAnchor>> {
        let anchors: Vec<AudioEditionAnchor> = sqlx::query_as(
            r#"
            SELECT id, section_id, audio_start_sec, audio_end_sec,
                   source_start_anchor, source_end_anchor, text_content
            FROM audio_edition_anchors
            WHERE section_id = ?1
            ORDER BY audio_start_sec ASC
            "#,
        )
        .bind(section_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch anchors: {}", e)))?;

        Ok(anchors)
    }

    pub async fn get_anchors_for_edition(
        &self,
        edition_id: &str,
    ) -> Result<Vec<AudioEditionAnchor>> {
        let anchors: Vec<AudioEditionAnchor> = sqlx::query_as(
            r#"
            SELECT a.id, a.section_id, a.audio_start_sec, a.audio_end_sec,
                   a.source_start_anchor, a.source_end_anchor, a.text_content
            FROM audio_edition_anchors a
            JOIN audio_edition_sections s ON a.section_id = s.id
            WHERE s.edition_id = ?1
            ORDER BY s.section_index ASC, a.audio_start_sec ASC
            "#,
        )
        .bind(edition_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch edition anchors: {}", e)))?;

        Ok(anchors)
    }

    pub async fn find_anchor_by_audio_time(
        &self,
        section_id: &str,
        timestamp_sec: f64,
    ) -> Result<Option<AudioEditionAnchor>> {
        let anchor: Option<AudioEditionAnchor> = sqlx::query_as(
            r#"
            SELECT id, section_id, audio_start_sec, audio_end_sec,
                   source_start_anchor, source_end_anchor, text_content
            FROM audio_edition_anchors
            WHERE section_id = ?1 AND ?2 >= audio_start_sec AND ?2 <= audio_end_sec
            LIMIT 1
            "#,
        )
        .bind(section_id)
        .bind(timestamp_sec)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to lookup anchor by time: {}", e)))?;

        Ok(anchor)
    }

    pub async fn find_anchor_by_source(
        &self,
        edition_id: &str,
        source_anchor: &str,
    ) -> Result<Option<AudioEditionAnchor>> {
        // Source anchors are numeric character offsets on the TS side; stored
        // as TEXT they would compare lexicographically ("9" > "80"), so cast
        // both sides to REAL before matching. Non-numeric anchor schemes
        // (e.g. EPUB CFI) still get the exact equality checks.
        let anchor: Option<AudioEditionAnchor> = sqlx::query_as(
            r#"
            SELECT a.id, a.section_id, a.audio_start_sec, a.audio_end_sec,
                   a.source_start_anchor, a.source_end_anchor, a.text_content
            FROM audio_edition_anchors a
            JOIN audio_edition_sections s ON a.section_id = s.id
            WHERE s.edition_id = ?1 AND (
                a.source_start_anchor = ?2 OR
                a.source_end_anchor = ?2 OR
                (
                    a.source_start_anchor NOT GLOB '*[^0-9.]*'
                    AND a.source_start_anchor != ''
                    AND a.source_end_anchor NOT GLOB '*[^0-9.]*'
                    AND a.source_end_anchor != ''
                    AND ?2 NOT GLOB '*[^0-9.]*'
                    AND ?2 != ''
                    AND CAST(?2 AS REAL) BETWEEN CAST(a.source_start_anchor AS REAL)
                                             AND CAST(a.source_end_anchor AS REAL)
                )
            )
            ORDER BY a.audio_start_sec ASC
            LIMIT 1
            "#,
        )
        .bind(edition_id)
        .bind(source_anchor)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to lookup anchor by source: {}", e)))?;

        Ok(anchor)
    }

    // --- Listening Sessions ---

    pub async fn create_listening_session(
        &self,
        session: &ListeningSession,
    ) -> Result<ListeningSession> {
        let id = if session.id.trim().is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            session.id.clone()
        };

        let started_at = if session.started_at > 0 {
            session.started_at
        } else {
            chrono::Utc::now().timestamp_millis()
        };

        sqlx::query(
            r#"
            INSERT INTO listening_sessions (
                id, edition_id, started_at, ended_at, duration_seconds, extract_count, is_reviewed
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
        )
        .bind(&id)
        .bind(&session.edition_id)
        .bind(started_at)
        .bind(session.ended_at)
        .bind(session.duration_seconds)
        .bind(session.extract_count)
        .bind(session.is_reviewed)
        .execute(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to insert listening session: {}", e)))?;

        Ok(ListeningSession {
            id,
            edition_id: session.edition_id.clone(),
            started_at,
            ended_at: session.ended_at,
            duration_seconds: session.duration_seconds,
            extract_count: session.extract_count,
            is_reviewed: session.is_reviewed,
        })
    }

    pub async fn get_listening_session(&self, id: &str) -> Result<Option<ListeningSessionWithItems>> {
        let session: Option<ListeningSession> = sqlx::query_as(
            r#"
            SELECT id, edition_id, started_at, ended_at, duration_seconds, extract_count, is_reviewed
            FROM listening_sessions
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch listening session: {}", e)))?;

        let Some(session) = session else {
            return Ok(None);
        };

        let items: Vec<ListeningSessionItem> = sqlx::query_as(
            r#"
            SELECT id, session_id, extract_id, marker_type, audio_timestamp, source_anchor, snippet_text, note, created_at
            FROM listening_session_items
            WHERE session_id = ?1
            ORDER BY created_at ASC
            "#,
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch session items: {}", e)))?;

        Ok(Some(ListeningSessionWithItems { session, items }))
    }

    pub async fn get_active_listening_session(
        &self,
        edition_id: &str,
    ) -> Result<Option<ListeningSessionWithItems>> {
        let session: Option<ListeningSession> = sqlx::query_as(
            r#"
            SELECT id, edition_id, started_at, ended_at, duration_seconds, extract_count, is_reviewed
            FROM listening_sessions
            WHERE edition_id = ?1 AND ended_at IS NULL
            ORDER BY started_at DESC
            LIMIT 1
            "#,
        )
        .bind(edition_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch active session: {}", e)))?;

        let Some(session) = session else {
            return Ok(None);
        };

        let items: Vec<ListeningSessionItem> = sqlx::query_as(
            r#"
            SELECT id, session_id, extract_id, marker_type, audio_timestamp, source_anchor, snippet_text, note, created_at
            FROM listening_session_items
            WHERE session_id = ?1
            ORDER BY created_at ASC
            "#,
        )
        .bind(&session.id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch session items: {}", e)))?;

        Ok(Some(ListeningSessionWithItems { session, items }))
    }

    pub async fn end_listening_session(
        &self,
        id: &str,
        ended_at: i64,
        duration_seconds: i32,
        extract_count: i32,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE listening_sessions
            SET ended_at = ?1, duration_seconds = ?2, extract_count = ?3
            WHERE id = ?4
            "#,
        )
        .bind(ended_at)
        .bind(duration_seconds)
        .bind(extract_count)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to end listening session: {}", e)))?;
        Ok(())
    }

    pub async fn mark_listening_session_reviewed(&self, id: &str, is_reviewed: bool) -> Result<()> {
        sqlx::query("UPDATE listening_sessions SET is_reviewed = ?1 WHERE id = ?2")
            .bind(if is_reviewed { 1 } else { 0 })
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to mark session reviewed: {}", e)))?;
        Ok(())
    }

    pub async fn list_unreviewed_listening_sessions(
        &self,
    ) -> Result<Vec<ListeningSessionWithItems>> {
        let sessions: Vec<ListeningSession> = sqlx::query_as(
            r#"
            SELECT id, edition_id, started_at, ended_at, duration_seconds, extract_count, is_reviewed
            FROM listening_sessions
            WHERE is_reviewed = 0 AND extract_count > 0
            ORDER BY started_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to list unreviewed sessions: {}", e)))?;

        let mut result = Vec::with_capacity(sessions.len());
        for session in sessions {
            let items: Vec<ListeningSessionItem> = sqlx::query_as(
                r#"
                SELECT id, session_id, extract_id, marker_type, audio_timestamp, source_anchor, snippet_text, note, created_at
                FROM listening_session_items
                WHERE session_id = ?1
                ORDER BY created_at ASC
                "#,
            )
            .bind(&session.id)
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default();

            result.push(ListeningSessionWithItems { session, items });
        }

        Ok(result)
    }

    /// List listening sessions, optionally filtered to unreviewed ones with
    /// captures. `unreviewed_only = false` returns every session (newest
    /// first) so the Inbox/history can show reviewed sessions too.
    pub async fn list_listening_sessions(
        &self,
        unreviewed_only: bool,
    ) -> Result<Vec<ListeningSessionWithItems>> {
        if unreviewed_only {
            return self.list_unreviewed_listening_sessions().await;
        }

        let sessions: Vec<ListeningSession> = sqlx::query_as(
            r#"
            SELECT id, edition_id, started_at, ended_at, duration_seconds, extract_count, is_reviewed
            FROM listening_sessions
            ORDER BY started_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to list listening sessions: {}", e)))?;

        let mut result = Vec::with_capacity(sessions.len());
        for session in sessions {
            let items: Vec<ListeningSessionItem> = sqlx::query_as(
                r#"
                SELECT id, session_id, extract_id, marker_type, audio_timestamp, source_anchor, snippet_text, note, created_at
                FROM listening_session_items
                WHERE session_id = ?1
                ORDER BY created_at ASC
                "#,
            )
            .bind(&session.id)
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default();

            result.push(ListeningSessionWithItems { session, items });
        }

        Ok(result)
    }

    /// marker_type values allowed by the schema CHECK — validated at the
    /// application level so invalid input surfaces as a typed
    /// `InvalidInput` error instead of a generic SQLite constraint failure.
    const VALID_MARKER_TYPES: [&str; 4] = ["extract", "bookmark", "interesting", "confusing"];

    pub async fn add_listening_session_item(
        &self,
        item: &ListeningSessionItem,
    ) -> Result<ListeningSessionItem> {
        if !Self::VALID_MARKER_TYPES.contains(&item.marker_type.as_str()) {
            return Err(PlethoraError::InvalidInput(format!(
                "Invalid marker_type '{}'; expected one of {:?}",
                item.marker_type, Self::VALID_MARKER_TYPES
            )));
        }

        let id = if item.id.trim().is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            item.id.clone()
        };

        let now = chrono::Utc::now().timestamp_millis();
        let created_at = if item.created_at > 0 {
            item.created_at
        } else {
            now
        };

        sqlx::query(
            r#"
            INSERT INTO listening_session_items (
                id, session_id, extract_id, marker_type, audio_timestamp,
                source_anchor, snippet_text, note, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
        )
        .bind(&id)
        .bind(&item.session_id)
        .bind(&item.extract_id)
        .bind(&item.marker_type)
        .bind(item.audio_timestamp)
        .bind(&item.source_anchor)
        .bind(&item.snippet_text)
        .bind(&item.note)
        .bind(created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to insert session item: {}", e)))?;

        // extract_count counts only actual extracts (design Decision 10) —
        // bookmarks/markers are itemized but do not inflate the count.
        if item.marker_type == "extract" {
            let _ = sqlx::query(
                "UPDATE listening_sessions SET extract_count = extract_count + 1 WHERE id = ?1",
            )
            .bind(&item.session_id)
            .execute(&self.pool)
            .await;
        }

        Ok(ListeningSessionItem {
            id,
            session_id: item.session_id.clone(),
            extract_id: item.extract_id.clone(),
            marker_type: item.marker_type.clone(),
            audio_timestamp: item.audio_timestamp,
            source_anchor: item.source_anchor.clone(),
            snippet_text: item.snippet_text.clone(),
            note: item.note.clone(),
            created_at,
        })
    }

    pub async fn get_listening_session_items(
        &self,
        session_id: &str,
    ) -> Result<Vec<ListeningSessionItem>> {
        let items: Vec<ListeningSessionItem> = sqlx::query_as(
            r#"
            SELECT id, session_id, extract_id, marker_type, audio_timestamp, source_anchor, snippet_text, note, created_at
            FROM listening_session_items
            WHERE session_id = ?1
            ORDER BY created_at ASC
            "#,
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch session items: {}", e)))?;

        Ok(items)
    }

    /// Apply a partial update to a session item. Returns the updated item, or
    /// `NotFound` when the id does not exist. marker_type is validated so the
    /// schema CHECK never surfaces as a generic SQLite error.
    pub async fn update_listening_session_item(
        &self,
        id: &str,
        updates: &ListeningSessionItemUpdate,
    ) -> Result<ListeningSessionItem> {
        if let Some(marker_type) = &updates.marker_type {
            if !Self::VALID_MARKER_TYPES.contains(&marker_type.as_str()) {
                return Err(PlethoraError::InvalidInput(format!(
                    "Invalid marker_type '{}'; expected one of {:?}",
                    marker_type, Self::VALID_MARKER_TYPES
                )));
            }
        }

        let existing: Option<ListeningSessionItem> = sqlx::query_as(
            r#"
            SELECT id, session_id, extract_id, marker_type, audio_timestamp, source_anchor, snippet_text, note, created_at
            FROM listening_session_items
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch session item: {}", e)))?;

        let Some(existing) = existing else {
            return Err(PlethoraError::NotFound(format!(
                "Listening session item '{}' not found",
                id
            )));
        };

        let merged = ListeningSessionItem {
            id: existing.id.clone(),
            session_id: existing.session_id.clone(),
            extract_id: updates
                .extract_id
                .clone()
                .unwrap_or_else(|| existing.extract_id.clone()),
            marker_type: updates
                .marker_type
                .clone()
                .unwrap_or_else(|| existing.marker_type.clone()),
            audio_timestamp: updates.audio_timestamp.unwrap_or(existing.audio_timestamp),
            source_anchor: updates
                .source_anchor
                .clone()
                .unwrap_or_else(|| existing.source_anchor.clone()),
            snippet_text: updates
                .snippet_text
                .clone()
                .unwrap_or_else(|| existing.snippet_text.clone()),
            note: updates.note.clone().unwrap_or_else(|| existing.note.clone()),
            created_at: existing.created_at,
        };

        sqlx::query(
            r#"
            UPDATE listening_session_items
            SET extract_id = ?2, marker_type = ?3, audio_timestamp = ?4,
                source_anchor = ?5, snippet_text = ?6, note = ?7
            WHERE id = ?1
            "#,
        )
        .bind(&merged.id)
        .bind(&merged.extract_id)
        .bind(&merged.marker_type)
        .bind(merged.audio_timestamp)
        .bind(&merged.source_anchor)
        .bind(&merged.snippet_text)
        .bind(&merged.note)
        .execute(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to update session item: {}", e)))?;

        // Keep extract_count consistent when the item's extract-ness changed
        // (extract ↔ marker transitions during triage).
        let was_extract = existing.marker_type == "extract";
        let now_extract = merged.marker_type == "extract";
        if was_extract && !now_extract {
            let _ = sqlx::query(
                "UPDATE listening_sessions SET extract_count = MAX(extract_count - 1, 0) WHERE id = ?1",
            )
            .bind(&merged.session_id)
            .execute(&self.pool)
            .await;
        } else if !was_extract && now_extract {
            let _ = sqlx::query(
                "UPDATE listening_sessions SET extract_count = extract_count + 1 WHERE id = ?1",
            )
            .bind(&merged.session_id)
            .execute(&self.pool)
            .await;
        }

        Ok(merged)
    }

    pub async fn delete_listening_session_item(&self, id: &str) -> Result<()> {
        // extract_count must stay consistent: decrement only when the deleted
        // item was an actual extract.
        let existing: Option<(String, String)> = sqlx::query_as(
            "SELECT session_id, marker_type FROM listening_session_items WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to fetch session item: {}", e)))?;

        sqlx::query("DELETE FROM listening_session_items WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to delete session item: {}", e)))?;

        if let Some((session_id, marker_type)) = existing {
            if marker_type == "extract" {
                let _ = sqlx::query(
                    "UPDATE listening_sessions SET extract_count = MAX(extract_count - 1, 0) WHERE id = ?1",
                )
                .bind(&session_id)
                .execute(&self.pool)
                .await;
            }
        }

        Ok(())
    }
}
