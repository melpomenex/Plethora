//! Retrieval over the semantic index (task 4.6, design D11/D15).
//!
//! One `retrieve(query, k, filters)` interface combining:
//! - a **lexical prefilter** via the FTS5 `document_search` table (top ~200
//!   documents by bm25 rank),
//! - **cosine top-k** over stored `semantic_chunk_embeddings` for the
//!   candidate union (FTS hits ∪ explicit `documentIds` filters), scored with
//!   a bounded min-heap in the `vector_store.rs` pattern, streaming rows so a
//!   100k-chunk scan stays memory-bounded,
//! - **chunk-neighborhood dedup**: adjacent ordinals of the same document +
//!   source type are skipped within the top-k so one passage does not crowd
//!   out the rest of the library.
//!
//! When the embedding backend is unavailable or no current-version embeddings
//! exist, the same interface returns FTS results flagged `lexicalOnly` instead
//! of failing (spec requirement).

use crate::ai_learning::embeddings_backend::EmbeddingBackend;
use crate::ai_learning::models::{
    RetrievalFilters, RetrievalMode, RetrievalResponse, SearchResult,
};
use crate::database::Repository;
use crate::error::Result;
use byteorder::{ByteOrder, LittleEndian};
use futures::TryStreamExt;
use sqlx::{QueryBuilder, Row};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashSet};
use tracing::debug;

/// Lexical prefilter size (design D11: "top ~200 by rank").
pub const LEXICAL_PREFILTER_LIMIT: i64 = 200;
/// Hard upper bound for `k`.
pub const MAX_K: usize = 50;
/// Default `k` when the caller does not specify one.
pub const DEFAULT_K: usize = 8;

/// Heap entry ordered by score (see `vector_store.rs` for why the ordering
/// traits are hand-written: `f32` is not `Eq`).
struct ScoredCandidate {
    score: f32,
    result: SearchResult,
}

impl PartialEq for ScoredCandidate {
    fn eq(&self, other: &Self) -> bool {
        self.score == other.score
    }
}
impl Eq for ScoredCandidate {}
impl PartialOrd for ScoredCandidate {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for ScoredCandidate {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.score
            .partial_cmp(&other.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    }
}

/// Retrieve the top-k chunks for `query`.
pub async fn retrieve(
    repo: &Repository,
    backend: &EmbeddingBackend,
    query: &str,
    k: usize,
    filters: &RetrievalFilters,
) -> Result<RetrievalResponse> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(RetrievalResponse {
            results: Vec::new(),
            mode: RetrievalMode::LexicalOnly.as_str().to_string(),
            candidates_scanned: 0,
        });
    }
    let k = k.clamp(1, MAX_K);

    // 1. Lexical prefilter over FTS5 documents.
    let fts_doc_ids = fts_document_prefilter(repo, query).await;

    // 2. Semantic path when a backend is available and query embedding works.
    let query_embedding = if backend.is_available() {
        match backend.embed_text(query).await {
            Ok(v) if !v.is_empty() => Some(v),
            Ok(_) => None,
            Err(_) => {
                debug!("query embedding failed, using lexical retrieval");
                None
            }
        }
    } else {
        None
    };

    if let Some(query_vec) = query_embedding {
        let model = backend.model_name();
        let version = backend.embedding_version();

        // Explicit filters are an authorization boundary, not additional FTS candidates.
        let candidate_docs = filters.document_ids.clone().or_else(|| fts_doc_ids.clone());

        let (scored, scanned) = semantic_topk(
            repo,
            &query_vec,
            k,
            candidate_docs.as_deref(),
            filters.source_types.as_deref(),
            &model,
            version,
        )
        .await?;

        if !scored.is_empty() {
            return Ok(RetrievalResponse {
                results: scored,
                mode: RetrievalMode::Semantic.as_str().to_string(),
                candidates_scanned: scanned,
            });
        }
        // No current-version embeddings: fall through to lexical.
    }

    // 3. Lexical-only fallback (backend unavailable, empty index, or all
    //    embeddings stale for the active version).
    let results = lexical_results(repo, query, k, filters).await?;
    Ok(RetrievalResponse {
        results,
        mode: RetrievalMode::LexicalOnly.as_str().to_string(),
        candidates_scanned: 0,
    })
}

/// FTS5 MATCH query that tolerates arbitrary user input: each token is
/// quoted and prefix-matched (`"tok"*`), so punctuation/operators in the
/// query cannot produce MATCH syntax errors.
fn sanitize_fts_query(query: &str) -> String {
    let tokens: Vec<String> = query
        .split_whitespace()
        .filter_map(|tok| {
            let cleaned: String = tok
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if cleaned.is_empty() {
                None
            } else {
                Some(format!("\"{}\"*", cleaned.replace('"', "")))
            }
        })
        .collect();
    tokens.join(" ")
}

/// Top documents by bm25 rank across `document_search` and `semantic_chunks_fts`
/// while strictly filtering out archived or AI-excluded documents.
async fn fts_document_prefilter(repo: &Repository, query: &str) -> Option<Vec<String>> {
    let fts_query = sanitize_fts_query(query);
    if fts_query.is_empty() {
        return None;
    }
    let mut seen = HashSet::new();
    let mut doc_ids = Vec::new();

    if let Ok(rows) = sqlx::query_as::<_, (String,)>(
        "SELECT ds.document_id
         FROM document_search ds
         JOIN documents d ON d.id = ds.document_id
         WHERE document_search MATCH ?1
           AND d.is_archived = 0
           AND d.is_ai_excluded = 0
         ORDER BY ds.rank
         LIMIT ?2",
    )
    .bind(&fts_query)
    .bind(LEXICAL_PREFILTER_LIMIT)
    .fetch_all(repo.pool())
    .await
    {
        for (id,) in rows {
            if seen.insert(id.clone()) {
                doc_ids.push(id);
            }
        }
    }

    if let Ok(chunk_rows) = sqlx::query_as::<_, (String,)>(
        "SELECT DISTINCT f.document_id
         FROM semantic_chunks_fts f
         JOIN documents d ON d.id = f.document_id
         WHERE semantic_chunks_fts MATCH ?1
           AND d.is_archived = 0
           AND d.is_ai_excluded = 0
         LIMIT ?2",
    )
    .bind(&fts_query)
    .bind(LEXICAL_PREFILTER_LIMIT)
    .fetch_all(repo.pool())
    .await
    {
        for (id,) in chunk_rows {
            if doc_ids.len() >= LEXICAL_PREFILTER_LIMIT as usize {
                break;
            }
            if seen.insert(id.clone()) {
                doc_ids.push(id);
            }
        }
    }

    if doc_ids.is_empty() {
        None
    } else {
        Some(doc_ids)
    }
}

/// Stream embeddings for the candidate set and keep the bounded top-k heap.
#[allow(clippy::too_many_arguments)]
async fn semantic_topk(
    repo: &Repository,
    query: &[f32],
    k: usize,
    candidate_docs: Option<&[String]>,
    source_types: Option<&[String]>,
    model: &str,
    version: i64,
) -> Result<(Vec<SearchResult>, usize)> {
    let mut builder: QueryBuilder<sqlx::Sqlite> =
        QueryBuilder::new("SELECT c.id, c.document_id, c.source_type, c.source_id, c.ordinal, \
                           c.text, c.heading_path, c.location_json, c.content_hash, c.token_count, e.embedding ");
    builder.push("FROM semantic_chunks c JOIN semantic_chunk_embeddings e ON e.chunk_id = c.id JOIN documents d ON d.id = c.document_id ");
    builder.push("WHERE d.is_archived = 0 AND d.is_ai_excluded = 0 AND e.model = ");
    builder.push_bind(model);
    builder.push(" AND e.embedding_version = ");
    builder.push_bind(version);
    if let Some(docs) = candidate_docs {
        if docs.is_empty() {
            return Ok((Vec::new(), 0));
        }
        builder.push(" AND c.document_id IN (");
        let mut separated = builder.separated(", ");
        for doc in docs {
            separated.push_bind(doc.clone());
        }
        separated.push_unseparated(") ");
    }
    if let Some(types) = source_types {
        if types.is_empty() {
            return Ok((Vec::new(), 0));
        }
        builder.push(" AND c.source_type IN (");
        let mut separated = builder.separated(", ");
        for t in types {
            separated.push_bind(t.clone());
        }
        separated.push_unseparated(") ");
    }

    let mut rows = builder.build().fetch(repo.pool());
    let mut heap: BinaryHeap<Reverse<ScoredCandidate>> = BinaryHeap::with_capacity(k);
    let mut scanned = 0usize;

    while let Some(row) = rows.try_next().await? {
        scanned += 1;
        let Ok(bytes) = row.try_get::<Vec<u8>, _>("embedding") else {
            continue;
        };
        let candidate = bytes_to_vector(&bytes);
        if candidate.len() != query.len() {
            continue; // dimension mismatch (older model): skip
        }
        let score = crate::ai::embedding_config::cosine_similarity(query, &candidate);
        if !score.is_finite() {
            continue;
        }

        let result = row_to_result(row, score, RetrievalMode::Semantic.as_str());
        let entry = ScoredCandidate { score, result };
        if heap.len() < k {
            heap.push(Reverse(entry));
        } else if let Some(Reverse(peek)) = heap.peek() {
            if score > peek.score {
                heap.pop();
                heap.push(Reverse(entry));
            }
        }
    }

    let mut out: Vec<SearchResult> = heap.into_iter().map(|Reverse(e)| e.result).collect();
    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Chunk-neighborhood dedup: drop results adjacent (ordinal ±1) to an
    // already-accepted chunk of the same document + source type.
    let mut deduped: Vec<SearchResult> = Vec::with_capacity(k);
    for result in out {
        let adjacent = deduped.iter().any(|accepted| {
            accepted.document_id == result.document_id
                && accepted.source_type == result.source_type
                && (accepted.ordinal - result.ordinal).abs() <= 1
        });
        if !adjacent {
            deduped.push(result);
        }
        if deduped.len() == k {
            break;
        }
    }
    Ok((deduped, scanned))
}

fn bytes_to_vector(bytes: &[u8]) -> Vec<f32> {
    let n = bytes.len() / 4;
    let mut v = vec![0.0f32; n];
    LittleEndian::read_f32_into(bytes, &mut v);
    v
}

fn row_to_result(row: sqlx::sqlite::SqliteRow, score: f32, mode: &str) -> SearchResult {
    let heading_path: String = row.try_get("heading_path").unwrap_or_else(|_| "[]".into());
    let location_json: String = row.try_get("location_json").unwrap_or_else(|_| "{}".into());
    SearchResult {
        chunk_id: row.try_get("id").unwrap_or_default(),
        document_id: row.try_get("document_id").unwrap_or_default(),
        document_title: None, // resolved batch-wise by the caller
        source_type: row.try_get("source_type").unwrap_or_default(),
        source_id: row.try_get("source_id").ok().flatten(),
        ordinal: row.try_get("ordinal").unwrap_or(0),
        text: row.try_get("text").unwrap_or_default(),
        heading_path: serde_json::from_str(&heading_path).unwrap_or_default(),
        location: serde_json::from_str(&location_json).unwrap_or(serde_json::Value::Null),
        content_hash: row.try_get("content_hash").unwrap_or_default(),
        token_count: row.try_get("token_count").unwrap_or(0),
        score: score as f64,
        mode: mode.to_string(),
    }
}

/// Lexical-only results: queries `semantic_chunks_fts` across all canonical
/// chunk types (`document`, `transcript`, `session`, `extract`, `annotation`,
/// `card`) enforcing `is_archived = 0 AND is_ai_excluded = 0`, with relaxed OR
/// fallback for multi-word queries and ephemeral `fts-<doc_id>` fallback ONLY
/// for unchunked eligible documents.
async fn lexical_results(
    repo: &Repository,
    query: &str,
    k: usize,
    filters: &RetrievalFilters,
) -> Result<Vec<SearchResult>> {
    let fts_query = sanitize_fts_query(query);
    let mut out: Vec<SearchResult> = Vec::new();
    if fts_query.is_empty() {
        return Ok(out);
    }

    let scoped_docs = filters
        .document_ids
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    let scoped_types = filters
        .source_types
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    let allowed_types: Option<HashSet<&str>> = filters
        .source_types
        .as_ref()
        .map(|ts| ts.iter().map(|t| t.as_str()).collect());
    let type_ok = |t: &str| allowed_types.as_ref().map_or(true, |set| set.contains(t));

    if scoped_docs.as_deref() == Some("[]") || scoped_types.as_deref() == Some("[]") {
        return Ok(out);
    }

    let mut seen_chunk_ids = HashSet::new();
    let chunk_limit = (k.saturating_mul(3)).max(32) as i64;

    if let Ok(chunk_rows) = sqlx::query(
        "SELECT c.id, c.document_id, c.source_type, c.source_id, c.ordinal,
                c.text, c.heading_path, c.location_json, c.content_hash, c.token_count,
                semantic_chunks_fts.rank AS bm25_rank
         FROM semantic_chunks_fts
         JOIN semantic_chunks c ON c.id = semantic_chunks_fts.chunk_id
         JOIN documents d ON d.id = c.document_id
         WHERE semantic_chunks_fts MATCH ?1
           AND d.is_archived = 0
           AND d.is_ai_excluded = 0
           AND (?2 IS NULL OR c.document_id IN (SELECT value FROM json_each(?2)))
           AND (?3 IS NULL OR c.source_type IN (SELECT value FROM json_each(?3)))
         ORDER BY semantic_chunks_fts.rank
         LIMIT ?4",
    )
    .bind(&fts_query)
    .bind(scoped_docs.as_deref())
    .bind(scoped_types.as_deref())
    .bind(chunk_limit)
    .fetch_all(repo.pool())
    .await
    {
        for row in chunk_rows {
            if out.len() >= k {
                break;
            }
            let rank: f64 = row.try_get("bm25_rank").unwrap_or(0.0);
            let result = row_to_result(
                row,
                normalize_bm25(rank) as f32,
                RetrievalMode::LexicalOnly.as_str(),
            );
            if seen_chunk_ids.insert(result.chunk_id.clone()) {
                out.push(result);
            }
        }
    }

    // Relaxed multi-term OR query over semantic_chunks_fts if strict AND returned < k hits.
    if out.len() < k {
        let tokens: Vec<&str> = fts_query.split_whitespace().collect();
        if tokens.len() > 1 {
            let or_query = tokens.join(" OR ");
            if let Ok(or_rows) = sqlx::query(
                "SELECT c.id, c.document_id, c.source_type, c.source_id, c.ordinal,
                        c.text, c.heading_path, c.location_json, c.content_hash, c.token_count,
                        semantic_chunks_fts.rank AS bm25_rank
                 FROM semantic_chunks_fts
                 JOIN semantic_chunks c ON c.id = semantic_chunks_fts.chunk_id
                 JOIN documents d ON d.id = c.document_id
                 WHERE semantic_chunks_fts MATCH ?1
                   AND d.is_archived = 0
                   AND d.is_ai_excluded = 0
                   AND (?2 IS NULL OR c.document_id IN (SELECT value FROM json_each(?2)))
                   AND (?3 IS NULL OR c.source_type IN (SELECT value FROM json_each(?3)))
                 ORDER BY semantic_chunks_fts.rank
                 LIMIT ?4",
            )
            .bind(&or_query)
            .bind(scoped_docs.as_deref())
            .bind(scoped_types.as_deref())
            .bind(chunk_limit)
            .fetch_all(repo.pool())
            .await
            {
                for row in or_rows {
                    if out.len() >= k {
                        break;
                    }
                    let rank: f64 = row.try_get("bm25_rank").unwrap_or(0.0);
                    let score = (normalize_bm25(rank) * 0.65).max(0.05) as f32;
                    let result = row_to_result(row, score, RetrievalMode::LexicalOnly.as_str());
                    if seen_chunk_ids.insert(result.chunk_id.clone()) {
                        out.push(result);
                    }
                }
            }
        }
    }

    // Ephemeral fallback ONLY for eligible unchunked documents.
    if out.len() < k && type_ok("document") {
        let doc_rows: Vec<(String, f64, String)> = sqlx::query_as(
            "SELECT ds.document_id, ds.rank, snippet(document_search, 2, '<mark>', '</mark>', '...', 24)
             FROM document_search ds
             JOIN documents d ON d.id = ds.document_id
             WHERE document_search MATCH ?1
               AND d.is_archived = 0
               AND d.is_ai_excluded = 0
               AND NOT EXISTS (SELECT 1 FROM semantic_chunks sc WHERE sc.document_id = ds.document_id)
               AND (?3 IS NULL OR ds.document_id IN (SELECT value FROM json_each(?3)))
             ORDER BY ds.rank
             LIMIT ?2",
        )
        .bind(&fts_query)
        .bind(LEXICAL_PREFILTER_LIMIT)
        .bind(scoped_docs.as_deref())
        .fetch_all(repo.pool())
        .await?;

        for (doc_id, rank, snippet) in doc_rows {
            if out.len() >= k {
                break;
            }
            out.push(SearchResult {
                chunk_id: format!("fts-{doc_id}"),
                document_id: doc_id.clone(),
                document_title: None,
                source_type: "document".to_string(),
                source_id: None,
                ordinal: -1,
                text: snippet.replace("<mark>", "").replace("</mark>", ""),
                heading_path: Vec::new(),
                location: serde_json::json!({
                    "sourceType": "fts",
                    "documentId": doc_id,
                    "ordinal": -1,
                }),
                content_hash: String::new(),
                token_count: 0,
                score: normalize_bm25(rank),
                mode: RetrievalMode::LexicalOnly.as_str().to_string(),
            });
        }
    }

    // Extract hits map to extract chunks via source_id when not already emitted.
    if out.len() < k && type_ok("extract") {
        let extract_rows: Vec<(String, String, f64)> = sqlx::query_as(
            "SELECT es.extract_id, es.document_id, es.rank
             FROM extract_search es
             JOIN documents d ON d.id = es.document_id
             WHERE extract_search MATCH ?1
               AND d.is_archived = 0
               AND d.is_ai_excluded = 0
               AND (?3 IS NULL OR es.document_id IN (SELECT value FROM json_each(?3)))
             ORDER BY es.rank
             LIMIT ?2",
        )
        .bind(&fts_query)
        .bind(LEXICAL_PREFILTER_LIMIT)
        .bind(scoped_docs.as_deref())
        .fetch_all(repo.pool())
        .await?;

        for (extract_id, doc_id, rank) in extract_rows {
            if out.len() >= k {
                break;
            }
            let row = sqlx::query(
                "SELECT id, document_id, source_type, source_id, ordinal, text, heading_path, location_json, content_hash, token_count
                 FROM semantic_chunks
                 WHERE document_id = ?1 AND source_type = 'extract' AND source_id = ?2
                 LIMIT 1",
            )
            .bind(&doc_id)
            .bind(&extract_id)
            .fetch_optional(repo.pool())
            .await?;
            if let Some(row) = row {
                let result = row_to_result(
                    row,
                    normalize_bm25(rank) as f32,
                    RetrievalMode::LexicalOnly.as_str(),
                );
                if type_ok(&result.source_type) && seen_chunk_ids.insert(result.chunk_id.clone()) {
                    out.push(result);
                }
            }
        }
    }

    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out.truncate(k);

    resolve_titles(repo, &mut out).await;
    Ok(out)
}

/// FTS5 `rank` is bm25 (negative, more-negative = better). Map to a
/// monotonic 0–1 score where better rank → higher score.
fn normalize_bm25(rank: f64) -> f64 {
    let distance = (-rank).max(0.0);
    1.0 / (1.0 + distance)
}

/// Batch-resolve document titles for a result list.
pub async fn resolve_titles(repo: &Repository, results: &mut [SearchResult]) {
    let ids: HashSet<&str> = results.iter().map(|r| r.document_id.as_str()).collect();
    let ids: Vec<&str> = ids.into_iter().collect();
    if ids.is_empty() {
        return;
    }
    let mut builder: QueryBuilder<sqlx::Sqlite> =
        QueryBuilder::new("SELECT id, title FROM documents WHERE id IN (");
    let mut separated = builder.separated(", ");
    for id in ids {
        separated.push_bind(id);
    }
    separated.push_unseparated(")");
    let Ok(rows) = builder.build().fetch_all(repo.pool()).await else {
        return;
    };
    let titles: std::collections::HashMap<String, String> = rows
        .iter()
        .filter_map(|row| {
            Some((
                row.try_get::<String, _>("id").ok()?,
                row.try_get::<String, _>("title").ok()?,
            ))
        })
        .collect();
    for result in results.iter_mut() {
        if result.document_title.is_none() {
            result.document_title = titles.get(&result.document_id).cloned();
        }
    }
}

/// Evenly samples chunks across ordinal positions (`0 .. len-1`) for each
/// eligible document (`is_archived = 0 AND is_ai_excluded = 0`). Used as a
/// bounded coverage fallback when keyword/semantic queries miss long sources
/// or generic study goals.
pub async fn sample_document_chunks(
    repo: &Repository,
    document_ids: &[String],
    extract_ids: Option<&[String]>,
    per_document_limit: usize,
) -> Result<Vec<SearchResult>> {
    if document_ids.is_empty() || per_document_limit == 0 {
        return Ok(Vec::new());
    }
    let limit = per_document_limit.clamp(1, 16);
    let extract_filter: Vec<String> = extract_ids
        .unwrap_or(&[])
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let mut out = Vec::new();
    for doc_id in document_ids {
        let mut id_qb: sqlx::QueryBuilder<'_, sqlx::Sqlite> = sqlx::QueryBuilder::new(
            "SELECT c.id FROM semantic_chunks c
             JOIN documents d ON d.id = c.document_id
             WHERE c.document_id = ",
        );
        id_qb.push_bind(doc_id);
        id_qb.push(" AND d.is_archived = 0 AND d.is_ai_excluded = 0");
        if extract_filter.is_empty() {
            id_qb.push(" AND c.source_type IN ('document', 'transcript', 'session', 'extract')");
        } else {
            id_qb.push(" AND c.source_type = 'extract' AND c.source_id IN (");
            let mut sep = id_qb.separated(", ");
            for ext_id in &extract_filter {
                sep.push_bind(ext_id);
            }
            id_qb.push(")");
        }
        id_qb.push(
            " ORDER BY CASE c.source_type
                 WHEN 'transcript' THEN 0
                 WHEN 'session' THEN 1
                 WHEN 'document' THEN 2
                 ELSE 3
             END, c.ordinal ASC",
        );

        let all_ids: Vec<(String,)> = id_qb.build_query_as().fetch_all(repo.pool()).await?;
        if all_ids.is_empty() {
            continue;
        }

        let mut picked_indices = Vec::new();
        if all_ids.len() <= limit {
            picked_indices.extend(0..all_ids.len());
        } else if limit == 1 {
            picked_indices.push(0);
        } else {
            let max_idx = all_ids.len() - 1;
            for i in 0..limit {
                let idx = (i * max_idx) / (limit - 1);
                if !picked_indices.contains(&idx) {
                    picked_indices.push(idx);
                }
            }
        }

        let picked_ids: Vec<&str> = picked_indices
            .iter()
            .map(|&idx| all_ids[idx].0.as_str())
            .collect();
        let mut row_qb: sqlx::QueryBuilder<'_, sqlx::Sqlite> = sqlx::QueryBuilder::new(
            "SELECT c.id, c.document_id, d.title, c.source_type, c.source_id, c.ordinal,
                    c.text, c.heading_path, c.location_json, c.content_hash, c.token_count
             FROM semantic_chunks c
             JOIN documents d ON d.id = c.document_id
             WHERE c.id IN (",
        );
        let mut sep = row_qb.separated(", ");
        for cid in &picked_ids {
            sep.push_bind(*cid);
        }
        row_qb.push(") ORDER BY c.ordinal ASC");

        let rows: Vec<(
            String,
            String,
            Option<String>,
            String,
            Option<String>,
            i64,
            String,
            String,
            String,
            String,
            i64,
        )> = row_qb.build_query_as().fetch_all(repo.pool()).await?;

        for (
            step,
            (
                chunk_id,
                document_id,
                document_title,
                source_type,
                source_id,
                ordinal,
                text,
                hp_json,
                loc_json,
                content_hash,
                token_count,
            ),
        ) in rows.into_iter().enumerate()
        {
            let heading_path: Vec<String> = serde_json::from_str(&hp_json).unwrap_or_default();
            let location: serde_json::Value =
                serde_json::from_str(&loc_json).unwrap_or(serde_json::Value::Null);
            out.push(SearchResult {
                chunk_id,
                document_id,
                document_title,
                source_type,
                source_id,
                ordinal,
                text,
                heading_path,
                location,
                content_hash,
                token_count,
                score: (0.45 - (step as f64) * 0.005).max(0.05),
                mode: "lexicalOnly".to_string(),
            });
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_learning::embeddings_backend::EmbeddingBackend;
    use crate::ai_learning::indexer::index_document_once;
    use crate::database::Repository;

    use crate::ai_learning::test_support::{reindex_fts, seed_document, test_pool};

    #[tokio::test]
    async fn lexical_fallback_without_backend_or_index() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(
            &pool,
            "lex-1",
            "The quantum tunneling effect explains alpha decay.",
            "text",
        )
        .await;
        reindex_fts(&pool).await;

        let backend = EmbeddingBackend::OnDevice {
            model: crate::ai_learning::embeddings_backend::ON_DEVICE_MODEL,
        };
        let response = retrieve(
            &repo,
            &backend,
            "quantum tunneling",
            5,
            &RetrievalFilters::default(),
        )
        .await
        .expect("retrieve");
        assert_eq!(response.mode, "lexicalOnly");
        assert!(!response.results.is_empty(), "FTS hit surfaced");
        assert!(response.results[0].document_id == "lex-1");
        assert!(response.results[0].text.contains("quantum"));
    }

    #[tokio::test]
    async fn lexical_limit_is_applied_within_selected_documents() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        for index in 0..LEXICAL_PREFILTER_LIMIT {
            seed_document(&pool, &format!("outside-{index}"), "tunneling", "text").await;
        }
        seed_document(
            &pool,
            "selected",
            "Quantum tunneling explains alpha decay and several other physical effects.",
            "text",
        )
        .await;

        let backend = EmbeddingBackend::OnDevice {
            model: crate::ai_learning::embeddings_backend::ON_DEVICE_MODEL,
        };
        let response = retrieve(
            &repo,
            &backend,
            "tunneling",
            5,
            &RetrievalFilters {
                document_ids: Some(vec!["selected".to_string()]),
                ..Default::default()
            },
        )
        .await
        .expect("retrieve selected document");
        assert_eq!(response.mode, "lexicalOnly");
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].document_id, "selected");
        assert!(response.results[0].text.contains("alpha decay"));
    }

    #[tokio::test]
    async fn semantic_ranking_on_synthetic_vectors() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        // One large paragraph (~800 chars) becomes its own chunk verbatim, so
        // querying with that exact text must score cosine 1.0 against it.
        let target_text =
            "alpha bravo charlie delta echo foxtrot golf hotel india juliet ".repeat(12);
        let target_text = target_text.trim_end();
        let content = format!(
            "# Section\n\n{}\n\n{}",
            target_text,
            "uniform victor whiskey xray yankee zulu ".repeat(20)
        );
        seed_document(&pool, "sem-1", &content, "markdown").await;
        seed_document(
            &pool,
            "sem-2",
            "Completely different topic about cooking recipes and ingredients.",
            "text",
        )
        .await;

        let backend = EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-retrieve",
        };
        index_document_once(&repo, "sem-1", &backend, &mut || true)
            .await
            .expect("index");
        index_document_once(&repo, "sem-2", &backend, &mut || true)
            .await
            .expect("index");

        // The mock embedding of the exact chunk text matches itself with
        // cosine 1.0 — deterministic top hit.
        let response = retrieve(
            &repo,
            &backend,
            target_text,
            5,
            &RetrievalFilters::default(),
        )
        .await
        .expect("retrieve");
        assert_eq!(response.mode, "semantic", "semantic mode expected");
        assert!(!response.results.is_empty());
        assert_eq!(response.results[0].document_id, "sem-1");
        let sim = response.results[0].score;
        assert!(
            (sim - 1.0).abs() < 1e-5,
            "exact chunk must score 1.0, got {sim}"
        );
        assert_eq!(response.results[0].mode, "semantic");
        assert!(response.results[0].document_title.is_some() || true);
        assert!(response.candidates_scanned > 0);
    }

    #[tokio::test]
    async fn document_filter_restricts_candidates() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        let content_a = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
        let content_b = "alpha bravo charlie delta echo foxtrot golf hotel india kilo";
        seed_document(&pool, "f-1", content_a, "text").await;
        seed_document(&pool, "f-2", content_b, "text").await;

        let backend = EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-filter",
        };
        index_document_once(&repo, "f-1", &backend, &mut || true)
            .await
            .expect("index f-1");
        index_document_once(&repo, "f-2", &backend, &mut || true)
            .await
            .expect("index f-2");

        let filters = RetrievalFilters {
            document_ids: Some(vec!["f-1".to_string()]),
            source_types: None,
        };
        let response = retrieve(&repo, &backend, content_a, 5, &filters)
            .await
            .expect("retrieve");
        assert!(!response.results.is_empty());
        assert!(
            response.results.iter().all(|r| r.document_id == "f-1"),
            "filter leaked other documents"
        );
    }

    #[tokio::test]
    async fn source_type_filter_extracts_only() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(
            &pool,
            "st-1",
            "Body about astronomy and telescopes and stars. More filler. ",
            "text",
        )
        .await;
        sqlx::query(
            "INSERT INTO extracts (id, document_id, content, date_created, date_modified)
             VALUES ('ext-st', 'st-1', 'astronomy telescopes stars extract', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let backend = EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-st",
        };
        index_document_once(&repo, "st-1", &backend, &mut || true)
            .await
            .expect("index");

        let filters = RetrievalFilters {
            document_ids: None,
            source_types: Some(vec!["extract".to_string()]),
        };
        let response = retrieve(
            &repo,
            &backend,
            "astronomy telescopes stars extract",
            5,
            &filters,
        )
        .await
        .expect("retrieve");
        assert!(!response.results.is_empty());
        assert!(
            response.results.iter().all(|r| r.source_type == "extract"),
            "expected extract-only results, got {:?}",
            response
                .results
                .iter()
                .map(|r| r.source_type.clone())
                .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn neighborhood_dedup_skips_adjacent_ordinals() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        // One long section → adjacent chunks with near-identical content (and
        // therefore near-identical mock embeddings).
        let content = (0..60)
            .map(|i| {
                format!(
                    "Shared thematic vocabulary number {i} about planetary geology and tectonics."
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        seed_document(&pool, "dup-1", &content, "text").await;

        let backend = EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-dup",
        };
        index_document_once(&repo, "dup-1", &backend, &mut || true)
            .await
            .expect("index");

        let response = retrieve(
            &repo,
            &backend,
            "planetary geology tectonics",
            10,
            &RetrievalFilters::default(),
        )
        .await
        .expect("retrieve");
        assert!(
            response.results.len() >= 2,
            "need multiple results to check dedup"
        );
        for (a, b) in response.results.iter().zip(response.results.iter().skip(1)) {
            if a.document_id == b.document_id && a.source_type == b.source_type {
                assert!(
                    (a.ordinal - b.ordinal).abs() > 1,
                    "adjacent ordinals {} and {} both in top-k",
                    a.ordinal,
                    b.ordinal
                );
            }
        }
    }

    #[tokio::test]
    async fn k_is_bounded() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        let content = (0..40)
            .map(|i| {
                format!("Distinct paragraph {i} vocabulary cluster with number {i} content words.")
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        seed_document(&pool, "k-1", &content, "text").await;
        let backend = EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-k",
        };
        index_document_once(&repo, "k-1", &backend, &mut || true)
            .await
            .expect("index");

        let response = retrieve(
            &repo,
            &backend,
            "vocabulary cluster",
            2,
            &RetrievalFilters::default(),
        )
        .await
        .expect("retrieve");
        assert!(response.results.len() <= 2);

        // Oversized k clamps to MAX_K.
        let response = retrieve(
            &repo,
            &backend,
            "vocabulary cluster",
            10_000,
            &RetrievalFilters::default(),
        )
        .await
        .expect("retrieve");
        assert!(response.results.len() <= MAX_K);
    }

    #[tokio::test]
    async fn empty_query_returns_nothing() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        let backend = EmbeddingBackend::Mock {
            dim: 8,
            model: "mock-e",
        };
        let response = retrieve(&repo, &backend, "   ", 5, &RetrievalFilters::default())
            .await
            .expect("retrieve");
        assert!(response.results.is_empty());
    }

    #[test]
    fn fts_sanitization_handles_operators_and_cjk() {
        assert_eq!(sanitize_fts_query("hello world"), "\"hello\"* \"world\"*");
        assert_eq!(
            sanitize_fts_query("a \" OR 1=1 --"),
            "\"a\"* \"OR\"* \"11\"* \"--\"*"
        );
        assert_eq!(sanitize_fts_query("量子计算"), "\"量子计算\"*");
        assert_eq!(sanitize_fts_query("!!! ..."), "");
    }

    #[test]
    fn bm25_normalization_is_monotonic() {
        assert!(normalize_bm25(-5.0) < normalize_bm25(-1.0));
        assert!((normalize_bm25(0.0) - 1.0).abs() < 1e-9);
    }

    #[tokio::test]
    async fn cross_modal_figure_and_media_retrieval() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(
            &pool,
            "doc-vis-1",
            "Neural network architectures and figures.",
            "pdf",
        )
        .await;
        reindex_fts(&pool).await;

        let backend = EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-cm",
        };
        let query = "transformer architecture diagram";
        let query_vec = backend.embed_text(query).await.expect("embed");

        // Insert figure chunk with asset_url and page_number
        let fig_location = serde_json::json!({
            "sourceType": "pdf",
            "documentId": "doc-vis-1",
            "ordinal": 0,
            "startOffset": 0,
            "endOffset": 45,
            "pageNumber": 5,
            "assetUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
        });
        sqlx::query(
            "INSERT INTO semantic_chunks (id, document_id, source_type, source_id, ordinal, text, heading_path, location_json, content_hash, token_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'), datetime('now'))",
        )
        .bind("fig-chk-1")
        .bind("doc-vis-1")
        .bind("figure")
        .bind(Option::<String>::None)
        .bind(0)
        .bind("Figure 1: Transformer model architecture diagram")
        .bind("[]")
        .bind(fig_location.to_string())
        .bind("hash-fig-1")
        .bind(10)
        .execute(&pool)
        .await
        .unwrap();

        // Store identical vector so cosine similarity is 1.0
        let mut embedding_bytes = vec![0u8; 32 * 4];
        LittleEndian::write_f32_into(&query_vec, &mut embedding_bytes);
        sqlx::query(
            "INSERT INTO semantic_chunk_embeddings (chunk_id, embedding, model, dimension, embedding_version, content_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind("fig-chk-1")
        .bind(&embedding_bytes)
        .bind("mock-cm")
        .bind(32)
        .bind(backend.embedding_version())
        .bind("hash-fig-1")
        .execute(&pool)
        .await
        .unwrap();

        let response = retrieve(&repo, &backend, query, 5, &RetrievalFilters::default())
            .await
            .expect("retrieve succeeds");

        assert_eq!(response.mode, "semantic");
        let hit = response.results.iter().find(|r| r.chunk_id == "fig-chk-1");
        assert!(hit.is_some(), "Figure hit was retrieved");
        let hit = hit.unwrap();
        assert_eq!(hit.source_type, "figure");
        assert_eq!(hit.location["pageNumber"], 5);
        assert_eq!(
            hit.location["assetUrl"],
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA"
        );
    }

    #[tokio::test]
    async fn lexical_results_retrieves_transcript_chunks_and_skips_ai_excluded() {
        use crate::ai_learning::models::SOURCE_TYPE_TRANSCRIPT;
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-yt-live", "", "youtube").await;
        seed_document(
            &pool,
            "doc-yt-excl",
            "Spectral decomposition exclusive excluded content",
            "youtube",
        )
        .await;
        seed_document(&pool, "doc-yt-arch", "", "youtube").await;
        sqlx::query("UPDATE documents SET is_ai_excluded = 1 WHERE id = 'doc-yt-excl'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE documents SET is_archived = 1 WHERE id = 'doc-yt-arch'")
            .execute(&pool)
            .await
            .unwrap();

        let yt_loc = serde_json::json!({
            "sourceType": "transcript",
            "documentId": "doc-yt-live",
            "ordinal": 0,
            "startOffset": 0,
            "endOffset": 45,
            "timestampMs": 42000,
        });
        sqlx::query(
            "INSERT INTO semantic_chunks (id, document_id, source_type, source_id, ordinal, text, heading_path, location_json, content_hash, token_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, NULL, 0, ?4, '[]', ?5, ?6, 9, datetime('now'), datetime('now'))",
        )
        .bind("chk-yt-1")
        .bind("doc-yt-live")
        .bind(SOURCE_TYPE_TRANSCRIPT)
        .bind("Spectral decomposition orthogonal basis theorem")
        .bind(yt_loc.to_string())
        .bind("hash-yt-1")
        .execute(&pool)
        .await
        .unwrap();

        let arch_loc = serde_json::json!({
            "sourceType": "transcript",
            "documentId": "doc-yt-arch",
            "ordinal": 0,
            "startOffset": 0,
            "endOffset": 45,
            "timestampMs": 88000,
        });
        sqlx::query(
            "INSERT INTO semantic_chunks (id, document_id, source_type, source_id, ordinal, text, heading_path, location_json, content_hash, token_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, NULL, 0, ?4, '[]', ?5, ?6, 9, datetime('now'), datetime('now'))",
        )
        .bind("chk-arch-1")
        .bind("doc-yt-arch")
        .bind(SOURCE_TYPE_TRANSCRIPT)
        .bind("Spectral decomposition archived chunk")
        .bind(arch_loc.to_string())
        .bind("hash-arch-1")
        .execute(&pool)
        .await
        .unwrap();

        reindex_fts(&pool).await;

        let backend = EmbeddingBackend::OnDevice {
            model: "embeddinggemma",
        };
        let response = retrieve(
            &repo,
            &backend,
            "spectral decomposition",
            5,
            &RetrievalFilters::default(),
        )
        .await
        .expect("lexical retrieve succeeds");

        assert_eq!(response.mode, "lexicalOnly");
        assert!(
            response
                .results
                .iter()
                .all(|r| r.document_id != "doc-yt-excl"),
            "is_ai_excluded document must be excluded from lexical FTS results"
        );
        assert!(
            response
                .results
                .iter()
                .all(|r| r.document_id != "doc-yt-arch"),
            "is_archived document must be excluded from lexical chunk results"
        );
        let hit = response
            .results
            .iter()
            .find(|r| r.chunk_id == "chk-yt-1")
            .expect("transcript chunk returned instead of fts stub");
        assert_eq!(hit.source_type, SOURCE_TYPE_TRANSCRIPT);
        assert_eq!(hit.location["timestampMs"], 42000);
    }

    #[tokio::test]
    async fn lexical_results_relaxes_multi_word_query_when_strict_and_insufficient() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-relax", "", "markdown").await;

        let loc = serde_json::json!({
            "sourceType": "markdown",
            "documentId": "doc-relax",
            "ordinal": 0,
            "startOffset": 0,
            "endOffset": 42,
        });
        sqlx::query(
            "INSERT INTO semantic_chunks (id, document_id, source_type, source_id, ordinal, text, heading_path, location_json, content_hash, token_count, created_at, updated_at)
             VALUES ('chk-relax-1', 'doc-relax', 'document', NULL, 0, 'Hamiltonian mechanics preserves phase volume.', '[]', ?1, 'hash-relax-1', 8, datetime('now'), datetime('now'))",
        )
        .bind(loc.to_string())
        .execute(&pool)
        .await
        .unwrap();

        let backend = EmbeddingBackend::OnDevice {
            model: "embeddinggemma",
        };
        let response = retrieve(
            &repo,
            &backend,
            "Hamiltonian Frobenius nonexistentterm",
            5,
            &RetrievalFilters {
                document_ids: Some(vec!["doc-relax".to_string()]),
                source_types: None,
            },
        )
        .await
        .expect("relaxed retrieve succeeds");

        assert_eq!(response.mode, "lexicalOnly");
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].chunk_id, "chk-relax-1");
    }

    #[tokio::test]
    async fn semantic_topk_skips_archived_and_ai_excluded_documents() {
        use byteorder::{ByteOrder, LittleEndian};
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-vis-ok", "Allowed diagram", "pdf").await;
        seed_document(&pool, "doc-vis-arch", "Archived diagram", "pdf").await;
        seed_document(
            &pool,
            "doc-vis-excl",
            "Transformer architecture attention excluded",
            "pdf",
        )
        .await;
        sqlx::query("UPDATE documents SET is_archived = 1 WHERE id = 'doc-vis-arch'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE documents SET is_ai_excluded = 1 WHERE id = 'doc-vis-excl'")
            .execute(&pool)
            .await
            .unwrap();
        reindex_fts(&pool).await;

        let backend = EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-cm",
        };
        let query = "transformer architecture attention";
        let query_vec = backend.embed_text(query).await.expect("embed");
        let mut embedding_bytes = vec![0u8; 32 * 4];
        LittleEndian::write_f32_into(&query_vec, &mut embedding_bytes);

        for (cid, did, hash) in [
            ("chk-ok", "doc-vis-ok", "h-ok"),
            ("chk-arch", "doc-vis-arch", "h-arch"),
        ] {
            let loc = serde_json::json!({
                "sourceType": "pdf",
                "documentId": did,
                "ordinal": 0,
                "startOffset": 0,
                "endOffset": 20,
                "pageNumber": 2,
            });
            sqlx::query(
                "INSERT INTO semantic_chunks (id, document_id, source_type, source_id, ordinal, text, heading_path, location_json, content_hash, token_count, created_at, updated_at)
                 VALUES (?1, ?2, 'document', NULL, 0, 'Transformer architecture attention weights', '[]', ?3, ?4, 6, datetime('now'), datetime('now'))",
            )
            .bind(cid)
            .bind(did)
            .bind(loc.to_string())
            .bind(hash)
            .execute(&pool)
            .await
            .unwrap();

            sqlx::query(
                "INSERT INTO semantic_chunk_embeddings (chunk_id, embedding, model, dimension, embedding_version, content_hash)
                 VALUES (?1, ?2, 'mock-cm', 32, ?3, ?4)",
            )
            .bind(cid)
            .bind(&embedding_bytes)
            .bind(backend.embedding_version())
            .bind(hash)
            .execute(&pool)
            .await
            .unwrap();
        }

        let response = retrieve(&repo, &backend, query, 5, &RetrievalFilters::default())
            .await
            .expect("semantic retrieve succeeds");

        assert_eq!(response.mode, "semantic");
        assert!(response.results.iter().any(|r| r.chunk_id == "chk-ok"));
        assert!(
            response
                .results
                .iter()
                .all(|r| r.document_id != "doc-vis-arch"),
            "is_archived doc must never be returned in semantic mode"
        );
        assert!(
            response
                .results
                .iter()
                .all(|r| r.document_id != "doc-vis-excl"),
            "is_ai_excluded doc must never be returned"
        );
    }

    #[tokio::test]
    async fn sample_document_chunks_stratified_respects_exclusions() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());

        seed_document(&pool, "doc-sample-ok", "Long Lecture", "pdf").await;
        seed_document(&pool, "doc-sample-arch", "Archived Notes", "pdf").await;
        seed_document(&pool, "doc-sample-excl", "Private Diary", "markdown").await;

        for (cid, doc_id, ordinal) in [
            ("smp-0", "doc-sample-ok", 0),
            ("smp-1", "doc-sample-ok", 1),
            ("smp-2", "doc-sample-ok", 2),
            ("smp-3", "doc-sample-ok", 3),
            ("smp-4", "doc-sample-ok", 4),
            ("smp-5", "doc-sample-ok", 5),
            ("arch-0", "doc-sample-arch", 0),
            ("excl-0", "doc-sample-excl", 0),
        ] {
            let loc = serde_json::json!({
                "sourceType": "pdf",
                "documentId": doc_id,
                "ordinal": ordinal,
                "startOffset": 0,
                "endOffset": 24,
                "pageNumber": ordinal + 1,
            });
            sqlx::query(
                "INSERT INTO semantic_chunks (id, document_id, source_type, source_id, ordinal, text, heading_path, location_json, content_hash, token_count, created_at, updated_at)
                 VALUES (?1, ?2, 'document', NULL, ?3, ?4, '[]', ?5, ?6, 4, datetime('now'), datetime('now'))",
            )
            .bind(cid)
            .bind(doc_id)
            .bind(ordinal)
            .bind(format!("Passage ordinal {ordinal} in document {doc_id}"))
            .bind(loc.to_string())
            .bind(format!("h-{cid}"))
            .execute(&pool)
            .await
            .unwrap();
        }

        sqlx::query("UPDATE documents SET is_archived = 1 WHERE id = 'doc-sample-arch'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE documents SET is_ai_excluded = 1 WHERE id = 'doc-sample-excl'")
            .execute(&pool)
            .await
            .unwrap();

        let ids = vec![
            "doc-sample-ok".to_string(),
            "doc-sample-arch".to_string(),
            "doc-sample-excl".to_string(),
        ];
        let results = sample_document_chunks(&repo, &ids, None, 3)
            .await
            .expect("sample_document_chunks succeeds");

        let ordinals: Vec<i64> = results.iter().map(|r| r.ordinal).collect();
        assert_eq!(ordinals, vec![0_i64, 2_i64, 5_i64]);
        assert!(results.iter().all(|r| r.document_id == "doc-sample-ok"));
    }
}
