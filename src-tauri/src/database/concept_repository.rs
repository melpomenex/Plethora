//! Concept + concept-link repository (design D21, tasks 6.1/6.4/6.5,
//! `add-ondevice-ai-learning-system` Phase 5).
//!
//! Relational model, no graph DB: `concepts` (unique `normalized_name`) and
//! `concept_links` (typed relations with confidence, provenance JSON,
//! creator, dismissal flag, proposal fingerprint — all created by migration
//! `085_ai_learning_system`).
//!
//! Proposal lifecycle per D21/the spec: link ROWS ARE the proposals. An
//! AI-proposed link inserts as a visible suggestion (`created_by = 'ai'`,
//! `is_dismissed = 0`); accepting records user endorsement
//! (`created_by = 'user'`); dismissing sets `is_dismissed = 1` AND the row's
//! fingerprint stays behind so `propose_link` refuses to re-insert the same
//! proposal ("dismissed proposals are not re-proposed").
//!
//! Caps: per-ANALYSIS caps (≤ 5 proposals) are enforced by the TS caller;
//! this repository additionally enforces a hard anti-spam backstop of
//! `MAX_AI_LINKS_PER_DAY` AI-created links per UTC day.
//!
//! Follows the sub-repository pattern of `document_repository.rs` /
//! `ai_provenance_repository.rs` (owns a `Pool<Sqlite>` clone).

use crate::error::{IncrementumError as Error, Result};
use sqlx::{Pool, Row, Sqlite};

/// Canonical relation types (design D21 / ai-knowledge-relationships spec).
pub const CONCEPT_RELATION_TYPES: [&str; 10] = [
    "same-as",
    "prerequisite-of",
    "example-of",
    "contradicts",
    "supports",
    "extends",
    "analogous-to",
    "definition-of",
    "application-of",
    "related-to",
];

/// Anti-spam backstop: max AI-created links per UTC day (per-analysis caps
/// live in the TS caller; this is the hard global stop).
pub const MAX_AI_LINKS_PER_DAY: i64 = 200;

/// One `concepts` row.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Concept {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One `concept_links` row (= one proposal when `created_by = "ai"`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptLink {
    pub id: String,
    pub source_kind: String,
    pub source_id: String,
    pub target_kind: String,
    pub target_id: String,
    pub relation_type: String,
    pub confidence: f64,
    pub provenance_json: Option<String>,
    /// `"ai"` | `"user"` — `user` marks an accepted/endorsed link.
    pub created_by: String,
    pub created_at: String,
    pub is_dismissed: bool,
    pub proposal_fingerprint: Option<String>,
}

/// Result of `propose_link`.
#[derive(Debug, Clone)]
pub enum LinkProposalOutcome {
    /// New row inserted.
    Created(ConceptLink),
    /// A live row with the same fingerprint already exists (idempotent).
    Duplicate(ConceptLink),
    /// This exact proposal was dismissed before — refused, not re-surfaced.
    Dismissed(ConceptLink),
}

/// Backlink row for a concept page: the link plus the source concept's name
/// when the source itself is a concept.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptBacklink {
    #[serde(flatten)]
    pub link: ConceptLink,
    pub source_concept_name: Option<String>,
}

/// Normalize a concept name for dedupe: lowercase, collapse whitespace.
pub fn normalize_concept_name(name: &str) -> String {
    name.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Start of the current UTC day (per-day cap window).
fn utc_day_start() -> String {
    use chrono::Timelike;
    let now = chrono::Utc::now();
    now.with_hour(0)
        .and_then(|t| t.with_minute(0))
        .and_then(|t| t.with_second(0))
        .and_then(|t| t.with_nanosecond(0))
        .unwrap_or(now)
        .to_rfc3339()
}

fn row_to_concept(row: &sqlx::sqlite::SqliteRow) -> Result<Concept> {
    Ok(Concept {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        normalized_name: row.try_get("normalized_name")?,
        description: nullable_text(row, "description"),
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_link(row: &sqlx::sqlite::SqliteRow) -> Result<ConceptLink> {
    let is_dismissed: i64 = row.try_get("is_dismissed")?;
    Ok(ConceptLink {
        id: row.try_get("id")?,
        source_kind: row.try_get("source_kind")?,
        source_id: row.try_get("source_id")?,
        target_kind: row.try_get("target_kind")?,
        target_id: row.try_get("target_id")?,
        relation_type: row.try_get("relation_type")?,
        confidence: row.try_get("confidence")?,
        provenance_json: nullable_text(row, "provenance_json"),
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        is_dismissed: is_dismissed != 0,
        proposal_fingerprint: nullable_text(row, "proposal_fingerprint"),
    })
}

/// Decode a nullable TEXT column defensively: NULL and stray empty strings
/// both map to `None` (sqlx sqlite can decode NULL TEXT as "" for `String`).
fn nullable_text(row: &sqlx::sqlite::SqliteRow, column: &str) -> Option<String> {
    let value: Option<String> = row.try_get(column).unwrap_or(None);
    value.filter(|v| !v.trim().is_empty())
}

const LINK_COLUMNS: &str = "id, source_kind, source_id, target_kind, target_id, \
                            relation_type, confidence, provenance_json, created_by, \
                            created_at, is_dismissed, proposal_fingerprint";

/// Repository for `concepts` + `concept_links`.
#[derive(Clone)]
pub struct ConceptRepository {
    pool: Pool<Sqlite>,
}

impl ConceptRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    /// Get the database pool for advanced queries.
    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Insert or reuse a concept by `normalized_name`. A provided
    /// non-empty description replaces a null/empty one; names differing
    /// only in case/whitespace dedupe onto the same row.
    pub async fn upsert_concept(&self, name: &str, description: Option<&str>) -> Result<Concept> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(Error::Validation("concept name must not be empty".into()));
        }
        let normalized = normalize_concept_name(trimmed);
        let id = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO concepts (id, name, normalized_name, description)
            VALUES (?1, ?2, ?3, NULLIF(?4, ''))
            ON CONFLICT(normalized_name) DO UPDATE SET
                description = COALESCE(NULLIF(?4, ''), concepts.description),
                updated_at = datetime('now')
            "#,
        )
        .bind(&id)
        .bind(trimmed)
        .bind(&normalized)
        .bind(description.unwrap_or(""))
        .execute(&self.pool)
        .await?;

        let row = sqlx::query(
            "SELECT id, name, normalized_name, description, created_at, updated_at \
             FROM concepts WHERE normalized_name = ?1",
        )
        .bind(&normalized)
        .fetch_one(&self.pool)
        .await?;
        row_to_concept(&row)
    }

    pub async fn get_concept(&self, concept_id: &str) -> Result<Option<Concept>> {
        let row = sqlx::query(
            "SELECT id, name, normalized_name, description, created_at, updated_at \
             FROM concepts WHERE id = ?1",
        )
        .bind(concept_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|r| row_to_concept(&r)).transpose()
    }

    /// Resolve concepts for a list of names (normalized matching); names
    /// without a row are simply absent from the result.
    pub async fn find_concepts_by_names(&self, names: &[String]) -> Result<Vec<Concept>> {
        let mut concepts = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for name in names {
            let normalized = normalize_concept_name(name);
            if normalized.is_empty() || !seen.insert(normalized.clone()) {
                continue;
            }
            let row = sqlx::query(
                "SELECT id, name, normalized_name, description, created_at, updated_at \
                 FROM concepts WHERE normalized_name = ?1",
            )
            .bind(&normalized)
            .fetch_optional(&self.pool)
            .await?;
            if let Some(r) = row {
                concepts.push(row_to_concept(&r)?);
            }
        }
        Ok(concepts)
    }

    /// Insert a proposed link. Fingerprint rules:
    /// - a DISMISSED row with this fingerprint → `Dismissed` (no insert —
    ///   the user already rejected this exact proposal);
    /// - a live row with this fingerprint → `Duplicate` (idempotent).
    ///
    /// `created_by = "ai"` proposals count against the per-day cap.
    pub async fn propose_link(
        &self,
        source_kind: &str,
        source_id: &str,
        target_kind: &str,
        target_id: &str,
        relation_type: &str,
        confidence: f64,
        provenance_json: Option<&str>,
        fingerprint: Option<&str>,
        created_by: &str,
    ) -> Result<LinkProposalOutcome> {
        if !CONCEPT_RELATION_TYPES.contains(&relation_type) {
            return Err(Error::Validation(format!(
                "unknown relation type: {relation_type}"
            )));
        }
        if !(0.0..=1.0).contains(&confidence) {
            return Err(Error::Validation(format!(
                "confidence must be within 0..=1, got {confidence}"
            )));
        }
        let created_by = if created_by == "user" { "user" } else { "ai" };

        // Fingerprint gate: dismissed first (even if a live duplicate also
        // exists, the dismissal is what the user asked to remember).
        if let Some(fp) = fingerprint {
            if !fp.is_empty() {
                if let Some(existing) = self.fetch_link_by_fingerprint(fp).await? {
                    return Ok(if existing.is_dismissed {
                        LinkProposalOutcome::Dismissed(existing)
                    } else {
                        LinkProposalOutcome::Duplicate(existing)
                    });
                }
            }
        }

        if created_by == "ai" {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM concept_links WHERE created_by = 'ai' AND created_at >= ?1",
            )
            .bind(utc_day_start())
            .fetch_one(&self.pool)
            .await?;
            if count >= MAX_AI_LINKS_PER_DAY {
                return Err(Error::Validation(format!(
                    "concept-link daily cap reached ({MAX_AI_LINKS_PER_DAY} AI links/day)"
                )));
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now_rfc3339();
        let fingerprint_value = fingerprint.filter(|fp| !fp.is_empty());

        sqlx::query(
            r#"
            INSERT INTO concept_links (
                id, source_kind, source_id, target_kind, target_id,
                relation_type, confidence, provenance_json, created_by,
                created_at, is_dismissed, proposal_fingerprint
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11)
            "#,
        )
        .bind(&id)
        .bind(source_kind)
        .bind(source_id)
        .bind(target_kind)
        .bind(target_id)
        .bind(relation_type)
        .bind(confidence)
        .bind(provenance_json)
        .bind(created_by)
        .bind(&created_at)
        .bind(&fingerprint_value)
        .execute(&self.pool)
        .await?;

        let link = self.get_link_row(&id).await?;
        Ok(LinkProposalOutcome::Created(link))
    }

    async fn fetch_link_by_fingerprint(&self, fingerprint: &str) -> Result<Option<ConceptLink>> {
        let row = sqlx::query(&format!(
            "SELECT {LINK_COLUMNS} FROM concept_links WHERE proposal_fingerprint = ?1 LIMIT 1"
        ))
        .bind(fingerprint)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|r| row_to_link(&r)).transpose()
    }

    async fn get_link_row(&self, link_id: &str) -> Result<ConceptLink> {
        let row = sqlx::query(&format!(
            "SELECT {LINK_COLUMNS} FROM concept_links WHERE id = ?1"
        ))
        .bind(link_id)
        .fetch_one(&self.pool)
        .await?;
        row_to_link(&row)
    }

    /// Accept a proposal: records user endorsement (`created_by = 'user'`).
    /// The row stays visible either way — acceptance is not required for a
    /// link to exist, it marks the user's explicit approval.
    pub async fn accept_link(&self, link_id: &str) -> Result<Option<ConceptLink>> {
        let updated = sqlx::query("UPDATE concept_links SET created_by = 'user' WHERE id = ?1")
            .bind(link_id)
            .execute(&self.pool)
            .await?;
        if updated.rows_affected() == 0 {
            return Ok(None);
        }
        Ok(Some(self.get_link_row(link_id).await?))
    }

    /// Dismiss a proposal: `is_dismissed = 1`. The row (and its
    /// fingerprint) stays so the same proposal cannot be re-inserted.
    pub async fn dismiss_link(&self, link_id: &str) -> Result<Option<ConceptLink>> {
        let updated = sqlx::query("UPDATE concept_links SET is_dismissed = 1 WHERE id = ?1")
            .bind(link_id)
            .execute(&self.pool)
            .await?;
        if updated.rows_affected() == 0 {
            return Ok(None);
        }
        Ok(Some(self.get_link_row(link_id).await?))
    }

    /// Remove a link outright (spec: the user can remove durable links at
    /// any time). Note: unlike dismissal this does NOT remember the
    /// fingerprint — the user removed the link, not the idea of it.
    pub async fn delete_link(&self, link_id: &str) -> Result<bool> {
        let deleted = sqlx::query("DELETE FROM concept_links WHERE id = ?1")
            .bind(link_id)
            .execute(&self.pool)
            .await?;
        Ok(deleted.rows_affected() > 0)
    }

    /// Links whose source is `(source_kind, source_id)` — what one document/
    /// chunk/extract links out to. Live rows only unless
    /// `include_dismissed`.
    pub async fn list_links_for(
        &self,
        source_kind: &str,
        source_id: &str,
        include_dismissed: bool,
    ) -> Result<Vec<ConceptLink>> {
        let sql = format!(
            "SELECT {LINK_COLUMNS} FROM concept_links \
             WHERE source_kind = ?1 AND source_id = ?2 {} \
             ORDER BY created_at DESC",
            if include_dismissed {
                ""
            } else {
                "AND is_dismissed = 0"
            }
        );
        let rows = sqlx::query(&sql)
            .bind(source_kind)
            .bind(source_id)
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(row_to_link).collect()
    }

    /// Links whose target is `(target_kind, target_id)` — e.g. every link
    /// pointing AT a concept.
    pub async fn list_links_targeting(
        &self,
        target_kind: &str,
        target_id: &str,
        include_dismissed: bool,
    ) -> Result<Vec<ConceptLink>> {
        let sql = format!(
            "SELECT {LINK_COLUMNS} FROM concept_links \
             WHERE target_kind = ?1 AND target_id = ?2 {} \
             ORDER BY created_at DESC",
            if include_dismissed {
                ""
            } else {
                "AND is_dismissed = 0"
            }
        );
        let rows = sqlx::query(&sql)
            .bind(target_kind)
            .bind(target_id)
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(row_to_link).collect()
    }

    /// Concept-page backlinks: every live link targeting a concept, with
    /// the source concept's name resolved when the source is a concept.
    pub async fn backlinks(&self, concept_id: &str) -> Result<Vec<ConceptBacklink>> {
        let rows = sqlx::query(&format!(
            r#"
            SELECT l.id, l.source_kind, l.source_id, l.target_kind, l.target_id,
                   l.relation_type, l.confidence, l.provenance_json, l.created_by,
                   l.created_at, l.is_dismissed, l.proposal_fingerprint,
                   c.name AS source_concept_name
            FROM concept_links l
            LEFT JOIN concepts c
                ON l.source_kind = 'concept' AND c.id = l.source_id
            WHERE l.target_kind = 'concept' AND l.target_id = ?1 AND l.is_dismissed = 0
            ORDER BY l.created_at DESC
            "#
        ))
        .bind(concept_id)
        .fetch_all(&self.pool)
        .await?;

        let mut backlinks = Vec::with_capacity(rows.len());
        for row in &rows {
            // NULL (source is not a concept) decodes as None; a stray empty
            // name is normalized to None as well.
            let name: Option<String> = row.try_get("source_concept_name").unwrap_or(None);
            backlinks.push(ConceptBacklink {
                link: row_to_link(row)?,
                source_concept_name: name.filter(|n| !n.trim().is_empty()),
            });
        }
        Ok(backlinks)
    }

    /// Has this exact proposal fingerprint been dismissed before?
    pub async fn dismissed_fingerprint_exists(&self, fingerprint: &str) -> Result<bool> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM concept_links \
             WHERE proposal_fingerprint = ?1 AND is_dismissed = 1",
        )
        .bind(fingerprint)
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup() -> ConceptRepository {
        let pool = crate::ai_learning::test_support::test_pool().await;
        ConceptRepository::new(pool)
    }

    #[test]
    fn test_normalize_concept_name() {
        assert_eq!(
            normalize_concept_name("  Context-Free   Grammars "),
            "context-free grammars"
        );
        assert_eq!(normalize_concept_name("Parse Trees"), "parse trees");
    }

    #[tokio::test]
    async fn test_upsert_concept_dedupes_normalized_names() {
        let repo = setup().await;

        let first = repo
            .upsert_concept("Parse Trees", Some("Tree derivations of a string"))
            .await
            .unwrap();
        assert_eq!(first.name, "Parse Trees");
        assert_eq!(first.normalized_name, "parse trees");
        assert_eq!(
            first.description.as_deref(),
            Some("Tree derivations of a string")
        );

        // Same name, different casing/whitespace → same row (no duplicate).
        let again = repo.upsert_concept("  parse   TREES ", None).await.unwrap();
        assert_eq!(again.id, first.id);
        // Existing description survives a None update.
        assert_eq!(
            again.description.as_deref(),
            Some("Tree derivations of a string")
        );

        // Empty name rejected.
        assert!(repo.upsert_concept("   ", None).await.is_err());
    }

    #[tokio::test]
    async fn test_get_and_find_concepts_by_names() {
        let repo = setup().await;
        let a = repo.upsert_concept("Pumping Lemma", None).await.unwrap();
        let _b = repo
            .upsert_concept("Regular Languages", None)
            .await
            .unwrap();

        let got = repo.get_concept(&a.id).await.unwrap().expect("concept");
        assert_eq!(got.normalized_name, "pumping lemma");

        let found = repo
            .find_concepts_by_names(&[
                "pumping   lemma".into(), // normalized match
                "REGULAR LANGUAGES".into(),
                "missing concept".into(), // absent → omitted
                "pumping lemma".into(),   // duplicate input → deduped
            ])
            .await
            .unwrap();
        assert_eq!(found.len(), 2);
        let names: Vec<&str> = found.iter().map(|c| c.normalized_name.as_str()).collect();
        assert!(names.contains(&"pumping lemma"));
        assert!(names.contains(&"regular languages"));
    }

    #[tokio::test]
    async fn test_propose_link_round_trip_and_queries() {
        let repo = setup().await;
        let concept = repo.upsert_concept("Pumping Lemma", None).await.unwrap();

        let LinkProposalOutcome::Created(link) = repo
            .propose_link(
                "document",
                "doc-1",
                "concept",
                &concept.id,
                "prerequisite-of",
                0.8,
                Some(r#"{"task":"prerequisite-analysis"}"#),
                Some("fp-doc1-pumping"),
                "ai",
            )
            .await
            .unwrap()
        else {
            panic!("expected Created");
        };
        assert_eq!(link.source_kind, "document");
        assert_eq!(link.source_id, "doc-1");
        assert_eq!(link.relation_type, "prerequisite-of");
        assert!((link.confidence - 0.8).abs() < 1e-9);
        assert_eq!(link.created_by, "ai");
        assert!(!link.is_dismissed);

        let links_for = repo
            .list_links_for("document", "doc-1", false)
            .await
            .unwrap();
        assert_eq!(links_for.len(), 1);
        assert_eq!(links_for[0].id, link.id);

        let targeting = repo
            .list_links_targeting("concept", &concept.id, false)
            .await
            .unwrap();
        assert_eq!(targeting.len(), 1);

        let backlinks = repo.backlinks(&concept.id).await.unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].link.id, link.id);
        assert_eq!(backlinks[0].source_concept_name, None); // source is a document

        // Dismissed rows are hidden from the live queries.
        repo.dismiss_link(&link.id).await.unwrap();
        assert!(repo
            .list_links_for("document", "doc-1", false)
            .await
            .unwrap()
            .is_empty());
        let including = repo
            .list_links_for("document", "doc-1", true)
            .await
            .unwrap();
        assert_eq!(including.len(), 1);
        assert!(including[0].is_dismissed);
        // Backlinks exclude dismissed.
        assert!(repo.backlinks(&concept.id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_duplicate_fingerprint_is_idempotent() {
        let repo = setup().await;
        let concept = repo
            .upsert_concept("Proof by Contradiction", None)
            .await
            .unwrap();

        let LinkProposalOutcome::Created(first) = repo
            .propose_link(
                "chunk",
                "c1",
                "concept",
                &concept.id,
                "related-to",
                0.7,
                None,
                Some("fp-1"),
                "ai",
            )
            .await
            .unwrap()
        else {
            panic!("first insert")
        };

        let LinkProposalOutcome::Duplicate(dup) = repo
            .propose_link(
                "chunk",
                "c1",
                "concept",
                &concept.id,
                "related-to",
                0.9,
                None,
                Some("fp-1"),
                "ai",
            )
            .await
            .unwrap()
        else {
            panic!("expected Duplicate")
        };
        assert_eq!(dup.id, first.id);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM concept_links")
            .fetch_one(repo.pool())
            .await
            .unwrap();
        assert_eq!(count, 1, "no second row for the same fingerprint");
    }

    #[tokio::test]
    async fn test_dismissed_fingerprint_blocks_reproposal() {
        let repo = setup().await;
        let concept = repo
            .upsert_concept("Context-Free Grammars", None)
            .await
            .unwrap();

        let LinkProposalOutcome::Created(link) = repo
            .propose_link(
                "document",
                "doc-9",
                "concept",
                &concept.id,
                "prerequisite-of",
                0.65,
                None,
                Some("fp-dismiss-me"),
                "ai",
            )
            .await
            .unwrap()
        else {
            panic!("insert")
        };

        // Dismiss → fingerprint remembered.
        let dismissed = repo.dismiss_link(&link.id).await.unwrap().expect("row");
        assert!(dismissed.is_dismissed);
        assert!(repo
            .dismissed_fingerprint_exists("fp-dismiss-me")
            .await
            .unwrap());
        assert!(!repo.dismissed_fingerprint_exists("fp-other").await.unwrap());

        // Same fingerprint, later analysis, even with different confidence:
        // refused (Dismissed), no new row.
        let LinkProposalOutcome::Dismissed(blocked) = repo
            .propose_link(
                "document",
                "doc-9",
                "concept",
                &concept.id,
                "prerequisite-of",
                0.95,
                None,
                Some("fp-dismiss-me"),
                "ai",
            )
            .await
            .unwrap()
        else {
            panic!("expected Dismissed")
        };
        assert_eq!(blocked.id, link.id);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM concept_links")
            .fetch_one(repo.pool())
            .await
            .unwrap();
        assert_eq!(count, 1);

        // Live list stays empty after the blocked re-proposal.
        assert!(repo
            .list_links_for("document", "doc-9", false)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn test_accept_sets_user_creator_and_delete_removes() {
        let repo = setup().await;
        let concept = repo
            .upsert_concept("Analogous Reasoning", None)
            .await
            .unwrap();
        let LinkProposalOutcome::Created(link) = repo
            .propose_link(
                "extract",
                "ext-1",
                "concept",
                &concept.id,
                "example-of",
                0.7,
                None,
                Some("fp-acc"),
                "ai",
            )
            .await
            .unwrap()
        else {
            panic!("insert")
        };

        let accepted = repo.accept_link(&link.id).await.unwrap().expect("accepted");
        assert_eq!(accepted.created_by, "user");
        assert!(!accepted.is_dismissed);

        assert!(repo.delete_link(&link.id).await.unwrap());
        assert!(!repo.delete_link(&link.id).await.unwrap());
        assert!(repo
            .list_links_targeting("concept", &concept.id, true)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn test_relation_type_and_confidence_validation() {
        let repo = setup().await;
        let concept = repo.upsert_concept("Valid Concept", None).await.unwrap();

        let err = repo
            .propose_link(
                "document",
                "d",
                "concept",
                &concept.id,
                "derives-from",
                0.5,
                None,
                None,
                "ai",
            )
            .await
            .unwrap_err();
        assert!(err.to_string().to_lowercase().contains("relation"));

        let err = repo
            .propose_link(
                "document",
                "d",
                "concept",
                &concept.id,
                "related-to",
                1.5,
                None,
                None,
                "ai",
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("confidence"));
    }

    #[tokio::test]
    async fn test_per_day_cap_rejects_ai_links_after_limit() {
        let repo = setup().await;
        let concept = repo.upsert_concept("Capped Concept", None).await.unwrap();

        // Seed the cap full with direct inserts (faster than 200 round-trips;
        // `propose_link` counts these rows through the same created_at column).
        let now = now_rfc3339();
        for i in 0..MAX_AI_LINKS_PER_DAY {
            sqlx::query(
                "INSERT INTO concept_links (id, source_kind, source_id, target_kind, target_id, \
                 relation_type, confidence, created_by, created_at, is_dismissed) \
                 VALUES (?1, 'document', 'doc-cap', 'concept', ?2, 'related-to', 0.7, 'ai', ?3, 0)",
            )
            .bind(format!("cap-{i}"))
            .bind(&concept.id)
            .bind(&now)
            .execute(repo.pool())
            .await
            .unwrap();
        }

        let err = repo
            .propose_link(
                "document",
                "doc-over",
                "concept",
                &concept.id,
                "related-to",
                0.9,
                None,
                Some("fp-over"),
                "ai",
            )
            .await
            .unwrap_err();
        assert!(err.to_string().to_lowercase().contains("cap"), "got: {err}");

        // User-created links are not subject to the AI cap.
        let LinkProposalOutcome::Created(_) = repo
            .propose_link(
                "document",
                "doc-user",
                "concept",
                &concept.id,
                "related-to",
                0.9,
                None,
                Some("fp-user"),
                "user",
            )
            .await
            .unwrap()
        else {
            panic!("user link must bypass the ai cap")
        };

        // Yesterday's AI links do not count against today's window.
        sqlx::query("DELETE FROM concept_links WHERE source_id = 'doc-cap'")
            .execute(repo.pool())
            .await
            .unwrap();
        let LinkProposalOutcome::Created(_) = repo
            .propose_link(
                "document",
                "doc-fresh",
                "concept",
                &concept.id,
                "related-to",
                0.9,
                None,
                Some("fp-fresh"),
                "ai",
            )
            .await
            .unwrap()
        else {
            panic!("fresh day must allow ai links")
        };
    }
}
