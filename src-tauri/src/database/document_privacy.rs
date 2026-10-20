//! Authoritative source policy shared by sync and session processing.

use super::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::Document;
use crate::sync::types::EntityType;
use sqlx::SqliteConnection;

/// Read on the same transaction/connection as journaling or dispatch.
pub async fn sync_entity_allowed(
    connection: &mut SqliteConnection,
    entity_type: EntityType,
    entity_id: &str,
) -> Result<bool> {
    if !matches!(
        entity_type,
        EntityType::Document
            | EntityType::Extract
            | EntityType::LearningItem
            | EntityType::ReviewResult
            | EntityType::ImageAsset
    ) {
        return Ok(true);
    }
    let blocked: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM private_sync_ownership WHERE entity_type = ?1 AND entity_id = ?2)
         OR EXISTS(SELECT 1 FROM document_sync_ownership o JOIN documents d ON d.id = o.document_id
         WHERE o.entity_type = ?1 AND o.entity_id = ?2 AND d.is_local_only = 1)",
    )
    .bind(entity_type.as_str())
    .bind(entity_id)
    .fetch_one(connection)
    .await?;
    Ok(!blocked)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use crate::models::{Extract, FileType, ItemType, LearningItem};
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
    async fn recording_privacy_survives_repository_restart_and_all_library_projections() {
        let repo = repository().await;
        let mut document = Document::new(
            "Private lecture".into(),
            "capture.wav".into(),
            FileType::Audio,
        );
        document.is_local_only = true;
        document.is_ai_excluded = true;
        repo.create_document(&document).await.unwrap();
        let restarted = Repository::new(repo.pool().clone());
        let loaded = restarted.get_document(&document.id).await.unwrap().unwrap();
        let json = serde_json::to_value(&loaded).unwrap();
        assert_eq!(json["isLocalOnly"], true);
        assert_eq!(json["isAiExcluded"], true);
        assert_eq!(json["privacyVersion"], 1);
        for documents in [
            restarted.list_documents().await.unwrap(),
            restarted.list_documents_summary().await.unwrap(),
            restarted
                .list_documents_by_collection(&document.collection_id)
                .await
                .unwrap(),
            restarted
                .list_documents_summary_by_collection(&document.collection_id)
                .await
                .unwrap(),
            restarted.list_documents_for_queue().await.unwrap(),
        ] {
            assert_eq!(documents.len(), 1);
            assert!(documents[0].is_local_only && documents[0].is_ai_excluded);
        }
        let (page, _) = restarted
            .list_startup_document_summaries(&document.collection_id, 10, 0)
            .await
            .unwrap();
        assert!(page[0].is_local_only && page[0].is_ai_excluded);
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE entity_id = ?1")
                .bind(&document.id)
                .fetch_one(repo.pool())
                .await
                .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn recording_privacy_stale_updates_and_sync_cannot_lower_restrictions() {
        let repo = repository().await;
        let document = Document::new("Lecture".into(), "capture.wav".into(), FileType::Audio);
        repo.create_document(&document).await.unwrap();
        let restricted = repo
            .set_document_privacy(&document.id, true, true, 1)
            .await
            .unwrap();
        assert_eq!(restricted.privacy_version, 2);
        let updated = repo.update_document(&document.id, &document).await.unwrap();
        assert!(updated.is_local_only && updated.is_ai_excluded);
        let mut tx = repo.pool().begin().await.unwrap();
        crate::sync::full_state::upsert_document(&mut tx, &document)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert!(
            repo.get_document(&document.id)
                .await
                .unwrap()
                .unwrap()
                .is_local_only
        );
        assert!(repo
            .set_document_privacy(&document.id, false, false, 1)
            .await
            .is_err());
        let allowed = repo
            .set_document_privacy(&document.id, false, false, 2)
            .await
            .unwrap();
        assert!(!allowed.is_local_only && !allowed.is_ai_excluded);
        assert_eq!(allowed.privacy_version, 3);
    }

    #[tokio::test]
    async fn recording_privacy_revokes_pending_derived_payloads_and_new_journaling() {
        let repo = repository().await;
        let document = Document::new("Lecture".into(), "capture.wav".into(), FileType::Audio);
        repo.create_document(&document).await.unwrap();
        let extract = Extract::new(document.id.clone(), "Source quotation".into());
        repo.create_extract(&extract).await.unwrap();
        let mut card = LearningItem::new(ItemType::Flashcard, "Question?".into());
        card.document_id = Some(document.id.clone());
        card.extract_id = Some(extract.id.clone());
        repo.create_learning_item(&card).await.unwrap();
        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox")
            .fetch_one(repo.pool())
            .await
            .unwrap();
        assert!(before >= 3);
        repo.set_document_privacy(&document.id, true, false, 1)
            .await
            .unwrap();
        let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox")
            .fetch_one(repo.pool())
            .await
            .unwrap();
        assert_eq!(after, 0);
        card.review_count = 1;
        repo.update_learning_item(&card).await.unwrap();
        assert_eq!(
            repo.get_learning_item_by_id(&card.id)
                .await
                .unwrap()
                .unwrap()
                .question,
            card.question
        );
        assert!(crate::sync::outbox::drain_pending_batch(repo.pool(), 100)
            .await
            .unwrap()
            .is_empty());
        assert!(repo
            .ensure_document_ai_allowed(&document.id, false)
            .await
            .is_ok());
        assert!(repo
            .ensure_document_ai_allowed(&document.id, true)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn recording_privacy_metadata_restriction_is_durable_and_blocks_indexing() {
        let repo = repository().await;
        let mut document = Document::new("Lecture".into(), "capture.wav".into(), FileType::Audio);
        document.content = Some("Private source text".into());
        repo.create_document(&document).await.unwrap();
        sqlx::query("INSERT INTO semantic_chunks (id, document_id, source_type, ordinal, text, content_hash) VALUES ('prior', ?1, 'document', 0, 'Private source text', 'hash')")
            .bind(&document.id).execute(repo.pool()).await.unwrap();
        repo.merge_document_metadata(
            &document.id,
            serde_json::json!({"isAiExcluded": true, "isLocalOnly": true}),
        )
        .await
        .unwrap();
        let restricted = repo.get_document(&document.id).await.unwrap().unwrap();
        assert!(restricted.is_local_only && restricted.is_ai_excluded);
        assert!(repo
            .ensure_document_ai_allowed(&document.id, false)
            .await
            .is_err());
        let backend = crate::ai_learning::embeddings_backend::EmbeddingBackend::from_config(None);
        let result = crate::ai_learning::indexer::index_document_once(
            &repo,
            &document.id,
            &backend,
            &mut || true,
        )
        .await;
        assert!(result.is_err());
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM semantic_chunks WHERE document_id = ?1")
                .bind(&document.id)
                .fetch_one(repo.pool())
                .await
                .unwrap();
        assert_eq!(count, 0);
        assert!(sqlx::query("INSERT INTO semantic_chunks (id, document_id, source_type, ordinal, text, content_hash) VALUES ('late', ?1, 'document', 0, 'late chunk', 'hash')")
            .bind(&document.id).execute(repo.pool()).await.is_err());
        // Intentional lowering also clears legacy keys so normalization cannot
        // re-enable an old restriction after restart.
        let allowed = repo
            .set_document_privacy(&document.id, false, false, restricted.privacy_version)
            .await
            .unwrap();
        assert!(!allowed.is_local_only && !allowed.is_ai_excluded);
    }

    #[tokio::test]
    async fn recording_privacy_checks_every_derived_source_and_private_deletion() {
        let repo = repository().await;
        let public = Document::new("Public".into(), "public.wav".into(), FileType::Audio);
        let mut private = Document::new("Private".into(), "private.wav".into(), FileType::Audio);
        private.is_local_only = true;
        repo.create_document(&public).await.unwrap();
        repo.create_document(&private).await.unwrap();
        let extract = Extract::new(private.id.clone(), "Private quote".into());
        repo.create_extract(&extract).await.unwrap();
        let mut card = LearningItem::new(ItemType::Flashcard, "Cross-source question?".into());
        card.document_id = Some(public.id.clone());
        card.extract_id = Some(extract.id.clone());
        repo.create_learning_item(&card).await.unwrap();
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE entity_id = ?1")
                .bind(&card.id)
                .fetch_one(repo.pool())
                .await
                .unwrap();
        assert_eq!(count, 0);
        assert!(!repo
            .card_source_index_allowed(&card.id, &public.id)
            .await
            .unwrap());
        sqlx::query("INSERT INTO semantic_chunks (id, document_id, source_type, source_id, ordinal, text, content_hash) VALUES ('stale-card', ?1, 'card', ?2, 0, 'Private question', 'hash')")
            .bind(&public.id).bind(&card.id).execute(repo.pool()).await.unwrap();
        assert!(repo
            .ensure_index_batch_sources_allowed(&["stale-card".into()], &public.id)
            .await
            .is_err());
        let backend = crate::ai_learning::embeddings_backend::EmbeddingBackend::from_config(None);
        crate::ai_learning::indexer::index_document_once(&repo, &public.id, &backend, &mut || true)
            .await
            .unwrap();
        let chunks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM semantic_chunks WHERE source_id = ?1 AND source_type = 'card'",
        )
        .bind(&card.id)
        .fetch_one(repo.pool())
        .await
        .unwrap();
        assert_eq!(chunks, 0);
        sqlx::query("UPDATE learning_items SET extract_id = NULL WHERE id = ?1")
            .bind(&card.id)
            .execute(repo.pool())
            .await
            .unwrap();
        repo.delete_extract(&extract.id).await.unwrap();
        card.extract_id = None;
        repo.update_learning_item(&card).await.unwrap();
        repo.delete_document(&private.id).await.unwrap();
        let private_deletes: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE entity_id IN (?1, ?2, ?3)")
                .bind(&private.id)
                .bind(&extract.id)
                .bind(&card.id)
                .fetch_one(repo.pool())
                .await
                .unwrap();
        assert_eq!(private_deletes, 0);
    }
}

impl Repository {
    /// Card chunks can include sources beyond the document being indexed.
    pub async fn card_source_index_allowed(
        &self,
        card_id: &str,
        index_document_id: &str,
    ) -> Result<bool> {
        let blocked: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM card_index_restrictions WHERE card_id = ?1
             AND (is_ai_excluded = 1 OR (is_local_only = 1 AND source_document_id != ?2)))",
        )
        .bind(card_id)
        .bind(index_document_id)
        .fetch_one(self.pool())
        .await?;
        Ok(!blocked)
    }

    pub async fn ensure_index_batch_sources_allowed(
        &self,
        chunk_ids: &[String],
        document_id: &str,
    ) -> Result<()> {
        let blocked: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM semantic_chunks c JOIN card_index_restrictions p ON p.card_id = c.source_id
             WHERE c.source_type = 'card' AND c.id IN (SELECT value FROM json_each(?1))
             AND (p.is_ai_excluded = 1 OR (p.is_local_only = 1 AND p.source_document_id != ?2)))",
        ).bind(serde_json::to_string(chunk_ids)?).bind(document_id).fetch_one(self.pool()).await?;
        if blocked {
            return Err(PlethoraError::Validation(
                "Card source policy blocks indexing".into(),
            ));
        }
        Ok(())
    }

    /// General edits and sync merge can only add restrictions. Lowering one
    /// requires this explicit command with the current persisted policy version.
    pub async fn set_document_privacy(
        &self,
        id: &str,
        is_local_only: bool,
        is_ai_excluded: bool,
        expected_version: i64,
    ) -> Result<Document> {
        let mut tx = self.pool().begin().await?;
        let changed = sqlx::query(
            "UPDATE documents SET is_local_only = ?1, is_ai_excluded = ?2,
             metadata = CASE WHEN json_valid(metadata) THEN json_remove(metadata, '$.isLocalOnly', '$.isAiExcluded') ELSE metadata END,
             date_modified = ?3 WHERE id = ?4 AND privacy_version = ?5",
        )
        .bind(is_local_only)
        .bind(is_ai_excluded)
        .bind(chrono::Utc::now())
        .bind(id)
        .bind(expected_version)
        .execute(&mut *tx)
        .await?;
        if changed.rows_affected() != 1 {
            return Err(PlethoraError::Validation(
                "Document privacy changed; reload before changing restrictions".into(),
            ));
        }
        let document = Self::journal_document_fields(&mut tx, id, &["flags"]).await?;
        tx.commit().await?;
        crate::sync::journal::notify_after_commit();
        Ok(document)
    }

    /// Call at execution time, including resumed work and each remote batch.
    /// `remote` includes endpoints whose on-device execution is unverified.
    pub async fn ensure_document_ai_allowed(&self, id: &str, remote: bool) -> Result<()> {
        let policy: Option<(bool, bool)> =
            sqlx::query_as("SELECT is_local_only, is_ai_excluded FROM documents WHERE id = ?1")
                .bind(id)
                .fetch_optional(self.pool())
                .await?;
        match policy {
            Some((local_only, excluded)) if !excluded && !(remote && local_only) => Ok(()),
            Some(_) => Err(PlethoraError::Validation(
                "Document policy blocks processing".into(),
            )),
            None => Err(PlethoraError::NotFound(format!("Document {id}"))),
        }
    }
}
