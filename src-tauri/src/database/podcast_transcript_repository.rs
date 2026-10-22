use super::Repository;
use crate::commands::podcast::{PodcastTranscriptResponse, TranscriptSegmentInfo};
use crate::error::{PlethoraError, Result};
use sqlx::Row;

impl Repository {
    pub async fn resolve_document_transcript_id(
        &self,
        book_id: &str,
        chapter_id: &str,
    ) -> Result<Option<(i64, String)>> {
        Ok(sqlx::query_as("SELECT id, status FROM transcripts WHERE book_id = ? AND (chapter_id = ? OR (? = ? AND status = 'completed')) ORDER BY (chapter_id = ?) DESC, updated_at DESC, id DESC LIMIT 1")
            .bind(book_id)
            .bind(chapter_id)
            .bind(chapter_id)
            .bind(book_id)
            .bind(chapter_id)
            .fetch_optional(self.pool())
            .await?)
    }

    pub async fn resolve_podcast_transcript(
        &self,
        episode_id: &str,
    ) -> Result<PodcastTranscriptResponse> {
        let episode = sqlx::query("SELECT transcript_text, transcript_status, duration FROM podcast_episodes WHERE id = ?")
            .bind(episode_id)
            .fetch_optional(self.pool())
            .await?
            .ok_or_else(|| PlethoraError::NotFound(format!("Podcast episode {}", episode_id)))?;
        let text: Option<String> = episode.try_get("transcript_text")?;
        let status: String = episode.try_get("transcript_status")?;
        let mut segments = self
            .get_podcast_transcript_segments_with_words(episode_id)
            .await?;
        let text = text
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                segments
                    .iter()
                    .map(|segment| segment.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            });
        if !text.trim().is_empty()
            && !matches!(
                status.as_str(),
                "downloading" | "transcribing" | "processing" | "error"
            )
        {
            if segments.is_empty() {
                segments.push(TranscriptSegmentInfo {
                    start_ms: 0,
                    end_ms: 0,
                    text: text.clone(),
                    word_timings_json: None,
                });
            }
            return Ok(PodcastTranscriptResponse {
                text,
                segments,
                status: "done".into(),
                progress: None,
            });
        }

        let source = format!("podcast:{}", episode_id);
        let completed = sqlx::query(
            "SELECT t.id FROM transcripts t JOIN documents d ON d.id = t.book_id
             WHERE json_extract(CASE WHEN json_valid(d.metadata) THEN d.metadata ELSE '{}' END, '$.source') = ?
             AND t.status = 'completed'
             AND EXISTS (SELECT 1 FROM transcript_segments s WHERE s.transcript_id = t.id AND trim(s.text) <> '')
             ORDER BY EXISTS (SELECT 1 FROM transcription_queue q WHERE q.document_id = d.id
                 AND COALESCE(q.chapter_id, q.document_id) = t.chapter_id AND q.status = 'completed') DESC,
                 t.updated_at DESC, t.id DESC LIMIT 1",
        ).bind(&source).fetch_optional(self.pool()).await?;
        if let Some(transcript) = completed {
            let transcript_id: i64 = transcript.try_get("id")?;
            let rows = sqlx::query("SELECT COALESCE(start_ms, 0) AS start_ms, COALESCE(end_ms, 0) AS end_ms, text, words_json FROM transcript_segments WHERE transcript_id = ? ORDER BY start_ms, id")
                .bind(transcript_id).fetch_all(self.pool()).await?;
            let segments = rows
                .into_iter()
                .map(|row| {
                    Ok(TranscriptSegmentInfo {
                        start_ms: row.try_get("start_ms")?,
                        end_ms: row.try_get("end_ms")?,
                        text: row.try_get("text")?,
                        word_timings_json: row.try_get("words_json")?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            let text = segments
                .iter()
                .map(|segment| segment.text.trim())
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            return Ok(PodcastTranscriptResponse {
                text,
                segments,
                status: "done".into(),
                progress: None,
            });
        }

        if matches!(
            status.as_str(),
            "pending" | "downloading" | "transcribing" | "processing"
        ) {
            return Ok(PodcastTranscriptResponse {
                text,
                segments,
                status,
                progress: None,
            });
        }

        let queue = sqlx::query(
            "SELECT q.status, q.progress FROM transcription_queue q JOIN documents d ON d.id = q.document_id
             WHERE json_extract(CASE WHEN json_valid(d.metadata) THEN d.metadata ELSE '{}' END, '$.source') = ?
             ORDER BY CASE WHEN q.status IN ('pending', 'processing') THEN 0 ELSE 1 END,
                 q.created_at DESC, q.id DESC LIMIT 1",
        ).bind(&source).fetch_optional(self.pool()).await?;
        let (resolved_status, progress) = match queue {
            Some(row) => {
                let queue_status: String = row.try_get("status")?;
                let progress: i32 = row.try_get("progress")?;
                match queue_status.as_str() {
                    "pending" => ("pending".to_string(), Some(progress)),
                    "processing" => ("transcribing".to_string(), Some(progress)),
                    "completed" => ("unavailable".to_string(), None),
                    _ => ("error".to_string(), None),
                }
            }
            None => {
                let has_saved_row: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM transcripts t JOIN documents d ON d.id = t.book_id
                     WHERE json_extract(CASE WHEN json_valid(d.metadata) THEN d.metadata ELSE '{}' END, '$.source') = ?)",
                ).bind(&source).fetch_one(self.pool()).await?;
                let status = if has_saved_row || status == "done" || status == "completed" {
                    "unavailable".to_string()
                } else {
                    status
                };
                (status, None)
            }
        };
        Ok(PodcastTranscriptResponse {
            text,
            segments,
            status: resolved_status,
            progress,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn fixture() -> Repository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        fixture_in(pool).await
    }

    async fn fixture_in(pool: sqlx::SqlitePool) -> Repository {
        sqlx::raw_sql(
            r#"CREATE TABLE podcast_episodes (id TEXT PRIMARY KEY, transcript_text TEXT, transcript_status TEXT, duration INTEGER);
             CREATE TABLE podcast_transcript_segments (episode_id TEXT, start_ms INTEGER, end_ms INTEGER, text TEXT, word_timings_json TEXT);
             CREATE TABLE documents (id TEXT PRIMARY KEY, metadata TEXT);
             CREATE TABLE transcripts (id INTEGER PRIMARY KEY, book_id TEXT, chapter_id TEXT, status TEXT, updated_at TEXT);
             CREATE TABLE transcript_segments (id INTEGER PRIMARY KEY, transcript_id INTEGER, start_ms INTEGER, end_ms INTEGER, text TEXT, words_json TEXT);
             CREATE TABLE transcription_queue (id TEXT, document_id TEXT, chapter_id TEXT, status TEXT, progress INTEGER, created_at TEXT);
             INSERT INTO podcast_episodes VALUES ('episode', NULL, 'none', 60);
             INSERT INTO documents VALUES ('document', '{"source":"podcast:episode"}');
             INSERT INTO transcripts VALUES (1, 'document', 'saved-chapter', 'completed', '2026-10-22');
             INSERT INTO transcript_segments VALUES (1, 1, 1200, 2400, 'Saved words', '[{"word":"Saved","start_ms":1200,"end_ms":1800}]');
             INSERT INTO transcription_queue VALUES ('job', 'document', 'saved-chapter', 'completed', 100, '2026-10-22');"#,
        ).execute(&pool).await.unwrap();
        Repository::new(pool)
    }

    #[tokio::test]
    async fn podcast_transcript_reuses_document_segments_after_queue_cleanup() {
        let directory = tempfile::tempdir().unwrap();
        let url = format!(
            "sqlite://{}?mode=rwc",
            directory.path().join("transcripts.sqlite").display()
        );
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        let repo = fixture_in(pool).await;
        let episode_only_text: Option<String> =
            sqlx::query_scalar("SELECT transcript_text FROM podcast_episodes WHERE id = 'episode'")
                .fetch_one(repo.pool())
                .await
                .unwrap();
        assert!(episode_only_text.is_none());
        let saved = repo.resolve_podcast_transcript("episode").await.unwrap();
        assert_eq!(saved.status, "done");
        assert_eq!(saved.text, "Saved words");
        assert_eq!(saved.segments[0].start_ms, 1200);
        assert!(saved.segments[0]
            .word_timings_json
            .as_ref()
            .unwrap()
            .contains("Saved"));
        sqlx::query("DELETE FROM transcription_queue")
            .execute(repo.pool())
            .await
            .unwrap();
        repo.pool().close().await;
        let reopened = Repository::new(
            SqlitePoolOptions::new()
                .max_connections(1)
                .connect(&url)
                .await
                .unwrap(),
        );
        assert_eq!(
            reopened
                .resolve_podcast_transcript("episode")
                .await
                .unwrap()
                .text,
            saved.text
        );
    }

    #[tokio::test]
    async fn podcast_transcript_preserves_episode_result_over_partial_document() {
        let repo = fixture().await;
        sqlx::raw_sql("UPDATE podcast_episodes SET transcript_text = 'Existing episode', transcript_status = 'done'; UPDATE transcripts SET status = 'processing';")
            .execute(repo.pool()).await.unwrap();
        let saved = repo.resolve_podcast_transcript("episode").await.unwrap();
        assert_eq!(saved.text, "Existing episode");
        assert_eq!(saved.segments[0].end_ms, 0);
    }

    #[tokio::test]
    async fn podcast_transcript_resolves_active_and_inconsistent_jobs() {
        let repo = fixture().await;
        sqlx::query("DELETE FROM transcript_segments")
            .execute(repo.pool())
            .await
            .unwrap();
        assert_eq!(
            repo.resolve_podcast_transcript("episode")
                .await
                .unwrap()
                .status,
            "unavailable"
        );
        sqlx::query("UPDATE transcription_queue SET status = 'processing', progress = 49")
            .execute(repo.pool())
            .await
            .unwrap();
        let active = repo.resolve_podcast_transcript("episode").await.unwrap();
        assert_eq!(active.status, "transcribing");
        assert_eq!(active.progress, Some(49));
        sqlx::raw_sql("UPDATE transcription_queue SET status = 'failed'; UPDATE podcast_episodes SET transcript_status = 'downloading';")
            .execute(repo.pool()).await.unwrap();
        assert_eq!(
            repo.resolve_podcast_transcript("episode")
                .await
                .unwrap()
                .status,
            "downloading"
        );
    }

    #[tokio::test]
    async fn podcast_transcript_does_not_guess_another_episode_identity() {
        let repo = fixture().await;
        sqlx::query("INSERT INTO podcast_episodes VALUES ('other', NULL, 'none', 60)")
            .execute(repo.pool())
            .await
            .unwrap();
        let other = repo.resolve_podcast_transcript("other").await.unwrap();
        assert_eq!(other.status, "none");
        assert!(other.text.is_empty());
    }

    #[tokio::test]
    async fn podcast_transcript_uses_newest_complete_row_without_merging_partial_chapters() {
        let repo = fixture().await;
        sqlx::raw_sql(
            "DELETE FROM transcription_queue;
            INSERT INTO transcripts VALUES (2, 'document', 'new', 'completed', '2026-10-23');
            INSERT INTO transcripts VALUES (3, 'document', 'partial', 'processing', '2026-10-24');
            INSERT INTO transcript_segments VALUES (2, 2, 0, 1000, 'New complete result', NULL);
            INSERT INTO transcript_segments VALUES (3, 3, 0, 1000, 'Partial result', NULL);",
        )
        .execute(repo.pool())
        .await
        .unwrap();
        assert_eq!(
            repo.resolve_podcast_transcript("episode")
                .await
                .unwrap()
                .text,
            "New complete result"
        );
    }

    #[tokio::test]
    async fn podcast_transcript_propagates_storage_failure() {
        let repo = fixture().await;
        sqlx::query("DROP TABLE transcript_segments")
            .execute(repo.pool())
            .await
            .unwrap();
        assert!(repo.resolve_podcast_transcript("episode").await.is_err());
    }

    #[tokio::test]
    async fn document_transcript_recovers_legacy_chapter_after_queue_cleanup() {
        let repo = fixture().await;
        sqlx::query("DELETE FROM transcription_queue")
            .execute(repo.pool())
            .await
            .unwrap();
        assert_eq!(
            repo.resolve_document_transcript_id("document", "document")
                .await
                .unwrap(),
            Some((1, "completed".into()))
        );
        assert!(repo
            .resolve_document_transcript_id("other", "other")
            .await
            .unwrap()
            .is_none());
        assert!(repo
            .resolve_document_transcript_id("document", "different-chapter")
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            repo.resolve_document_transcript_id("document", "saved-chapter")
                .await
                .unwrap(),
            Some((1, "completed".into()))
        );
    }
}
