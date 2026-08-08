//! Storage for the SuperMemo neural queue (supermemo-faithful-queue Phase 4).
//!
//! The neural-queue algorithm lives in [`crate::algorithms::neural_queue`]
//! (pure functions over a [`NeuralGraph`] abstraction). This module is the
//! database-backed half: it implements `NeuralGraph` against the `element_tree`
//! overlay (Phase 2) and persists the built queue to the `neural_queue` table
//! (migration 080).
//!
//! The neural queue is an **opt-in** review mode (SuperMemo's *Learn : Go
//! neural*). Normal learning continues to use the priority queue; entering
//! neural review builds a queue by spreading activation from a seed element,
//! and exiting returns to the priority queue without mutating it.

use sqlx::{Pool, Sqlite};

use crate::algorithms::neural_queue::{
    run_spreading_activation, NeuralEntry, NeuralGraph, ElementId, ElementNode, QUEUE_REFILL_MIN,
};
use crate::error::{IncrementumError, Result};
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
    /// This is SuperMemo's *Learn : Go neural* entry action. The priority
    /// queue is **not** mutated — only read for intrinsic priorities.
    pub async fn build(&self, seed_element_id: ElementId) -> Result<Vec<NeuralEntry>> {
        let graph = DbNeuralGraph::new(self.pool.clone());
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
        let (n,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM neural_queue WHERE consumed = 0")
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
    ) -> Result<Option<Vec<NeuralEntry>>> {
        if !self.needs_refill().await? {
            return Ok(None);
        }
        Ok(Some(self.build(seed_element_id).await?))
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

// ── DbNeuralGraph: NeuralGraph backed by element_tree + the priority queue ─

/// A [`NeuralGraph`] implementation that reads the `element_tree` overlay and
/// derives intrinsic priorities from the priority queue (the user-set
/// `priority_slider` on documents / learning_items, normalized to [0,1]).
struct DbNeuralGraph {
    pool: Pool<Sqlite>,
}

impl DbNeuralGraph {
    fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }
}

impl NeuralGraph for DbNeuralGraph {
    fn node(&self, id: ElementId) -> Option<ElementNode> {
        block_on(async move {
            let row = sqlx::query_as::<_, (
                i64, i32, Option<i64>, Option<i64>, Option<i64>, Option<i64>, Option<i64>, Option<i64>,
            )>(
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
        // The concept registry is not yet populated (no v1 UI to create
        // concept groups, per design.md). The column exists; this returns
        // empty until concept groups are authored.
        let _ = id;
        Vec::new()
    }

    fn inter_element_neighbors(&self, id: ElementId) -> Vec<ElementId> {
        block_on(async move {
            // Follow the inter_element_link_id pointer, if set.
            let row: Option<(Option<i64>,)> = sqlx::query_as(
                "SELECT inter_element_link_id FROM element_tree WHERE id = ?1",
            )
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .ok()?;
            Some(row.and_then(|(link,)| link).map(|l| vec![l]).unwrap_or_default())
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
        slider.map(|s| s.clamp(0, 100) as f64 / 100.0).unwrap_or(1.0)
    }
}

/// Async helper: fetch a single node by id.
async fn fetch_node(pool: &Pool<Sqlite>, id: ElementId) -> Option<ElementNode> {
    let row = sqlx::query_as::<_, (
        i64, i32, Option<i64>, Option<i64>, Option<i64>, Option<i64>, Option<i64>, Option<i64>,
    )>(
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

        let entries = repo.build(seed).await.expect("build");
        // The seed plus its two children land in the queue.
        assert!(entries.len() >= 3, "queue should contain seed + children");
        assert_eq!(repo.size().await.unwrap(), entries.len());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn front_returns_unconsumed_in_order() {
        let repo = setup().await;
        let seed = seed_tree(&repo).await;
        repo.build(seed).await.unwrap();

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
    async fn consume_marks_studied_and_lowers_remaining() {
        let repo = setup().await;
        let seed = seed_tree(&repo).await;
        let entries = repo.build(seed).await.unwrap();
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
        repo.build(doc).await.unwrap();
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
        repo.build(node).await.expect("build");

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
        let ran = repo.refill_if_depleted(seed).await.unwrap();
        assert!(ran.is_some(), "refill ran when depleted");

        // Now the queue has ~3 entries (< 20 threshold still), so it will run
        // again. This confirms the depletion check, not idempotency.
        let ran_again = repo.refill_if_depleted(seed).await.unwrap();
        assert!(ran_again.is_some(), "still below threshold → refill again");
    }
}
