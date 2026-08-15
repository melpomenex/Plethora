//! Shared data model for the AI learning semantic index.
//!
//! Everything stored here is a *rebuildable cache* (design D22): user content
//! stays canonical in `documents` / `extracts` / `annotations` /
//! `learning_items`, and `ai_learning_reset_index` can wipe these rows without
//! losing anything.

use serde::{Deserialize, Serialize};

/// Source of a semantic chunk. Documents chunk into many rows; extracts,
/// annotations and card fronts are single chunks (task 4.7).
pub const SOURCE_TYPE_DOCUMENT: &str = "document";
pub const SOURCE_TYPE_EXTRACT: &str = "extract";
pub const SOURCE_TYPE_ANNOTATION: &str = "annotation";
pub const SOURCE_TYPE_CARD: &str = "card";

/// A chunk produced by the chunker, ready to persist into `semantic_chunks`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkModel {
    /// Deterministic, hash-derived id (`sha256(document|source|content_hash)`)
    /// so re-indexing identical content reuses the same row.
    pub id: String,
    pub document_id: String,
    /// `document` | `extract` | `annotation` | `card`.
    pub source_type: String,
    /// Id of the originating extract/annotation/card; `None` for documents.
    pub source_id: Option<String>,
    /// 0-based position within `(document_id, source_type)`.
    pub ordinal: i64,
    pub text: String,
    pub heading_path: Vec<String>,
    /// Serialized [`ChunkLocation`] JSON.
    pub location_json: String,
    /// sha256 hex of `text` (matches the `rag.rs` chunk-hash convention).
    pub content_hash: String,
    /// Rough estimate: `chars / 4`.
    pub token_count: i64,
}

/// Navigation payload stored in `semantic_chunks.location_json` (design D13).
///
/// Mirrors the `src/types/selection.ts` context vocabulary so the TS viewer
/// can jump. EPUB CFI ranges are an explicit extension point: Rust stores
/// `spineIndex` + text offsets now, and the TS side enriches with `cfiRange`
/// once the CFI machinery is wired into indexing (do not block on CFI).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkLocation {
    /// Surface kind of the *content*: `pdf` | `epub` | `html` | `markdown` | `text`.
    pub source_type: String,
    pub document_id: String,
    pub ordinal: i64,
    /// Char offsets into the chunker's input text (for HTML sources: into the
    /// tag-stripped projection produced during parsing).
    pub start_offset: usize,
    pub end_offset: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub heading_path: Vec<String>,
    /// PDF page number (1-based) when the source is page-scoped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_number: Option<i64>,
    /// EPUB spine index of the chapter the chunk came from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spine_index: Option<i64>,
    /// EPUB CFI range — TS-enriched extension point.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cfi_range: Option<String>,
    /// PDF highlight rects — TS-enriched extension point.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_rects: Option<serde_json::Value>,
    /// Extract id for `extract` chunks (also carries annotation/card anchors
    /// via `anchor_id`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extract_id: Option<String>,
    /// Annotation or learning-item id for those source types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_id: Option<String>,
}

/// Per-document indexing state machine (design D14 / spec): the migration
/// column stores the kebab-case strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IndexState {
    Unindexed,
    Queued,
    Indexing,
    Indexed,
    Stale,
    Failed,
}

impl IndexState {
    pub fn as_str(self) -> &'static str {
        match self {
            IndexState::Unindexed => "unindexed",
            IndexState::Queued => "queued",
            IndexState::Indexing => "indexing",
            IndexState::Indexed => "indexed",
            IndexState::Stale => "stale",
            IndexState::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "unindexed" => IndexState::Unindexed,
            "queued" => IndexState::Queued,
            "indexing" => IndexState::Indexing,
            "indexed" => IndexState::Indexed,
            "stale" => IndexState::Stale,
            "failed" => IndexState::Failed,
            _ => return None,
        })
    }
}

/// One row of the per-document index status surfaced by
/// `ai_learning_index_status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentIndexStatus {
    pub document_id: String,
    pub state: String,
    pub embedding_version: Option<i64>,
    pub chunks_indexed: i64,
    pub total_chunks: i64,
    pub error: Option<String>,
    pub updated_at: String,
}

/// Aggregate index status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregateIndexStatus {
    pub total_documents: i64,
    pub indexed_documents: i64,
    pub queued_documents: i64,
    pub indexing_documents: i64,
    pub stale_documents: i64,
    pub failed_documents: i64,
    pub total_chunks: i64,
    pub total_embeddings: i64,
    /// Sum of `LENGTH(embedding)` across `semantic_chunk_embeddings`, bytes.
    pub embedding_storage_bytes: i64,
    /// Distinct `(model, embedding_version)` pairs currently stored — more
    /// than one entry means part of the index is stale for the active backend.
    pub embedding_models: Vec<EmbeddingModelUsage>,
    /// Background worker paused?
    pub paused: bool,
    /// Document the worker is currently processing, if any.
    pub active_document: Option<String>,
    /// Documents waiting in the in-memory queue.
    pub pending_documents: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingModelUsage {
    pub model: String,
    pub embedding_version: i64,
    pub chunks: i64,
}

/// Filters accepted by `ai_learning_retrieve`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalFilters {
    pub document_ids: Option<Vec<String>>,
    pub source_types: Option<Vec<String>>,
}

/// Retrieval mode: `semantic` used query embeddings, `lexicalOnly` is the
/// FTS5 fallback (embedding provider unavailable / empty index).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RetrievalMode {
    Semantic,
    LexicalOnly,
}

impl RetrievalMode {
    pub fn as_str(self) -> &'static str {
        match self {
            RetrievalMode::Semantic => "semantic",
            RetrievalMode::LexicalOnly => "lexicalOnly",
        }
    }
}

/// A retrieval result (task 4.6).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// `semantic_chunks.id`, or `fts-{documentId}` for ephemeral lexical-only
    /// document hits that predate indexing.
    pub chunk_id: String,
    pub document_id: String,
    pub document_title: Option<String>,
    pub source_type: String,
    pub source_id: Option<String>,
    pub ordinal: i64,
    pub text: String,
    pub heading_path: Vec<String>,
    /// Parsed `location_json` for viewer navigation.
    pub location: serde_json::Value,
    pub content_hash: String,
    pub token_count: i64,
    /// Cosine similarity (semantic mode) or normalized FTS rank (lexicalOnly).
    pub score: f64,
    pub mode: String,
}

/// Response envelope for `ai_learning_retrieve`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalResponse {
    pub results: Vec<SearchResult>,
    pub mode: String,
    /// Number of candidate embeddings scanned (semantic mode).
    pub candidates_scanned: usize,
}
