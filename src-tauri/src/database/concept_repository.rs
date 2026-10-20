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

use crate::error::{PlethoraError as Error, Result};
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

/// Hard per-analysis cap for visible/saved AI proposals (defended in Rust).
pub const MAX_AI_LINKS_PER_ANALYSIS: i64 = 5;

/// Fingerprint policy version (must match the TS constant).
pub const RELATIONSHIP_POLICY_VERSION: &str = "relationship-policy-v1";

/// Endpoint kinds whose existence/revision the command boundary validates.
pub const CONCEPT_LINK_ENDPOINT_KINDS: [&str; 6] = [
    "concept",
    "document",
    "extract",
    "card",
    "annotation",
    "chunk",
];

/// Relation types whose endpoints are unordered for fingerprint identity.
pub const SYMMETRIC_CONCEPT_RELATIONS: [&str; 3] = ["same-as", "analogous-to", "related-to"];

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
    /// IMMUTABLE creation provenance (`ai` | `user` | `unknown`).
    pub origin: String,
    pub analysis_id: Option<String>,
    pub source_revision: Option<String>,
    pub endorsed_at: Option<String>,
    pub dismissed_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Input for one validated proposal (command boundary).
#[derive(Debug, Clone, Default)]
pub struct ConceptLinkProposal {
    pub source_kind: String,
    pub source_id: String,
    pub target_kind: String,
    pub target_id: String,
    pub relation_type: String,
    pub confidence: f64,
    pub provenance_json: Option<String>,
    pub fingerprint: Option<String>,
    pub origin: String,
    pub analysis_id: Option<String>,
    pub source_revision: Option<String>,
    pub target_revision: Option<String>,
}

/// Narrow edit input. Absent fields keep their current value.
#[derive(Debug, Clone, Default)]
pub struct ConceptLinkUpdate {
    pub relation_type: Option<String>,
    pub confidence: Option<f64>,
    pub source_kind: Option<String>,
    pub source_id: Option<String>,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub source_revision: Option<String>,
}

/// Result of `update_link`.
#[derive(Debug, Clone)]
pub enum LinkUpdateOutcome {
    Updated(ConceptLink),
    NotFound,
    /// The edited relationship collides with a live row; the original is kept.
    Conflict(ConceptLink),
}

/// A new concept created inside a batch-save transaction.
#[derive(Debug, Clone)]
pub struct NewConceptDraft {
    pub handle: String,
    pub name: String,
    pub description: Option<String>,
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

/// Normalized endpoint identity used by fingerprints (`kind:id`).
pub fn concept_link_endpoint_key(kind: &str, id: &str) -> String {
    format!("{}:{}", kind.trim().to_lowercase(), id.trim())
}

/// Canonical app/backend-generated fingerprint. Must mirror
/// `canonicalConceptLinkFingerprint` in `src/api/concept-links.ts`.
pub fn canonical_link_fingerprint(
    source_kind: &str,
    source_id: &str,
    target_kind: &str,
    target_id: &str,
    relation_type: &str,
    source_revision: Option<&str>,
    target_revision: Option<&str>,
) -> String {
    let mut source = concept_link_endpoint_key(source_kind, source_id);
    let mut target = concept_link_endpoint_key(target_kind, target_id);
    let mut source_revision = source_revision.unwrap_or("").to_string();
    let mut target_revision = target_revision.unwrap_or("").to_string();
    if SYMMETRIC_CONCEPT_RELATIONS.contains(&relation_type) && source > target {
        std::mem::swap(&mut source, &mut target);
        std::mem::swap(&mut source_revision, &mut target_revision);
    }
    let endpoints = [source, target];
    let revisions = [source_revision, target_revision];
    format!(
        "concept-link-v1\u{0}policy={}\u{0}relation={}\u{0}endpoints={}\u{0}revisions={}",
        RELATIONSHIP_POLICY_VERSION,
        relation_type,
        endpoints.join("|"),
        revisions.join("|")
    )
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
        origin: row
            .try_get::<Option<String>, _>("origin")
            .ok()
            .flatten()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "unknown".into()),
        analysis_id: nullable_text(row, "analysis_id"),
        source_revision: nullable_text(row, "source_revision"),
        endorsed_at: nullable_text(row, "endorsed_at"),
        dismissed_at: nullable_text(row, "dismissed_at"),
        updated_at: nullable_text(row, "updated_at"),
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
                            created_at, is_dismissed, proposal_fingerprint, origin, \
                            analysis_id, source_revision, endorsed_at, dismissed_at, updated_at";

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

    /// Insert a proposed link (low-level compatibility path used by existing
    /// repository callers/tests). Feasibility validation lives in
    /// [`Self::propose_link_validated`] for the command boundary.
    ///
    /// Fingerprint rules:
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
        let origin = created_by;

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
            self.ensure_daily_cap().await?;
        }

        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now_rfc3339();
        let fingerprint_value = fingerprint.filter(|fp| !fp.is_empty());

        let insert = sqlx::query(
            r#"
            INSERT INTO concept_links (
                id, source_kind, source_id, target_kind, target_id,
                relation_type, confidence, provenance_json, created_by,
                created_at, is_dismissed, proposal_fingerprint, origin,
                analysis_id, source_revision, endorsed_at, dismissed_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?12,
                      NULL, NULL, NULL, NULL, ?10)
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
        .bind(origin)
        .execute(&self.pool)
        .await;

        if let Err(error) = insert {
            // A concurrent live duplicate is a normal outcome, not a failure.
            if let Some(fp) = &fingerprint_value {
                if let Some(existing) = self.fetch_link_by_fingerprint(fp).await? {
                    return Ok(if existing.is_dismissed {
                        LinkProposalOutcome::Dismissed(existing)
                    } else {
                        LinkProposalOutcome::Duplicate(existing)
                    });
                }
            }
            return Err(error.into());
        }

        let link = self.get_link_row(&id).await?;
        Ok(LinkProposalOutcome::Created(link))
    }

    /// Daily AI quota counts IMMUTABLE `origin`, never mutable `created_by`:
    /// accepting an AI proposal cannot release quota. Pre-migration rows are
    /// `origin = 'unknown'`; an unknown row still created by AI is counted
    /// conservatively.
    async fn ensure_daily_cap(&self) -> Result<()> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM concept_links \
             WHERE created_at >= ?1 \
               AND (origin = 'ai' OR (origin = 'unknown' AND created_by = 'ai'))",
        )
        .bind(utc_day_start())
        .fetch_one(&self.pool)
        .await?;
        if count >= MAX_AI_LINKS_PER_DAY {
            return Err(Error::Validation(format!(
                "concept-link daily cap reached ({MAX_AI_LINKS_PER_DAY} AI links/day)"
            )));
        }
        Ok(())
    }

    fn validate_relation_and_confidence(relation_type: &str, confidence: f64) -> Result<()> {
        if !CONCEPT_RELATION_TYPES.contains(&relation_type) {
            return Err(Error::Validation(format!(
                "unknown relation type: {relation_type}"
            )));
        }
        if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
            return Err(Error::Validation(format!(
                "confidence must be a finite value within 0..=1, got {confidence}"
            )));
        }
        Ok(())
    }

    fn validate_endpoint_kind(kind: &str) -> Result<()> {
        if CONCEPT_LINK_ENDPOINT_KINDS.contains(&kind) {
            Ok(())
        } else {
            Err(Error::Validation(format!(
                "unknown concept-link endpoint kind: {kind}"
            )))
        }
    }

    /// Does the endpoint row exist right now?
    pub async fn endpoint_exists(&self, kind: &str, id: &str) -> Result<bool> {
        let table = match kind {
            "concept" => "concepts",
            "document" => "documents",
            "extract" => "extracts",
            "card" => "learning_items",
            "annotation" => "annotations",
            "chunk" => "semantic_chunks",
            _ => return Ok(false),
        };
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?1"))
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        Ok(count > 0)
    }

    /// Current authoritative revision of an endpoint, when one exists.
    pub async fn endpoint_revision(&self, kind: &str, id: &str) -> Result<Option<String>> {
        let sql = match kind {
            "concept" => "SELECT updated_at FROM concepts WHERE id = ?1",
            "document" => {
                "SELECT COALESCE(NULLIF(content_hash, ''), date_modified) FROM documents WHERE id = ?1"
            }
            "extract" => "SELECT date_modified FROM extracts WHERE id = ?1",
            "card" => "SELECT date_modified FROM learning_items WHERE id = ?1",
            "annotation" => "SELECT date_modified FROM annotations WHERE id = ?1",
            "chunk" => "SELECT content_hash FROM semantic_chunks WHERE id = ?1",
            _ => return Ok(None),
        };
        let value: Option<String> = sqlx::query_scalar(sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(value.filter(|v| !v.trim().is_empty()))
    }

    async fn validate_proposal(
        &self,
        proposal: &ConceptLinkProposal,
        enforce_caps: bool,
    ) -> Result<String> {
        Self::validate_relation_and_confidence(&proposal.relation_type, proposal.confidence)?;
        Self::validate_endpoint_kind(&proposal.source_kind)?;
        Self::validate_endpoint_kind(&proposal.target_kind)?;
        if proposal.source_kind == proposal.target_kind && proposal.source_id == proposal.target_id
        {
            return Err(Error::Validation(
                "concept link cannot be a self-edge".into(),
            ));
        }
        if !self
            .endpoint_exists(&proposal.source_kind, &proposal.source_id)
            .await?
        {
            return Err(Error::Validation(
                "concept-link source endpoint does not exist".into(),
            ));
        }
        if !self
            .endpoint_exists(&proposal.target_kind, &proposal.target_id)
            .await?
        {
            return Err(Error::Validation(
                "concept-link target endpoint does not exist".into(),
            ));
        }

        for (kind, id, expected) in [
            (
                &proposal.source_kind,
                &proposal.source_id,
                proposal.source_revision.as_deref(),
            ),
            (
                &proposal.target_kind,
                &proposal.target_id,
                proposal.target_revision.as_deref(),
            ),
        ] {
            let Some(expected) = expected.filter(|value| !value.trim().is_empty()) else {
                continue;
            };
            if let Some(current) = self.endpoint_revision(kind, id).await? {
                if current != expected {
                    return Err(Error::Validation(
                        "concept-link endpoint revision is stale".into(),
                    ));
                }
            }
        }

        if proposal.origin != "user" {
            if let Some(analysis_id) = proposal.analysis_id.as_deref() {
                if enforce_caps {
                    let count: i64 = sqlx::query_scalar(
                        "SELECT COUNT(*) FROM concept_links \
                         WHERE origin = 'ai' AND analysis_id = ?1 AND is_dismissed = 0",
                    )
                    .bind(analysis_id)
                    .fetch_one(&self.pool)
                    .await?;
                    if count >= MAX_AI_LINKS_PER_ANALYSIS {
                        return Err(Error::Validation(format!(
                            "concept-link per-analysis cap reached ({MAX_AI_LINKS_PER_ANALYSIS} proposals/analysis)"
                        )));
                    }
                }
            }
            if enforce_caps {
                self.ensure_daily_cap().await?;
            }
        }

        // Always use the canonical fingerprint; arbitrary IPC-supplied strings
        // cannot bypass dismissal/dedupe identity.
        Ok(canonical_link_fingerprint(
            &proposal.source_kind,
            &proposal.source_id,
            &proposal.target_kind,
            &proposal.target_id,
            &proposal.relation_type,
            proposal.source_revision.as_deref(),
            proposal.target_revision.as_deref(),
        ))
    }

    async fn insert_validated_link(
        &self,
        proposal: &ConceptLinkProposal,
        fingerprint: &str,
    ) -> Result<LinkProposalOutcome> {
        if let Some(existing) = self.fetch_link_by_fingerprint(fingerprint).await? {
            return Ok(if existing.is_dismissed {
                LinkProposalOutcome::Dismissed(existing)
            } else {
                LinkProposalOutcome::Duplicate(existing)
            });
        }

        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now_rfc3339();
        let insert = sqlx::query(
            r#"
            INSERT INTO concept_links (
                id, source_kind, source_id, target_kind, target_id,
                relation_type, confidence, provenance_json, created_by,
                created_at, is_dismissed, proposal_fingerprint, origin,
                analysis_id, source_revision, endorsed_at, dismissed_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?14, ?9, 0, ?10, ?11,
                      ?12, ?13, NULL, NULL, ?9)
            "#,
        )
        .bind(&id)
        .bind(&proposal.source_kind)
        .bind(&proposal.source_id)
        .bind(&proposal.target_kind)
        .bind(&proposal.target_id)
        .bind(&proposal.relation_type)
        .bind(proposal.confidence)
        .bind(&proposal.provenance_json)
        .bind(&created_at)
        .bind(fingerprint)
        .bind(if proposal.origin == "user" {
            "user"
        } else {
            "ai"
        })
        .bind(&proposal.analysis_id)
        .bind(&proposal.source_revision)
        .bind(if proposal.origin == "user" { "user" } else { "ai" })
        .execute(&self.pool)
        .await;

        if let Err(error) = insert {
            if let Some(existing) = self.fetch_link_by_fingerprint(fingerprint).await? {
                return Ok(if existing.is_dismissed {
                    LinkProposalOutcome::Dismissed(existing)
                } else {
                    LinkProposalOutcome::Duplicate(existing)
                });
            }
            return Err(error.into());
        }

        let link = self.get_link_row(&id).await?;
        Ok(LinkProposalOutcome::Created(link))
    }

    /// Command-boundary proposal: validates endpoint kind/existence,
    /// revisions, confidence, relation policy, immutable origin and caps
    /// before any insert.
    pub async fn propose_link_validated(
        &self,
        proposal: ConceptLinkProposal,
    ) -> Result<LinkProposalOutcome> {
        let fingerprint = self.validate_proposal(&proposal, true).await?;
        self.insert_validated_link(&proposal, &fingerprint).await
    }

    /// List concepts for the read-only graph projection (bounded).
    pub async fn list_concepts(&self, limit: i64) -> Result<Vec<Concept>> {
        let rows = sqlx::query(
            "SELECT id, name, normalized_name, description, created_at, updated_at \
             FROM concepts ORDER BY created_at DESC LIMIT ?1",
        )
        .bind(limit.clamp(1, 2000))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_concept).collect()
    }

    /// Confirmed (endorsed) live links only — pending AI suggestions are
    /// deliberately excluded from authoritative graph edges/counts.
    pub async fn list_confirmed_links(&self, limit: i64) -> Result<Vec<ConceptLink>> {
        let sql = format!(
            "SELECT {LINK_COLUMNS} FROM concept_links \
             WHERE created_by = 'user' AND is_dismissed = 0 \
             ORDER BY created_at DESC LIMIT ?1"
        );
        let rows = sqlx::query(&sql)
            .bind(limit.clamp(1, 5000))
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(row_to_link).collect()
    }

    /// Narrow edit: validate endpoints/uniqueness; a material identity edit
    /// resets endorsement while preserving immutable origin.
    pub async fn update_link(
        &self,
        link_id: &str,
        update: ConceptLinkUpdate,
    ) -> Result<LinkUpdateOutcome> {
        let Some(current) = self.sqlx_get_link_optional(link_id).await? else {
            return Ok(LinkUpdateOutcome::NotFound);
        };

        let next = ConceptLinkProposal {
            source_kind: update
                .source_kind
                .unwrap_or_else(|| current.source_kind.clone()),
            source_id: update
                .source_id
                .unwrap_or_else(|| current.source_id.clone()),
            target_kind: update
                .target_kind
                .unwrap_or_else(|| current.target_kind.clone()),
            target_id: update
                .target_id
                .unwrap_or_else(|| current.target_id.clone()),
            relation_type: update
                .relation_type
                .unwrap_or_else(|| current.relation_type.clone()),
            confidence: update.confidence.unwrap_or(current.confidence),
            provenance_json: current.provenance_json.clone(),
            fingerprint: current.proposal_fingerprint.clone(),
            origin: current.origin.clone(),
            analysis_id: current.analysis_id.clone(),
            source_revision: update
                .source_revision
                .or_else(|| current.source_revision.clone()),
            target_revision: None,
        };

        let fingerprint = self.validate_proposal(&next, false).await?;
        if let Some(existing) = self.fetch_link_by_fingerprint(&fingerprint).await? {
            if existing.id != current.id && !existing.is_dismissed {
                return Ok(LinkUpdateOutcome::Conflict(existing));
            }
        }

        let material = next.source_kind != current.source_kind
            || next.source_id != current.source_id
            || next.target_kind != current.target_kind
            || next.target_id != current.target_id
            || next.relation_type != current.relation_type;

        // Material edits of an AI-origin row return to unendorsed state; a
        // user-created row stays user-created. Historical endorsement is not
        // silently claimed for a changed relationship.
        let (created_by, endorsed_at) = if material {
            if next.origin == "ai" {
                ("ai".to_string(), None)
            } else {
                ("user".to_string(), current.endorsed_at.clone())
            }
        } else {
            (current.created_by.clone(), current.endorsed_at.clone())
        };

        let updated_at = now_rfc3339();
        let result = sqlx::query(
            "UPDATE concept_links SET source_kind = ?1, source_id = ?2, target_kind = ?3, \
             target_id = ?4, relation_type = ?5, confidence = ?6, proposal_fingerprint = ?7, \
             created_by = ?8, endorsed_at = ?9, source_revision = ?10, updated_at = ?11 \
             WHERE id = ?12",
        )
        .bind(&next.source_kind)
        .bind(&next.source_id)
        .bind(&next.target_kind)
        .bind(&next.target_id)
        .bind(&next.relation_type)
        .bind(next.confidence)
        .bind(&fingerprint)
        .bind(&created_by)
        .bind(&endorsed_at)
        .bind(&next.source_revision)
        .bind(&updated_at)
        .bind(link_id)
        .execute(&self.pool)
        .await;

        if let Err(error) = result {
            if let Some(existing) = self.fetch_link_by_fingerprint(&fingerprint).await? {
                if existing.id != current.id && !existing.is_dismissed {
                    return Ok(LinkUpdateOutcome::Conflict(existing));
                }
            }
            return Err(error.into());
        }

        Ok(LinkUpdateOutcome::Updated(
            self.get_link_row(link_id).await?,
        ))
    }

    /// Transactional batch save used by explicit "Save suggestions".
    ///
    /// - upserts unresolved concepts and links in ONE transaction;
    /// - caps the batch at five AI proposals per analysis;
    /// - validates every endpoint before insert;
    /// - removes any newly created concept that ended with no live link
    ///   (dismissed/duplicate proposals cannot leave orphans).
    pub async fn save_proposals_batch(
        &self,
        analysis_id: &str,
        proposals: &[ConceptLinkProposal],
        new_concepts: &[NewConceptDraft],
    ) -> Result<Vec<LinkProposalOutcome>> {
        if proposals.len() > MAX_AI_LINKS_PER_ANALYSIS as usize {
            return Err(Error::Validation(format!(
                "at most {MAX_AI_LINKS_PER_ANALYSIS} proposals may be saved per analysis"
            )));
        }
        let existing_in_analysis: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM concept_links \
             WHERE origin = 'ai' AND analysis_id = ?1 AND is_dismissed = 0",
        )
        .bind(analysis_id)
        .fetch_one(&self.pool)
        .await?;
        if existing_in_analysis + proposals.len() as i64 > MAX_AI_LINKS_PER_ANALYSIS {
            return Err(Error::Validation(format!(
                "concept-link per-analysis cap reached ({MAX_AI_LINKS_PER_ANALYSIS} proposals/analysis)"
            )));
        }
        let daily_ai_links: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM concept_links \
             WHERE created_at >= ?1 \
               AND (origin = 'ai' OR (origin = 'unknown' AND created_by = 'ai'))",
        )
        .bind(utc_day_start())
        .fetch_one(&self.pool)
        .await?;
        if daily_ai_links + proposals.len() as i64 > MAX_AI_LINKS_PER_DAY {
            return Err(Error::Validation(format!(
                "concept-link daily cap reached ({MAX_AI_LINKS_PER_DAY} AI links/day)"
            )));
        }

        // Resolve/validate before opening the transaction. New concepts are
        // inserted inside it, so a later failure rolls them back.
        let mut resolved: Vec<ConceptLinkProposal> = Vec::with_capacity(proposals.len());
        let mut handle_to_name = std::collections::HashMap::new();
        for draft in new_concepts {
            if !draft.handle.starts_with("draft:concept:") {
                return Err(Error::Validation("invalid new-concept handle".into()));
            }
            if normalize_concept_name(&draft.name).is_empty() {
                return Err(Error::Validation("concept name must not be empty".into()));
            }
            handle_to_name.insert(draft.handle.clone(), draft.name.clone());
        }

        for proposal in proposals {
            let mut next = proposal.clone();
            next.origin = "ai".into();
            next.analysis_id = Some(analysis_id.to_string());
            if next.source_kind == "concept" && handle_to_name.contains_key(&next.source_id) {
                // A freshly created draft concept has no prior revision.
                next.source_revision = None;
            }
            resolved.push(next);
        }

        // Validate endpoints that are NOT draft handles now; draft concept
        // endpoints are created in the transaction below.
        for proposal in &resolved {
            Self::validate_relation_and_confidence(&proposal.relation_type, proposal.confidence)?;
            Self::validate_endpoint_kind(&proposal.source_kind)?;
            Self::validate_endpoint_kind(&proposal.target_kind)?;
            if proposal.source_kind == proposal.target_kind
                && proposal.source_id == proposal.target_id
            {
                return Err(Error::Validation(
                    "concept link cannot be a self-edge".into(),
                ));
            }
            for (kind, id) in [
                (&proposal.source_kind, &proposal.source_id),
                (&proposal.target_kind, &proposal.target_id),
            ] {
                let is_draft = kind == "concept" && handle_to_name.contains_key(id);
                if !is_draft && !self.endpoint_exists(kind, id).await? {
                    return Err(Error::Validation(
                        "concept-link endpoint does not exist".into(),
                    ));
                }
            }
            if let Some(expected) = proposal
                .source_revision
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                let is_draft = proposal.source_kind == "concept"
                    && handle_to_name.contains_key(&proposal.source_id);
                if !is_draft {
                    if let Some(current) = self
                        .endpoint_revision(&proposal.source_kind, &proposal.source_id)
                        .await?
                    {
                        if current != expected {
                            return Err(Error::Validation(
                                "concept-link source revision is stale".into(),
                            ));
                        }
                    }
                }
            }
            if let Some(expected) = proposal
                .target_revision
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                let is_draft = proposal.target_kind == "concept"
                    && handle_to_name.contains_key(&proposal.target_id);
                if !is_draft {
                    if let Some(current) = self
                        .endpoint_revision(&proposal.target_kind, &proposal.target_id)
                        .await?
                    {
                        if current != expected {
                            return Err(Error::Validation(
                                "concept-link target revision is stale".into(),
                            ));
                        }
                    }
                }
            }
        }

        let mut tx = self.pool.begin().await?;
        let mut created_concepts: Vec<(String, String)> = Vec::new();
        let mut handle_ids: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        for draft in new_concepts {
            let normalized = normalize_concept_name(&draft.name);
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO concepts (id, name, normalized_name, description) \
                 VALUES (?1, ?2, ?3, NULLIF(?4, '')) \
                 ON CONFLICT(normalized_name) DO UPDATE SET \
                    description = COALESCE(NULLIF(?4, ''), concepts.description), \
                    updated_at = datetime('now')",
            )
            .bind(&id)
            .bind(draft.name.trim())
            .bind(&normalized)
            .bind(draft.description.clone().unwrap_or_default())
            .execute(&mut *tx)
            .await?;
            let resolved_id: String =
                sqlx::query_scalar("SELECT id FROM concepts WHERE normalized_name = ?1")
                    .bind(&normalized)
                    .fetch_one(&mut *tx)
                    .await?;
            handle_ids.insert(draft.handle.clone(), resolved_id.clone());
            created_concepts.push((resolved_id, draft.handle.clone()));
        }

        let mut outcomes = Vec::with_capacity(resolved.len());
        for mut proposal in resolved {
            if proposal.source_kind == "concept" {
                if let Some(id) = handle_ids.get(&proposal.source_id) {
                    proposal.source_id = id.clone();
                }
            }
            if proposal.target_kind == "concept" {
                if let Some(id) = handle_ids.get(&proposal.target_id) {
                    proposal.target_id = id.clone();
                }
            }
            if proposal.source_kind == proposal.target_kind
                && proposal.source_id == proposal.target_id
            {
                return Err(Error::Validation(
                    "concept link cannot be a self-edge".into(),
                ));
            }

            let fingerprint = canonical_link_fingerprint(
                &proposal.source_kind,
                &proposal.source_id,
                &proposal.target_kind,
                &proposal.target_id,
                &proposal.relation_type,
                proposal.source_revision.as_deref(),
                proposal.target_revision.as_deref(),
            );

            let existing = sqlx::query(&format!(
                "SELECT {LINK_COLUMNS} FROM concept_links \
                 WHERE proposal_fingerprint = ?1 LIMIT 1"
            ))
            .bind(&fingerprint)
            .fetch_optional(&mut *tx)
            .await?;

            if let Some(row) = existing {
                let link = row_to_link(&row)?;
                outcomes.push(if link.is_dismissed {
                    LinkProposalOutcome::Dismissed(link)
                } else {
                    LinkProposalOutcome::Duplicate(link)
                });
                continue;
            }

            let id = uuid::Uuid::new_v4().to_string();
            let created_at = now_rfc3339();
            let inserted = sqlx::query(
                "INSERT INTO concept_links (id, source_kind, source_id, target_kind, target_id, \
                 relation_type, confidence, provenance_json, created_by, created_at, is_dismissed, \
                 proposal_fingerprint, origin, analysis_id, source_revision, endorsed_at, dismissed_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ai', ?9, 0, ?10, 'ai', ?11, ?12, NULL, NULL, ?9)",
            )
            .bind(&id)
            .bind(&proposal.source_kind)
            .bind(&proposal.source_id)
            .bind(&proposal.target_kind)
            .bind(&proposal.target_id)
            .bind(&proposal.relation_type)
            .bind(proposal.confidence)
            .bind(&proposal.provenance_json)
            .bind(&created_at)
            .bind(&fingerprint)
            .bind(&proposal.analysis_id)
            .bind(&proposal.source_revision)
            .execute(&mut *tx)
            .await;

            if let Err(error) = inserted {
                // A concurrent save may have committed the same canonical
                // fingerprint first; resolve to that row instead of failing.
                let existing = sqlx::query(&format!(
                    "SELECT {LINK_COLUMNS} FROM concept_links \
                     WHERE proposal_fingerprint = ?1 LIMIT 1"
                ))
                .bind(&fingerprint)
                .fetch_optional(&mut *tx)
                .await?;
                if let Some(row) = existing {
                    let link = row_to_link(&row)?;
                    outcomes.push(if link.is_dismissed {
                        LinkProposalOutcome::Dismissed(link)
                    } else {
                        LinkProposalOutcome::Duplicate(link)
                    });
                    continue;
                }
                return Err(error.into());
            }

            let link = sqlx::query(&format!(
                "SELECT {LINK_COLUMNS} FROM concept_links WHERE id = ?1"
            ))
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
            outcomes.push(LinkProposalOutcome::Created(row_to_link(&link)?));
        }

        // No orphan concepts: a new concept that no link references (live OR
        // dismissed history) is removed. Dismissed/duplicate proposals must
        // not leave artifacts, but dismissal history keeps its endpoint.
        for (concept_id, _) in &created_concepts {
            let links: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM concept_links \
                 WHERE (source_kind = 'concept' AND source_id = ?1) OR \
                       (target_kind = 'concept' AND target_id = ?1)",
            )
            .bind(concept_id.as_str())
            .fetch_one(&mut *tx)
            .await?;
            if links == 0 {
                sqlx::query("DELETE FROM concepts WHERE id = ?1")
                    .bind(concept_id.as_str())
                    .execute(&mut *tx)
                    .await?;
            }
        }

        tx.commit().await?;
        Ok(outcomes)
    }

    async fn sqlx_get_link_optional(&self, link_id: &str) -> Result<Option<ConceptLink>> {
        let row = sqlx::query(&format!(
            "SELECT {LINK_COLUMNS} FROM concept_links WHERE id = ?1"
        ))
        .bind(link_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|r| row_to_link(&r)).transpose()
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

    /// Accept a proposal: records user endorsement (`created_by = 'user'`)
    /// while preserving IMMUTABLE `origin`. Acceptance never releases the AI
    /// quota (which counts origin, not created_by).
    pub async fn accept_link(&self, link_id: &str) -> Result<Option<ConceptLink>> {
        let now = now_rfc3339();
        let updated = sqlx::query(
            "UPDATE concept_links \
             SET created_by = 'user', endorsed_at = COALESCE(endorsed_at, ?2), updated_at = ?2 \
             WHERE id = ?1 AND is_dismissed = 0",
        )
        .bind(link_id)
        .bind(&now)
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
        let now = now_rfc3339();
        let updated = sqlx::query(
            "UPDATE concept_links \
             SET is_dismissed = 1, dismissed_at = ?2, updated_at = ?2 \
             WHERE id = ?1",
        )
        .bind(link_id)
        .bind(&now)
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
                   l.origin, l.analysis_id, l.source_revision, l.endorsed_at,
                   l.dismissed_at, l.updated_at,
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

    async fn seed_evidence_endpoints(repo: &ConceptRepository) {
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, content_hash, date_added, date_modified)
             VALUES ('doc-1', 'Doc', '/tmp/doc.txt', 'text', 'Gravity is a force.', 'doc-rev',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .expect("seed document");
        sqlx::query(
            "INSERT INTO extracts (id, document_id, content, date_created, date_modified)
             VALUES ('ext-1', 'doc-1', 'Gravity extract', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .expect("seed extract");
        sqlx::query(
            "INSERT INTO learning_items (id, document_id, item_type, question, date_created, date_modified, due_date)
             VALUES ('card-1', 'doc-1', 'flashcard', 'What is gravity?',
                     '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z', '2026-01-04T00:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .expect("seed card");
        sqlx::query(
            "INSERT INTO annotations (id, document_id, type, page_number, content, color, date_created, date_modified)
             VALUES ('ann-1', 'doc-1', 'highlight', 1, 'Gravity annotation', '#ffff00',
                     '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z')",
        )
        .execute(repo.pool())
        .await
        .expect("seed annotation");
    }

    fn validated_proposal(concept_id: &str, analysis_id: Option<&str>) -> ConceptLinkProposal {
        ConceptLinkProposal {
            source_kind: "document".into(),
            source_id: "doc-1".into(),
            target_kind: "concept".into(),
            target_id: concept_id.into(),
            relation_type: "prerequisite-of".into(),
            confidence: 0.9,
            provenance_json: Some(r#"{"origin":"ai"}"#.into()),
            fingerprint: None,
            origin: "ai".into(),
            analysis_id: analysis_id.map(str::to_string),
            source_revision: Some("doc-rev".into()),
            target_revision: None,
        }
    }

    #[tokio::test]
    async fn test_validated_proposal_checks_endpoints_and_revisions() {
        let repo = setup().await;
        seed_evidence_endpoints(&repo).await;
        let concept = repo.upsert_concept("Gravity", None).await.unwrap();

        let LinkProposalOutcome::Created(link) = repo
            .propose_link_validated(validated_proposal(&concept.id, Some("analysis-v1")))
            .await
            .unwrap()
        else {
            panic!("expected Created")
        };
        assert_eq!(link.origin, "ai");
        assert_eq!(link.analysis_id.as_deref(), Some("analysis-v1"));
        assert_eq!(link.source_revision.as_deref(), Some("doc-rev"));
        assert!(!link.is_dismissed);

        let mut missing = validated_proposal(&concept.id, None);
        missing.source_id = "missing-document".into();
        let error = repo.propose_link_validated(missing).await.unwrap_err();
        assert!(error.to_string().contains("does not exist"), "got: {error}");

        let mut stale = validated_proposal(&concept.id, None);
        stale.source_revision = Some("old-revision".into());
        let error = repo.propose_link_validated(stale).await.unwrap_err();
        assert!(error.to_string().contains("stale"), "got: {error}");

        let mut unknown_kind = validated_proposal(&concept.id, None);
        unknown_kind.target_kind = "tag".into();
        let error = repo.propose_link_validated(unknown_kind).await.unwrap_err();
        assert!(error.to_string().contains("endpoint kind"), "got: {error}");
    }

    #[tokio::test]
    async fn test_per_analysis_cap_is_backend_enforced() {
        let repo = setup().await;
        seed_evidence_endpoints(&repo).await;
        for index in 0..MAX_AI_LINKS_PER_ANALYSIS {
            let concept = repo
                .upsert_concept(&format!("Concept {index}"), None)
                .await
                .unwrap();
            repo.propose_link_validated(validated_proposal(&concept.id, Some("analysis-cap")))
                .await
                .expect("within cap");
        }
        let overflow = repo.upsert_concept("Overflow", None).await.unwrap();
        let error = repo
            .propose_link_validated(validated_proposal(&overflow.id, Some("analysis-cap")))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("per-analysis"), "got: {error}");

        // A different analysis has its own budget.
        repo.propose_link_validated(validated_proposal(&overflow.id, Some("analysis-other")))
            .await
            .expect("separate analysis budget");
    }

    #[tokio::test]
    async fn test_acceptance_cannot_release_daily_quota() {
        let repo = setup().await;
        seed_evidence_endpoints(&repo).await;
        let concept = repo.upsert_concept("Gravity", None).await.unwrap();
        let now = now_rfc3339();
        for index in 0..MAX_AI_LINKS_PER_DAY {
            sqlx::query(
                "INSERT INTO concept_links (id, source_kind, source_id, target_kind, target_id, \
                 relation_type, confidence, created_by, created_at, is_dismissed, origin) \
                 VALUES (?1, 'document', 'doc-1', 'concept', ?2, 'related-to', 0.8, 'ai', ?3, 0, 'ai')",
            )
            .bind(format!("quota-{index}"))
            .bind(&concept.id)
            .bind(&now)
            .execute(repo.pool())
            .await
            .unwrap();
        }

        let accepted = repo
            .accept_link("quota-0")
            .await
            .unwrap()
            .expect("accepted");
        assert_eq!(accepted.created_by, "user");
        assert_eq!(accepted.origin, "ai", "origin is immutable");
        assert!(accepted.endorsed_at.is_some());

        let error = repo
            .propose_link_validated(validated_proposal(&concept.id, None))
            .await
            .unwrap_err();
        assert!(
            error.to_string().to_lowercase().contains("cap"),
            "got: {error}"
        );
    }

    #[tokio::test]
    async fn test_material_edit_resets_endorsement_and_conflicts_are_surfaced() {
        let repo = setup().await;
        let a = repo.upsert_concept("Concept A", None).await.unwrap();
        let b = repo.upsert_concept("Concept B", None).await.unwrap();
        let c = repo.upsert_concept("Concept C", None).await.unwrap();

        let make_link = |target: &str, fingerprint: &str| ConceptLinkProposal {
            source_kind: "concept".into(),
            source_id: a.id.clone(),
            target_kind: "concept".into(),
            target_id: target.to_string(),
            relation_type: "supports".into(),
            confidence: 0.9,
            provenance_json: None,
            fingerprint: Some(fingerprint.into()),
            origin: "ai".into(),
            analysis_id: None,
            source_revision: None,
            target_revision: None,
        };

        let LinkProposalOutcome::Created(link_b) = repo
            .propose_link_validated(make_link(&b.id, "ignored-b"))
            .await
            .unwrap()
        else {
            panic!("link b")
        };
        let LinkProposalOutcome::Created(link_c) = repo
            .propose_link_validated(make_link(&c.id, "ignored-c"))
            .await
            .unwrap()
        else {
            panic!("link c")
        };

        // Accept link C, then try to retarget link B onto C: conflict, original
        // link B remains intact.
        repo.accept_link(&link_c.id).await.unwrap();
        let conflict = repo
            .update_link(
                &link_b.id,
                ConceptLinkUpdate {
                    target_id: Some(c.id.clone()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        match conflict {
            LinkUpdateOutcome::Conflict(existing) => assert_eq!(existing.id, link_c.id),
            other => panic!("expected conflict, got {other:?}"),
        }
        let original = repo.get_link_row(&link_b.id).await.unwrap();
        assert_eq!(original.target_id, b.id);

        // Material edit resets AI endorsement.
        repo.accept_link(&link_b.id).await.unwrap();
        let updated = repo
            .update_link(
                &link_b.id,
                ConceptLinkUpdate {
                    relation_type: Some("extends".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let LinkUpdateOutcome::Updated(updated) = updated else {
            panic!("expected updated")
        };
        assert_eq!(updated.relation_type, "extends");
        assert_eq!(updated.origin, "ai", "origin survives the edit");
        assert_eq!(updated.created_by, "ai", "material edit resets endorsement");
        assert!(updated.endorsed_at.is_none());

        // A non-material confidence edit keeps endorsement.
        repo.accept_link(&link_b.id).await.unwrap();
        let updated = repo
            .update_link(
                &link_b.id,
                ConceptLinkUpdate {
                    confidence: Some(0.7),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let LinkUpdateOutcome::Updated(updated) = updated else {
            panic!("expected updated")
        };
        assert_eq!(updated.created_by, "user");
        assert!(updated.endorsed_at.is_some());
    }

    #[tokio::test]
    async fn test_batch_save_is_transactional_and_leaves_no_orphan_concepts() {
        let repo = setup().await;
        seed_evidence_endpoints(&repo).await;

        let created = repo
            .save_proposals_batch(
                "analysis-batch",
                &[ConceptLinkProposal {
                    source_kind: "document".into(),
                    source_id: "doc-1".into(),
                    target_kind: "concept".into(),
                    target_id: "draft:concept:0".into(),
                    relation_type: "supports".into(),
                    confidence: 0.9,
                    provenance_json: None,
                    fingerprint: None,
                    origin: "ai".into(),
                    analysis_id: Some("analysis-batch".into()),
                    source_revision: Some("doc-rev".into()),
                    target_revision: None,
                }],
                &[NewConceptDraft {
                    handle: "draft:concept:0".into(),
                    name: "Atomic Concept".into(),
                    description: None,
                }],
            )
            .await
            .unwrap();
        assert!(matches!(created[0], LinkProposalOutcome::Created(_)));
        let concept = repo
            .find_concepts_by_names(&["atomic concept".into()])
            .await
            .unwrap();
        assert_eq!(concept.len(), 1);

        // Invalid second endpoint: the whole batch (including the new concept)
        // rolls back before the transaction is committed.
        let error = repo
            .save_proposals_batch(
                "analysis-fail",
                &[
                    ConceptLinkProposal {
                        source_kind: "document".into(),
                        source_id: "doc-1".into(),
                        target_kind: "concept".into(),
                        target_id: "draft:concept:1".into(),
                        relation_type: "supports".into(),
                        confidence: 0.9,
                        provenance_json: None,
                        fingerprint: None,
                        origin: "ai".into(),
                        analysis_id: Some("analysis-fail".into()),
                        source_revision: None,
                        target_revision: None,
                    },
                    ConceptLinkProposal {
                        source_kind: "document".into(),
                        source_id: "missing-doc".into(),
                        target_kind: "concept".into(),
                        target_id: "draft:concept:1".into(),
                        relation_type: "supports".into(),
                        confidence: 0.9,
                        provenance_json: None,
                        fingerprint: None,
                        origin: "ai".into(),
                        analysis_id: Some("analysis-fail".into()),
                        source_revision: None,
                        target_revision: None,
                    },
                ],
                &[NewConceptDraft {
                    handle: "draft:concept:1".into(),
                    name: "Rolled Back Concept".into(),
                    description: None,
                }],
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("does not exist"), "got: {error}");
        assert!(repo
            .find_concepts_by_names(&["rolled back concept".into()])
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn test_confirmed_projection_excludes_pending_and_dismissed() {
        let repo = setup().await;
        seed_evidence_endpoints(&repo).await;
        let concept = repo.upsert_concept("Projected", None).await.unwrap();
        let LinkProposalOutcome::Created(pending) = repo
            .propose_link_validated(validated_proposal(&concept.id, None))
            .await
            .unwrap()
        else {
            panic!("pending")
        };
        assert!(repo.list_confirmed_links(100).await.unwrap().is_empty());

        repo.accept_link(&pending.id).await.unwrap();
        let confirmed = repo.list_confirmed_links(100).await.unwrap();
        assert_eq!(confirmed.len(), 1);
        assert_eq!(confirmed[0].origin, "ai");
        assert_eq!(confirmed[0].created_by, "user");

        repo.dismiss_link(&pending.id).await.unwrap();
        assert!(repo.list_confirmed_links(100).await.unwrap().is_empty());
    }

    #[test]
    fn test_canonical_fingerprint_symmetric_and_directional() {
        let symmetric = canonical_link_fingerprint(
            "concept",
            "a",
            "concept",
            "b",
            "same-as",
            Some("r1"),
            Some("r2"),
        );
        let reversed = canonical_link_fingerprint(
            "concept",
            "b",
            "concept",
            "a",
            "same-as",
            Some("r2"),
            Some("r1"),
        );
        assert_eq!(symmetric, reversed);

        let forward = canonical_link_fingerprint(
            "concept",
            "a",
            "concept",
            "b",
            "prerequisite-of",
            None,
            None,
        );
        let backward = canonical_link_fingerprint(
            "concept",
            "b",
            "concept",
            "a",
            "prerequisite-of",
            None,
            None,
        );
        assert_ne!(forward, backward);
    }
}
