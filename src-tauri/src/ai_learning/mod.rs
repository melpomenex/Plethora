//! AI learning semantic memory: chunking, incremental indexing, and
//! retrieval (OpenSpec change `add-ondevice-ai-learning-system`, Phase 3).
//!
//! Layer map:
//! - [`chunker`] — heading-aware recursive splitter producing `ChunkModel`s
//!   with navigation payloads (design D12/D13).
//! - [`embeddings_backend`] — backend registry (on-device stub / Ollama /
//!   cloud / mock) with versioned staleness (D10, task 4.4).
//! - [`indexer`] — tokio background worker: per-document enqueue on change,
//!   content-hash diffing, per-chunk commits, state machine, pause/resume/
//!   cancel/reset (D14, tasks 4.3 + 4.7).
//! - [`retrieval`] — `retrieve(query, k, filters)` with FTS5 lexical
//!   prefilter/fallback and bounded-heap cosine top-k (D11, task 4.6).
//!
//! Everything persisted here is a rebuildable cache; user content stays
//! canonical in the existing domain tables (D22).

pub mod chunker;
pub mod embeddings_backend;
pub mod indexer;
pub mod models;
pub mod retrieval;
pub mod spotlight;

/// Timed perf tests for the chunker and the cosine top-k kernel (task 4.11).
#[cfg(test)]
mod benches;

#[cfg(test)]
pub(crate) mod test_support;

pub use indexer::{BackendFactory, IndexerQueue, IndexerRuntimeStatus};

#[cfg(test)]
mod tests {
    use super::test_support::{pool_migrated_up_to, test_pool};

    /// Task 4.1: the `085_ai_learning_system` migration creates every table
    /// of the semantic index (+ provenance/concepts/recall/assessment/passage
    /// caches for later phases) on a fresh database.
    #[tokio::test]
    async fn migration_085_creates_all_ai_learning_tables_on_fresh_db() {
        let pool = test_pool().await;

        for table in [
            "semantic_chunks",
            "semantic_chunk_embeddings",
            "ai_index_state",
            "ai_provenance",
            "concepts",
            "concept_links",
            "recall_prompt_history",
            "answer_assessments",
            "passage_scores",
            "queue_item_embeddings",
        ] {
            let (count,): (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            )
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("sqlite_master query");
            assert_eq!(count, 1, "table {table} should exist after migrations");
        }

        for index in [
            "idx_semantic_chunks_document",
            "idx_semantic_chunks_hash",
            "idx_semantic_chunk_embeddings_version",
            "idx_queue_item_embeddings_content_hash",
        ] {
            let (count,): (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
            )
            .bind(index)
            .fetch_one(&pool)
            .await
            .expect("sqlite_master query");
            assert_eq!(count, 1, "index {index} should exist after migrations");
        }

        // The legacy RAG table must be gone (folded + dropped).
        let (legacy,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'document_chunk_embeddings'",
        )
        .fetch_one(&pool)
        .await
        .expect("sqlite_master query");
        assert_eq!(legacy, 0, "document_chunk_embeddings should be dropped");
    }

    /// Task 4.1: the one-time fold migrates pre-existing legacy RAG rows into
    /// the unified tables. Seeding the old table is only possible by stopping
    /// just before 085 — exactly what the migration-up-to helper does.
    #[tokio::test]
    async fn migration_085_folds_legacy_chunk_embeddings_then_drops_table() {
        let pool = pool_migrated_up_to("085_ai_learning_system").await;

        // Seed a document + two legacy RAG chunk rows the way migration 051
        // left them (millisecond created_at).
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, date_added, date_modified)
             VALUES ('fold-1', 'Folded doc', '/tmp/f.pdf', 'pdf', 'content', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("seed document");

        let now_ms = 1_767_225_600_000i64; // 2026-01-01T00:00:00Z
        for (id, idx, text) in [
            ("legacy-1", 0i64, "First legacy chunk text"),
            ("legacy-2", 1, "Second legacy chunk text"),
        ] {
            sqlx::query(
                "INSERT INTO document_chunk_embeddings
                    (id, document_id, chunk_index, chunk_text, embedding, content_hash, provider, model, dimension, created_at)
                 VALUES (?1, 'fold-1', ?2, ?3, x'0000803F', 'hash-' || ?1, 'Ollama', 'nomic-embed-text', 1, ?4)",
            )
            .bind(id)
            .bind(idx)
            .bind(text)
            .bind(now_ms)
            .execute(&pool)
            .await
            .expect("seed legacy chunk");
        }

        crate::database::migrations::run_migrations(&pool)
            .await
            .expect("apply 085");

        // Folded rows present in the unified tables…
        let (chunks,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM semantic_chunks WHERE document_id = 'fold-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(chunks, 2, "legacy chunks folded into semantic_chunks");

        let (embeddings, source_type): (i64, i64) = sqlx::query_as(
            "SELECT COUNT(*),
                    SUM(CASE WHEN source_type = 'document' THEN 1 ELSE 0 END)
             FROM semantic_chunks WHERE document_id = 'fold-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let _ = source_type;
        assert_eq!(embeddings, 2);

        let (folded_embeddings,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM semantic_chunk_embeddings WHERE chunk_id IN ('legacy-1', 'legacy-2')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(folded_embeddings, 2, "legacy embeddings folded");

        let (model, version): (String, i64) = sqlx::query_as(
            "SELECT model, embedding_version FROM semantic_chunk_embeddings WHERE chunk_id = 'legacy-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(model, "nomic-embed-text");
        assert_eq!(version, 1, "folded rows carry the default version 1");

        // …and the legacy table is retired.
        let (legacy,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'document_chunk_embeddings'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(legacy, 0);
    }

    /// Task 4.1: repository round-trip through the new tables (schema
    /// presence alone is not enough — the indexer must be able to write and
    /// cascade).
    #[tokio::test]
    async fn semantic_tables_support_indexer_round_trip_and_cascade() {
        let pool = test_pool().await;
        use crate::ai_learning::embeddings_backend::EmbeddingBackend;
        use crate::ai_learning::indexer::index_document_once;
        use crate::database::Repository;

        let repo = Repository::new(pool.clone());
        super::test_support::seed_document(
            &pool,
            "rt-1",
            "Round trip content with several words. ",
            "text",
        )
        .await;

        let backend = EmbeddingBackend::Mock {
            dim: 16,
            model: "mock-rt",
        };
        index_document_once(&repo, "rt-1", &backend, &mut || true)
            .await
            .expect("round trip index");

        let (state,): (String,) =
            sqlx::query_as("SELECT state FROM ai_index_state WHERE document_id = 'rt-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(state, "indexed");

        // Deleting the document cascades chunks, embeddings, and state.
        sqlx::query("DELETE FROM documents WHERE id = 'rt-1'")
            .execute(&pool)
            .await
            .unwrap();
        let (remaining,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM semantic_chunks")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(remaining, 0);
    }
}
