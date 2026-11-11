//! C8-T01 golden fixture loader (test-only, never production).
//! Inserts the synthetic OS corpus documents + concepts + confirmed links.
//! No production code may import this module.

use sqlx::{Pool, Sqlite};

pub const FIXTURE_DOCS: &[(&str, &str)] = &[
    ("doc_fixture_os_pdf", "Synthetic Operating Systems Notes"),
    ("doc_fixture_os_video", "Synthetic Scheduling Lecture"),
    (
        "doc_fixture_os_epub",
        "Synthetic Synchronization Worked Examples",
    ),
];

pub const FIXTURE_CONCEPTS: &[(&str, &str)] = &[
    ("concept_fixture_os_process", "Processes and threads"),
    ("concept_fixture_os_scheduling", "CPU scheduling"),
    ("concept_fixture_os_tlb", "Address translation and TLBs"),
    ("concept_fixture_os_page_fault", "Page-fault handling"),
    ("concept_fixture_os_semaphores", "Bounded-buffer semaphores"),
];

pub async fn load_golden_corpus(pool: &Pool<Sqlite>) -> Result<(), String> {
    for (id, title) in FIXTURE_DOCS {
        sqlx::query(
            "INSERT OR IGNORE INTO documents (id, title, file_path, file_type, date_added, date_modified, content)
             VALUES (?1, ?2, '/fixture', 'pdf', '2026-01-05T09:00:00.000Z', '2026-01-05T09:00:00.000Z', 'fixture')",
        )
        .bind(id)
        .bind(title)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }
    for (id, name) in FIXTURE_CONCEPTS {
        sqlx::query(
            "INSERT OR IGNORE INTO concepts (id, name, normalized_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, '2026-01-05T09:00:00.000Z', '2026-01-05T09:00:00.000Z')",
        )
        .bind(id)
        .bind(name)
        .bind(name.to_lowercase())
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;

    #[tokio::test]
    async fn golden_corpus_loads_twice_identically() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        load_golden_corpus(&pool).await.unwrap();
        load_golden_corpus(&pool).await.unwrap();
        let (docs,): (i64,) =
            sqlx::query_as("SELECT count(*) FROM documents WHERE id LIKE 'doc_fixture_os_%'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(docs, 3);
        let (concepts,): (i64,) =
            sqlx::query_as("SELECT count(*) FROM concepts WHERE id LIKE 'concept_fixture_os_%'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(concepts, 5);
    }
}
