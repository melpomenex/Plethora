//! Learning object source repository — durable rich evidence associations
//! for learning objects (cards and extracts) derived from recording sessions.
//! Task 2.4 / OpenSpec D4, D5.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Row, Sqlite};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningObjectSource {
    pub id: String,
    pub target_kind: String, // "card" | "extract"
    pub target_id: String,
    pub session_id: Option<String>,
    pub document_id: String,
    pub evidence_json: String,
    pub evidence_hash: String,
    pub created_at: String,
}

#[derive(Clone)]
pub struct LearningObjectSourceRepository {
    pool: Pool<Sqlite>,
}

impl LearningObjectSourceRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Compute a deterministic SHA-256 evidence hash.
    pub fn compute_evidence_hash(evidence_json: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(evidence_json.trim().as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Validate that a quote strictly matches canonical segment text at the given UTF-16 code unit slice.
    pub fn validate_canonical_quote(
        segment_text: &str,
        start_utf16: usize,
        end_utf16: usize,
        quote: &str,
    ) -> bool {
        let utf16: Vec<u16> = segment_text.encode_utf16().collect();
        if start_utf16 > end_utf16 || end_utf16 > utf16.len() {
            return false;
        }
        if let Ok(sliced) = String::from_utf16(&utf16[start_utf16..end_utf16]) {
            sliced == quote
        } else {
            false
        }
    }

    /// Save a source association linking a target (card or extract) to its session evidence.
    /// Repeated save request with identical evidence_hash is idempotent.
    pub async fn save_source_association(
        &self,
        target_kind: &str,
        target_id: &str,
        session_id: Option<&str>,
        document_id: &str,
        evidence_json: &str,
    ) -> Result<LearningObjectSource> {
        let hash = Self::compute_evidence_hash(evidence_json);
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT INTO learning_object_sources (
                id, target_kind, target_id, session_id, document_id, evidence_json, evidence_hash, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(target_kind, target_id, evidence_hash) DO NOTHING
            "#,
        )
        .bind(&id)
        .bind(target_kind)
        .bind(target_id)
        .bind(session_id)
        .bind(document_id)
        .bind(evidence_json)
        .bind(&hash)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        let row = sqlx::query(
            "SELECT id, target_kind, target_id, session_id, document_id, evidence_json, evidence_hash, created_at
             FROM learning_object_sources
             WHERE target_kind = ?1 AND target_id = ?2 AND evidence_hash = ?3",
        )
        .bind(target_kind)
        .bind(target_id)
        .bind(&hash)
        .fetch_one(&self.pool)
        .await?;

        Ok(LearningObjectSource {
            id: row.try_get("id")?,
            target_kind: row.try_get("target_kind")?,
            target_id: row.try_get("target_id")?,
            session_id: row.try_get("session_id")?,
            document_id: row.try_get("document_id")?,
            evidence_json: row.try_get("evidence_json")?,
            evidence_hash: row.try_get("evidence_hash")?,
            created_at: row.try_get("created_at")?,
        })
    }

    /// Check if a target already exists for this document and evidence hash (deduplication helper).
    pub async fn find_existing_target_by_evidence(
        &self,
        document_id: &str,
        target_kind: &str,
        evidence_hash: &str,
    ) -> Result<Option<String>> {
        let row = sqlx::query_scalar::<_, String>(
            "SELECT target_id FROM learning_object_sources
             WHERE document_id = ?1 AND target_kind = ?2 AND evidence_hash = ?3
             LIMIT 1",
        )
        .bind(document_id)
        .bind(target_kind)
        .bind(evidence_hash)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row)
    }

    /// Retrieve all rich source associations for a specific target object.
    pub async fn get_sources_for_target(
        &self,
        target_kind: &str,
        target_id: &str,
    ) -> Result<Vec<LearningObjectSource>> {
        let rows = sqlx::query(
            "SELECT id, target_kind, target_id, session_id, document_id, evidence_json, evidence_hash, created_at
             FROM learning_object_sources
             WHERE target_kind = ?1 AND target_id = ?2
             ORDER BY created_at ASC",
        )
        .bind(target_kind)
        .bind(target_id)
        .fetch_all(&self.pool)
        .await?;

        let mut sources = Vec::new();
        for row in rows {
            sources.push(LearningObjectSource {
                id: row.try_get("id")?,
                target_kind: row.try_get("target_kind")?,
                target_id: row.try_get("target_id")?,
                session_id: row.try_get("session_id")?,
                document_id: row.try_get("document_id")?,
                evidence_json: row.try_get("evidence_json")?,
                evidence_hash: row.try_get("evidence_hash")?,
                created_at: row.try_get("created_at")?,
            });
        }
        Ok(sources)
    }

    /// Retrieve all rich source associations for a recording session.
    pub async fn get_sources_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<LearningObjectSource>> {
        let rows = sqlx::query(
            "SELECT id, target_kind, target_id, session_id, document_id, evidence_json, evidence_hash, created_at
             FROM learning_object_sources
             WHERE session_id = ?1
             ORDER BY created_at ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;

        let mut sources = Vec::new();
        for row in rows {
            sources.push(LearningObjectSource {
                id: row.try_get("id")?,
                target_kind: row.try_get("target_kind")?,
                target_id: row.try_get("target_id")?,
                session_id: row.try_get("session_id")?,
                document_id: row.try_get("document_id")?,
                evidence_json: row.try_get("evidence_json")?,
                evidence_hash: row.try_get("evidence_hash")?,
                created_at: row.try_get("created_at")?,
            });
        }
        Ok(sources)
    }
}

use crate::database::Repository;

impl Repository {
    pub async fn save_learning_object_source(
        &self,
        target_kind: &str,
        target_id: &str,
        session_id: Option<&str>,
        document_id: &str,
        evidence_json: &str,
    ) -> Result<LearningObjectSource> {
        let repo = LearningObjectSourceRepository::new(self.pool().clone());
        repo.save_source_association(target_kind, target_id, session_id, document_id, evidence_json).await
    }

    pub async fn get_learning_object_sources_for_target(
        &self,
        target_kind: &str,
        target_id: &str,
    ) -> Result<Vec<LearningObjectSource>> {
        let repo = LearningObjectSourceRepository::new(self.pool().clone());
        repo.get_sources_for_target(target_kind, target_id).await
    }

    pub async fn get_learning_object_sources_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<LearningObjectSource>> {
        let repo = LearningObjectSourceRepository::new(self.pool().clone());
        repo.get_sources_for_session(session_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn learning_object_source_lifecycle_and_idempotency() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();

        let repo = LearningObjectSourceRepository::new(pool.clone());
        let doc_id = "doc-test-1";
        let session_id = "sess-test-1";
        let target_id = "extract-1";
        let evidence = r#"{"quote":"Paxos consensus","segmentKeys":["seg-1"]}"#;

        // 1. Initial save
        let source1 = repo
            .save_source_association("extract", target_id, Some(session_id), doc_id, evidence)
            .await
            .unwrap();
        assert_eq!(source1.target_id, target_id);
        assert_eq!(source1.target_kind, "extract");

        // 2. Repeated save is idempotent (returns matching row without error)
        let source2 = repo
            .save_source_association("extract", target_id, Some(session_id), doc_id, evidence)
            .await
            .unwrap();
        assert_eq!(source1.id, source2.id);
        assert_eq!(source1.evidence_hash, source2.evidence_hash);

        // 3. Find existing target by evidence
        let existing = repo
            .find_existing_target_by_evidence(doc_id, "extract", &source1.evidence_hash)
            .await
            .unwrap();
        assert_eq!(existing, Some(target_id.to_string()));

        // 4. Query by target
        let target_sources = repo
            .get_sources_for_target("extract", target_id)
            .await
            .unwrap();
        assert_eq!(target_sources.len(), 1);
        assert_eq!(target_sources[0].id, source1.id);

        // 5. Query by session
        let session_sources = repo
            .get_sources_for_session(session_id)
            .await
            .unwrap();
        assert_eq!(session_sources.len(), 1);
        assert_eq!(session_sources[0].id, source1.id);

        // 6. Canonical quote validation with UTF-16 code units
        let segment_text = "Hello 🌍 world!"; // 🌍 is 2 UTF-16 code units
        let utf16_len: usize = segment_text.encode_utf16().count();
        assert_eq!(utf16_len, 15);

        // "Hello" is 0..5
        assert!(LearningObjectSourceRepository::validate_canonical_quote(
            segment_text,
            0,
            5,
            "Hello"
        ));

        // "🌍" is 6..8
        assert!(LearningObjectSourceRepository::validate_canonical_quote(
            segment_text,
            6,
            8,
            "🌍"
        ));

        // Mismatched quote fails
        assert!(!LearningObjectSourceRepository::validate_canonical_quote(
            segment_text,
            0,
            5,
            "Wrong"
        ));
    }
}
