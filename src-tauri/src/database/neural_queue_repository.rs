//! Storage for the Plethora neural queue.
//!
//! The neural-queue algorithm lives in [`crate::algorithms::neural_queue`]
//! (pure functions over a [`NeuralGraph`] abstraction). This module is the
//! database-backed half: it implements `NeuralGraph` against the `element_tree`
//! overlay and persists the built queue to the `neural_queue` table
//! (migration 080).
//!
//! The neural queue is an **opt-in** associative review mode. Normal learning
//! continues to use the priority queue; entering neural review builds a queue
//! by spreading activation from a seed element, and exiting returns to the
//! priority queue without mutating it.

use std::collections::{HashMap, HashSet};

use sqlx::{Pool, Sqlite};

use crate::algorithms::neural_queue::{
    run_spreading_activation, ElementId, ElementNode, NeuralEntry, NeuralGraph, QUEUE_REFILL_MIN,
};
use crate::commands::semantic_graph::EmbeddingConfigInput;
use crate::error::{PlethoraError, Result};
use crate::models::collection::DEFAULT_COLLECTION_ID;

/// A persisted row in the `neural_queue` table.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NeuralQueueRow {
    pub element_id: ElementId,
    pub position: i64,
    pub priority_value: f64,
    pub consumed: bool,
    pub updated_at: String,
}

/// A neural-queue front entry JOINed with its `element_tree` identity, so the
/// frontend can resolve each queued element back to the concrete document /
/// extract / learning item it renders. Returned by [`NeuralQueueRepository::resolved_front`].
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ResolvedNeuralQueueEntry {
    pub element_id: ElementId,
    pub position: i64,
    pub priority_value: f64,
    /// `"document"` | `"extract"` | `"learning_item"` — the element_tree kind,
    /// matching [`crate::database::ElementKind`]'s snake_case serialization.
    pub element_kind: String,
    /// The concrete item's uuid (documents.id / extracts.id / learning_items.id).
    pub element_ref_id: String,
}

/// Repository for the `neural_queue` table. Holds no state beyond the shared
/// connection pool.
#[derive(Clone)]
pub struct NeuralQueueRepository {
    pool: Pool<Sqlite>,
}

impl NeuralQueueRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Build the neural queue by spreading activation from `seed_element_id`,
    /// persisting the result into the `neural_queue` table (replacing any
    /// prior contents). Returns the built entries in presentation order.
    ///
    /// The priority queue is **not** mutated — only read for intrinsic priorities.
    pub async fn build(
        &self,
        seed_element_id: ElementId,
        embedding_config: Option<EmbeddingConfigInput>,
    ) -> Result<Vec<NeuralEntry>> {
        let graph = DbNeuralGraph::new(self.pool.clone(), embedding_config);
        let entries = run_spreading_activation(&graph, seed_element_id);

        // Persist: clear the table, then insert the fresh entries with 1-based
        // positions. `consumed = 0` for all (a fresh build).
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM neural_queue")
            .execute(&mut *tx)
            .await?;
        let now = chrono::Utc::now().to_rfc3339();
        for (i, entry) in entries.iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO neural_queue (element_id, position, priority_value, consumed, updated_at)
                VALUES (?1, ?2, ?3, 0, ?4)
                "#,
            )
            .bind(entry.element_id)
            .bind((i + 1) as i64)
            .bind(entry.priority_value)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(entries)
    }

    /// Return up to `n` unconsumed entries from the front of the neural queue,
    /// in presentation order (lowest priority value first).
    pub async fn front(&self, n: usize) -> Result<Vec<NeuralQueueRow>> {
        let rows = sqlx::query(
            r#"
            SELECT element_id, position, priority_value, consumed, updated_at
            FROM neural_queue
            WHERE consumed = 0
            ORDER BY position ASC
            LIMIT ?1
            "#,
        )
        .bind(n as i64)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_neural_queue_row).collect()
    }

    /// Like [`front`](Self::front), but JOINs each entry with its `element_tree`
    /// row so the caller learns the concrete `(element_kind, element_ref_id)`
    /// needed to render it. Used by the "Go neural" review UI, which has to turn
    /// each neural-queue position back into a document / extract / learning item.
    /// Single JOIN — no N+1.
    pub async fn resolved_front(&self, n: usize) -> Result<Vec<ResolvedNeuralQueueEntry>> {
        let rows = sqlx::query(
            r#"
            SELECT nq.element_id, nq.position, nq.priority_value,
                   et.element_kind, et.element_ref_id
            FROM neural_queue nq
            JOIN element_tree et ON et.id = nq.element_id
            WHERE nq.consumed = 0
            ORDER BY nq.position ASC
            LIMIT ?1
            "#,
        )
        .bind(n as i64)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_resolved_entry).collect()
    }

    /// Mark `element_id` as studied (consumed). Returns true if a row was
    /// updated.
    pub async fn consume(&self, element_id: ElementId) -> Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE neural_queue SET consumed = 1, updated_at = ?1
            WHERE element_id = ?2
            "#,
        )
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(element_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// The count of unconsumed (remaining) entries — the depletion signal.
    pub async fn remaining(&self) -> Result<usize> {
        let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM neural_queue WHERE consumed = 0")
            .fetch_one(&self.pool)
            .await?;
        Ok(n as usize)
    }

    /// The total entry count (consumed + remaining).
    pub async fn size(&self) -> Result<usize> {
        let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM neural_queue")
            .fetch_one(&self.pool)
            .await?;
        Ok(n as usize)
    }

    /// Whether the neural queue needs a refill: remaining < the depletion
    /// threshold ([`QUEUE_REFILL_MIN`]).
    pub async fn needs_refill(&self) -> Result<bool> {
        Ok(self.remaining().await? < QUEUE_REFILL_MIN)
    }

    /// Refill from `seed` if the queue is depleted below the threshold.
    /// Returns Some(entries) if a refill ran, None if the threshold was met.
    pub async fn refill_if_depleted(
        &self,
        seed_element_id: ElementId,
        embedding_config: Option<EmbeddingConfigInput>,
    ) -> Result<Option<Vec<NeuralEntry>>> {
        if !self.needs_refill().await? {
            return Ok(None);
        }
        Ok(Some(self.build(seed_element_id, embedding_config).await?))
    }
}

/// Decode a row into a [`NeuralQueueRow`].
fn row_to_neural_queue_row(row: &sqlx::sqlite::SqliteRow) -> Result<NeuralQueueRow> {
    use sqlx::Row;
    Ok(NeuralQueueRow {
        element_id: row.try_get("element_id")?,
        position: row.try_get("position")?,
        priority_value: row.try_get("priority_value")?,
        consumed: row.try_get::<i64, _>("consumed").map(|v| v != 0)?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// Decode a JOINed row into a [`ResolvedNeuralQueueEntry`].
fn row_to_resolved_entry(row: &sqlx::sqlite::SqliteRow) -> Result<ResolvedNeuralQueueEntry> {
    use sqlx::Row;
    Ok(ResolvedNeuralQueueEntry {
        element_id: row.try_get("element_id")?,
        position: row.try_get("position")?,
        priority_value: row.try_get("priority_value")?,
        element_kind: row.try_get("element_kind")?,
        element_ref_id: row.try_get("element_ref_id")?,
    })
}

// ── Tag + embedding helpers for the concept/semantic neighbors ─────────────

/// Read the JSON-array `tags` column for a concrete item. Returns the parsed
/// tag strings (empty on any failure — a missing/ malformed column is treated
/// as "no tags").
async fn read_tags(pool: &Pool<Sqlite>, kind: &str, ref_id: &str) -> Result<Vec<String>> {
    let (table, id_col) = match kind {
        "document" => ("documents", "id"),
        "extract" => ("extracts", "id"),
        "learning_item" => ("learning_items", "id"),
        _ => return Ok(Vec::new()),
    };
    let sql = format!("SELECT tags FROM {table} WHERE {id_col} = ?1");
    let row: Option<(Option<String>,)> = sqlx::query_as(&sql)
        .bind(ref_id)
        .fetch_optional(pool)
        .await?;
    let tags_json = row.and_then(|(t,)| t).unwrap_or_else(|| "[]".to_string());
    let parsed: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(parsed
        .into_iter()
        .filter(|t| !t.trim().is_empty())
        .collect())
}

/// Find `(element_kind, element_ref_id)` pairs for items carrying any of
/// `tags` across the three concrete tables, using `json_each` over the JSON
/// `tags` columns. Matching is case-insensitive. `tags_json` is a JSON array
/// of lowercased tag strings to match against.
async fn find_items_with_tags(pool: &Pool<Sqlite>, tags: &[String]) -> Vec<(String, String)> {
    let lower: Vec<String> = tags.iter().map(|t| t.to_lowercase()).collect();
    let tags_json = serde_json::to_string(&lower).unwrap_or_else(|_| "[]".to_string());
    let mut out = Vec::new();

    for (kind, table) in [
        ("document", "documents"),
        ("extract", "extracts"),
        ("learning_item", "learning_items"),
    ] {
        let sql = format!(
            "SELECT DISTINCT t.id FROM {table} t, json_each(t.tags) je \
             WHERE LOWER(je.value) IN (SELECT value FROM json_each(?1))"
        );
        if let Ok(rows) = sqlx::query_as::<_, (String,)>(sql.as_str())
            .bind(&tags_json)
            .fetch_all(pool)
            .await
        {
            for (id,) in rows {
                out.push((kind.to_string(), id));
            }
        }
    }
    out
}

/// Mean-pool a set of embedding slices into a single vector. Each input slice
/// is one chunk's embedding; the result is the per-dimension average. The
/// dimension is inferred from the first non-empty slice.
fn mean_pool(chunks: &[&[f32]]) -> Vec<f32> {
    if chunks.is_empty() {
        return Vec::new();
    }
    let dim = chunks[0].len();
    if dim == 0 {
        return Vec::new();
    }
    let mut acc = vec![0.0f32; dim];
    let mut count = 0usize;
    for chunk in chunks {
        if chunk.len() != dim {
            continue; // skip malformed strides
        }
        for (a, v) in acc.iter_mut().zip(chunk.iter()) {
            *a += *v;
        }
        count += 1;
    }
    if count == 0 {
        return Vec::new();
    }
    for v in acc.iter_mut() {
        *v /= count as f32;
    }
    acc
}

// ── DbNeuralGraph: NeuralGraph backed by element_tree + the priority queue ─

/// A [`NeuralGraph`] implementation that reads the `element_tree` overlay and
/// derives intrinsic priorities from the priority queue (the user-set
/// `priority_slider` on documents / learning_items, normalized to [0,1]).
///
/// When `embedding_config` is set, `semantic_neighbors` resolves the most
/// cosine-similar documents via the RAG chunk embeddings. When it is `None`
/// (the collection is unindexed, or the user has no embedding provider
/// configured), semantic propagation is a graceful no-op — the other four
/// relationship types still drive the queue.
struct DbNeuralGraph {
    pool: Pool<Sqlite>,
    embedding_config: Option<EmbeddingConfigInput>,
}

impl DbNeuralGraph {
    fn new(pool: Pool<Sqlite>, embedding_config: Option<EmbeddingConfigInput>) -> Self {
        Self {
            pool,
            embedding_config,
        }
    }
}

impl NeuralGraph for DbNeuralGraph {
    fn node(&self, id: ElementId) -> Option<ElementNode> {
        block_on(async move {
            let row = sqlx::query_as::<
                _,
                (
                    i64,
                    i32,
                    Option<i64>,
                    Option<i64>,
                    Option<i64>,
                    Option<i64>,
                    Option<i64>,
                    Option<i64>,
                ),
            >(
                r#"SELECT id, element_type, parent_id, first_child_id,
                   next_sibling_id, prev_sibling_id, concept_link_id,
                   inter_element_link_id
                   FROM element_tree WHERE id = ?1"#,
            )
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .ok()??;
            Some(ElementNode {
                id: row.0,
                element_type: row.1,
                parent_id: row.2,
                first_child_id: row.3,
                next_sibling_id: row.4,
                prev_sibling_id: row.5,
                concept_link_id: row.6,
                inter_element_link_id: row.7,
            })
        })
    }

    fn children(&self, id: ElementId) -> Vec<ElementNode> {
        block_on(async move {
            // Walk first_child → next_sibling.
            let first: Option<(Option<i64>,)> =
                sqlx::query_as("SELECT first_child_id FROM element_tree WHERE id = ?1")
                    .bind(id)
                    .fetch_optional(&self.pool)
                    .await
                    .ok()?;
            let first = first.and_then(|(f,)| f);
            let mut out = Vec::new();
            let mut cursor = first;
            while let Some(cid) = cursor {
                let node = match fetch_node(&self.pool, cid).await {
                    Some(n) => n,
                    None => break,
                };
                cursor = node.next_sibling_id;
                out.push(node);
            }
            Some(out)
        })
        .unwrap_or_default()
    }

    fn descendants(&self, id: ElementId) -> Vec<ElementNode> {
        let mut out = Vec::new();
        let mut stack = vec![id];
        let mut seen = std::collections::HashSet::new();
        while let Some(cur) = stack.pop() {
            if !seen.insert(cur) {
                continue;
            }
            for child in self.children(cur) {
                out.push(child.clone());
                stack.push(child.id);
            }
        }
        out
    }

    fn concept_neighbors(&self, id: ElementId) -> Vec<(ElementId, bool)> {
        // Tag-based concept-group proxy: items sharing a tag with the seed are
        // concept peers. The seed's tags are read from its concrete table; then
        // every other document/extract/learning_item carrying any of those tags
        // (via json_each) becomes a child-concept neighbor (weight 0.3 — tags
        // are flat peer groups, so the parent direction is unused). Capped to
        // bound the activation spread.
        const CONCEPT_CAP: usize = 15;

        block_on(async move {
            use crate::database::{ElementKind, ElementTreeRepository};

            // Resolve the seed's concrete identity.
            let row: Option<(String, String)> = sqlx::query_as(
                "SELECT element_kind, element_ref_id FROM element_tree WHERE id = ?1",
            )
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .ok()?;
            let (kind, ref_id) = row?;

            // Gather tags for the seed from its concrete table.
            let tags = read_tags(&self.pool, &kind, &ref_id).await.ok()?;
            if tags.is_empty() {
                return Some(Vec::new());
            }

            // Find other items sharing any of those tags across all three
            // tables, deduped by (kind, ref_id). Each is resolved to its
            // element_tree id.
            let et = ElementTreeRepository::new(self.pool.clone());
            let mut seen: HashSet<(String, String)> = std::iter::once((kind, ref_id)).collect();
            let mut out: Vec<(ElementId, bool)> = Vec::new();

            for (peer_kind, peer_ref) in find_items_with_tags(&self.pool, &tags).await {
                if !seen.insert((peer_kind.clone(), peer_ref.clone())) {
                    continue;
                }
                let peer_element_kind = match peer_kind.as_str() {
                    "document" => ElementKind::Document,
                    "extract" => ElementKind::Extract,
                    _ => ElementKind::LearningItem,
                };
                if let Ok(Some(peer_id)) = et.find_node_id(peer_element_kind, &peer_ref).await {
                    out.push((peer_id, false)); // peer → child-concept weight
                    if out.len() >= CONCEPT_CAP {
                        break;
                    }
                }
            }
            Some(out)
        })
        .unwrap_or_default()
    }

    fn semantic_neighbors(&self, id: ElementId) -> Vec<(ElementId, f64)> {
        // Embedding-similarity neighbors via RAG chunk embeddings: mean-pool the
        // seed document's chunks, then score every other indexed document's
        // pooled vector by cosine similarity, returning the top matches above a
        // threshold. A no-op (empty) when no embedding config is set or the
        // collection is unindexed.
        use crate::ai::embedding_config::{cosine_similarity, model_name, provider_name};
        use crate::database::{ElementKind, ElementTreeRepository, Repository};

        const SEMANTIC_TOP_N: usize = 8;
        const SEMANTIC_THRESHOLD: f64 = 0.30;

        let config = match &self.embedding_config {
            Some(c) => c.clone(),
            None => return Vec::new(),
        };
        let provider_str = provider_name(&config);
        let model_str = model_name(&config);

        block_on(async move {
            let repo = Repository::new(self.pool.clone());
            let et = ElementTreeRepository::new(self.pool.clone());

            // Resolve the seed → its owning document id (extracts/cards inherit
            // their parent document's similarity; only documents are indexed).
            let seed_row: Option<(String, String)> = sqlx::query_as(
                "SELECT element_kind, element_ref_id FROM element_tree WHERE id = ?1",
            )
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .ok()?;
            let (seed_kind, seed_ref) = seed_row?;
            let seed_doc_id = match seed_kind.as_str() {
                "document" => seed_ref.clone(),
                "extract" => sqlx::query_as::<_, (Option<String>,)>(
                    "SELECT document_id FROM extracts WHERE id = ?1",
                )
                .bind(&seed_ref)
                .fetch_optional(&self.pool)
                .await
                .ok()?
                .and_then(|(d,)| d)?,
                _ => {
                    // learning_item — resolve via extract_id, then document.
                    let (extract_id, document_id): (Option<String>, Option<String>) =
                        sqlx::query_as::<_, (Option<String>, Option<String>)>(
                            "SELECT extract_id, document_id FROM learning_items WHERE id = ?1",
                        )
                        .bind(&seed_ref)
                        .fetch_one(&self.pool)
                        .await
                        .ok()?;
                    if let Some(doc) = document_id {
                        doc
                    } else if let Some(ext) = extract_id {
                        sqlx::query_as::<_, (Option<String>,)>(
                            "SELECT document_id FROM extracts WHERE id = ?1",
                        )
                        .bind(&ext)
                        .fetch_optional(&self.pool)
                        .await
                        .ok()?
                        .and_then(|(d,)| d)?
                    } else {
                        return Some(Vec::new());
                    }
                }
            };

            // Mean-pool the seed document's chunks into one vector.
            let seed_chunks = repo
                .get_chunk_embeddings(Some(&[seed_doc_id.clone()]), &provider_str, &model_str)
                .await
                .ok()?;
            if seed_chunks.is_empty() {
                return Some(Vec::new());
            }
            let seed_vec = mean_pool(
                &seed_chunks
                    .iter()
                    .map(|c| c.embedding.as_slice())
                    .collect::<Vec<_>>(),
            );

            // Score every other indexed document's pooled vector.
            let all_chunks = repo
                .get_chunk_embeddings(None, &provider_str, &model_str)
                .await
                .ok()?;

            // Group chunks per-document, then mean-pool each document's chunks
            // into a single representative vector.
            let mut grouped: HashMap<String, Vec<Vec<f32>>> = HashMap::new();
            for chunk in &all_chunks {
                grouped
                    .entry(chunk.document_id.clone())
                    .or_default()
                    .push(chunk.embedding.clone());
            }
            let doc_vecs: HashMap<String, Vec<f32>> = grouped
                .iter()
                .map(|(doc_id, chunks)| {
                    let refs: Vec<&[f32]> = chunks.iter().map(|c| c.as_slice()).collect();
                    (doc_id.clone(), mean_pool(&refs))
                })
                .collect();

            let mut scored: Vec<(String, f64)> = doc_vecs
                .iter()
                .filter(|(doc_id, _)| *doc_id != &seed_doc_id)
                .map(|(doc_id, vec)| (doc_id.clone(), cosine_similarity(&seed_vec, vec) as f64))
                .filter(|(_, sim)| *sim >= SEMANTIC_THRESHOLD)
                .collect();
            scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            scored.truncate(SEMANTIC_TOP_N);

            let mut out: Vec<(ElementId, f64)> = Vec::new();
            for (doc_id, sim) in scored {
                if let Ok(Some(eid)) = et.find_node_id(ElementKind::Document, &doc_id).await {
                    out.push((eid, sim));
                }
            }
            Some(out)
        })
        .unwrap_or_default()
    }

    fn inter_element_neighbors(&self, id: ElementId) -> Vec<ElementId> {
        block_on(async move {
            // Follow the inter_element_link_id pointer, if set.
            let row: Option<(Option<i64>,)> =
                sqlx::query_as("SELECT inter_element_link_id FROM element_tree WHERE id = ?1")
                    .bind(id)
                    .fetch_optional(&self.pool)
                    .await
                    .ok()?;
            Some(
                row.and_then(|(link,)| link)
                    .map(|l| vec![l])
                    .unwrap_or_default(),
            )
        })
        .unwrap_or_default()
    }

    fn intrinsic_priority(&self, id: ElementId) -> f64 {
        let slider: Option<i64> = block_on(async move {
            // Resolve the concrete item via (element_kind, element_ref_id),
            // then read its priority_slider.
            let row: Option<(String, String)> = sqlx::query_as(
                "SELECT element_kind, element_ref_id FROM element_tree WHERE id = ?1",
            )
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .ok()?;
            let (kind, ref_id) = row?;
            let slider: Option<i64> = match kind.as_str() {
                "document" => sqlx::query_as("SELECT priority_slider FROM documents WHERE id = ?1")
                    .bind(&ref_id)
                    .fetch_optional(&self.pool)
                    .await
                    .ok()?
                    .map(|(v,)| v),
                "learning_item" => {
                    sqlx::query_as("SELECT priority_slider FROM learning_items WHERE id = ?1")
                        .bind(&ref_id)
                        .fetch_optional(&self.pool)
                        .await
                        .ok()?
                        .map(|(v,)| v)
                }
                "extract" => sqlx::query_as("SELECT priority_score FROM extracts WHERE id = ?1")
                    .bind(&ref_id)
                    .fetch_optional(&self.pool)
                    .await
                    .ok()?
                    .map(|(v,): (f64,)| (v.clamp(0.0, 100.0) as i64)),
                _ => None,
            };
            Some(slider.unwrap_or(100))
        });
        // Normalize a 0-100 slider to [0,1]; default to max urgency.
        slider
            .map(|s| s.clamp(0, 100) as f64 / 100.0)
            .unwrap_or(1.0)
    }
}

/// Async helper: fetch a single node by id.
async fn fetch_node(pool: &Pool<Sqlite>, id: ElementId) -> Option<ElementNode> {
    let row = sqlx::query_as::<
        _,
        (
            i64,
            i32,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
        ),
    >(
        r#"SELECT id, element_type, parent_id, first_child_id,
           next_sibling_id, prev_sibling_id, concept_link_id,
           inter_element_link_id
           FROM element_tree WHERE id = ?1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .ok()??;
    Some(ElementNode {
        id: row.0,
        element_type: row.1,
        parent_id: row.2,
        first_child_id: row.3,
        next_sibling_id: row.4,
        prev_sibling_id: row.5,
        concept_link_id: row.6,
        inter_element_link_id: row.7,
    })
}

/// Bridge the sync `NeuralGraph` trait to the async sqlx pool. The trait is
/// sync (pure, testable); the repository methods that invoke the algorithm are
/// async and run on tokio's multi-threaded runtime, so `block_in_place` lets
/// us synchronously await the async query without deadlocking. If no runtime
/// is running, the algorithm cannot reach the database and the call returns
/// the closure's default (None/empty).
fn block_on<T, Fut>(fut: Fut) -> T
where
    T: Default,
    Fut: std::future::Future<Output = T>,
{
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(fut)),
        Err(_) => T::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use std::path::PathBuf;

    async fn setup() -> NeuralQueueRepository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        NeuralQueueRepository::new(db.pool().clone())
    }

    async fn seed_tree(repo: &NeuralQueueRepository) -> ElementId {
        // Build a small tree: document 1 (root) with two extract children.
        use crate::database::ElementTreeRepository;
        let et = ElementTreeRepository::new(repo.pool().clone());
        let doc = et
            .register_node(
                crate::database::ElementKind::Document,
                "neural-doc",
                crate::database::ELEMENT_TYPE_TOPIC,
                None,
                &chrono::Utc::now().to_rfc3339(),
            )
            .await
            .unwrap();
        for i in 1..=2 {
            et.register_node(
                crate::database::ElementKind::Extract,
                &format!("neural-ext-{i}"),
                crate::database::ELEMENT_TYPE_TOPIC,
                Some(doc),
                &chrono::Utc::now().to_rfc3339(),
            )
            .await
            .unwrap();
        }
        doc
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn build_from_seed_populates_the_queue() {
        let repo = setup().await;
        let seed = seed_tree(&repo).await;

        let entries = repo.build(seed, None).await.expect("build");
        // The seed plus its two children land in the queue.
        assert!(entries.len() >= 3, "queue should contain seed + children");
        assert_eq!(repo.size().await.unwrap(), entries.len());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn front_returns_unconsumed_in_order() {
        let repo = setup().await;
        let seed = seed_tree(&repo).await;
        repo.build(seed, None).await.unwrap();

        let front = repo.front(10).await.unwrap();
        assert!(!front.is_empty());
        // Positions are ascending.
        let mut prev = 0;
        for row in &front {
            assert!(row.position > prev, "positions ascending");
            assert!(!row.consumed);
            prev = row.position;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn resolved_front_joins_element_tree_identity() {
        let repo = setup().await;
        let seed = seed_tree(&repo).await;
        repo.build(seed, None).await.unwrap();

        let resolved = repo.resolved_front(usize::MAX).await.unwrap();
        assert!(!resolved.is_empty());

        // Every entry must carry a concrete (kind, ref_id) the UI can render.
        for entry in &resolved {
            assert!(
                matches!(
                    entry.element_kind.as_str(),
                    "document" | "extract" | "learning_item"
                ),
                "unexpected kind: {}",
                entry.element_kind
            );
            assert!(
                !entry.element_ref_id.is_empty(),
                "ref_id must be present for {}",
                entry.element_kind
            );
            // The seeded ids are `neural-doc`, `neural-ext-1`, `neural-ext-2`.
            assert!(
                entry.element_ref_id.starts_with("neural-"),
                "ref_id {} should be one of the seeded ids",
                entry.element_ref_id
            );
        }

        // Positions are ascending (presentation order), matching front().
        let mut prev = 0;
        for entry in &resolved {
            assert!(entry.position > prev, "positions ascending");
            prev = entry.position;
        }
        assert_eq!(
            resolved.len(),
            repo.front(usize::MAX).await.unwrap().len(),
            "resolved_front and front should return the same rows"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn consume_marks_studied_and_lowers_remaining() {
        let repo = setup().await;
        let seed = seed_tree(&repo).await;
        let entries = repo.build(seed, None).await.unwrap();
        let before = repo.remaining().await.unwrap();

        let first = entries[0].element_id;
        assert!(repo.consume(first).await.unwrap());
        assert_eq!(repo.remaining().await.unwrap(), before - 1);

        // front() no longer returns the consumed element.
        let front = repo.front(usize::MAX).await.unwrap();
        assert!(!front.iter().any(|r| r.element_id == first));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn needs_refill_when_below_threshold() {
        let repo = setup().await;
        // Empty queue → below threshold → needs refill.
        assert!(repo.needs_refill().await.unwrap());

        // Seed a large-enough tree so the build exceeds QUEUE_REFILL_MIN.
        use crate::database::ElementTreeRepository;
        let et = ElementTreeRepository::new(repo.pool().clone());
        let doc = et
            .register_node(
                crate::database::ElementKind::Document,
                "big-doc",
                crate::database::ELEMENT_TYPE_TOPIC,
                None,
                &chrono::Utc::now().to_rfc3339(),
            )
            .await
            .unwrap();
        for i in 0..30 {
            et.register_node(
                crate::database::ElementKind::LearningItem,
                &format!("big-card-{i}"),
                crate::database::ELEMENT_TYPE_ITEM,
                Some(doc),
                &chrono::Utc::now().to_rfc3339(),
            )
            .await
            .unwrap();
        }
        repo.build(doc, None).await.unwrap();
        assert!(!repo.needs_refill().await.unwrap(), "queue above threshold");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn build_does_not_mutate_priority_slider() {
        // The priority queue must be untouched by a neural build. Set a
        // document's priority, build, and confirm it is unchanged.
        let repo = setup().await;
        let pool = repo.pool();
        // Insert a document with a known priority_slider directly.
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            r#"INSERT INTO documents (id, collection_id, title, file_path, file_type, tags, date_added, date_modified, extract_count, learning_item_count, priority_rating, priority_slider, priority_score, is_archived, is_favorite, is_dismissed)
               VALUES ('pdoc', ?1, 't', '/p.pdf', 'pdf', '[]', ?2, ?2, 0, 0, 0, 77, 77.0, 0, 0, 0)"#,
        )
        .bind(DEFAULT_COLLECTION_ID)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();

        // Register it in element_tree and build from it.
        use crate::database::ElementTreeRepository;
        let et = ElementTreeRepository::new(pool.clone());
        let node = et
            .register_node(
                crate::database::ElementKind::Document,
                "pdoc",
                crate::database::ELEMENT_TYPE_TOPIC,
                None,
                &now,
            )
            .await
            .unwrap();
        repo.build(node, None).await.expect("build");

        let (slider,): (i64,) =
            sqlx::query_as("SELECT priority_slider FROM documents WHERE id = 'pdoc'")
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(slider, 77, "priority queue not mutated by neural build");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn refill_if_depleted_only_runs_below_threshold() {
        let repo = setup().await;
        // Empty → depleted → refill runs and builds.
        let seed = seed_tree(&repo).await;
        let ran = repo.refill_if_depleted(seed, None).await.unwrap();
        assert!(ran.is_some(), "refill ran when depleted");

        // Now the queue has ~3 entries (< 20 threshold still), so it will run
        // again. This confirms the depletion check, not idempotency.
        let ran_again = repo.refill_if_depleted(seed, None).await.unwrap();
        assert!(ran_again.is_some(), "still below threshold → refill again");
    }

    /// Helper: insert a document row with given tags, registered in element_tree.
    async fn seed_tagged_document(
        repo: &NeuralQueueRepository,
        id: &str,
        tags_json: &str,
    ) -> ElementId {
        use crate::database::ElementTreeRepository;
        let pool = repo.pool();
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            r#"INSERT INTO documents (id, collection_id, title, file_path, file_type, tags, date_added, date_modified, extract_count, learning_item_count, priority_rating, priority_slider, priority_score, is_archived, is_favorite, is_dismissed)
               VALUES (?1, ?2, ?3, ?4, 'pdf', ?5, ?6, ?6, 0, 0, 0, 50, 50.0, 0, 0, 0)"#,
        )
        .bind(id)
        .bind(DEFAULT_COLLECTION_ID)
        .bind(format!("Doc {id}"))
        .bind(format!("/{id}.pdf"))
        .bind(tags_json)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();

        let et = ElementTreeRepository::new(pool.clone());
        et.register_node(
            crate::database::ElementKind::Document,
            id,
            crate::database::ELEMENT_TYPE_TOPIC,
            None,
            &now,
        )
        .await
        .unwrap()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn concept_neighbors_via_tags_surfaces_tag_mates_in_neural_queue() {
        // Two documents share the tag "biology"; a third has an unrelated tag.
        // Building the neural queue from one biology doc should surface the
        // other biology doc (a concept peer), but not the unrelated doc.
        let repo = setup().await;
        let a = seed_tagged_document(&repo, "bio-a", r#"["biology"]"#).await;
        let _b = seed_tagged_document(&repo, "bio-b", r#"["biology"]"#).await;
        let _c = seed_tagged_document(&repo, "chem-a", r#"["chemistry"]"#).await;

        let entries = repo.build(a, None).await.expect("build");
        let ref_ids: Vec<String> = entries.iter().map(|e| e.element_id.to_string()).collect();

        // The queue contains the seed (bio-a) and the tag-mate (bio-b), but not
        // chem-a. Resolve element ids back to ref ids to check.
        let pool = repo.pool();
        let mut queued_ref_ids: Vec<String> = Vec::new();
        for entry in &entries {
            let row: Option<(String,)> =
                sqlx::query_as("SELECT element_ref_id FROM element_tree WHERE id = ?1")
                    .bind(entry.element_id)
                    .fetch_optional(pool)
                    .await
                    .unwrap();
            if let Some((r,)) = row {
                queued_ref_ids.push(r);
            }
        }
        assert!(
            queued_ref_ids.contains(&"bio-a".to_string()),
            "seed present"
        );
        assert!(
            queued_ref_ids.contains(&"bio-b".to_string()),
            "tag-mate bio-b reached via concept propagation"
        );
        assert!(
            !queued_ref_ids.contains(&"chem-a".to_string()),
            "unrelated chem-a should not be in the queue"
        );
        let _ = ref_ids; // keep the allocation
    }
}
