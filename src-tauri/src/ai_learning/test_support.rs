//! Shared fixtures for `ai_learning` tests: an in-memory database with all
//! migrations applied plus document seeding helpers.

use sqlx::sqlite::SqlitePoolOptions;

/// In-memory database with the full migration chain applied. One connection:
/// `sqlite::memory:` gives every pool connection a private database.
pub(crate) async fn test_pool() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("open in-memory db");
    crate::database::migrations::run_migrations(&pool)
        .await
        .expect("migrations apply");
    pool
}

/// In-memory database with every migration up to (but not including)
/// `stop_before` applied, so a test can seed rows that look like they
/// predate the migration under test.
pub(crate) async fn pool_migrated_up_to(stop_before: &str) -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("open in-memory db");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .expect("create migrations table");

    for migration in crate::database::migrations::MIGRATIONS {
        if migration.name == stop_before {
            return pool;
        }
        sqlx::raw_sql(migration.sql)
            .execute(&pool)
            .await
            .unwrap_or_else(|e| panic!("migration {} failed: {}", migration.name, e));
        sqlx::query(
            "INSERT INTO _schema_migrations (name, applied_at) VALUES (?1, datetime('now'))",
        )
        .bind(migration.name)
        .execute(&pool)
        .await
        .expect("record migration");
    }
    panic!("migration {} not found", stop_before);
}

/// Seed a minimal document row.
pub(crate) async fn seed_document(
    pool: &sqlx::SqlitePool,
    id: &str,
    content: &str,
    file_type: &str,
) {
    sqlx::query(
        "INSERT INTO documents (id, title, file_path, file_type, content, date_added, date_modified)
         VALUES (?1, ?2, '/tmp/x', ?3, ?4, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(format!("Doc {id}"))
    .bind(file_type)
    .bind(content)
    .execute(pool)
    .await
    .expect("seed document");
}

/// Repopulate the FTS5 tables from `documents`/`extracts`, mirroring the
/// `fts_reindex` command and migration 030's backfill.
///
/// Pre-existing migration quirk (out of this change's scope): after a fresh
/// full-migration run the `document_search_*` sync triggers are absent (only
/// the `extract_search_*` triggers exist), so seeded rows never reach
/// `document_search` automatically. Production DBs get repopulated by the
/// same backfill this helper performs.
pub(crate) async fn reindex_fts(pool: &sqlx::SqlitePool) {
    sqlx::query(
        "INSERT OR IGNORE INTO document_search(document_id, title, content, content_type)
         SELECT id, title, COALESCE(content, ''), file_type FROM documents",
    )
    .execute(pool)
    .await
    .expect("backfill document_search");
    sqlx::query(
        "INSERT OR IGNORE INTO extract_search(extract_id, document_id, content)
         SELECT id, document_id, COALESCE(content, '') FROM extracts",
    )
    .execute(pool)
    .await
    .expect("backfill extract_search");
}
