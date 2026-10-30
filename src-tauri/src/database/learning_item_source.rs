//! One authoritative lineage check inside every canonical card INSERT transaction.

use crate::error::{PlethoraError, Result};
use crate::models::{ItemType, LearningItem};
use chrono::{DateTime, Utc};
use sqlx::{Row, Sqlite, Transaction};

#[derive(Debug, Clone, Default)]
pub struct ExpectedLearningSource {
    pub document_revision: Option<String>,
    pub extract_revision: Option<String>,
}

pub async fn canonicalize_learning_item_source(
    tx: &mut Transaction<'_, Sqlite>,
    item: &LearningItem,
    expected: Option<&ExpectedLearningSource>,
) -> Result<LearningItem> {
    let mut item = item.clone();
    if item
        .document_id
        .as_deref()
        .is_some_and(|id| id.starts_with("extract:"))
    {
        return Err(PlethoraError::InvalidInput(
            "Resolve the extract's source document before saving".into(),
        ));
    }
    if let Some(id) = &item.extract_id {
        let row = sqlx::query("SELECT document_id, date_modified FROM extracts WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| PlethoraError::NotFound("The source extract is unavailable".into()))?;
        let parent: String = row.try_get("document_id")?;
        if item.document_id.as_ref().is_some_and(|id| id != &parent) {
            return Err(PlethoraError::InvalidInput(
                "The extract does not belong to the selected source document".into(),
            ));
        }
        if let Some(revision) = expected.and_then(|e| e.extract_revision.as_deref()) {
            let expected = DateTime::parse_from_rfc3339(revision)
                .map_err(|_| PlethoraError::InvalidInput("Invalid source extract revision".into()))?
                .with_timezone(&Utc);
            let actual: Option<DateTime<Utc>> = row.try_get("date_modified")?;
            if actual != Some(expected) {
                return Err(PlethoraError::InvalidInput(
                    "The source extract changed; regenerate or reselect it before saving".into(),
                ));
            }
        }
        item.document_id = Some(parent);
        item.source_reference = None;
    }
    if let Some(id) = &item.document_id {
        let row = sqlx::query("SELECT collection_id, content_hash FROM documents WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| PlethoraError::NotFound("The source document is unavailable".into()))?;
        let collection = row
            .try_get::<Option<String>, _>("collection_id")?
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| crate::models::collection::DEFAULT_COLLECTION_ID.to_string());
        if item.collection_id == crate::models::collection::DEFAULT_COLLECTION_ID {
            item.collection_id = collection;
        } else if item.collection_id != collection {
            return Err(PlethoraError::InvalidInput(
                "The card and its source must belong to the same collection".into(),
            ));
        }
        if let Some(revision) = expected.and_then(|e| e.document_revision.as_deref()) {
            let actual: Option<String> = row.try_get("content_hash")?;
            if actual.as_deref() != Some(revision) {
                return Err(PlethoraError::InvalidInput(
                    "The source document changed; regenerate or reselect it before saving".into(),
                ));
            }
        }
    }
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM collections WHERE id = ?)")
        .bind(&item.collection_id)
        .fetch_one(&mut **tx)
        .await?;
    if !exists {
        return Err(PlethoraError::NotFound(
            "The selected collection is unavailable".into(),
        ));
    }
    if let Some(reference) = &item.source_reference {
        let value: serde_json::Value = serde_json::from_str(reference)
            .map_err(|_| PlethoraError::InvalidInput("Invalid source passage reference".into()))?;
        if item.document_id.is_none()
            || value["document_id"].as_str() != item.document_id.as_deref()
        {
            return Err(PlethoraError::InvalidInput(
                "The source passage does not match its document".into(),
            ));
        }
    }
    if expected.is_some()
        && item.item_type == ItemType::Cloze
        && item
            .cloze_text
            .as_deref()
            .is_none_or(|s| s.trim().is_empty())
    {
        item.cloze_text = Some(item.question.clone());
    }
    Ok(item)
}

/// Acceptance IDs name one immutable candidate; clocks and scheduling defaults
/// are not part of its content identity.
pub fn same_learning_candidate(existing: &LearningItem, candidate: &LearningItem) -> bool {
    fn source(value: &Option<String>) -> Option<serde_json::Value> {
        value.as_ref().map(|raw| {
            let mut value = serde_json::from_str::<serde_json::Value>(raw)
                .unwrap_or_else(|_| serde_json::Value::String(raw.clone()));
            if let Some(object) = value.as_object_mut() {
                object.remove("captured_at");
            }
            value
        })
    }
    let mut a = existing.tags.clone();
    let mut b = candidate.tags.clone();
    a.sort();
    b.sort();
    a.dedup();
    b.dedup();
    let cloze = |item: &LearningItem| {
        item.cloze_text
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| item.question.clone())
    };
    existing.item_type == candidate.item_type
        && existing.question == candidate.question
        && existing.answer == candidate.answer
        && (existing.item_type != ItemType::Cloze || cloze(existing) == cloze(candidate))
        && existing.extract_id == candidate.extract_id
        && (existing.document_id == candidate.document_id
            || (candidate.document_id.is_none() && candidate.extract_id.is_some()))
        && a == b
        && existing.image_asset_ids == candidate.image_asset_ids
        && existing.interaction_metadata == candidate.interaction_metadata
        && (candidate.extract_id.is_some()
            || source(&existing.source_reference) == source(&candidate.source_reference))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::issue6_test_support::{issue6_repository, DOCUMENT_ID, EXTRACT_ID, VIDEO_ID};
    use crate::models::{Document, FileType};

    fn card() -> LearningItem {
        let mut card = LearningItem::new(ItemType::Qa, "Canonical source question?".into());
        card.answer = Some("Canonical answer".into());
        card.extract_id = Some(EXTRACT_ID.into());
        card
    }

    #[tokio::test]
    async fn issue6_canonical_card_lineage_and_source_revisions() {
        let repo = issue6_repository().await;
        let extract = repo.get_extract(EXTRACT_ID).await.unwrap().unwrap();
        let document = repo.get_document(DOCUMENT_ID).await.unwrap().unwrap();
        let expected = ExpectedLearningSource {
            document_revision: document.content_hash,
            extract_revision: Some(extract.date_modified.to_rfc3339()),
        };
        let created = repo
            .create_learning_item_with_source(&card(), Some(&expected))
            .await
            .unwrap();
        assert_eq!(created.document_id.as_deref(), Some(DOCUMENT_ID));
        assert_eq!(created.extract_id.as_deref(), Some(EXTRACT_ID));
        let mut wrong = card();
        wrong.document_id = Some(VIDEO_ID.into());
        assert!(repo
            .create_learning_item_with_source(&wrong, Some(&expected))
            .await
            .is_err());
        let stale = ExpectedLearningSource {
            document_revision: Some("stale".into()),
            ..expected
        };
        assert!(repo
            .create_learning_item_with_source(&card(), Some(&stale))
            .await
            .is_err());
        let mut no_collection = LearningItem::new(ItemType::Basic, "Unscoped".into());
        no_collection.collection_id = "missing-collection".into();
        assert!(repo.create_learning_item(&no_collection).await.is_err());
        sqlx::query("DELETE FROM documents WHERE id = ?")
            .bind(DOCUMENT_ID)
            .execute(repo.pool())
            .await
            .unwrap();
        assert!(repo
            .create_learning_item_with_source(&card(), None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn issue6_creation_inherits_source_collection_and_rolls_back_journal_failure() {
        let repo = issue6_repository().await;
        let collection = repo
            .create_collection("Source collection", None, None)
            .await
            .unwrap();
        let mut document =
            Document::new("Owned source".into(), "owned.md".into(), FileType::Markdown);
        document.collection_id = collection.id.clone();
        repo.create_document(&document).await.unwrap();
        let mut candidate =
            LearningItem::new(ItemType::Cloze, "The {{c1::answer}} is here.".into());
        candidate.document_id = Some(document.id.clone());
        let created = repo
            .create_learning_item_with_source(&candidate, Some(&ExpectedLearningSource::default()))
            .await
            .unwrap();
        assert_eq!(created.collection_id, collection.id);
        assert_eq!(created.cloze_text, Some(candidate.question));
        let mut failed = LearningItem::new(ItemType::Qa, "Must roll back".into());
        failed.document_id = Some(document.id.clone());
        sqlx::query("CREATE TRIGGER fail_card_journal BEFORE INSERT ON sync_outbox WHEN NEW.entity_type = 'learning_item' BEGIN SELECT RAISE(ABORT, 'injected journal failure'); END")
            .execute(repo.pool()).await.unwrap();
        assert!(repo.create_learning_item(&failed).await.is_err());
        assert!(repo
            .get_learning_item_by_id(&failed.id)
            .await
            .unwrap()
            .is_none());
        let nodes: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM element_tree WHERE element_ref_id = ?")
                .bind(&failed.id)
                .fetch_one(repo.pool())
                .await
                .unwrap();
        assert_eq!(nodes, 0);
        assert_eq!(
            repo.get_document(&document.id)
                .await
                .unwrap()
                .unwrap()
                .learning_item_count,
            1
        );
    }

    #[tokio::test]
    async fn issue6_same_candidate_replay_serializes_and_conflicting_payload_fails() {
        let repo = issue6_repository().await;
        let mut first = card();
        first.acceptance_id = Some("chat-turn".into());
        first.proposal_id = Some("candidate-1".into());
        let mut retry = first.clone();
        retry.id = uuid::Uuid::new_v4().to_string();
        let (a, b) = tokio::join!(
            repo.create_learning_item(&first),
            repo.create_learning_item(&retry)
        );
        let a = a.unwrap();
        let b = b.unwrap();
        assert_eq!(a.id, b.id);
        retry.question = "Changed candidate".into();
        assert!(repo.create_learning_item(&retry).await.is_err());
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM learning_items WHERE acceptance_id = 'chat-turn'",
        )
        .fetch_one(repo.pool())
        .await
        .unwrap();
        assert_eq!(count, 1);
    }
}
