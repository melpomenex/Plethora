//! SuperMemo knowledge-tree overlay repository.
//!
//! A thin `element_tree` table (migration 078) overlays the existing
//! `documents` / `extracts` / `learning_items` tables without modifying them.
//! Each row references one concrete item via `(element_kind, element_ref_id)`
//! and carries the tree topology columns the priority and neural queues
//! traverse: parent/child/sibling pointers, element type, concept and
//! inter-element links, and cached descendant counts.
//!
//! Documents are Topics (type 0) at the root; extracts are Topics under their
//! document; learning items are Items (type 1) under their extract (or
//! document). Children are appended as the last sibling, mirroring SuperMemo's
//! `AddNewElement` constructor.

use std::collections::HashSet;

use sqlx::{Pool, Sqlite, Transaction};

use crate::error::{PlethoraError, Result};

/// The three concrete item tables the overlay indexes.
///
/// Stored as a TEXT column (`'document' | 'extract' | 'learning_item'`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElementKind {
    Document,
    Extract,
    LearningItem,
}

impl ElementKind {
    /// The text form persisted in the `element_kind` column.
    pub fn as_str(self) -> &'static str {
        match self {
            ElementKind::Document => "document",
            ElementKind::Extract => "extract",
            ElementKind::LearningItem => "learning_item",
        }
    }

    /// Parse a stored `element_kind` text value.
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "document" => Ok(Self::Document),
            "extract" => Ok(Self::Extract),
            "learning_item" => Ok(Self::LearningItem),
            other => Err(PlethoraError::InvalidInput(format!(
                "unknown element_kind '{other}'"
            ))),
        }
    }
}

/// SuperMemo element-type byte stored in `element_type`.
///
/// 0 = Topic (documents, extracts), 1 = Item (learning items),
/// 4 = Concept (created explicitly; no v1 UI). 2/3 are reserved.
pub const ELEMENT_TYPE_TOPIC: i32 = 0;
pub const ELEMENT_TYPE_ITEM: i32 = 1;
pub const ELEMENT_TYPE_CONCEPT: i32 = 4;

/// Descendant-count thresholds the neural-queue traversal switches on.
pub const DESCENDANT_THRESHOLD_A: i64 = 300;
pub const DESCENDANT_THRESHOLD_B: i64 = 400;

/// A node in the element tree overlay.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ElementTreeNode {
    pub id: i64,
    pub element_kind: ElementKind,
    pub element_ref_id: String,
    pub parent_id: Option<i64>,
    pub first_child_id: Option<i64>,
    pub next_sibling_id: Option<i64>,
    pub prev_sibling_id: Option<i64>,
    pub element_type: i32,
    pub concept_link_id: Option<i64>,
    pub inter_element_link_id: Option<i64>,
    pub descendant_count_a: i64,
    pub descendant_count_b: i64,
    pub sort_order: i64,
    pub created_at: String,
}

/// A repository for the `element_tree` overlay table. Holds no state beyond
/// the shared connection pool; construct freely.
#[derive(Clone)]
pub struct ElementTreeRepository {
    pool: Pool<Sqlite>,
}

impl ElementTreeRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Resolve the `(element_kind, element_ref_id)` pair for a concrete item
    /// to its element_tree id, if one has been registered.
    pub async fn find_node_id(&self, kind: ElementKind, ref_id: &str) -> Result<Option<i64>> {
        find_node_id_pool(&self.pool, kind, ref_id).await
    }

    /// Resolve a node id to its full row.
    pub async fn get_node(&self, id: i64) -> Result<Option<ElementTreeNode>> {
        let row = sqlx::query("SELECT * FROM element_tree WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(|r| row_to_node(&r)).transpose()
    }

    /// Register a new element_tree node under `parent_id` (None = root),
    /// appending it as the **last** child of its parent — the same semantics
    /// as SuperMemo's `AddNewElement`. Performs the sibling-chain surgery:
    /// the prior last child's `next_sibling_id` is pointed at the new node,
    /// the new node's `prev_sibling_id` at the prior last child, and the
    /// parent's `first_child_id` is initialized if this is its first child.
    ///
    /// Returns the new node's id. Re-registering an existing
    /// `(element_kind, element_ref_id)` is idempotent: it returns the existing
    /// id without inserting a duplicate (the `UNIQUE` constraint backs this).
    pub async fn register_node(
        &self,
        kind: ElementKind,
        ref_id: &str,
        element_type: i32,
        parent_id: Option<i64>,
        created_at: &str,
    ) -> Result<i64> {
        // Idempotent: if a node already exists for this (kind, ref_id), return it.
        if let Some(existing) = self.find_node_id(kind, ref_id).await? {
            return Ok(existing);
        }

        let mut tx = self.pool.begin().await?;
        let id =
            register_node_in_tx(&mut tx, kind, ref_id, element_type, parent_id, created_at).await?;
        tx.commit().await?;
        Ok(id)
    }

    /// Transaction-scoped variant of [`register_node`], for callers that
    /// already hold a transaction (e.g. `create_extract`, which must commit
    /// the overlay edge atomically with the item INSERT).
    pub async fn register_node_tx(
        tx: &mut Transaction<'_, Sqlite>,
        kind: ElementKind,
        ref_id: &str,
        element_type: i32,
        parent_id: Option<i64>,
        created_at: &str,
    ) -> Result<i64> {
        register_node_in_tx(tx, kind, ref_id, element_type, parent_id, created_at).await
    }

    /// Unlink a node from the topology — patching the prev/next sibling chain
    /// symmetrically and clearing the parent's child pointer when the node is
    /// its first child. This mirrors SuperMemo's doubly-linked-list unlink.
    ///
    /// The row itself is left in place (history); callers that want a hard
    /// delete can drop the row afterward. Children of the unlinked node, if
    /// any, are orphaned (their parent_id is not rewritten here) — that matches
    /// SuperMemo, which deletes an element's subtree before unlinking.
    pub async fn unlink_node(&self, id: i64) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        unlink_node_in_tx(&mut tx, id).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Transaction-scoped variant of [`unlink_node`].
    pub async fn unlink_node_tx(tx: &mut Transaction<'_, Sqlite>, id: i64) -> Result<()> {
        unlink_node_in_tx(tx, id).await
    }

    /// Move `src` under `new_parent` (None = root), rejecting the move if
    /// `new_parent` is `src` itself or one of `src`'s descendants (which would
    /// create a cycle). The node is re-appended as the last child of
    /// `new_parent`.
    ///
    /// Returns `Err` on a cycle attempt without mutating the tree.
    pub async fn move_node(
        &self,
        src: i64,
        new_parent: Option<i64>,
        created_at_for_new_position: &str,
    ) -> Result<()> {
        if let Some(np) = new_parent {
            if np == src {
                return Err(PlethoraError::InvalidInput(
                    "cannot move an element into itself".into(),
                ));
            }
            if self.is_descendant(np, src).await? {
                return Err(PlethoraError::InvalidInput(
                    "cannot move an element into its own descendant (cycle)".into(),
                ));
            }
        }

        let mut tx = self.pool.begin().await?;
        unlink_node_in_tx(&mut tx, src).await?;
        // The node row still exists (unlink only patches the sibling chain);
        // reparent it and re-append as the last child of `new_parent`.
        reparent_in_tx(&mut tx, src, new_parent, created_at_for_new_position).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Return `true` if `candidate` is `ancestor` or a descendant of `ancestor`
    /// (i.e. `ancestor` is on the path from the root to `candidate`). Used as
    /// the cycle guard in [`move_node`].
    pub async fn is_descendant(&self, candidate: i64, ancestor: i64) -> Result<bool> {
        if candidate == ancestor {
            return Ok(true);
        }
        let mut current = candidate;
        let mut visited = HashSet::new();
        loop {
            if !visited.insert(current) {
                // Defensive: a malformed chain would otherwise loop forever.
                return Ok(false);
            }
            let parent: Option<(Option<i64>,)> = sqlx::query_as::<_, (Option<i64>,)>(
                "SELECT parent_id FROM element_tree WHERE id = ?1",
            )
            .bind(current)
            .fetch_optional(&self.pool)
            .await?;
            match parent {
                None => return Ok(false),
                Some((Some(p),)) => {
                    if p == ancestor {
                        return Ok(true);
                    }
                    current = p;
                }
                Some((None,)) => return Ok(false),
            }
        }
    }

    /// Return the direct children of `parent`, ordered by sort_order then
    /// created_at (the order they were appended).
    pub async fn get_children(&self, parent_id: i64) -> Result<Vec<ElementTreeNode>> {
        let rows = sqlx::query(
            "SELECT * FROM element_tree WHERE parent_id = ?1 ORDER BY sort_order, created_at, id",
        )
        .bind(parent_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_node).collect()
    }

    /// Return the siblings of `id` (same parent, excluding `id` itself),
    /// ordered by sort_order then created_at.
    pub async fn get_siblings(&self, id: i64) -> Result<Vec<ElementTreeNode>> {
        let parent_id: Option<(Option<i64>,)> =
            sqlx::query_as::<_, (Option<i64>,)>("SELECT parent_id FROM element_tree WHERE id = ?1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        let Some((Some(parent),)) = parent_id else {
            return Ok(Vec::new());
        };
        let rows = sqlx::query(
            "SELECT * FROM element_tree WHERE parent_id = ?1 AND id <> ?2 ORDER BY sort_order, created_at, id",
        )
        .bind(parent)
        .bind(id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_node).collect()
    }

    /// Return `id` and all of its descendants (the whole subtree), in
    /// unspecified order. The traversal switches on the descendant-count
    /// thresholds (300 / 400) the neural-queue code uses to choose its walk
    /// shape — here we simply return the full set and let the caller decide;
    /// the thresholds are surfaced via [`DESCENDANT_THRESHOLD_A`] /
    /// [`DESCENDANT_THRESHOLD_B`].
    pub async fn get_descendants(&self, id: i64) -> Result<Vec<ElementTreeNode>> {
        let mut out = Vec::new();
        let mut stack = vec![id];
        let mut visited = HashSet::new();
        while let Some(cur) = stack.pop() {
            if !visited.insert(cur) {
                continue;
            }
            let children = self.get_children(cur).await?;
            for child in children {
                out.push(child.clone());
                stack.push(child.id);
            }
        }
        Ok(out)
    }

    /// Walk up the parent chain from `id` to find its root article — the
    /// topmost Topic ancestor (a document), or `id` itself if it is already a
    /// root. Returns None if the node doesn't exist.
    pub async fn get_root_article(&self, id: i64) -> Result<Option<ElementTreeNode>> {
        let mut current = match self.get_node(id).await? {
            Some(n) => n,
            None => return Ok(None),
        };
        let mut visited = HashSet::new();
        while let Some(parent_id) = current.parent_id {
            if !visited.insert(current.id) {
                break;
            }
            match self.get_node(parent_id).await? {
                Some(parent) => current = parent,
                None => break,
            }
        }
        Ok(Some(current))
    }
}

// ---------------------------------------------------------------------------
// Free functions used both by the repo and by transactional callers
// (create_extract / create_learning_item_inner), so the sibling-chain surgery
// is defined exactly once.
// ---------------------------------------------------------------------------

/// Look up an element_tree id by `(kind, ref_id)` using a pool reference.
pub async fn find_node_id_pool(
    pool: &Pool<Sqlite>,
    kind: ElementKind,
    ref_id: &str,
) -> Result<Option<i64>> {
    let row: Option<(i64,)> = sqlx::query_as::<_, (i64,)>(
        "SELECT id FROM element_tree WHERE element_kind = ?1 AND element_ref_id = ?2",
    )
    .bind(kind.as_str())
    .bind(ref_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id,)| id))
}

/// Look up an element_tree id by `(kind, ref_id)` inside a transaction.
pub async fn find_node_id_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    kind: ElementKind,
    ref_id: &str,
) -> Result<Option<i64>> {
    let row: Option<(i64,)> = sqlx::query_as::<_, (i64,)>(
        "SELECT id FROM element_tree WHERE element_kind = ?1 AND element_ref_id = ?2",
    )
    .bind(kind.as_str())
    .bind(ref_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.map(|(id,)| id))
}

/// Insert an element_tree row, append-as-last-child surgery included, inside
/// the caller's transaction. Idempotent on `(kind, ref_id)`.
pub async fn register_node_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    kind: ElementKind,
    ref_id: &str,
    element_type: i32,
    parent_id: Option<i64>,
    created_at: &str,
) -> Result<i64> {
    // Idempotency check inside the transaction too — a caller may have already
    // inserted the node earlier in the same tx.
    let existing: Option<(i64,)> = sqlx::query_as::<_, (i64,)>(
        "SELECT id FROM element_tree WHERE element_kind = ?1 AND element_ref_id = ?2",
    )
    .bind(kind.as_str())
    .bind(ref_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some((id,)) = existing {
        return Ok(id);
    }

    // sort_order = the new child's position among its siblings, computed as
    // one past the current max so the append-as-last-child order is stable.
    let next_sort_order: i64 = match parent_id {
        Some(pid) => {
            let (max_sort,): (Option<i64>,) =
                sqlx::query_as("SELECT MAX(sort_order) FROM element_tree WHERE parent_id = ?1")
                    .bind(pid)
                    .fetch_one(&mut **tx)
                    .await?;
            max_sort.unwrap_or(-1) + 1
        }
        None => 0,
    };

    // Find the current last child (max sort_order) so we can wire its
    // next_sibling_id at the new node and the new node's prev_sibling_id at it.
    let last_child_id: Option<i64> = match parent_id {
        Some(pid) => {
            // fetch_optional so the very first append (no existing children)
            // yields None rather than a RowNotFound error.
            let lc: Option<(i64,)> = sqlx::query_as(
                "SELECT id FROM element_tree WHERE parent_id = ?1 ORDER BY sort_order DESC, created_at DESC, id DESC LIMIT 1",
            )
            .bind(pid)
            .fetch_optional(&mut **tx)
            .await?;
            lc.map(|(id,)| id)
        }
        None => None,
    };

    // Insert the new node with its prev_sibling_id already wired.
    let insert_result = sqlx::query(
        r#"
        INSERT INTO element_tree (
            element_kind, element_ref_id, parent_id, first_child_id,
            next_sibling_id, prev_sibling_id, element_type, concept_link_id,
            inter_element_link_id, descendant_count_a, descendant_count_b,
            sort_order, created_at
        ) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, NULL, NULL, 0, 0, ?6, ?7)
        "#,
    )
    .bind(kind.as_str())
    .bind(ref_id)
    .bind(parent_id)
    .bind(last_child_id)
    .bind(element_type)
    .bind(next_sort_order)
    .bind(created_at)
    .execute(&mut **tx)
    .await?;
    let new_id = insert_result.last_insert_rowid();

    // Point the prior last child's next_sibling_id at the new node.
    if let Some(lc) = last_child_id {
        sqlx::query("UPDATE element_tree SET next_sibling_id = ?1 WHERE id = ?2")
            .bind(new_id)
            .bind(lc)
            .execute(&mut **tx)
            .await?;
    }

    // Initialize / keep the parent's first_child_id pointing at its earliest
    // child. On first append there is no last_child, so the new node is also
    // the first child.
    if let Some(pid) = parent_id {
        let (first_child,): (Option<i64>,) =
            sqlx::query_as("SELECT first_child_id FROM element_tree WHERE id = ?1")
                .bind(pid)
                .fetch_one(&mut **tx)
                .await?;
        if first_child.is_none() {
            sqlx::query("UPDATE element_tree SET first_child_id = ?1 WHERE id = ?2")
                .bind(new_id)
                .bind(pid)
                .execute(&mut **tx)
                .await?;
        }
    }

    Ok(new_id)
}

/// Reparent an existing element_tree node, re-appending it as the **last**
/// child of `new_parent` (None = root). Unlike [`register_node_in_tx`], this
/// UPDATEs the existing row in place rather than relying on the
/// `(kind, ref_id)` idempotent-insert path — which is what `move_node` needs,
/// since the node already exists and only its parent (and thus sibling chain)
/// is changing. The caller is responsible for unlinking the node from its old
/// position first.
pub async fn reparent_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    id: i64,
    new_parent: Option<i64>,
    created_at_for_new_position: &str,
) -> Result<()> {
    // The new sort_order is one past the current max among the new parent's
    // children, so the moved node lands last.
    let next_sort_order: i64 = match new_parent {
        Some(pid) => {
            let (max_sort,): (Option<i64>,) =
                sqlx::query_as("SELECT MAX(sort_order) FROM element_tree WHERE parent_id = ?1")
                    .bind(pid)
                    .fetch_one(&mut **tx)
                    .await?;
            max_sort.unwrap_or(-1) + 1
        }
        None => 0,
    };

    // The new last child among the new parent's existing children (None if it
    // is empty, which makes the moved node also the first child).
    let last_child_id: Option<i64> = match new_parent {
        Some(pid) => {
            let lc: Option<(i64,)> = sqlx::query_as(
                "SELECT id FROM element_tree WHERE parent_id = ?1 ORDER BY sort_order DESC, created_at DESC, id DESC LIMIT 1",
            )
            .bind(pid)
            .fetch_optional(&mut **tx)
            .await?;
            lc.map(|(cid,)| cid)
        }
        None => None,
    };

    // Reparent and clear stale sibling pointers; prev wired to prior last child.
    sqlx::query(
        r#"
        UPDATE element_tree
        SET parent_id = ?1,
            first_child_id = NULL,
            next_sibling_id = NULL,
            prev_sibling_id = ?2,
            sort_order = ?3,
            created_at = ?4
        WHERE id = ?5
        "#,
    )
    .bind(new_parent)
    .bind(last_child_id)
    .bind(next_sort_order)
    .bind(created_at_for_new_position)
    .bind(id)
    .execute(&mut **tx)
    .await?;

    // Point the prior last child's next_sibling_id at the moved node.
    if let Some(lc) = last_child_id {
        sqlx::query("UPDATE element_tree SET next_sibling_id = ?1 WHERE id = ?2")
            .bind(id)
            .bind(lc)
            .execute(&mut **tx)
            .await?;
    }

    // Initialize / keep the new parent's first_child_id. On first append there
    // is no last child, so the moved node becomes the first child.
    if let Some(pid) = new_parent {
        let (first_child,): (Option<i64>,) =
            sqlx::query_as("SELECT first_child_id FROM element_tree WHERE id = ?1")
                .bind(pid)
                .fetch_one(&mut **tx)
                .await?;
        if first_child.is_none() {
            sqlx::query("UPDATE element_tree SET first_child_id = ?1 WHERE id = ?2")
                .bind(id)
                .bind(pid)
                .execute(&mut **tx)
                .await?;
        }
    }

    Ok(())
}

/// Unlink a node from its sibling chain and parent, inside the caller's
/// transaction. Symmetric doubly-linked-list removal.
pub async fn unlink_node_in_tx(tx: &mut Transaction<'_, Sqlite>, id: i64) -> Result<()> {
    let row: Option<(Option<i64>, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT parent_id, prev_sibling_id, next_sibling_id FROM element_tree WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((parent_id, prev_id, next_id)) = row else {
        return Ok(()); // already gone
    };

    // Reconnect prev <-> next across the removed node.
    if let Some(prev) = prev_id {
        sqlx::query("UPDATE element_tree SET next_sibling_id = ?1 WHERE id = ?2")
            .bind(next_id)
            .bind(prev)
            .execute(&mut **tx)
            .await?;
    }
    if let Some(next) = next_id {
        sqlx::query("UPDATE element_tree SET prev_sibling_id = ?1 WHERE id = ?2")
            .bind(prev_id)
            .bind(next)
            .execute(&mut **tx)
            .await?;
    }

    // If the node was its parent's first child, advance the parent's pointer.
    if let Some(pid) = parent_id {
        let (first_child,): (Option<i64>,) =
            sqlx::query_as("SELECT first_child_id FROM element_tree WHERE id = ?1")
                .bind(pid)
                .fetch_one(&mut **tx)
                .await?;
        if first_child == Some(id) {
            sqlx::query("UPDATE element_tree SET first_child_id = ?1 WHERE id = ?2")
                .bind(next_id)
                .bind(pid)
                .execute(&mut **tx)
                .await?;
        }
    }

    Ok(())
}

/// Fetch a single node inside a transaction.
async fn node_in_tx(tx: &mut Transaction<'_, Sqlite>, id: i64) -> Result<Option<ElementTreeNode>> {
    let row = sqlx::query("SELECT * FROM element_tree WHERE id = ?1")
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?;
    row.map(|r| row_to_node(&r)).transpose()
}

/// Decode a sqlx Row into an [`ElementTreeNode`]. Shared by all read paths.
fn row_to_node(row: &sqlx::sqlite::SqliteRow) -> Result<ElementTreeNode> {
    use sqlx::Row;
    let kind_str: String = row.try_get("element_kind")?;
    let created_at: String = row.try_get("created_at")?;
    Ok(ElementTreeNode {
        id: row.try_get("id")?,
        element_kind: ElementKind::parse(&kind_str)?,
        element_ref_id: row.try_get("element_ref_id")?,
        parent_id: row.try_get("parent_id")?,
        first_child_id: row.try_get("first_child_id")?,
        next_sibling_id: row.try_get("next_sibling_id")?,
        prev_sibling_id: row.try_get("prev_sibling_id")?,
        element_type: row.try_get("element_type")?,
        concept_link_id: row.try_get("concept_link_id")?,
        inter_element_link_id: row.try_get("inter_element_link_id")?,
        descendant_count_a: row.try_get("descendant_count_a")?,
        descendant_count_b: row.try_get("descendant_count_b")?,
        sort_order: row.try_get("sort_order")?,
        created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use std::path::PathBuf;

    async fn setup() -> ElementTreeRepository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        ElementTreeRepository::new(db.pool().clone())
    }

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    #[tokio::test]
    async fn register_first_child_sets_parent_first_child() {
        let repo = setup().await;
        // Root document node.
        let doc = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        // First extract child.
        let e1 = repo
            .register_node(
                ElementKind::Extract,
                "ext1",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();

        let parent = repo.get_node(doc).await.unwrap().unwrap();
        assert_eq!(parent.first_child_id, Some(e1));
        let child = repo.get_node(e1).await.unwrap().unwrap();
        assert_eq!(child.parent_id, Some(doc));
        assert_eq!(child.prev_sibling_id, None);
        assert_eq!(child.next_sibling_id, None);
    }

    #[tokio::test]
    async fn register_second_child_wires_sibling_chain() {
        let repo = setup().await;
        let doc = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        let e1 = repo
            .register_node(
                ElementKind::Extract,
                "ext1",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();
        let e2 = repo
            .register_node(
                ElementKind::Extract,
                "ext2",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();

        // e1 is the first child; e2 is the last. e1.next = e2, e2.prev = e1.
        let first = repo.get_node(e1).await.unwrap().unwrap();
        let second = repo.get_node(e2).await.unwrap().unwrap();
        assert_eq!(first.next_sibling_id, Some(e2));
        assert_eq!(first.prev_sibling_id, None);
        assert_eq!(second.prev_sibling_id, Some(e1));
        assert_eq!(second.next_sibling_id, None);
        // Parent's first child is still the earliest.
        let parent = repo.get_node(doc).await.unwrap().unwrap();
        assert_eq!(parent.first_child_id, Some(e1));
    }

    #[tokio::test]
    async fn register_node_is_idempotent() {
        let repo = setup().await;
        let a = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        let b = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        assert_eq!(a, b);
    }

    #[tokio::test]
    async fn unlink_middle_of_chain_reconnects_prev_and_next() {
        let repo = setup().await;
        let doc = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        let e1 = repo
            .register_node(
                ElementKind::Extract,
                "ext1",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();
        let e2 = repo
            .register_node(
                ElementKind::Extract,
                "ext2",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();
        let e3 = repo
            .register_node(
                ElementKind::Extract,
                "ext3",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();

        // Unlink the middle child e2. e1 and e3 should reconnect.
        repo.unlink_node(e2).await.unwrap();
        let first = repo.get_node(e1).await.unwrap().unwrap();
        let third = repo.get_node(e3).await.unwrap().unwrap();
        assert_eq!(first.next_sibling_id, Some(e3));
        assert_eq!(third.prev_sibling_id, Some(e1));
        let parent = repo.get_node(doc).await.unwrap().unwrap();
        assert_eq!(parent.first_child_id, Some(e1));
    }

    #[tokio::test]
    async fn unlink_head_advances_parent_first_child() {
        let repo = setup().await;
        let doc = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        let e1 = repo
            .register_node(
                ElementKind::Extract,
                "ext1",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();
        let e2 = repo
            .register_node(
                ElementKind::Extract,
                "ext2",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();

        // Unlink the head. The parent's first_child should advance to e2.
        repo.unlink_node(e1).await.unwrap();
        let parent = repo.get_node(doc).await.unwrap().unwrap();
        assert_eq!(parent.first_child_id, Some(e2));
        let second = repo.get_node(e2).await.unwrap().unwrap();
        assert_eq!(second.prev_sibling_id, None);
    }

    #[tokio::test]
    async fn unlink_tail_clears_prev_pointer() {
        let repo = setup().await;
        let doc = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        let e1 = repo
            .register_node(
                ElementKind::Extract,
                "ext1",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();
        let e2 = repo
            .register_node(
                ElementKind::Extract,
                "ext2",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();

        repo.unlink_node(e2).await.unwrap();
        let first = repo.get_node(e1).await.unwrap().unwrap();
        assert_eq!(first.next_sibling_id, None);
    }

    #[tokio::test]
    async fn is_descendant_rejects_moving_into_own_descendant() {
        let repo = setup().await;
        let doc = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        let ext = repo
            .register_node(
                ElementKind::Extract,
                "ext1",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();
        let card = repo
            .register_node(
                ElementKind::LearningItem,
                "c1",
                ELEMENT_TYPE_ITEM,
                Some(ext),
                &now(),
            )
            .await
            .unwrap();

        // card is a descendant of doc; doc is NOT a descendant of card.
        assert!(repo.is_descendant(card, doc).await.unwrap());
        assert!(!repo.is_descendant(doc, card).await.unwrap());

        // Moving the doc into its own descendant must be rejected.
        let err = repo.move_node(doc, Some(card), &now()).await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn move_node_reparents() {
        let repo = setup().await;
        let doc = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        let ext = repo
            .register_node(
                ElementKind::Extract,
                "ext1",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();

        // Moving into itself is rejected.
        let err = repo.move_node(doc, Some(doc), &now()).await;
        assert!(err.is_err());

        // A legal move: ext is already under doc; move it to root (None).
        repo.move_node(ext, None, &now()).await.unwrap();
        let moved = repo.get_node(ext).await.unwrap().unwrap();
        assert_eq!(moved.parent_id, None);
    }

    #[tokio::test]
    async fn get_descendants_returns_whole_subtree() {
        let repo = setup().await;
        let doc = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        let ext = repo
            .register_node(
                ElementKind::Extract,
                "ext1",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();
        let _card = repo
            .register_node(
                ElementKind::LearningItem,
                "c1",
                ELEMENT_TYPE_ITEM,
                Some(ext),
                &now(),
            )
            .await
            .unwrap();

        let desc = repo.get_descendants(doc).await.unwrap();
        assert_eq!(desc.len(), 2); // ext + card
        assert!(desc.iter().any(|n| n.id == ext));
    }

    #[tokio::test]
    async fn get_root_article_walks_to_topmost_ancestor() {
        let repo = setup().await;
        let doc = repo
            .register_node(
                ElementKind::Document,
                "doc1",
                ELEMENT_TYPE_TOPIC,
                None,
                &now(),
            )
            .await
            .unwrap();
        let ext = repo
            .register_node(
                ElementKind::Extract,
                "ext1",
                ELEMENT_TYPE_TOPIC,
                Some(doc),
                &now(),
            )
            .await
            .unwrap();
        let card = repo
            .register_node(
                ElementKind::LearningItem,
                "c1",
                ELEMENT_TYPE_ITEM,
                Some(ext),
                &now(),
            )
            .await
            .unwrap();

        let root = repo.get_root_article(card).await.unwrap().unwrap();
        assert_eq!(root.id, doc);
    }
}
