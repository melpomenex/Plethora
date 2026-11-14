//! Tauri commands for Study Sources resolution and metadata.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
//! - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T06)

use crate::ai_learning::indexer::ensure_documents_chunks_indexed;
use crate::commands::ai_learning::try_enqueue_document;
use crate::database::{Repository, StudySourceRepository};
use crate::models::{
    EnsureStudySourceResult, StudyCommandError, StudySourceCatalogItem, StudySourceRefInput,
    StudySourceResolution,
};
use tauri::{AppHandle, State};

fn repository(repo: &Repository) -> StudySourceRepository {
    StudySourceRepository::new(repo.pool().clone())
}

#[tauri::command]
pub async fn resolve_study_source_refs(
    input: Vec<StudySourceRefInput>,
    repo: State<'_, Repository>,
) -> Result<Vec<StudySourceResolution>, StudyCommandError> {
    repository(&repo).resolve_study_source_refs(&input).await
}

#[tauri::command]
pub async fn get_study_source_catalog(
    include_archived: Option<bool>,
    repo: State<'_, Repository>,
) -> Result<Vec<StudySourceCatalogItem>, StudyCommandError> {
    repository(&repo)
        .get_study_source_catalog(include_archived.unwrap_or(false))
        .await
}

async fn ensure_podcast_and_index(
    repo: &Repository,
    app: Option<&AppHandle>,
    episode_id: &str,
) -> Result<EnsureStudySourceResult, StudyCommandError> {
    let result = repository(repo)
        .ensure_podcast_episode_document(episode_id)
        .await?;
    if !result.is_ai_excluded {
        let _ =
            ensure_documents_chunks_indexed(repo, std::slice::from_ref(&result.document_id)).await;
        if let Some(app_handle) = app {
            try_enqueue_document(app_handle, &result.document_id);
        }
    }
    Ok(result)
}

async fn ensure_rss_and_index(
    repo: &Repository,
    app: Option<&AppHandle>,
    article_id: &str,
) -> Result<EnsureStudySourceResult, StudyCommandError> {
    let result = repository(repo)
        .ensure_rss_article_document(article_id)
        .await?;
    if !result.is_ai_excluded {
        let _ =
            ensure_documents_chunks_indexed(repo, std::slice::from_ref(&result.document_id)).await;
        if let Some(app_handle) = app {
            try_enqueue_document(app_handle, &result.document_id);
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn ensure_podcast_episode_document(
    episode_id: String,
    app: AppHandle,
    repo: State<'_, Repository>,
) -> Result<EnsureStudySourceResult, StudyCommandError> {
    ensure_podcast_and_index(repo.inner(), Some(&app), &episode_id).await
}

#[tauri::command]
pub async fn ensure_rss_article_document(
    article_id: String,
    app: AppHandle,
    repo: State<'_, Repository>,
) -> Result<EnsureStudySourceResult, StudyCommandError> {
    ensure_rss_and_index(repo.inner(), Some(&app), &article_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use serde_json::json;
    use std::path::PathBuf;

    async fn setup_test_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:"))
            .await
            .expect("memory db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    #[tokio::test]
    async fn test_resolve_study_source_refs_command() {
        let repo = setup_test_repo().await;
        let source_repo = repository(&repo);

        // Seed a document
        sqlx::query(
            r#"INSERT INTO documents (id, title, file_path, file_type, content, content_hash, date_added, date_modified)
               VALUES ('doc_cmd1', 'Command Doc', '/path.pdf', 'pdf', 'Some test content here.', 'hash123', '2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z')"#,
        )
        .execute(repo.pool())
        .await
        .expect("seed doc");

        let input = StudySourceRefInput {
            document_id: "doc_cmd1".to_string(),
            extract_id: None,
            excerpt: "Some test content here.".to_string(),
            excerpt_sha256: None,
            revision: Some("hash123".to_string()),
            revision_kind: None,
            document_title: Some("Command Doc".to_string()),
            source_type: Some("pdf".to_string()),
            jump: Some(json!({"page": 1})),
            chunk: None,
            section_label: None,
        };

        let res = source_repo
            .resolve_study_source_refs(&[input])
            .await
            .expect("resolve");
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].status, crate::models::StudySourceStatus::Current);
    }

    #[tokio::test]
    async fn catalog_reports_honest_readiness_across_source_types() {
        let repo = setup_test_repo().await;
        let source_repo = repository(&repo);

        // 1. Scanned PDF with no extracted text -> NeedsOcr
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, date_added, date_modified)
             VALUES ('doc-scan', 'Scanned Paper', '/scan.pdf', 'pdf', '', '2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .unwrap();

        // 2. YouTube video with cached transcript (linked via video_id) -> Ready
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, date_added, date_modified)
             VALUES ('doc-yt-cached', 'Transformers Video', 'https://youtu.be/dQw4w9WgXcQ', 'youtube', NULL, '2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO youtube_transcripts (id, document_id, video_id, transcript, segments_json, date_created, date_modified)
             VALUES ('yt-1', NULL, 'dQw4w9WgXcQ', 'Attention scales sequence models cleanly.', '[]', '2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .unwrap();

        // 3. Local video without transcript -> NeedsTranscript
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, date_added, date_modified)
             VALUES ('doc-vid-raw', 'Unprocessed Clip', '/clip.mp4', 'video', NULL, '2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .unwrap();

        // 4. AI-excluded doc and Local-only doc
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, is_ai_excluded, date_added, date_modified)
             VALUES ('doc-excl', 'Private Notes', '/priv.md', 'markdown', 'secret text', 1, '2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, is_local_only, date_added, date_modified)
             VALUES ('doc-local', 'On-Device Spec', '/local.md', 'markdown', 'local only spec', 1, '2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .unwrap();

        // 5. Podcast episode (transcribed) and un-transcribed episode
        sqlx::query(
            "INSERT INTO podcast_feeds (id, title, feed_url) VALUES ('pf-1', 'Systems Cast', 'https://example.com/feed.xml')",
        )
        .execute(repo.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO podcast_episodes (id, feed_id, title, audio_url, transcript_text, transcript_status)
             VALUES ('ep-ready', 'pf-1', 'Kernel Episode', 'https://example.com/ep1.mp3', 'Microkernels isolate device drivers cleanly.', 'completed'),
                    ('ep-raw', 'pf-1', 'Untranscribed Episode', 'https://example.com/ep2.mp3', NULL, 'none')",
        )
        .execute(repo.pool())
        .await
        .unwrap();

        // 6. RSS article with HTML body
        sqlx::query(
            "INSERT INTO rss_feeds (id, url, title, date_added) VALUES ('rf-1', 'https://example.com/rss', 'Tech Blog', '2026-11-10T10:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO rss_articles (id, feed_id, url, title, content, date_added)
             VALUES ('rss-1', 'rf-1', 'https://example.com/post-1', 'SQLite WAL Internals', '<p>Write-ahead logging enables concurrent readers.</p>', '2026-11-10T10:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .unwrap();

        let catalog = source_repo
            .get_study_source_catalog(false)
            .await
            .expect("catalog");

        let by_id: std::collections::HashMap<_, _> =
            catalog.iter().map(|i| (i.id.as_str(), i)).collect();

        assert_eq!(
            by_id["doc-scan"].readiness,
            crate::models::StudySourceReadiness::NeedsOcr
        );
        assert_eq!(by_id["doc-scan"].prepare_action.as_deref(), Some("run-ocr"));
        assert_eq!(
            by_id["doc-yt-cached"].readiness,
            crate::models::StudySourceReadiness::Ready
        );
        assert_eq!(
            by_id["doc-vid-raw"].readiness,
            crate::models::StudySourceReadiness::NeedsTranscript
        );
        assert_eq!(
            by_id["doc-excl"].readiness,
            crate::models::StudySourceReadiness::AiExcluded
        );
        assert_eq!(
            by_id["doc-local"].readiness,
            crate::models::StudySourceReadiness::LocalOnly
        );
        assert_eq!(
            by_id["podcast:ep-ready"].readiness,
            crate::models::StudySourceReadiness::Ready
        );
        assert_eq!(
            by_id["podcast:ep-raw"].readiness,
            crate::models::StudySourceReadiness::NeedsTranscript
        );
        assert_eq!(
            by_id["rss:rss-1"].readiness,
            crate::models::StudySourceReadiness::Ready
        );
    }

    #[tokio::test]
    async fn promote_podcast_and_rss_are_idempotent_indexed_and_resolvable() {
        let repo = setup_test_repo().await;
        let source_repo = repository(&repo);

        sqlx::query(
            "INSERT INTO podcast_feeds (id, title, feed_url) VALUES ('pf-2', 'AI Pod', 'https://example.com/ai.xml')",
        )
        .execute(repo.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO podcast_episodes (id, feed_id, title, audio_url, transcript_status)
             VALUES ('ep-seg', 'pf-2', 'Mixture of Experts', 'https://example.com/moe.mp3', 'completed')",
        )
        .execute(repo.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO podcast_transcript_segments (episode_id, segment_index, start_ms, end_ms, text)
             VALUES ('ep-seg', 0, 12000, 18000, 'Routing tokens sparsely reduces FLOPs per forward pass.')",
        )
        .execute(repo.pool())
        .await
        .unwrap();

        let first_pod = ensure_podcast_and_index(&repo, None, "ep-seg")
            .await
            .expect("first promote podcast");
        assert!(first_pod.promoted);
        let second_pod = ensure_podcast_and_index(&repo, None, "ep-seg")
            .await
            .expect("idempotent promote podcast");
        assert!(!second_pod.promoted);
        assert_eq!(first_pod.document_id, second_pod.document_id);

        let chunk_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM semantic_chunks WHERE document_id = ?1")
                .bind(&first_pod.document_id)
                .fetch_one(repo.pool())
                .await
                .unwrap();
        assert!(
            chunk_count >= 1,
            "promoted podcast episode must be chunk-indexed"
        );

        // Resolve excerpt against promoted podcast doc
        let pod_res = source_repo
            .resolve_study_source_refs(&[StudySourceRefInput {
                document_id: first_pod.document_id.clone(),
                extract_id: None,
                excerpt: "Routing tokens sparsely reduces FLOPs per forward pass.".to_string(),
                excerpt_sha256: None,
                revision: Some(first_pod.revision.clone()),
                revision_kind: Some(first_pod.revision_kind.clone()),
                document_title: Some(first_pod.title.clone()),
                source_type: Some("audio".to_string()),
                jump: Some(json!({"kind": "audio", "timeSeconds": 12})),
                chunk: None,
                section_label: None,
            }])
            .await
            .expect("resolve podcast excerpt");
        assert_eq!(pod_res[0].status, crate::models::StudySourceStatus::Current);
        assert_eq!(
            pod_res[0].navigation,
            crate::models::StudySourceNavigation::Exact
        );

        // Now promote RSS article and confirm deduplication in catalog
        sqlx::query(
            "INSERT INTO rss_feeds (id, url, title, date_added) VALUES ('rf-2', 'https://example.com/r2', 'Compiler Blog', '2026-11-10T10:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO rss_articles (id, feed_id, url, title, content, date_added)
             VALUES ('rss-2', 'rf-2', 'https://example.com/ssa', 'Static Single Assignment', '<div><h2>SSA Form</h2><p>Each variable is assigned exactly once in SSA representation.</p></div>', '2026-11-10T10:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .unwrap();

        let first_rss = ensure_rss_and_index(&repo, None, "rss-2")
            .await
            .expect("first promote rss");
        assert!(first_rss.promoted);
        let second_rss = ensure_rss_and_index(&repo, None, "rss-2")
            .await
            .expect("idempotent promote rss");
        assert!(!second_rss.promoted);
        assert_eq!(first_rss.document_id, second_rss.document_id);

        let catalog_after = source_repo.get_study_source_catalog(false).await.unwrap();
        assert!(
            catalog_after
                .iter()
                .all(|c| c.id != "podcast:ep-seg" && c.id != "rss:rss-2"),
            "promoted podcast and rss items should not duplicate unpromoted rows in catalog"
        );
    }
}
