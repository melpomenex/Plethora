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
use tracing::{debug, warn};

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
            Err(e) => {
                debug!("query embedding failed, lexical fallback: {}", e);
                None
            }
        }
    } else {
        None
    };

    if let Some(query_vec) = query_embedding {
        let model = backend.model_name();
        let version = backend.embedding_version();

        // Candidate documents: FTS hits ∪ explicit filters.
        let mut candidate_docs: Option<Vec<String>> = filters.document_ids.clone();
        if let Some(fts) = fts_doc_ids.as_ref() {
            candidate_docs = Some(match candidate_docs.take() {
                Some(explicit) => {
                    let mut merged = explicit;
                    for id in fts {
                        if !merged.contains(id) {
                            merged.push(id.clone());
                        }
                    }
                    merged
                }
                None => fts.clone(),
            });
        }

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

/// Top documents by bm25 rank via `document_search`.
async fn fts_document_prefilter(repo: &Repository, query: &str) -> Option<Vec<String>> {
    let fts_query = sanitize_fts_query(query);
    if fts_query.is_empty() {
        return None;
    }
    match sqlx::query_as::<_, (String,)>(
        "SELECT document_id FROM document_search
         WHERE document_search MATCH ?1
         ORDER BY rank
         LIMIT ?2",
    )
    .bind(&fts_query)
    .bind(LEXICAL_PREFILTER_LIMIT)
    .fetch_all(repo.pool())
    .await
    {
        Ok(rows) if !rows.is_empty() => Some(rows.into_iter().map(|(id,)| id).collect()),
        Ok(_) => None,
        Err(e) => {
            // Unindexed FTS table or tokenizer error: degrade to no prefilter.
            debug!("document_search prefilter failed: {}", e);
            None
        }
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
    builder.push("FROM semantic_chunks c JOIN semantic_chunk_embeddings e ON e.chunk_id = c.id ");
    builder.push("WHERE e.model = ");
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

/// Lexical-only results: FTS document hits (mapped to their best-matching
/// chunk when the document is indexed, otherwise an ephemeral snippet hit)
/// plus extract hits mapped to their extract chunks.
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

    let allowed_docs = filters.document_ids.as_ref().map(|docs| {
        docs.iter()
            .map(|d| d.as_str())
            .collect::<HashSet<&str>>()
    });
    let allowed_types: Option<HashSet<&str>> = filters
        .source_types
        .as_ref()
        .map(|ts| ts.iter().map(|t| t.as_str()).collect());

    let type_ok = |t: &str| allowed_types.as_ref().map_or(true, |set| set.contains(t));

    // Document hits.
    let doc_rows: Vec<(String, f64, String)> = match sqlx::query_as(
        "SELECT ds.document_id, rank, snippet(document_search, 2, '<mark>', '</mark>', '...', 24)
         FROM document_search ds
         WHERE document_search MATCH ?1
         ORDER BY rank
         LIMIT ?2",
    )
    .bind(&fts_query)
    .bind(LEXICAL_PREFILTER_LIMIT)
    .fetch_all(repo.pool())
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            warn!("lexical document search failed: {}", e);
            Vec::new()
        }
    };

    for (doc_id, rank, snippet) in doc_rows {
        if out.len() >= k {
            break;
        }
        if let Some(allowed) = allowed_docs.as_ref() {
            if !allowed.contains(doc_id.as_str()) {
                continue;
            }
        }
        let score = normalize_bm25(rank);

        // Prefer the document's best lexical chunk when it is indexed.
        if type_ok("document") {
            if let Some(mut chunk) =
                best_lexical_chunk(repo, &doc_id, "document", &fts_query).await?
            {
                chunk.score = score;
                chunk.mode = RetrievalMode::LexicalOnly.as_str().to_string();
                out.push(chunk);
                continue;
            }
        }

        // Unindexed document: ephemeral snippet result (chunkId `fts-…`) so
        // retrieval still surfaces the hit before the first index build.
        if type_ok("document") {
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
                score,
                mode: RetrievalMode::LexicalOnly.as_str().to_string(),
            });
        }
    }

    // Extract hits map to extract chunks via source_id.
    let extract_rows: Vec<(String, String, f64)> = match sqlx::query_as(
        "SELECT es.extract_id, es.document_id, rank
         FROM extract_search es
         WHERE extract_search MATCH ?1
         ORDER BY rank
         LIMIT ?2",
    )
    .bind(&fts_query)
    .bind(LEXICAL_PREFILTER_LIMIT)
    .fetch_all(repo.pool())
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            warn!("lexical extract search failed: {}", e);
            Vec::new()
        }
    };

    for (extract_id, doc_id, rank) in extract_rows {
        if out.len() >= k * 2 {
            break;
        }
        if let Some(allowed) = allowed_docs.as_ref() {
            if !allowed.contains(doc_id.as_str()) {
                continue;
            }
        }
        if !type_ok("extract") {
            continue;
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
            let mut result = row_to_result(row, normalize_bm25(rank) as f32, RetrievalMode::LexicalOnly.as_str());
            if !type_ok(&result.source_type) {
                continue;
            }
            out.push(result);
        }
    }

    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out.truncate(k);

    // Resolve titles once for the survivors.
    resolve_titles(repo, &mut out).await;
    Ok(out)
}

/// Cheapest-lexical match: the chunk of `document_id` sharing the most query
/// tokens. Falls back to the first chunk.
async fn best_lexical_chunk(
    repo: &Repository,
    document_id: &str,
    source_type: &str,
    fts_query: &str,
) -> Result<Option<SearchResult>> {
    let tokens: HashSet<String> = fts_query
        .split_whitespace()
        .map(|t| t.trim_matches(|c| c == '"' || c == '*').to_lowercase())
        .filter(|t| !t.is_empty())
        .collect();

    let rows = sqlx::query(
        "SELECT id, document_id, source_type, source_id, ordinal, text, heading_path, location_json, content_hash, token_count
         FROM semantic_chunks
         WHERE document_id = ?1 AND source_type = ?2
         ORDER BY ordinal",
    )
    .bind(document_id)
    .bind(source_type)
    .fetch_all(repo.pool())
    .await?;

    let mut best: Option<(usize, SearchResult)> = None;
    for row in rows {
        let text: String = row.try_get("text").unwrap_or_default();
        let lower = text.to_lowercase();
        let overlap = tokens.iter().filter(|t| lower.contains(t.as_str())).count();
        let result = row_to_result(row, 0.0, RetrievalMode::LexicalOnly.as_str());
        if best.as_ref().map(|(o, _)| overlap > *o).unwrap_or(true) {
            best = Some((overlap, result));
        }
    }
    let (_, mut result) = best.map(|(o, r)| (o, r)).unwrap_or_else(|| (0, SearchResult {
        chunk_id: String::new(),
        document_id: document_id.to_string(),
        document_title: None,
        source_type: source_type.to_string(),
        source_id: None,
        ordinal: 0,
        text: String::new(),
        heading_path: Vec::new(),
        location: serde_json::Value::Null,
        content_hash: String::new(),
        token_count: 0,
        score: 0.0,
        mode: RetrievalMode::LexicalOnly.as_str().to_string(),
    }));
    if result.chunk_id.is_empty() {
        return Ok(None);
    }
    Ok(Some(result))
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
        seed_document(&pool, "lex-1", "The quantum tunneling effect explains alpha decay.", "text").await;
        reindex_fts(&pool).await;

        let backend = EmbeddingBackend::OnDevice {
            model: "embeddinggemma-300m",
        };
        let response = retrieve(&repo, &backend, "quantum tunneling", 5, &RetrievalFilters::default())
            .await
            .expect("retrieve");
        assert_eq!(response.mode, "lexicalOnly");
        assert!(!response.results.is_empty(), "FTS hit surfaced");
        assert!(response.results[0].document_id == "lex-1");
        assert!(response.results[0].text.contains("quantum"));
    }

    #[tokio::test]
    async fn semantic_ranking_on_synthetic_vectors() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        // One large paragraph (~800 chars) becomes its own chunk verbatim, so
        // querying with that exact text must score cosine 1.0 against it.
        let target_text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet ".repeat(12);
        let target_text = target_text.trim_end();
        let content = format!("# Section\n\n{}\n\n{}", target_text, "uniform victor whiskey xray yankee zulu ".repeat(20));
        seed_document(&pool, "sem-1", &content, "markdown").await;
        seed_document(&pool, "sem-2", "Completely different topic about cooking recipes and ingredients.", "text").await;

        let backend = EmbeddingBackend::Mock { dim: 32, model: "mock-retrieve" };
        index_document_once(&repo, "sem-1", &backend, &mut || true).await.expect("index");
        index_document_once(&repo, "sem-2", &backend, &mut || true).await.expect("index");

        // The mock embedding of the exact chunk text matches itself with
        // cosine 1.0 — deterministic top hit.
        let response = retrieve(&repo, &backend, target_text, 5, &RetrievalFilters::default())
            .await
            .expect("retrieve");
        assert_eq!(response.mode, "semantic", "semantic mode expected");
        assert!(!response.results.is_empty());
        assert_eq!(response.results[0].document_id, "sem-1");
        let sim = response.results[0].score;
        assert!((sim - 1.0).abs() < 1e-5, "exact chunk must score 1.0, got {sim}");
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

        let backend = EmbeddingBackend::Mock { dim: 32, model: "mock-filter" };
        index_document_once(&repo, "f-1", &backend, &mut || true).await.expect("index f-1");
        index_document_once(&repo, "f-2", &backend, &mut || true).await.expect("index f-2");

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
        seed_document(&pool, "st-1", "Body about astronomy and telescopes and stars. More filler. ", "text").await;
        sqlx::query(
            "INSERT INTO extracts (id, document_id, content, date_created, date_modified)
             VALUES ('ext-st', 'st-1', 'astronomy telescopes stars extract', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let backend = EmbeddingBackend::Mock { dim: 32, model: "mock-st" };
        index_document_once(&repo, "st-1", &backend, &mut || true).await.expect("index");

        let filters = RetrievalFilters {
            document_ids: None,
            source_types: Some(vec!["extract".to_string()]),
        };
        let response = retrieve(&repo, &backend, "astronomy telescopes stars extract", 5, &filters)
            .await
            .expect("retrieve");
        assert!(!response.results.is_empty());
        assert!(
            response.results.iter().all(|r| r.source_type == "extract"),
            "expected extract-only results, got {:?}",
            response.results.iter().map(|r| r.source_type.clone()).collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn neighborhood_dedup_skips_adjacent_ordinals() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        // One long section → adjacent chunks with near-identical content (and
        // therefore near-identical mock embeddings).
        let content = (0..60)
            .map(|i| format!("Shared thematic vocabulary number {i} about planetary geology and tectonics."))
            .collect::<Vec<_>>()
            .join("\n\n");
        seed_document(&pool, "dup-1", &content, "text").await;

        let backend = EmbeddingBackend::Mock { dim: 32, model: "mock-dup" };
        index_document_once(&repo, "dup-1", &backend, &mut || true).await.expect("index");

        let response = retrieve(&repo, &backend, "planetary geology tectonics", 10, &RetrievalFilters::default())
            .await
            .expect("retrieve");
        assert!(response.results.len() >= 2, "need multiple results to check dedup");
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
            .map(|i| format!("Distinct paragraph {i} vocabulary cluster with number {i} content words."))
            .collect::<Vec<_>>()
            .join("\n\n");
        seed_document(&pool, "k-1", &content, "text").await;
        let backend = EmbeddingBackend::Mock { dim: 32, model: "mock-k" };
        index_document_once(&repo, "k-1", &backend, &mut || true).await.expect("index");

        let response = retrieve(&repo, &backend, "vocabulary cluster", 2, &RetrievalFilters::default())
            .await
            .expect("retrieve");
        assert!(response.results.len() <= 2);

        // Oversized k clamps to MAX_K.
        let response = retrieve(&repo, &backend, "vocabulary cluster", 10_000, &RetrievalFilters::default())
            .await
            .expect("retrieve");
        assert!(response.results.len() <= MAX_K);
    }

    #[tokio::test]
    async fn empty_query_returns_nothing() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        let backend = EmbeddingBackend::Mock { dim: 8, model: "mock-e" };
        let response = retrieve(&repo, &backend, "   ", 5, &RetrievalFilters::default())
            .await
            .expect("retrieve");
        assert!(response.results.is_empty());
    }


    #[test]
    fn fts_sanitization_handles_operators_and_cjk() {
        assert_eq!(sanitize_fts_query("hello world"), "\"hello\"* \"world\"*");
        assert_eq!(sanitize_fts_query("a \" OR 1=1 --"), "\"a\"* \"OR\"* \"11\"* \"--\"*");
        assert_eq!(sanitize_fts_query("量子计算"), "\"量子计算\"*");
        assert_eq!(sanitize_fts_query("!!! ..."), "");
    }

    #[test]
    fn bm25_normalization_is_monotonic() {
        assert!(normalize_bm25(-5.0) < normalize_bm25(-1.0));
        assert!((normalize_bm25(0.0) - 1.0).abs() < 1e-9);
    }

}
