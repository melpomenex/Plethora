//! Study source resolution, validation, and persistence repository.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §2
//! - openspec/changes/establish-persistent-study-plans/

use crate::models::study_source::{
    FieldIssue, RevisionKind, StudyCommandError, StudyErrorCode, StudySourceChunk,
    StudySourceNavigation, StudySourceRefInput, StudySourceRefV1, StudySourceResolution,
    StudySourceStatus,
};
use chrono::Utc;
use sha2::{Digest, Sha256};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::HashMap;
use uuid::Uuid;

pub const EXCERPT_MIN_CHARS: usize = 1;
pub const EXCERPT_MAX_CHARS: usize = 1600;

pub fn compute_sha256(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let result = hasher.finalize();
    format!("sha256:{:x}", result)
}

pub fn compute_excerpt_sha256(excerpt: &str) -> String {
    let normalized = excerpt.replace("\r\n", "\n");
    compute_sha256(&normalized)
}

#[derive(Clone)]
pub struct StudySourceRepository {
    pool: Pool<Sqlite>,
}

impl StudySourceRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Resolves an array of source reference inputs against live documents and extracts in SQLite.
    ///
    /// Determines:
    /// - Live revision (content_hash -> date_modified -> unknown)
    /// - Exact live excerpt match, multiplicity check (ambiguous if multiple matches)
    /// - Source status (current, stale, missing, ambiguous, unsupported)
    /// - Navigation fidelity (exact, coarse, unavailable)
    /// - Deduplication against existing study_source_refs
    pub async fn resolve_study_source_refs(
        &self,
        inputs: &[StudySourceRefInput],
    ) -> Result<Vec<StudySourceResolution>, StudyCommandError> {
        let mut resolutions = Vec::with_capacity(inputs.len());

        for (idx, input) in inputs.iter().enumerate() {
            // Validate input document ID
            if input.document_id.trim().is_empty() {
                return Err(StudyCommandError::invalid_input(
                    "study_source.error.required_document_id",
                    vec![FieldIssue {
                        path: format!("inputs[{}].documentId", idx),
                        code: "required_field".to_string(),
                        message_key: "study_source.error.required_document_id".to_string(),
                    }],
                ));
            }

            // Normalize and validate excerpt
            let normalized_excerpt = input.excerpt.replace("\r\n", "\n");
            if normalized_excerpt.trim().is_empty()
                || normalized_excerpt.len() < EXCERPT_MIN_CHARS
                || normalized_excerpt.len() > EXCERPT_MAX_CHARS
            {
                return Err(StudyCommandError::invalid_input(
                    "study_source.error.invalid_excerpt_length",
                    vec![FieldIssue {
                        path: format!("inputs[{}].excerpt", idx),
                        code: "invalid_excerpt_length".to_string(),
                        message_key: "study_source.error.invalid_excerpt_length".to_string(),
                    }],
                ));
            }

            let excerpt_sha = compute_excerpt_sha256(&normalized_excerpt);

            // Fetch live document
            let doc_row = sqlx::query(
                "SELECT id, title, file_type, content, content_hash, date_modified, is_local_only, is_ai_excluded
                 FROM documents WHERE id = ?1 LIMIT 1",
            )
            .bind(&input.document_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

            if doc_row.is_none() {
                // Document not found in library -> Missing
                let ref_id = self
                    .find_or_create_ref_id(
                        &input.document_id,
                        input.revision.as_deref().unwrap_or("unknown"),
                        &excerpt_sha,
                        input.extract_id.as_deref(),
                    )
                    .await?;

                let ref_item = StudySourceRefV1 {
                    schema_version: 1,
                    id: ref_id,
                    document_id: input.document_id.clone(),
                    extract_id: input.extract_id.clone(),
                    excerpt: normalized_excerpt,
                    excerpt_sha256: excerpt_sha,
                    revision: input
                        .revision
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string()),
                    revision_kind: input.revision_kind.unwrap_or(RevisionKind::Unknown),
                    document_title: input
                        .document_title
                        .clone()
                        .unwrap_or_else(|| "Unknown Document".to_string()),
                    source_type: input
                        .source_type
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string()),
                    jump: input.jump.clone(),
                    chunk: input.chunk.clone(),
                    section_label: input.section_label.clone(),
                    captured_at: Utc::now().to_rfc3339(),
                };

                resolutions.push(StudySourceResolution {
                    ref_item,
                    status: StudySourceStatus::Missing,
                    navigation: StudySourceNavigation::Unavailable,
                    reason_key: Some("study_source.missing.document_not_found".to_string()),
                });
                continue;
            }

            let doc = doc_row.unwrap();
            let doc_title: String = doc
                .try_get("title")
                .unwrap_or_else(|_| "Untitled".to_string());
            let doc_file_type: String = doc
                .try_get("file_type")
                .unwrap_or_else(|_| "unknown".to_string());
            let doc_content_hash: Option<String> = doc.try_get("content_hash").ok().flatten();
            let doc_date_modified: String = doc
                .try_get("date_modified")
                .unwrap_or_else(|_| Utc::now().to_rfc3339());
            let doc_content: Option<String> = doc.try_get("content").ok().flatten();
            let is_ai_excluded: bool = doc.try_get("is_ai_excluded").unwrap_or(false);

            // Determine live revision
            let (live_revision, live_revision_kind) = if let Some(ref hash) = doc_content_hash {
                if !hash.trim().is_empty() {
                    (hash.clone(), RevisionKind::ContentHash)
                } else {
                    (doc_date_modified.clone(), RevisionKind::ModifiedAt)
                }
            } else if !doc_date_modified.trim().is_empty() {
                (doc_date_modified.clone(), RevisionKind::ModifiedAt)
            } else {
                ("unknown".to_string(), RevisionKind::Unknown)
            };

            let mut revision_mismatch = false;
            if let Some(ref supplied_rev) = input.revision {
                if supplied_rev != &live_revision {
                    revision_mismatch = true;
                }
            }

            // Validate excerpt in extract or document content
            let mut status = StudySourceStatus::Current;
            let mut navigation = StudySourceNavigation::Exact;
            let mut reason_key: Option<String> = None;

            if let Some(ref ext_id) = input.extract_id {
                let ext_row = sqlx::query(
                    "SELECT id, document_id, content FROM extracts WHERE id = ?1 LIMIT 1",
                )
                .bind(ext_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

                if ext_row.is_none() {
                    status = StudySourceStatus::Missing;
                    navigation = StudySourceNavigation::Unavailable;
                    reason_key = Some("study_source.missing.extract_not_found".to_string());
                } else {
                    let ext = ext_row.unwrap();
                    let ext_doc_id: String = ext.try_get("document_id").unwrap_or_default();
                    if ext_doc_id != input.document_id {
                        return Err(StudyCommandError::invalid_input(
                            "study_source.error.extract_document_mismatch",
                            vec![FieldIssue {
                                path: format!("inputs[{}].extractId", idx),
                                code: "extract_document_mismatch".to_string(),
                                message_key: "study_source.error.extract_document_mismatch"
                                    .to_string(),
                            }],
                        ));
                    }
                    let ext_content: String = ext.try_get("content").unwrap_or_default();
                    let norm_ext_content = ext_content.replace("\r\n", "\n");
                    let match_count = norm_ext_content.matches(&normalized_excerpt).count();

                    if match_count == 0 {
                        status = StudySourceStatus::Stale;
                        navigation = StudySourceNavigation::Coarse;
                        reason_key = Some("study_source.stale.excerpt_not_in_extract".to_string());
                    } else if match_count > 1 {
                        status = StudySourceStatus::Ambiguous;
                        navigation = StudySourceNavigation::Coarse;
                        reason_key = Some("study_source.ambiguous.multiple_matches".to_string());
                    }
                }
            } else if let Some(ref full_content) = doc_content {
                let norm_full_content = full_content.replace("\r\n", "\n");
                let match_count = norm_full_content.matches(&normalized_excerpt).count();

                if match_count == 0 {
                    status = StudySourceStatus::Stale;
                    navigation = StudySourceNavigation::Coarse;
                    reason_key = Some("study_source.stale.excerpt_not_in_document".to_string());
                } else if match_count > 1 {
                    status = StudySourceStatus::Ambiguous;
                    navigation = StudySourceNavigation::Coarse;
                    reason_key = Some("study_source.ambiguous.multiple_matches".to_string());
                }
            }

            if revision_mismatch && status == StudySourceStatus::Current {
                status = StudySourceStatus::Stale;
                navigation = StudySourceNavigation::Coarse;
                reason_key = Some("study_source.stale.revision_mismatch".to_string());
            }

            // Validate jump kind compatibility
            if let Some(ref jump) = input.jump {
                if let Some(kind_val) = jump.get("kind").and_then(|k| k.as_str()) {
                    let doc_type_lower = doc_file_type.to_lowercase();
                    if (doc_type_lower == "pdf" && kind_val != "pdf")
                        || (doc_type_lower == "epub" && kind_val != "epub")
                        || (doc_type_lower == "youtube" && kind_val != "youtube")
                        || (doc_type_lower == "audio" && kind_val != "audio")
                    {
                        navigation = StudySourceNavigation::Unavailable;
                        reason_key =
                            Some("study_source.unsupported.jump_kind_mismatch".to_string());
                    }

                    // Validate per-kind numeric invariants
                    if kind_val == "pdf" {
                        if let Some(page) = jump.get("pageNumber").and_then(|p| p.as_i64()) {
                            if page < 1 {
                                navigation = StudySourceNavigation::Unavailable;
                                reason_key = Some("study_source.invalid.pdf_page".to_string());
                            }
                        }
                    } else if kind_val == "youtube" || kind_val == "audio" {
                        if let Some(sec) = jump.get("timeSeconds").and_then(|s| s.as_f64()) {
                            if sec < 0.0 || !sec.is_finite() {
                                navigation = StudySourceNavigation::Unavailable;
                                reason_key = Some("study_source.invalid.media_time".to_string());
                            }
                        }
                    }
                }
            }

            if is_ai_excluded && reason_key.is_none() {
                reason_key = Some("study_source.meta.ai_excluded".to_string());
            }

            let ref_id = self
                .find_or_create_ref_id(
                    &input.document_id,
                    &live_revision,
                    &excerpt_sha,
                    input.extract_id.as_deref(),
                )
                .await?;

            let ref_item = StudySourceRefV1 {
                schema_version: 1,
                id: ref_id,
                document_id: input.document_id.clone(),
                extract_id: input.extract_id.clone(),
                excerpt: normalized_excerpt,
                excerpt_sha256: excerpt_sha,
                revision: live_revision,
                revision_kind: live_revision_kind,
                document_title: doc_title,
                source_type: doc_file_type,
                jump: input.jump.clone(),
                chunk: input.chunk.clone(),
                section_label: input.section_label.clone(),
                captured_at: Utc::now().to_rfc3339(),
            };

            resolutions.push(StudySourceResolution {
                ref_item,
                status,
                navigation,
                reason_key,
            });
        }

        Ok(resolutions)
    }

    /// Finds an existing study_source_refs row ID matching the content tuple,
    /// or generates a fresh `ssr_<uuid>`.
    async fn find_or_create_ref_id(
        &self,
        document_id: &str,
        revision: &str,
        excerpt_sha256: &str,
        extract_id: Option<&str>,
    ) -> Result<String, StudyCommandError> {
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM study_source_refs
             WHERE document_id = ?1 AND revision = ?2 AND excerpt_sha256 = ?3 AND COALESCE(extract_id, '') = COALESCE(?4, '')
             LIMIT 1",
        )
        .bind(document_id)
        .bind(revision)
        .bind(excerpt_sha256)
        .bind(extract_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        Ok(existing.unwrap_or_else(|| format!("ssr_{}", Uuid::new_v4())))
    }

    /// Upserts a source reference row inside an ongoing transaction.
    /// Relies on the unique index on `(document_id, revision, excerpt_sha256, COALESCE(extract_id, ''))`
    /// to deduplicate and return the canonical persisted ID.
    pub async fn upsert_source_ref_in_tx(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        ref_item: &StudySourceRefV1,
    ) -> Result<String, StudyCommandError> {
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM study_source_refs
             WHERE document_id = ?1 AND revision = ?2 AND excerpt_sha256 = ?3 AND COALESCE(extract_id, '') = COALESCE(?4, '')
             LIMIT 1",
        )
        .bind(&ref_item.document_id)
        .bind(&ref_item.revision)
        .bind(&ref_item.excerpt_sha256)
        .bind(ref_item.extract_id.as_deref())
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        if let Some(id) = existing {
            return Ok(id);
        }

        let jump_json = ref_item
            .jump
            .as_ref()
            .map(|j| serde_json::to_string(j).unwrap_or_default());

        let chunk_json = ref_item
            .chunk
            .as_ref()
            .map(|c| serde_json::to_string(c).unwrap_or_default());

        sqlx::query(
            "INSERT INTO study_source_refs (
                id, schema_version, document_id, extract_id, excerpt, excerpt_sha256,
                revision, revision_kind, document_title, source_type, jump_json,
                chunk_json, section_label, captured_at
             ) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        )
        .bind(&ref_item.id)
        .bind(&ref_item.document_id)
        .bind(ref_item.extract_id.as_deref())
        .bind(&ref_item.excerpt)
        .bind(&ref_item.excerpt_sha256)
        .bind(&ref_item.revision)
        .bind(ref_item.revision_kind.to_string())
        .bind(&ref_item.document_title)
        .bind(&ref_item.source_type)
        .bind(jump_json)
        .bind(chunk_json)
        .bind(ref_item.section_label.as_deref())
        .bind(&ref_item.captured_at)
        .execute(&mut **tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        Ok(ref_item.id.clone())
    }

    /// Fetches a single source reference by ID.
    pub async fn get_source_ref(
        &self,
        id: &str,
    ) -> Result<Option<StudySourceRefV1>, StudyCommandError> {
        let row = sqlx::query(
            "SELECT id, schema_version, document_id, extract_id, excerpt, excerpt_sha256,
                    revision, revision_kind, document_title, source_type, jump_json,
                    chunk_json, section_label, captured_at
             FROM study_source_refs WHERE id = ?1 LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        Ok(row.map(|r| self.map_source_ref_row(&r)))
    }

    /// Fetches a batch of source references by their IDs.
    pub async fn get_source_refs_batch(
        &self,
        ids: &[String],
    ) -> Result<HashMap<String, StudySourceRefV1>, StudyCommandError> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut results = HashMap::with_capacity(ids.len());
        // Batch in chunks of 50 to respect SQLite parameter limits
        for chunk in ids.chunks(50) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT id, schema_version, document_id, extract_id, excerpt, excerpt_sha256,
                        revision, revision_kind, document_title, source_type, jump_json,
                        chunk_json, section_label, captured_at
                 FROM study_source_refs WHERE id IN ({})",
                placeholders
            );

            let mut query = sqlx::query(&sql);
            for id in chunk {
                query = query.bind(id);
            }

            let rows = query
                .fetch_all(&self.pool)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

            for r in rows {
                let ref_item = self.map_source_ref_row(&r);
                results.insert(ref_item.id.clone(), ref_item);
            }
        }

        Ok(results)
    }

    /// Cleans up unreferenced study source refs.
    pub async fn cleanup_unused_source_refs_in_tx(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
    ) -> Result<u64, StudyCommandError> {
        let result = sqlx::query(
            "DELETE FROM study_source_refs
             WHERE id NOT IN (
                 SELECT source_ref_id FROM study_plan_node_sources
                 UNION
                 SELECT source_ref_id FROM study_plan_prerequisite_sources
             )",
        )
        .execute(&mut **tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        Ok(result.rows_affected())
    }

    fn map_source_ref_row(&self, r: &sqlx::sqlite::SqliteRow) -> StudySourceRefV1 {
        let rev_kind_str: String = r
            .try_get("revision_kind")
            .unwrap_or_else(|_| "unknown".to_string());
        let jump_json: Option<String> = r.try_get("jump_json").ok().flatten();
        let chunk_json: Option<String> = r.try_get("chunk_json").ok().flatten();

        StudySourceRefV1 {
            schema_version: r.try_get("schema_version").unwrap_or(1),
            id: r.try_get("id").unwrap_or_default(),
            document_id: r.try_get("document_id").unwrap_or_default(),
            extract_id: r.try_get("extract_id").ok().flatten(),
            excerpt: r.try_get("excerpt").unwrap_or_default(),
            excerpt_sha256: r.try_get("excerpt_sha256").unwrap_or_default(),
            revision: r.try_get("revision").unwrap_or_default(),
            revision_kind: rev_kind_str.parse().unwrap_or(RevisionKind::Unknown),
            document_title: r.try_get("document_title").unwrap_or_default(),
            source_type: r.try_get("source_type").unwrap_or_default(),
            jump: jump_json.and_then(|j| serde_json::from_str(&j).ok()),
            chunk: chunk_json.and_then(|c| serde_json::from_str(&c).ok()),
            section_label: r.try_get("section_label").ok().flatten(),
            captured_at: r.try_get("captured_at").unwrap_or_default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn create_test_db() -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        crate::database::migrations::run_migrations(&pool)
            .await
            .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_resolve_exact_document_and_extract_resolution() {
        let pool = create_test_db().await;
        let repo = StudySourceRepository::new(pool.clone());

        // Seed a document
        sqlx::query(
            "INSERT INTO documents (id, collection_id, title, file_path, file_type, content, content_hash, date_added, date_modified)
             VALUES ('doc_raft', '00000000-0000-0000-0000-000000000001', 'In Search of an Understandable Consensus Algorithm', '/path/raft.pdf', 'pdf',
                     'Raft is a consensus algorithm for managing a replicated log. It produces a result equivalent to Paxos.', 'hash_raft_v1', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).execute(&pool).await.unwrap();

        // Seed an extract
        sqlx::query(
            "INSERT INTO extracts (id, collection_id, document_id, content, date_created, date_modified)
             VALUES ('ext_1', '00000000-0000-0000-0000-000000000001', 'doc_raft', 'Raft is a consensus algorithm for managing a replicated log.', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).execute(&pool).await.unwrap();

        // 1. Exact current document ref
        let inputs = vec![
            StudySourceRefInput {
                document_id: "doc_raft".to_string(),
                extract_id: None,
                excerpt: "Raft is a consensus algorithm for managing a replicated log.".to_string(),
                excerpt_sha256: None,
                revision: None,
                revision_kind: None,
                document_title: None,
                source_type: Some("pdf".to_string()),
                jump: Some(serde_json::json!({ "kind": "pdf", "pageNumber": 1 })),
                chunk: None,
                section_label: Some("Abstract".to_string()),
            },
            StudySourceRefInput {
                document_id: "doc_raft".to_string(),
                extract_id: Some("ext_1".to_string()),
                excerpt: "Raft is a consensus algorithm".to_string(),
                excerpt_sha256: None,
                revision: Some("hash_raft_v1".to_string()),
                revision_kind: Some(RevisionKind::ContentHash),
                document_title: None,
                source_type: Some("pdf".to_string()),
                jump: None,
                chunk: None,
                section_label: None,
            },
        ];

        let results = repo.resolve_study_source_refs(&inputs).await.unwrap();
        assert_eq!(results.len(), 2);

        // Document ref
        assert_eq!(results[0].status, StudySourceStatus::Current);
        assert_eq!(results[0].navigation, StudySourceNavigation::Exact);
        assert_eq!(results[0].ref_item.revision, "hash_raft_v1");
        assert_eq!(results[0].ref_item.revision_kind, RevisionKind::ContentHash);
        assert!(results[0].ref_item.id.starts_with("ssr_"));

        // Extract ref
        assert_eq!(results[1].status, StudySourceStatus::Current);
        assert_eq!(results[1].navigation, StudySourceNavigation::Exact);
        assert_eq!(results[1].ref_item.extract_id.as_deref(), Some("ext_1"));
    }

    #[tokio::test]
    async fn test_negative_cases_deleted_doc_mismatch_and_bad_locator() {
        let pool = create_test_db().await;
        let repo = StudySourceRepository::new(pool.clone());

        // Seed a document
        sqlx::query(
            "INSERT INTO documents (id, collection_id, title, file_path, file_type, content, content_hash, date_added, date_modified)
             VALUES ('doc_os', '00000000-0000-0000-0000-000000000001', 'Operating Systems', '/path/os.pdf', 'pdf',
                     'Virtual memory TLB hit. Another sentence. Virtual memory TLB hit.', 'hash_os_v1', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')"
        ).execute(&pool).await.unwrap();

        // 1. Deleted/missing document
        let missing_input = vec![StudySourceRefInput {
            document_id: "doc_nonexistent".to_string(),
            extract_id: None,
            excerpt: "Some excerpt".to_string(),
            excerpt_sha256: None,
            revision: None,
            revision_kind: None,
            document_title: None,
            source_type: None,
            jump: None,
            chunk: None,
            section_label: None,
        }];
        let res_missing = repo
            .resolve_study_source_refs(&missing_input)
            .await
            .unwrap();
        assert_eq!(res_missing[0].status, StudySourceStatus::Missing);
        assert_eq!(
            res_missing[0].navigation,
            StudySourceNavigation::Unavailable
        );

        // 2. Revision mismatch -> Stale
        let stale_input = vec![StudySourceRefInput {
            document_id: "doc_os".to_string(),
            extract_id: None,
            excerpt: "Another sentence.".to_string(),
            excerpt_sha256: None,
            revision: Some("older_revision_hash".to_string()),
            revision_kind: Some(RevisionKind::ContentHash),
            document_title: None,
            source_type: None,
            jump: None,
            chunk: None,
            section_label: None,
        }];
        let res_stale = repo.resolve_study_source_refs(&stale_input).await.unwrap();
        assert_eq!(res_stale[0].status, StudySourceStatus::Stale);
        assert_eq!(res_stale[0].navigation, StudySourceNavigation::Coarse);

        // 3. Ambiguous multiple matches
        let ambig_input = vec![StudySourceRefInput {
            document_id: "doc_os".to_string(),
            extract_id: None,
            excerpt: "Virtual memory TLB hit.".to_string(),
            excerpt_sha256: None,
            revision: None,
            revision_kind: None,
            document_title: None,
            source_type: None,
            jump: None,
            chunk: None,
            section_label: None,
        }];
        let res_ambig = repo.resolve_study_source_refs(&ambig_input).await.unwrap();
        assert_eq!(res_ambig[0].status, StudySourceStatus::Ambiguous);

        // 4. Bad PDF locator (page 0 or negative) -> Unavailable navigation
        let bad_jump_input = vec![StudySourceRefInput {
            document_id: "doc_os".to_string(),
            extract_id: None,
            excerpt: "Another sentence.".to_string(),
            excerpt_sha256: None,
            revision: None,
            revision_kind: None,
            document_title: None,
            source_type: Some("pdf".to_string()),
            jump: Some(serde_json::json!({ "kind": "pdf", "pageNumber": 0 })),
            chunk: None,
            section_label: None,
        }];
        let res_bad_jump = repo
            .resolve_study_source_refs(&bad_jump_input)
            .await
            .unwrap();
        assert_eq!(
            res_bad_jump[0].navigation,
            StudySourceNavigation::Unavailable
        );
    }

    #[tokio::test]
    async fn test_source_ref_deduplication_and_persistence() {
        let pool = create_test_db().await;
        let repo = StudySourceRepository::new(pool.clone());

        let ref_item = StudySourceRefV1 {
            schema_version: 1,
            id: "ssr_test_1".to_string(),
            document_id: "doc_1".to_string(),
            extract_id: None,
            excerpt: "Unique excerpt text".to_string(),
            excerpt_sha256: compute_excerpt_sha256("Unique excerpt text"),
            revision: "rev_1".to_string(),
            revision_kind: RevisionKind::ContentHash,
            document_title: "Title 1".to_string(),
            source_type: "pdf".to_string(),
            jump: None,
            chunk: None,
            section_label: None,
            captured_at: Utc::now().to_rfc3339(),
        };

        let mut tx = pool.begin().await.unwrap();
        let id1 = repo
            .upsert_source_ref_in_tx(&mut tx, &ref_item)
            .await
            .unwrap();
        assert_eq!(id1, "ssr_test_1");

        // Upsert exact same tuple with different ID proposal
        let mut duplicate_ref = ref_item.clone();
        duplicate_ref.id = "ssr_test_2".to_string();

        let id2 = repo
            .upsert_source_ref_in_tx(&mut tx, &duplicate_ref)
            .await
            .unwrap();
        // Should return existing id1!
        assert_eq!(id2, "ssr_test_1");
        tx.commit().await.unwrap();

        // Fetch back
        let fetched = repo.get_source_ref("ssr_test_1").await.unwrap();
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().excerpt, "Unique excerpt text");
    }
}
