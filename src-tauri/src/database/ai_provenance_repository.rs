//! AI provenance repository — durable provenance records for AI-proposed
//! learning objects (design D22/D23, `add-ondevice-ai-learning-system`
//! tasks 2.6 / Phase 1).
//!
//! Every accepted AI-generated learning object keeps a row in `ai_provenance`
//! (created by migration `085_ai_learning_system`): which provider/model/model
//! class produced it, from which input fingerprint, when, and a metadata JSON
//! blob carrying the original passage + selection context so the origin can be
//! navigated later (`get_ai_provenance`).
//!
//! Follows the sub-repository pattern of `document_repository.rs` (owns a
//! `Pool<Sqlite>` clone; `Repository` hands its pool to commands).

use crate::error::Result;
use sqlx::{Pool, Row, Sqlite};

/// One provenance record (row of `ai_provenance`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiProvenance {
    pub id: String,
    pub target_kind: String,
    pub target_id: String,
    pub task_id: String,
    pub provider: String,
    pub model: Option<String>,
    pub model_class: Option<String>,
    pub input_fingerprint: Option<String>,
    pub created_at: String,
    /// JSON string — callers pass the original passage / selection context /
    /// document linkage as a `serde_json::Value` via the command layer.
    pub metadata_json: Option<String>,
}

/// Repository for `ai_provenance` operations.
#[derive(Clone)]
pub struct AiProvenanceRepository {
    pool: Pool<Sqlite>,
}

impl AiProvenanceRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    /// Get the database pool for advanced queries.
    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Insert a provenance record. `id`/`created_at` are generated when absent.
    pub async fn insert_provenance(&self, record: &AiProvenance) -> Result<AiProvenance> {
        let id = if record.id.trim().is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            record.id.clone()
        };
        let created_at = if record.created_at.trim().is_empty() {
            chrono::Utc::now().to_rfc3339()
        } else {
            record.created_at.clone()
        };

        sqlx::query(
            r#"
            INSERT INTO ai_provenance (
                id, target_kind, target_id, task_id, provider, model,
                model_class, input_fingerprint, created_at, metadata_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
        )
        .bind(&id)
        .bind(&record.target_kind)
        .bind(&record.target_id)
        .bind(&record.task_id)
        .bind(&record.provider)
        .bind(&record.model)
        .bind(&record.model_class)
        .bind(&record.input_fingerprint)
        .bind(&created_at)
        .bind(&record.metadata_json)
        .execute(&self.pool)
        .await?;

        Ok(AiProvenance {
            id,
            created_at,
            ..record.clone()
        })
    }

    /// All provenance records attached to one target, oldest first.
    pub async fn get_provenance_for_target(
        &self,
        target_kind: &str,
        target_id: &str,
    ) -> Result<Vec<AiProvenance>> {
        let rows = sqlx::query(
            r#"
            SELECT id, target_kind, target_id, task_id, provider, model,
                   model_class, input_fingerprint, created_at, metadata_json
            FROM ai_provenance
            WHERE target_kind = ?1 AND target_id = ?2
            ORDER BY created_at ASC
            "#,
        )
        .bind(target_kind)
        .bind(target_id)
        .fetch_all(&self.pool)
        .await?;

        let mut records = Vec::with_capacity(rows.len());
        for row in rows {
            records.push(AiProvenance {
                id: row.try_get("id")?,
                target_kind: row.try_get("target_kind")?,
                target_id: row.try_get("target_id")?,
                task_id: row.try_get("task_id")?,
                provider: row.try_get("provider")?,
                model: row.try_get("model").ok(),
                model_class: row.try_get("model_class").ok(),
                input_fingerprint: row.try_get("input_fingerprint").ok(),
                created_at: row.try_get("created_at")?,
                metadata_json: row.try_get("metadata_json").ok(),
            });
        }
        Ok(records)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use std::path::PathBuf;

    async fn setup_repo() -> AiProvenanceRepository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        AiProvenanceRepository::new(db.pool().clone())
    }

    fn sample(id: &str, target_id: &str) -> AiProvenance {
        AiProvenance {
            id: id.to_string(),
            target_kind: "learning_item".to_string(),
            target_id: target_id.to_string(),
            task_id: "learn-this".to_string(),
            provider: "ondevice-nano".to_string(),
            model: Some("gemini-nano".to_string()),
            model_class: Some("full".to_string()),
            input_fingerprint: Some("fnv-1234".to_string()),
            created_at: String::new(),
            metadata_json: Some(
                serde_json::json!({
                    "passage": "Photosynthesis converts light energy into chemical energy.",
                    "documentId": "doc-1",
                    "cardType": "definition"
                })
                .to_string(),
            ),
        }
    }

    #[tokio::test]
    async fn test_insert_and_get_round_trip() {
        let repo = setup_repo().await;

        let inserted = repo
            .insert_provenance(&sample("prov-1", "item-1"))
            .await
            .expect("insert");
        // id preserved, created_at generated when empty
        assert_eq!(inserted.id, "prov-1");
        assert!(!inserted.created_at.is_empty());

        let fetched = repo
            .get_provenance_for_target("learning_item", "item-1")
            .await
            .expect("get");
        assert_eq!(fetched.len(), 1);
        assert_eq!(fetched[0].id, "prov-1");
        assert_eq!(fetched[0].task_id, "learn-this");
        assert_eq!(fetched[0].provider, "ondevice-nano");
        assert_eq!(fetched[0].model.as_deref(), Some("gemini-nano"));
        assert_eq!(fetched[0].model_class.as_deref(), Some("full"));
        assert_eq!(fetched[0].input_fingerprint.as_deref(), Some("fnv-1234"));

        let metadata: serde_json::Value =
            serde_json::from_str(fetched[0].metadata_json.as_deref().unwrap()).expect("metadata");
        assert_eq!(metadata["documentId"], "doc-1");
        assert_eq!(metadata["cardType"], "definition");
    }

    #[tokio::test]
    async fn test_generates_id_and_orders_multiple_records() {
        let repo = setup_repo().await;

        let first = repo
            .insert_provenance(&sample("", "item-2"))
            .await
            .expect("insert 1");
        assert!(!first.id.is_empty());

        let mut second = sample("", "item-2");
        second.provider = "cloud-openai".to_string();
        let second = repo.insert_provenance(&second).await.expect("insert 2");
        assert!(!second.id.is_empty());
        assert_ne!(first.id, second.id);

        let fetched = repo
            .get_provenance_for_target("learning_item", "item-2")
            .await
            .expect("get");
        assert_eq!(fetched.len(), 2);
        // Ordered by created_at ASC; both inserted within the same test run.
        let providers: Vec<&str> = fetched.iter().map(|r| r.provider.as_str()).collect();
        assert!(providers.contains(&"ondevice-nano"));
        assert!(providers.contains(&"cloud-openai"));
    }

    #[tokio::test]
    async fn test_scopes_by_target_kind_and_id() {
        let repo = setup_repo().await;
        repo.insert_provenance(&sample("prov-a", "item-A"))
            .await
            .expect("insert A");
        repo.insert_provenance(&sample("prov-b", "item-B"))
            .await
            .expect("insert B");

        let only_a = repo
            .get_provenance_for_target("learning_item", "item-A")
            .await
            .expect("get A");
        assert_eq!(only_a.len(), 1);
        assert_eq!(only_a[0].id, "prov-a");

        // Different kind, same id → nothing.
        let none = repo
            .get_provenance_for_target("extract", "item-A")
            .await
            .expect("get extract");
        assert!(none.is_empty());
    }
}
