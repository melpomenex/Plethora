//! Study source resolution, validation, and persistence repository.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §2
//! - openspec/changes/establish-persistent-study-plans/

use crate::ai_learning::chunker::{chunk_document, ChunkContext, ChunkInput, ChunkOptions};
use crate::ai_learning::indexer::build_rich_text_chunks;
use crate::ai_learning::models::{ChunkLocation, ChunkModel, SOURCE_TYPE_DOCUMENT};
use crate::models::study_source::{
    FieldIssue, RevisionKind, StudyCommandError, StudyErrorCode, StudySourceChunk,
    StudySourceNavigation, StudySourceRefInput, StudySourceRefV1, StudySourceResolution,
    StudySourceStatus,
};
use chrono::Utc;
use sha2::{Digest, Sha256};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::{hash_map::Entry, HashMap};
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

/// Collapse every whitespace run to a single space so chunk text produced by
/// the indexer (which normalizes hard-wrapped paragraphs and joins blocks with
/// blank lines) can be compared with the original source projection. Without
/// this, valid retrieved chunks are rejected whenever the stored source keeps
/// line breaks the chunker removed.
pub fn normalize_for_match(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    for ch in text.replace("\r\n", "\n").chars() {
        if ch.is_whitespace() {
            pending_space = !out.is_empty();
        } else {
            if pending_space {
                out.push(' ');
                pending_space = false;
            }
            out.push(ch);
        }
    }
    out
}

fn normalized_match_count(haystack: &str, needle: &str) -> usize {
    let normalized_needle = normalize_for_match(needle);
    if normalized_needle.is_empty() {
        return 0;
    }
    normalize_for_match(haystack)
        .match_indices(&normalized_needle)
        .count()
}

/// Builds the searchable projections of a source: stored plain text first,
/// then the same tag-stripped HTML projection the chunker indexes. HTML and
/// EPUB documents frequently keep only the rich markup, so the plain text is
/// empty even though the source is fully available.
fn collect_source_texts(plain: Option<&str>, html: Option<&str>) -> Vec<String> {
    let mut texts = Vec::new();
    if let Some(text) = plain {
        if !text.trim().is_empty() {
            texts.push(text.to_string());
        }
    }
    if let Some(markup) = html {
        if !markup.trim().is_empty() {
            let projection = crate::ai_learning::chunker::html_plain_text(markup);
            if !projection.trim().is_empty() {
                texts.push(projection);
            }
        }
    }
    texts
}

fn best_source_match_count(texts: &[String], normalized_needle: &str) -> usize {
    texts
        .iter()
        .map(|text| normalized_match_count(text, normalized_needle))
        .max()
        .unwrap_or(0)
}

enum BookProjection {
    Rich(Vec<ChunkModel>),
    Plain(Vec<ChunkModel>),
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
        let mut book_chunks = HashMap::new();

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
                || normalized_excerpt.chars().count() > EXCERPT_MAX_CHARS
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
                "SELECT id, title, file_type, file_path, content, html_content, content_hash, date_modified,
                        is_archived, is_local_only, is_ai_excluded
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
            let doc_content_hash = doc.try_get::<Option<String>, _>("content_hash").ok().flatten();
            let doc_date_modified: String = doc.try_get("date_modified").unwrap_or_default();
            let doc_content: Option<String> = doc.try_get("content").ok().flatten();
            let doc_html: Option<String> = doc.try_get("html_content").ok().flatten();
            let is_archived: bool = doc.try_get("is_archived").unwrap_or(false);
            let is_ai_excluded: bool = doc.try_get("is_ai_excluded").unwrap_or(false);

            // Match the revision selected by the frontend source scope.
            let content_hash = doc_content_hash
                .as_deref()
                .map(str::trim)
                .filter(|hash| !hash.is_empty());
            let (live_revision, live_revision_kind) = if let Some(hash) = content_hash {
                (hash.to_string(), RevisionKind::ContentHash)
            } else if !doc_date_modified.trim().is_empty() {
                (
                    doc_date_modified.trim().to_string(),
                    RevisionKind::ModifiedAt,
                )
            } else {
                ("unknown".to_string(), RevisionKind::Unknown)
            };
            let revision_mismatch = input
                .revision
                .as_ref()
                .is_some_and(|revision| revision != &live_revision);

            // Validate the excerpt against the canonical indexed chunk and the
            // live source. Whitespace is normalized on both sides: the chunker
            // unwraps hard-wrapped paragraphs, so byte-exact comparison against
            // stored content produces false "stale" verdicts for every hit.
            let mut status = StudySourceStatus::Current;
            let mut navigation = if input.jump.is_some() {
                StudySourceNavigation::Exact
            } else {
                StudySourceNavigation::Coarse
            };
            let mut reason_key: Option<String> = None;

            if is_archived {
                status = StudySourceStatus::Missing;
                navigation = StudySourceNavigation::Unavailable;
                reason_key = Some("study_source.missing.document_archived".to_string());
            } else if revision_mismatch {
                status = StudySourceStatus::Stale;
                navigation = StudySourceNavigation::Coarse;
                reason_key = Some("study_source.stale.revision_mismatch".to_string());
            } else if let Some(ref ext_id) = input.extract_id {
                let ext_row = sqlx::query(
                    "SELECT id, document_id, content, html_content FROM extracts WHERE id = ?1 LIMIT 1",
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
                    let ext_content: Option<String> =
                        ext.try_get("content").ok().flatten();
                    let ext_html: Option<String> =
                        ext.try_get("html_content").ok().flatten();
                    let source_texts =
                        collect_source_texts(ext_content.as_deref(), ext_html.as_deref());
                    if input.chunk.is_some() {
                        if let Some(reason) = self
                            .verify_chunk_ref(
                                input,
                                &doc_date_modified,
                                &normalized_excerpt,
                                &source_texts,
                                None,
                                true,
                            )
                            .await?
                        {
                            status = StudySourceStatus::Stale;
                            navigation = StudySourceNavigation::Coarse;
                            reason_key = Some(reason);
                        }
                    } else if source_texts.is_empty() {
                        let (found, count) = self
                            .search_source_chunks(
                                &input.document_id,
                                Some(ext_id),
                                &normalized_excerpt,
                            )
                            .await?;
                        if !found {
                            status = StudySourceStatus::Stale;
                            navigation = StudySourceNavigation::Coarse;
                            reason_key =
                                Some("study_source.stale.excerpt_not_in_extract".to_string());
                        } else if count > 1 {
                            status = StudySourceStatus::Ambiguous;
                            navigation = StudySourceNavigation::Coarse;
                            reason_key =
                                Some("study_source.ambiguous.multiple_matches".to_string());
                        }
                    } else {
                        let match_count =
                            best_source_match_count(&source_texts, &normalized_excerpt);
                        if match_count == 0 {
                            status = StudySourceStatus::Stale;
                            navigation = StudySourceNavigation::Coarse;
                            reason_key =
                                Some("study_source.stale.excerpt_not_in_extract".to_string());
                        } else if match_count > 1 {
                            status = StudySourceStatus::Ambiguous;
                            navigation = StudySourceNavigation::Coarse;
                            reason_key =
                                Some("study_source.ambiguous.multiple_matches".to_string());
                        }
                    }
                }
            } else {
                let is_book = matches!(doc_file_type.as_str(), "pdf" | "epub");
                let mut book_projection = None;
                if is_book && input.chunk.is_some() && !is_ai_excluded {
                    let key = (
                        input.document_id.clone(),
                        live_revision.clone(),
                        doc_date_modified.clone(),
                    );
                    let projection =
                        match book_chunks.entry(key) {
                            Entry::Occupied(entry) => entry.into_mut(),
                            Entry::Vacant(entry) => {
                                let ctx = ChunkContext {
                                    document_id: &input.document_id,
                                    source_type: SOURCE_TYPE_DOCUMENT,
                                    source_id: None,
                                    location_source_type: &doc_file_type,
                                    spine_index: None,
                                };
                                let path: String = doc.try_get("file_path").unwrap_or_default();
                                let projection =
                                    match build_rich_text_chunks(&ctx, &path, doc_html.as_deref())
                                        .await
                                    {
                                        Some(chunks) => BookProjection::Rich(chunks),
                                        None => {
                                            let text = doc_content.as_deref().unwrap_or_default();
                                            BookProjection::Plain(chunk_document(
                                                &ctx,
                                                ChunkInput::Plain {
                                                    text,
                                                    heading_heuristic: true,
                                                },
                                                &ChunkOptions::default(),
                                            ))
                                        }
                                    };
                                entry.insert(projection)
                            }
                        };
                    book_projection = Some(&*projection);
                }
                let source_texts = if book_projection.is_some() {
                    Vec::new()
                } else {
                    collect_source_texts(doc_content.as_deref(), doc_html.as_deref())
                };
                if input.chunk.is_some() {
                    if let Some(reason) = self
                        .verify_chunk_ref(
                            input,
                            &doc_date_modified,
                            &normalized_excerpt,
                            &source_texts,
                            book_projection,
                            !is_book,
                        )
                        .await?
                    {
                        status = StudySourceStatus::Stale;
                        navigation = StudySourceNavigation::Coarse;
                        reason_key = Some(reason);
                    }
                } else if source_texts.is_empty() && !is_book {
                    let (found, count) = self
                        .search_source_chunks(&input.document_id, None, &normalized_excerpt)
                        .await?;
                    if !found {
                        status = StudySourceStatus::Stale;
                        navigation = StudySourceNavigation::Coarse;
                        reason_key = Some("study_source.stale.excerpt_not_in_source".to_string());
                    } else if count > 1 {
                        status = StudySourceStatus::Ambiguous;
                        navigation = StudySourceNavigation::Coarse;
                        reason_key = Some("study_source.ambiguous.multiple_matches".to_string());
                    }
                } else {
                    let match_count = best_source_match_count(&source_texts, &normalized_excerpt);
                    if match_count == 0 && is_book {
                        status = StudySourceStatus::Stale;
                        navigation = StudySourceNavigation::Coarse;
                        reason_key = Some("study_source.stale.excerpt_not_in_source".to_string());
                    } else if match_count == 0 {
                        // HTML/PDF projections can differ from stored plain text.
                        // Fall back to the canonical indexed chunk before
                        // declaring the excerpt stale.
                        let (found, count) = self
                            .search_source_chunks(&input.document_id, None, &normalized_excerpt)
                            .await?;
                        if !found {
                            status = StudySourceStatus::Stale;
                            navigation = StudySourceNavigation::Coarse;
                            reason_key =
                                Some("study_source.stale.excerpt_not_in_source".to_string());
                        } else if count > 1 {
                            status = StudySourceStatus::Ambiguous;
                            navigation = StudySourceNavigation::Coarse;
                            reason_key =
                                Some("study_source.ambiguous.multiple_matches".to_string());
                        }
                    } else if match_count > 1 {
                        status = StudySourceStatus::Ambiguous;
                        navigation = StudySourceNavigation::Coarse;
                        reason_key = Some("study_source.ambiguous.multiple_matches".to_string());
                    }
                }
            }

            // Validate jump kind compatibility
            if let Some(jump) = input
                .jump
                .as_ref()
                .filter(|_| status == StudySourceStatus::Current)
            {
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

            if is_ai_excluded {
                // AI-excluded documents must never verify as a usable source,
                // even when the excerpt itself matches. Callers only accept
                // `current` resolutions, so the status (not just the reason
                // key) has to change here.
                if status != StudySourceStatus::Missing {
                    status = StudySourceStatus::Unsupported;
                    navigation = StudySourceNavigation::Unavailable;
                }
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

    /// Validates a retrieved chunk as the canonical indexed representation of
    /// an excerpt: identity, document ownership, ordinal, content hash, source
    /// type, excerpt containment, and freshness. Returns a specific reason key
    /// when any check fails.
    async fn verify_chunk_ref(
        &self,
        input: &StudySourceRefInput,
        doc_date_modified: &str,
        normalized_excerpt: &str,
        source_texts: &[String],
        book_projection: Option<&BookProjection>,
        allow_index_fallback: bool,
    ) -> Result<Option<String>, StudyCommandError> {
        let Some(chunk_ref) = input.chunk.as_ref() else {
            return Ok(Some("study_source.stale.chunk_not_found".to_string()));
        };
        let excerpt_key = normalize_for_match(normalized_excerpt);

        let row = sqlx::query(
            "SELECT c.document_id, c.source_type, c.source_id, c.ordinal, c.text,
                    c.content_hash, c.location_json, i.state AS index_state,
                    (i.document_id IS NOT NULL
                     AND datetime(i.updated_at) >= datetime(?2)) AS index_current
             FROM semantic_chunks c
             LEFT JOIN ai_index_state i ON i.document_id = c.document_id
             WHERE c.id = ?1
             LIMIT 1",
        )
        .bind(&chunk_ref.chunk_id)
        .bind(doc_date_modified)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let Some(row) = row else {
            return Ok(Some("study_source.stale.chunk_not_found".to_string()));
        };

        let chunk_doc_id: String = row.try_get("document_id").unwrap_or_default();
        if chunk_doc_id != input.document_id {
            return Ok(Some(
                "study_source.stale.chunk_document_mismatch".to_string(),
            ));
        }

        let chunk_ordinal: i64 = row.try_get("ordinal").unwrap_or_default();
        if chunk_ordinal != i64::from(chunk_ref.ordinal) {
            return Ok(Some(
                "study_source.stale.chunk_ordinal_mismatch".to_string(),
            ));
        }

        let chunk_text: String = row.try_get("text").unwrap_or_default();
        let stored_hash: String = row.try_get("content_hash").unwrap_or_default();
        let computed_hash = crate::ai_learning::chunker::chunk_content_hash(&chunk_text);
        if stored_hash != computed_hash {
            return Ok(Some(
                "study_source.stale.chunk_integrity_failed".to_string(),
            ));
        }

        let source_type: String = row.try_get("source_type").unwrap_or_default();
        let source_id: Option<String> = row.try_get("source_id").ok().flatten();
        if input.extract_id.is_some() {
            let expected_extract = input.extract_id.as_deref();
            if source_type != crate::ai_learning::models::SOURCE_TYPE_EXTRACT
                || source_id.as_deref() != expected_extract
            {
                return Ok(Some(
                    "study_source.stale.chunk_source_type_mismatch".to_string(),
                ));
            }
        } else if !matches!(
            source_type.as_str(),
            crate::ai_learning::models::SOURCE_TYPE_DOCUMENT
                | crate::ai_learning::models::SOURCE_TYPE_SESSION
                | "transcript"
        ) {
            return Ok(Some(
                "study_source.stale.chunk_source_type_mismatch".to_string(),
            ));
        }

        if !normalize_for_match(&chunk_text).contains(&excerpt_key) {
            return Ok(Some(
                "study_source.stale.chunk_text_mismatch".to_string(),
            ));
        }

        if let Some(projection) = book_projection {
            let chunks = match projection {
                BookProjection::Rich(chunks) => chunks,
                BookProjection::Plain(chunks) => {
                    let page_scoped = row
                        .try_get::<String, _>("location_json")
                        .ok()
                        .and_then(|json| serde_json::from_str::<ChunkLocation>(&json).ok())
                        .is_some_and(|location| {
                            location.source_type == "pdf" && location.page_number.is_some()
                        });
                    if page_scoped {
                        return Ok(Some(
                            "study_source.stale.source_projection_unavailable".to_string(),
                        ));
                    }
                    chunks
                }
            };
            let matches_live_chunk = chunks.iter().any(|chunk| {
                if chunk.id != chunk_ref.chunk_id
                    || chunk.ordinal != chunk_ordinal
                    || chunk.content_hash != stored_hash
                {
                    return false;
                }
                serde_json::from_str::<ChunkLocation>(&chunk.location_json).is_ok_and(|location| {
                    let requested_page = input
                        .jump
                        .as_ref()
                        .and_then(|jump| jump.get("pageNumber"))
                        .and_then(serde_json::Value::as_i64);
                    usize::try_from(chunk_ref.start_offset) == Ok(location.start_offset)
                        && usize::try_from(chunk_ref.end_offset) == Ok(location.end_offset)
                        && requested_page.is_none_or(|page| location.page_number == Some(page))
                })
            });
            return Ok((!matches_live_chunk)
                .then(|| "study_source.stale.chunk_not_in_live_source".to_string()));
        }

        // The excerpt is present in the canonical chunk. If the original
        // source projection also contains it, the chunk is current. Otherwise
        // fall back to index freshness (transcript/session chunks add
        // timestamps and speaker prefixes, and PDF/HTML projections can differ
        // from the chunker's text).
        let matches_original = source_texts
            .iter()
            .any(|text| normalize_for_match(text).contains(&excerpt_key));
        if matches_original {
            return Ok(None);
        }

        // A book with a missing rich projection can still be proved by
        // stored source text. Index timestamps alone cannot establish it.
        if !allow_index_fallback {
            return Ok(Some("study_source.stale.excerpt_not_in_source".to_string()));
        }

        let index_state: Option<String> = row.try_get("index_state").ok().flatten();
        let index_current: bool = row.try_get("index_current").unwrap_or(false);
        let state_current = matches!(index_state.as_deref(), Some("indexed" | "stale"));
        if !index_current || !state_current {
            return Ok(Some(
                "study_source.stale.index_not_current".to_string(),
            ));
        }

        Ok(None)
    }

    /// Searches the canonical chunks of one document (optionally scoped to an
    /// extract) for a whitespace-normalized excerpt. Used when the source has
    /// no plain-text projection (transcripts, sessions) or when the projection
    /// differs from the indexed text.
    async fn search_source_chunks(
        &self,
        document_id: &str,
        extract_id: Option<&str>,
        normalized_excerpt: &str,
    ) -> Result<(bool, usize), StudyCommandError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT text FROM semantic_chunks
             WHERE document_id = ?1
               AND (
                    (?2 IS NOT NULL AND source_type = 'extract' AND source_id = ?2)
                    OR
                    (?2 IS NULL AND source_type IN ('document', 'transcript', 'session'))
               )",
        )
        .bind(document_id)
        .bind(extract_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let excerpt_key = normalize_for_match(normalized_excerpt);
        let count = rows
            .iter()
            .filter(|(text,)| normalize_for_match(text).contains(&excerpt_key))
            .count();
        Ok((count > 0, count))
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
    use crate::ai_learning::models::{SOURCE_TYPE_DOCUMENT, SOURCE_TYPE_EXTRACT};

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
        assert_eq!(results[1].navigation, StudySourceNavigation::Coarse);
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

    async fn seed_document(
        pool: &Pool<Sqlite>,
        id: &str,
        title: &str,
        file_type: &str,
        content: &str,
        content_hash: &str,
        updated_at: &str,
    ) {
        sqlx::query(
            "INSERT INTO documents
                (id, title, file_path, file_type, content, content_hash, date_added, date_modified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        )
        .bind(id)
        .bind(title)
        .bind(format!("/path/{id}"))
        .bind(file_type)
        .bind(content)
        .bind(content_hash)
        .bind(updated_at)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_chunk(
        pool: &Pool<Sqlite>,
        id: &str,
        document_id: &str,
        source_type: &str,
        source_id: Option<&str>,
        ordinal: i32,
        text: &str,
    ) {
        sqlx::query(
            "INSERT INTO semantic_chunks
                (id, document_id, source_type, source_id, ordinal, text, content_hash, token_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        )
        .bind(id)
        .bind(document_id)
        .bind(source_type)
        .bind(source_id)
        // Insert i64 so SQLite stores an integer, matching the production table.
        .bind(i64::from(ordinal))
        .bind(text)
        .bind(crate::ai_learning::chunker::chunk_content_hash(text))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_index_state(
        pool: &Pool<Sqlite>,
        document_id: &str,
        state: &str,
        updated_at: &str,
    ) {
        sqlx::query(
            "INSERT INTO ai_index_state
                (document_id, state, chunks_indexed, total_chunks, updated_at)
             VALUES (?1, ?2, 1, 1, ?3)",
        )
        .bind(document_id)
        .bind(state)
        .bind(updated_at)
        .execute(pool)
        .await
        .unwrap();
    }

    fn chunk_ref(id: &str, ordinal: i32, text: &str) -> StudySourceChunk {
        StudySourceChunk {
            chunk_id: id.to_string(),
            ordinal,
            start_offset: 0,
            end_offset: text.chars().count() as i32,
        }
    }

    fn retrieved_book_ref(chunk: &ChunkModel, revision: &str) -> StudySourceRefInput {
        let location: ChunkLocation = serde_json::from_str(&chunk.location_json).unwrap();
        StudySourceRefInput {
            document_id: chunk.document_id.clone(),
            extract_id: None,
            excerpt: chunk.text.trim().chars().take(500).collect(),
            excerpt_sha256: None,
            revision: Some(revision.into()),
            revision_kind: Some(RevisionKind::ContentHash),
            document_title: None,
            source_type: Some(chunk.source_type.clone()),
            jump: location
                .page_number
                .map(|page| serde_json::json!({"kind": "pdf", "pageNumber": page})),
            chunk: Some(StudySourceChunk {
                chunk_id: chunk.id.clone(),
                ordinal: chunk.ordinal as i32,
                start_offset: location.start_offset as i32,
                end_offset: location.end_offset as i32,
            }),
            section_label: None,
        }
    }

    #[tokio::test]
    async fn test_pdf_and_epub_chunks_require_current_authoritative_projection() {
        let pool = create_test_db().await;
        let repo = StudySourceRepository::new(pool.clone());
        let pdf_fixture = |name: &str| {
            format!(
                "{}/tests/fixtures/pdf-baseline/{name}",
                env!("CARGO_MANIFEST_DIR")
            )
        };
        let temp = tempfile::tempdir().unwrap();
        let pdf_path = temp.path().join("book.pdf");
        tokio::fs::copy(pdf_fixture("simple-text.pdf"), &pdf_path)
            .await
            .unwrap();
        let path = pdf_path.to_str().unwrap();
        let html = "<h1>Chapter One</h1><p>Grounded knowledge has a basis in experience.</p><p>Another original sentence belongs to the same chapter.</p>";

        for kind in ["pdf", "epub"] {
            let markup = (kind == "epub").then_some(html);
            let ctx = ChunkContext {
                document_id: kind,
                source_type: SOURCE_TYPE_DOCUMENT,
                source_id: None,
                location_source_type: kind,
                spine_index: None,
            };
            let chunks = build_rich_text_chunks(&ctx, path, markup).await.unwrap();
            let chunk = chunks.first().unwrap();
            let input = retrieved_book_ref(chunk, "book-rev");
            seed_document(
                &pool,
                kind,
                "Book",
                kind,
                "Different import projection.",
                "book-rev",
                "2026-11-10T12:00:00Z",
            )
            .await;
            sqlx::query("UPDATE documents SET file_path = ?1, html_content = ?2 WHERE id = ?3")
                .bind(path)
                .bind(markup)
                .bind(kind)
                .execute(&pool)
                .await
                .unwrap();
            seed_chunk(
                &pool,
                &chunk.id,
                kind,
                SOURCE_TYPE_DOCUMENT,
                None,
                chunk.ordinal as i32,
                &chunk.text,
            )
            .await;
            sqlx::query("UPDATE semantic_chunks SET location_json = ?1 WHERE id = ?2")
                .bind(&chunk.location_json)
                .bind(&chunk.id)
                .execute(&pool)
                .await
                .unwrap();

            // An old index timestamp alone does not invalidate a fresh source match.
            seed_index_state(&pool, kind, "indexed", "2026-11-10T11:00:00Z").await;
            let mut bad_offset = input.clone();
            bad_offset.chunk.as_mut().unwrap().end_offset += 1;
            let mut wrong_revision = input.clone();
            wrong_revision.revision = Some("old-rev".into());
            let results = repo
                .resolve_study_source_refs(&[input.clone(), bad_offset, wrong_revision])
                .await
                .unwrap();
            assert_eq!(results[0].status, StudySourceStatus::Current);
            assert_eq!(
                results[1].reason_key.as_deref(),
                Some("study_source.stale.chunk_not_in_live_source")
            );
            assert_eq!(results[2].status, StudySourceStatus::Stale);
            assert_eq!(
                results[2].reason_key.as_deref(),
                Some("study_source.stale.revision_mismatch")
            );

            // Change the actual source while keeping the DB revision unchanged.
            // The import projection and a fresh index timestamp still claim the old excerpt.
            sqlx::query("UPDATE documents SET content = ?1 WHERE id = ?2")
                .bind(&input.excerpt)
                .bind(kind)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("UPDATE ai_index_state SET updated_at = '2026-11-10T13:00:00Z' WHERE document_id = ?1")
                .bind(kind).execute(&pool).await.unwrap();
            if kind == "pdf" {
                tokio::fs::copy(pdf_fixture("ligature-heavy.pdf"), &pdf_path)
                    .await
                    .unwrap();
            } else {
                sqlx::query("UPDATE documents SET html_content = '<p>Entirely different source text.</p>' WHERE id = 'epub'")
                    .execute(&pool).await.unwrap();
            }

            let result = repo.resolve_study_source_refs(&[input]).await.unwrap();
            assert_eq!(result[0].status, StudySourceStatus::Stale);
            assert_eq!(
                result[0].reason_key.as_deref(),
                Some("study_source.stale.chunk_not_in_live_source")
            );
        }
    }

    #[tokio::test]
    async fn test_chunk_verification_accepts_whitespace_normalized_canonical_chunk() {
        let pool = create_test_db().await;
        let repo = StudySourceRepository::new(pool.clone());

        // Stored content keeps hard line breaks the chunker removes, so a
        // byte-exact comparison would mark this valid passage stale.
        seed_document(
            &pool,
            "doc_epub",
            "Philosophy",
            "epub",
            "Knowledge is a justified true belief.\nValue depends on desire.\n\nAgents act for reasons.",
            "rev_epub",
            "2026-11-10T12:00:00Z",
        )
        .await;
        let live_content = "Knowledge is a justified true belief.\nValue depends on desire.\n\nAgents act for reasons.";
        let ctx = ChunkContext {
            document_id: "doc_epub",
            source_type: SOURCE_TYPE_DOCUMENT,
            source_id: None,
            location_source_type: "epub",
            spine_index: None,
        };
        let chunks = crate::ai_learning::chunker::chunk_document(
            &ctx,
            crate::ai_learning::chunker::ChunkInput::Plain {
                text: live_content,
                heading_heuristic: true,
            },
            &Default::default(),
        );
        let chunk = &chunks[0];
        assert!(!live_content.contains(&chunk.text));
        seed_chunk(
            &pool,
            &chunk.id,
            "doc_epub",
            SOURCE_TYPE_DOCUMENT,
            None,
            chunk.ordinal as i32,
            &chunk.text,
        )
        .await;
        seed_index_state(&pool, "doc_epub", "indexed", "2026-11-10T12:05:00Z").await;

        let input = retrieved_book_ref(chunk, "rev_epub");
        let results = repo
            .resolve_study_source_refs(&[input.clone()])
            .await
            .unwrap();
        assert_eq!(results[0].status, StudySourceStatus::Current);
        assert_eq!(results[0].reason_key, None);

        let edited_content = format!("A new paragraph precedes the old passage.\n\n{live_content}");
        sqlx::query("UPDATE documents SET content = ?1 WHERE id = 'doc_epub'")
            .bind(&edited_content)
            .execute(&pool)
            .await
            .unwrap();
        let results = repo.resolve_study_source_refs(&[input]).await.unwrap();
        assert_eq!(results[0].status, StudySourceStatus::Stale);
        assert_eq!(
            results[0].reason_key.as_deref(),
            Some("study_source.stale.chunk_not_in_live_source")
        );
    }

    #[tokio::test]
    async fn test_chunk_verification_rejects_missing_mismatched_and_fabricated() {
        let pool = create_test_db().await;
        let repo = StudySourceRepository::new(pool.clone());

        seed_document(
            &pool,
            "doc_a",
            "Doc A",
            "markdown",
            "Alpha passage. Beta passage.",
            "rev_a",
            "2026-11-10T12:00:00Z",
        )
        .await;
        seed_chunk(
            &pool,
            "chunk_a_0",
            "doc_a",
            SOURCE_TYPE_DOCUMENT,
            None,
            0,
            "Alpha passage. Beta passage.",
        )
        .await;
        seed_index_state(&pool, "doc_a", "indexed", "2026-11-10T12:05:00Z").await;

        seed_document(
            &pool,
            "doc_b",
            "Doc B",
            "markdown",
            "Another document.",
            "rev_b",
            "2026-11-10T12:00:00Z",
        )
        .await;

        let base = StudySourceRefInput {
            document_id: "doc_a".to_string(),
            extract_id: None,
            excerpt: "Alpha passage.".to_string(),
            excerpt_sha256: None,
            revision: Some("rev_a".to_string()),
            revision_kind: None,
            document_title: None,
            source_type: None,
            jump: None,
            chunk: Some(chunk_ref("chunk_a_0", 0, "Alpha passage.")),
            section_label: None,
        };

        // Fabricated excerpt not present in the canonical chunk.
        let mut fabricated = base.clone();
        fabricated.excerpt = "A hallucinated quotation.".to_string();
        let res = repo
            .resolve_study_source_refs(&[fabricated])
            .await
            .unwrap();
        assert_eq!(res[0].status, StudySourceStatus::Stale);
        assert_eq!(
            res[0].reason_key.as_deref(),
            Some("study_source.stale.chunk_text_mismatch")
        );

        // Nonexistent chunk id.
        let mut missing = base.clone();
        missing.chunk = Some(chunk_ref("chunk_missing", 0, "Alpha passage."));
        let res = repo.resolve_study_source_refs(&[missing]).await.unwrap();
        assert_eq!(
            res[0].reason_key.as_deref(),
            Some("study_source.stale.chunk_not_found")
        );

        // Chunk exists but belongs to a different document.
        let mut wrong_doc = base.clone();
        wrong_doc.chunk = Some(chunk_ref("chunk_a_0", 0, "Alpha passage."));
        wrong_doc.document_id = "doc_b".to_string();
        wrong_doc.revision = Some("rev_b".to_string());
        let res = repo.resolve_study_source_refs(&[wrong_doc]).await.unwrap();
        assert_eq!(
            res[0].reason_key.as_deref(),
            Some("study_source.stale.chunk_document_mismatch")
        );

        // Ordinal drift for the same chunk id.
        let mut wrong_ordinal = base.clone();
        wrong_ordinal.chunk = Some(chunk_ref("chunk_a_0", 7, "Alpha passage."));
        let res = repo
            .resolve_study_source_refs(&[wrong_ordinal])
            .await
            .unwrap();
        assert_eq!(
            res[0].reason_key.as_deref(),
            Some("study_source.stale.chunk_ordinal_mismatch")
        );
    }

    #[tokio::test]
    async fn test_transcript_only_document_verifies_from_canonical_chunk() {
        let pool = create_test_db().await;
        let repo = StudySourceRepository::new(pool.clone());

        seed_document(
            &pool,
            "doc_video",
            "GPU Talk",
            "youtube",
            "",
            "rev_video",
            "2026-11-10T12:00:00Z",
        )
        .await;
        let transcript_text = "[0:00] Today we discuss GPU kernels.\n[0:05] Occupancy matters.";
        seed_chunk(
            &pool,
            "chunk_video_0",
            "doc_video",
            "transcript",
            None,
            0,
            transcript_text,
        )
        .await;
        seed_index_state(&pool, "doc_video", "indexed", "2026-11-10T12:05:00Z").await;

        let result = repo
            .resolve_study_source_refs(&[StudySourceRefInput {
                document_id: "doc_video".to_string(),
                extract_id: None,
                excerpt: "[0:00] Today we discuss GPU kernels.".to_string(),
                excerpt_sha256: None,
                revision: Some("rev_video".to_string()),
                revision_kind: None,
                document_title: None,
                source_type: Some("transcript".to_string()),
                jump: None,
                chunk: Some(chunk_ref("chunk_video_0", 0, transcript_text)),
                section_label: None,
            }])
            .await
            .unwrap();
        assert_eq!(result[0].status, StudySourceStatus::Current);
    }

    #[tokio::test]
    async fn test_extract_chunk_requires_matching_extract_source() {
        let pool = create_test_db().await;
        let repo = StudySourceRepository::new(pool.clone());

        seed_document(
            &pool,
            "doc_book",
            "Book",
            "pdf",
            "Document body.",
            "rev_book",
            "2026-11-10T12:00:00Z",
        )
        .await;
        sqlx::query(
            "INSERT INTO extracts (id, document_id, content, date_created, date_modified)
             VALUES ('ext_1', 'doc_book', 'An extracted passage.', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        seed_chunk(
            &pool,
            "chunk_ext_1",
            "doc_book",
            SOURCE_TYPE_EXTRACT,
            Some("ext_1"),
            0,
            "An extracted passage.",
        )
        .await;
        seed_index_state(&pool, "doc_book", "indexed", "2026-11-10T12:05:00Z").await;

        let result = repo
            .resolve_study_source_refs(&[StudySourceRefInput {
                document_id: "doc_book".to_string(),
                extract_id: Some("ext_1".to_string()),
                excerpt: "An extracted passage.".to_string(),
                excerpt_sha256: None,
                revision: Some("rev_book".to_string()),
                revision_kind: None,
                document_title: None,
                source_type: Some("pdf".to_string()),
                jump: None,
                chunk: Some(chunk_ref("chunk_ext_1", 0, "An extracted passage.")),
                section_label: None,
            }])
            .await
            .unwrap();
        assert_eq!(result[0].status, StudySourceStatus::Current);

        // A document chunk cannot stand in for an extract reference, even
        // when its text matches the extract exactly.
        seed_chunk(
            &pool,
            "chunk_doc_body",
            "doc_book",
            SOURCE_TYPE_DOCUMENT,
            None,
            0,
            "An extracted passage.",
        )
        .await;
        let wrong_source_type = StudySourceRepository::new(pool.clone());
        let result = wrong_source_type
            .resolve_study_source_refs(&[StudySourceRefInput {
                document_id: "doc_book".to_string(),
                extract_id: Some("ext_1".to_string()),
                excerpt: "An extracted passage.".to_string(),
                excerpt_sha256: None,
                revision: Some("rev_book".to_string()),
                revision_kind: None,
                document_title: None,
                source_type: None,
                jump: None,
                chunk: Some(chunk_ref("chunk_doc_body", 0, "An extracted passage.")),
                section_label: None,
            }])
            .await
            .unwrap();
        assert_eq!(
            result[0].reason_key.as_deref(),
            Some("study_source.stale.chunk_source_type_mismatch")
        );
    }

    #[tokio::test]
    async fn test_ai_excluded_and_stale_index_sources_are_rejected() {
        let pool = create_test_db().await;
        let repo = StudySourceRepository::new(pool.clone());

        seed_document(
            &pool,
            "doc_excluded",
            "Private",
            "markdown",
            "A private passage.",
            "rev_private",
            "2026-11-10T12:00:00Z",
        )
        .await;
        sqlx::query("UPDATE documents SET is_ai_excluded = 1 WHERE id = 'doc_excluded'")
            .execute(&pool)
            .await
            .unwrap();

        let result = repo
            .resolve_study_source_refs(&[StudySourceRefInput {
                document_id: "doc_excluded".to_string(),
                extract_id: None,
                excerpt: "A private passage.".to_string(),
                excerpt_sha256: None,
                revision: Some("rev_private".to_string()),
                revision_kind: None,
                document_title: None,
                source_type: None,
                jump: None,
                chunk: None,
                section_label: None,
            }])
            .await
            .unwrap();
        assert_eq!(result[0].status, StudySourceStatus::Unsupported);
        assert_eq!(
            result[0].reason_key.as_deref(),
            Some("study_source.meta.ai_excluded")
        );

        // Transcript-only chunk whose index state predates the document edit.
        seed_document(
            &pool,
            "doc_stale_transcript",
            "Stale Talk",
            "audio",
            "",
            "rev_stale",
            "2026-11-10T13:00:00Z",
        )
        .await;
        seed_chunk(
            &pool,
            "chunk_stale_0",
            "doc_stale_transcript",
            "transcript",
            None,
            0,
            "[0:00] A stale transcript line.",
        )
        .await;
        seed_index_state(
            &pool,
            "doc_stale_transcript",
            "indexed",
            "2026-11-10T12:00:00Z",
        )
        .await;

        let result = repo
            .resolve_study_source_refs(&[StudySourceRefInput {
                document_id: "doc_stale_transcript".to_string(),
                extract_id: None,
                excerpt: "[0:00] A stale transcript line.".to_string(),
                excerpt_sha256: None,
                revision: Some("rev_stale".to_string()),
                revision_kind: None,
                document_title: None,
                source_type: Some("transcript".to_string()),
                jump: None,
                chunk: Some(chunk_ref(
                    "chunk_stale_0",
                    0,
                    "[0:00] A stale transcript line.",
                )),
                section_label: None,
            }])
            .await
            .unwrap();
        assert_eq!(result[0].status, StudySourceStatus::Stale);
        assert_eq!(
            result[0].reason_key.as_deref(),
            Some("study_source.stale.index_not_current")
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
