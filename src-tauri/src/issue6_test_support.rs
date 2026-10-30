//! Isolated, deterministic issue #6 data for repository and workflow tests.

use std::path::PathBuf;

use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::database::{Database, Repository};
use crate::models::{
    Document, Extract, FileType, ItemType, LearningItem, MemoryState, VideoExtract,
};

pub(crate) const DOCUMENT_ID: &str = "issue6-document";
pub(crate) const EXTRACT_ID: &str = "issue6-extract";
pub(crate) const VIDEO_ID: &str = "issue6-video";
pub(crate) const VIDEO_EXTRACT_ID: &str = "issue6-video-extract";
pub(crate) const NEW_VIDEO_EXTRACT_ID: &str = "issue6-video-extract-new";
pub(crate) const PLAYLIST_ID: &str = "issue6-playlist";
pub(crate) const CARD_IDS: [&str; 4] = [
    "issue6-basic",
    "issue6-qa",
    "issue6-cloze",
    "issue6-occlusion",
];
pub(crate) const SECTIONED_CONTENT: &str = "# First\nFirst section body.\n## Shared\nFirst shared body.\n# Second\nSecond section body.\n## Shared\nSecond shared body.";

pub(crate) fn now() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
        .expect("fixture clock")
        .with_timezone(&Utc)
}

/// A canned provider response; tests may mutate it to model bad/partial output.
pub(crate) fn provider_response() -> Value {
    json!({"cards": [{"type": "qa", "question": "What is in the second section?", "answer": "Second section body."}]})
}

/// Populate the production repository against a fresh, migrated in-memory DB.
pub(crate) async fn issue6_repository() -> Repository {
    issue6_repository_at(PathBuf::from(":memory:")).await
}

pub(crate) async fn issue6_repository_at(path: PathBuf) -> Repository {
    let db = Database::new(path).await.expect("fixture database");
    db.migrate().await.expect("fixture migrations");
    let repo = Repository::new(db.pool().clone());
    let clock = now();
    // Both rows are created by production migrations; pin their timestamps so
    // fixture comparisons do not depend on the wall clock used by migration.
    for table in ["collections", "youtube_playlist_settings"] {
        sqlx::query(&format!(
            "UPDATE {table} SET created_at = ?1, modified_at = ?1"
        ))
        .bind(clock.to_rfc3339())
        .execute(repo.pool())
        .await
        .expect("fix migrated fixture clock");
    }

    for (id, kind, title) in [
        (DOCUMENT_ID, FileType::Markdown, "Sectioned document"),
        ("issue6-html", FileType::Html, "HTML document"),
        ("issue6-pdf", FileType::Pdf, "PDF document"),
        ("issue6-epub", FileType::Epub, "EPUB document"),
        (VIDEO_ID, FileType::Youtube, "Video document"),
    ] {
        let mut document = Document::new(title.into(), format!("fixture://{id}"), kind);
        document.id = id.into();
        document.content = Some(SECTIONED_CONTENT.into());
        document.date_added = clock;
        document.date_modified = clock;
        document.date_last_reviewed = Some(clock - Duration::days(8));
        document.next_reading_date = Some(clock - Duration::days(7));
        document.priority_slider = 75;
        document.priority_rating = 4;
        document.priority_score = 75.0;
        document.priority_explicitly_set = true;
        document.stability = Some(8.0);
        document.difficulty = Some(4.0);
        document.reps = Some(2);
        repo.create_document(&document)
            .await
            .expect("seed document");
        sqlx::query(
            r#"
            UPDATE documents SET
                date_last_reviewed = ?1,
                next_reading_date = ?2,
                priority_slider = ?3,
                priority_rating = ?4,
                priority_score = ?5,
                priority_explicitly_set = ?6,
                stability = ?7,
                difficulty = ?8,
                reps = ?9
            WHERE id = ?10
            "#,
        )
        .bind(document.date_last_reviewed)
        .bind(document.next_reading_date)
        .bind(document.priority_slider)
        .bind(document.priority_rating)
        .bind(document.priority_score)
        .bind(if document.priority_explicitly_set {
            1_i64
        } else {
            0_i64
        })
        .bind(document.stability)
        .bind(document.difficulty)
        .bind(document.reps)
        .bind(&document.id)
        .execute(repo.pool())
        .await
        .expect("seed document scheduling and priority state");
    }

    let mut extract = Extract::new(DOCUMENT_ID.into(), "Second section body.".into());
    extract.id = EXTRACT_ID.into();
    extract.date_created = clock;
    extract.date_modified = clock;
    extract.last_review_date = Some(clock - Duration::days(2));
    extract.next_review_date = Some(clock - Duration::days(1));
    extract.review_count = 1;
    extract.reps = 1;
    extract.priority_score = 60.0;
    extract.memory_state = Some(MemoryState::new(3.0, 5.0));
    repo.create_extract(&extract).await.expect("seed extract");

    // One valid 1x1 PNG makes asset resolution independent of the network.
    let png: &[u8] = &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4,
        0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 3, 3,
        2, 0, 238, 86, 95, 107, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];
    sqlx::query("INSERT INTO image_assets (id, mime_type, content, byte_size, sha256, width, height, created_at, updated_at) VALUES (?1, 'image/png', ?2, ?3, ?4, 1, 1, ?5, ?5)")
        .bind("issue6-image")
        .bind(png)
        .bind(png.len() as i64)
        .bind(format!("{:x}", Sha256::digest(png)))
        .bind(clock)
        .execute(repo.pool()).await.expect("seed image");

    for (id, kind, question) in [
        (CARD_IDS[0], ItemType::Basic, "Basic question?"),
        (CARD_IDS[1], ItemType::Qa, "Question and answer?"),
        (
            CARD_IDS[2],
            ItemType::Cloze,
            "The {{c1::answer::hint}} is hidden.",
        ),
        (CARD_IDS[3], ItemType::Qa, "What is under the mask?"),
    ] {
        let mut card = LearningItem::new(kind, question.into());
        card.id = id.into();
        card.document_id = Some(DOCUMENT_ID.into());
        card.extract_id = Some(EXTRACT_ID.into());
        card.answer = Some("Answer".into());
        card.date_created = clock;
        card.date_modified = clock;
        card.due_date = clock - Duration::days(1);
        card.last_review_date = Some(clock - Duration::days(8));
        card.review_count = 2;
        card.memory_state = Some(MemoryState::new(7.0, 5.0));
        card.priority_slider = 50;
        card.priority_explicitly_set = true;
        if id == CARD_IDS[2] {
            card.cloze_text = Some(question.into());
        }
        if id == CARD_IDS[3] {
            card.image_asset_ids = vec!["issue6-image".into()];
            card.interaction_metadata = Some(json!({
                "imageOcclusionAssetId": "issue6-image",
                "imageOcclusionRegions": [{"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5}]
            }));
        }
        repo.create_learning_item(&card).await.expect("seed card");
    }

    let mut video = VideoExtract::new(VIDEO_ID.into(), 10.0, 40.0, "Video segment".into());
    video.id = VIDEO_EXTRACT_ID.into();
    video.date_created = clock;
    video.date_modified = clock;
    video.next_review_date = Some(clock - Duration::days(1));
    repo.create_video_extract(&video)
        .await
        .expect("seed video extract");
    let mut new_video = VideoExtract::new(VIDEO_ID.into(), 50.0, 80.0, "New video segment".into());
    new_video.id = NEW_VIDEO_EXTRACT_ID.into();
    new_video.date_created = clock;
    new_video.date_modified = clock;
    repo.create_video_extract(&new_video)
        .await
        .expect("seed new video extract");
    repo.create_playlist_subscription(
        PLAYLIST_ID,
        "fixture-playlist",
        "https://example.invalid/playlist",
        Some("Fixture playlist"),
        None,
        None,
        None,
        None,
        Some(0),
    )
    .await
    .expect("seed playlist");
    sqlx::query(
        "UPDATE youtube_playlist_subscriptions SET created_at = ?1, modified_at = ?1 WHERE id = ?2",
    )
    .bind(clock.to_rfc3339())
    .bind(PLAYLIST_ID)
    .execute(repo.pool())
    .await
    .expect("fix playlist clock");
    repo
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Explicitly invoked to retain a reproducible pre-implementation ledger.
    #[tokio::test]
    #[ignore = "writes the baseline to ISSUE6_BASELINE_PATH when explicitly requested"]
    async fn issue6_capture_baseline() {
        let repo = issue6_repository().await;
        let document = repo.get_document(DOCUMENT_ID).await.unwrap().unwrap();
        let extract = repo.get_extract(EXTRACT_ID).await.unwrap().unwrap();
        let mut cards = Vec::new();
        for id in CARD_IDS {
            cards.push(repo.get_learning_item_by_id(id).await.unwrap().unwrap());
        }
        let videos = vec![
            repo.get_video_extract(VIDEO_EXTRACT_ID)
                .await
                .unwrap()
                .unwrap(),
            repo.get_video_extract(NEW_VIDEO_EXTRACT_ID)
                .await
                .unwrap()
                .unwrap(),
        ];
        let playlist = repo
            .get_playlist_subscription(PLAYLIST_ID)
            .await
            .unwrap()
            .unwrap();
        let settings = repo.get_playlist_settings().await.unwrap();
        let review_log: i64 = sqlx::query_scalar("SELECT count(*) FROM review_log")
            .fetch_one(repo.pool())
            .await
            .unwrap();
        let outbox: i64 = sqlx::query_scalar("SELECT count(*) FROM sync_outbox")
            .fetch_one(repo.pool())
            .await
            .unwrap();
        let baseline = json!({
            "revision": "7d87d811f6db8fcd98da148d22e7f10a46bd747d",
            "fixture_clock": now().to_rfc3339(),
            "origin": "Fresh in-memory SQLite, production migrations and repository",
            "document": document, "extract": extract, "cards": cards,
            "video_extracts": videos, "playlist": playlist, "playlist_settings": settings,
            "counts": { "documents": 5, "extracts": 1, "cards": 4, "video_extracts": 2, "review_log": review_log, "sync_outbox": outbox }
        });
        let output = std::env::var("ISSUE6_BASELINE_PATH").expect("explicit baseline path");
        std::fs::write(
            output,
            serde_json::to_string_pretty(&baseline).unwrap() + "\n",
        )
        .expect("write baseline");
    }

    #[tokio::test]
    async fn issue6_fixture_recreates_with_foreign_keys_and_preserved_state() {
        assert_eq!(
            SECTIONED_CONTENT
                .lines()
                .filter(|line| *line == "## Shared")
                .count(),
            2
        );
        for _ in 0..2 {
            let repo = issue6_repository().await;
            let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
                .fetch_one(repo.pool())
                .await
                .unwrap();
            assert_eq!(foreign_keys, 1);
            for (table, expected) in [
                ("documents", 5),
                ("extracts", 1),
                ("learning_items", 4),
                ("video_extracts", 2),
                ("youtube_playlist_subscriptions", 1),
                ("youtube_playlist_settings", 1),
                ("collections", 1),
                ("image_assets", 1),
            ] {
                let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
                    .fetch_one(repo.pool())
                    .await
                    .unwrap();
                assert_eq!(count, expected, "{table}");
            }
            let doc = repo.get_document(DOCUMENT_ID).await.unwrap().unwrap();
            assert_eq!(doc.date_last_reviewed, Some(now() - Duration::days(8)));
            assert_eq!(doc.next_reading_date, Some(now() - Duration::days(7)));
            assert_eq!(doc.priority_slider, 75);
            assert_eq!(doc.priority_rating, 4);
            assert_eq!(doc.priority_score, 75.0);
            assert!(doc.priority_explicitly_set);
            assert_eq!(doc.stability, Some(8.0));
            assert_eq!(doc.difficulty, Some(4.0));
            assert_eq!(doc.reps, Some(2));
            assert_eq!(doc.extract_count, 1);
            assert_eq!(doc.learning_item_count, 4);
            let card = repo
                .get_learning_item_by_id(CARD_IDS[2])
                .await
                .unwrap()
                .unwrap();
            assert_eq!(card.document_id.as_deref(), Some(DOCUMENT_ID));
            assert_eq!(card.extract_id.as_deref(), Some(EXTRACT_ID));
            assert_eq!(card.review_count, 2);
            assert_eq!(card.due_date, now() - Duration::days(1));
            assert_eq!(card.memory_state.unwrap().stability, 7.0);
            let new_video = repo
                .get_video_extract(NEW_VIDEO_EXTRACT_ID)
                .await
                .unwrap()
                .unwrap();
            assert!(new_video.next_review_date.is_none());
            assert_eq!(new_video.review_count, 0);
            let due_video = repo
                .get_video_extract(VIDEO_EXTRACT_ID)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(due_video.next_review_date, Some(now() - Duration::days(1)));
            assert_eq!(
                provider_response()["cards"][0]["answer"],
                "Second section body."
            );
        }
    }

    #[tokio::test]
    async fn issue6_repro_s05_raw_extract_namespace_triggers_sqlite_fk_787_while_mcp_resolves() {
        let repo = issue6_repository().await;
        // 1. Reproduce S05: bypassing canonical source resolution lets the UI
        //    `extract:<id>` namespace reach `learning_items.document_id`, which
        //    violates SQLite's foreign key constraint (extended code 787).
        let mut raw_namespace_card =
            LearningItem::new(ItemType::Qa, "What is in the second section?".into());
        raw_namespace_card.id = "issue6-s05-raw-fk".into();
        raw_namespace_card.document_id = Some(format!("extract:{EXTRACT_ID}"));
        raw_namespace_card.answer = Some("Second section body.".into());

        let guarded = repo
            .create_learning_item(&raw_namespace_card)
            .await
            .expect_err("UI extract namespace must be rejected before persistence");
        assert!(matches!(guarded, crate::error::PlethoraError::InvalidInput(_)));
        // Keep the original database failure as evidence, below the repaired
        // repository guard. The failed statement cannot alter the source row.
        let err = sqlx::query("UPDATE learning_items SET document_id = ? WHERE id = ?")
            .bind(format!("extract:{EXTRACT_ID}"))
            .bind(CARD_IDS[0])
            .execute(repo.pool())
            .await
            .map_err(crate::error::PlethoraError::Database)
            .expect_err("raw display namespace violates SQLite's document FK");
        match &err {
            crate::error::PlethoraError::Database(sqlx::Error::Database(db_err)) => {
                assert_eq!(db_err.code().as_deref(), Some("787"));
                assert!(
                    db_err.message().contains("FOREIGN KEY constraint failed"),
                    "unexpected sqlite message: {}",
                    db_err.message()
                );
            }
            other => panic!("expected SQLite FK 787 error, got {other:?}"),
        }
        let unchanged_count: i64 = sqlx::query_scalar("SELECT count(*) FROM learning_items")
            .fetch_one(repo.pool())
            .await
            .unwrap();
        assert_eq!(unchanged_count, CARD_IDS.len() as i64);

        // 2. Canonical MCP tool boundary resolves `extract:<id>` to parent
        //    `document_id` + `extract_id` and rejects deleted/missing extracts.
        let registry = crate::mcp::tools::MCPToolRegistry::new(std::sync::Arc::new(repo.clone()));
        let missing_err = registry
            .execute_tool(
                "create_qa_card",
                json!({
                    "document_id": "extract:missing-extract",
                    "question": "Missing source?",
                    "answer": "Unavailable"
                }),
            )
            .await
            .expect_err("deleted/missing extract must fail before insert");
        assert!(missing_err.contains("source extract is unavailable"));

        let ok_result = registry
            .execute_tool(
                "create_qa_card",
                json!({
                    "document_id": format!("extract:{EXTRACT_ID}"),
                    "question": "What is in the second section?",
                    "answer": "Second section body."
                }),
            )
            .await
            .expect("canonical MCP create should succeed");
        let payload: Value = serde_json::from_str(&ok_result.content[0].text).unwrap();
        let saved = repo
            .get_learning_item_by_id(payload["id"].as_str().unwrap())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.document_id.as_deref(), Some(DOCUMENT_ID));
        assert_eq!(saved.extract_id.as_deref(), Some(EXTRACT_ID));
    }

    #[tokio::test]
    async fn issue6_repro_s04_partial_identity_and_split_content_tag_writes() {
        let repo = issue6_repository().await;
        let original = repo
            .get_learning_item_by_id(CARD_IDS[2])
            .await
            .unwrap()
            .unwrap();

        // 1. Identity signature: a queue-prefixed display ID (`flashcard-<id>`)
        //    cannot resolve the persisted row (`None` -> command NotFound -> S04 toast).
        let wrong_id = format!("flashcard-{}", CARD_IDS[2]);
        let missing = repo
            .update_learning_item_content(
                &wrong_id,
                "The {{c1::edited}} is hidden.",
                Some("Answer"),
                Some("The {{c1::edited}} is hidden."),
            )
            .await
            .unwrap();
        assert!(missing.is_none());

        // 2. Persistence / split-write signature: content update commits on its
        //    own transaction (preserving scheduling, memory, priority, lineage)
        //    before InlineCardEditor's separate tag write executes.
        let updated = repo
            .update_learning_item_content(
                CARD_IDS[2],
                "The {{c1::edited::hint}} is hidden.",
                Some("Answer"),
                Some("The {{c1::edited::hint}} is hidden."),
            )
            .await
            .unwrap()
            .expect("valid persisted id updates content");
        assert_eq!(updated.question, "The {{c1::edited::hint}} is hidden.");
        assert_eq!(
            updated.cloze_text.as_deref(),
            Some("The {{c1::edited::hint}} is hidden.")
        );
        assert_eq!(updated.due_date, original.due_date);
        assert_eq!(updated.last_review_date, original.last_review_date);
        assert_eq!(updated.review_count, original.review_count);
        assert_eq!(
            updated
                .memory_state
                .as_ref()
                .map(|m| (m.stability, m.difficulty)),
            original
                .memory_state
                .as_ref()
                .map(|m| (m.stability, m.difficulty)),
        );
        assert_eq!(updated.priority_slider, original.priority_slider);
        assert_eq!(updated.priority_score, original.priority_score);
        assert_eq!(
            updated.priority_explicitly_set,
            original.priority_explicitly_set
        );
        assert_eq!(updated.document_id, original.document_id);
        assert_eq!(updated.extract_id, original.extract_id);
        assert_eq!(updated.tags, original.tags);
    }

    #[tokio::test]
    async fn issue6_repro_s09_deleted_card_lookup_and_content_write_fail_not_found() {
        let repo = issue6_repository().await;
        // Simulate S10 durable delete while a stale Scroll/Optimal session copy
        // stays onscreen, followed by S09 lookup/action against the deleted ID.
        let deleted = sqlx::query("DELETE FROM learning_items WHERE id = ?1")
            .bind(CARD_IDS[2])
            .execute(repo.pool())
            .await
            .unwrap();
        assert_eq!(deleted.rows_affected(), 1);

        assert!(repo
            .get_learning_item_by_id(CARD_IDS[2])
            .await
            .unwrap()
            .is_none());
        assert!(repo
            .update_learning_item_content(CARD_IDS[2], "Stale edit", None, None)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn playlist_subscription_creation_seeds_global_defaults_and_preserves_overrides() {
        let repo = issue6_repository().await;

        // Set global settings defaults
        repo.update_playlist_settings(Some(true), Some(12), Some(8), Some(3), Some(false))
            .await
            .expect("update settings");

        let settings = repo.get_playlist_settings().await.expect("get settings");
        assert_eq!(settings.default_intersperse_interval, 12);
        assert_eq!(settings.default_priority, 8);
        assert_eq!(settings.max_consecutive_playlist_videos, 3);

        // Create new subscription
        repo.create_playlist_subscription(
            "sub-seeded",
            "pl-seeded",
            "https://example.invalid/seeded",
            Some("Seeded Playlist"),
            None,
            None,
            None,
            None,
            Some(0),
        )
        .await
        .expect("create subscription");

        let sub = repo
            .get_playlist_subscription("sub-seeded")
            .await
            .expect("fetch sub")
            .expect("sub exists");
        assert_eq!(sub.queue_intersperse_interval, 12);
        assert_eq!(sub.priority_rating, 8);

        // Update global defaults to new values
        repo.update_playlist_settings(Some(true), Some(20), Some(9), Some(4), Some(true))
            .await
            .expect("update settings 2");

        // Existing subscription is unchanged
        let sub_after = repo
            .get_playlist_subscription("sub-seeded")
            .await
            .expect("fetch sub")
            .expect("sub exists");
        assert_eq!(sub_after.queue_intersperse_interval, 12);
        assert_eq!(sub_after.priority_rating, 8);

        // Subscriptions can be updated independently within D9 numeric bounds
        repo.update_playlist_subscription(
            "sub-seeded",
            None,
            None,
            None,
            Some(7),
            Some(3),
            Some(48),
        )
        .await
        .expect("update subscription");
        let sub_updated = repo
            .get_playlist_subscription("sub-seeded")
            .await
            .expect("fetch sub")
            .expect("sub exists");
        assert_eq!(sub_updated.queue_intersperse_interval, 7);
        assert_eq!(sub_updated.priority_rating, 3);
        assert_eq!(sub_updated.refresh_interval_hours, 48);

        // Validation bounds reject out-of-range values
        assert!(repo
            .update_playlist_subscription("sub-seeded", None, None, None, Some(0), None, None)
            .await
            .is_err());
        assert!(repo
            .update_playlist_subscription("sub-seeded", None, None, None, Some(51), None, None)
            .await
            .is_err());
        assert!(repo
            .update_playlist_subscription("sub-seeded", None, None, None, None, Some(0), None)
            .await
            .is_err());
        assert!(repo
            .update_playlist_subscription("sub-seeded", None, None, None, None, Some(11), None)
            .await
            .is_err());
        assert!(repo
            .update_playlist_subscription("sub-seeded", None, None, None, None, None, Some(0))
            .await
            .is_err());
        assert!(repo
            .update_playlist_subscription("sub-seeded", None, None, None, None, None, Some(169))
            .await
            .is_err());

        assert!(repo
            .update_playlist_settings(None, Some(0), None, None, None)
            .await
            .is_err());
        assert!(repo
            .update_playlist_settings(None, Some(51), None, None, None)
            .await
            .is_err());
        assert!(repo
            .update_playlist_settings(None, None, Some(0), None, None)
            .await
            .is_err());
        assert!(repo
            .update_playlist_settings(None, None, Some(11), None, None)
            .await
            .is_err());
        assert!(repo
            .update_playlist_settings(None, None, None, Some(0), None)
            .await
            .is_err());
        assert!(repo
            .update_playlist_settings(None, None, None, Some(6), None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn playlist_interspersion_cadence_and_deterministic_collision_ordering() {
        let repo = issue6_repository().await;

        // Set global settings: enabled, interval defaults, max_consecutive = 1
        repo.update_playlist_settings(Some(true), Some(2), Some(5), Some(1), Some(false))
            .await
            .expect("update settings");

        // Create two subscriptions: Sub A (priority 8, interval 2) and Sub B (priority 4, interval 2)
        repo.create_playlist_subscription(
            "sub-a",
            "pl-a",
            "https://example.invalid/pl-a",
            Some("Playlist A"),
            None,
            None,
            None,
            None,
            Some(2),
        )
        .await
        .unwrap();
        repo.update_playlist_subscription("sub-a", None, None, None, Some(2), Some(8), None)
            .await
            .unwrap();

        repo.create_playlist_subscription(
            "sub-b",
            "pl-b",
            "https://example.invalid/pl-b",
            Some("Playlist B"),
            None,
            None,
            None,
            None,
            Some(2),
        )
        .await
        .unwrap();
        repo.update_playlist_subscription("sub-b", None, None, None, Some(2), Some(4), None)
            .await
            .unwrap();

        // Create documents for playlist videos
        let mut doc_a = Document::new(
            "Video A1".to_string(),
            "video://a1".to_string(),
            FileType::Markdown,
        );
        doc_a.id = "doc-video-a1".to_string();
        doc_a.content = Some("Video A1 body".to_string());
        doc_a.priority_rating = 8;
        doc_a.priority_slider = 78;
        doc_a.priority_score = 78.0;
        doc_a.priority_explicitly_set = false;
        repo.create_document(&doc_a).await.unwrap();

        let mut doc_b = Document::new(
            "Video B1".to_string(),
            "video://b1".to_string(),
            FileType::Markdown,
        );
        doc_b.id = "doc-video-b1".to_string();
        doc_b.content = Some("Video B1 body".to_string());
        doc_b.priority_rating = 4;
        doc_b.priority_slider = 33;
        doc_b.priority_score = 33.0;
        doc_b.priority_explicitly_set = false;
        repo.create_document(&doc_b).await.unwrap();

        // Add videos to subscriptions and link to documents
        repo.add_playlist_video(
            "pv-a1",
            "sub-a",
            "vid-a1",
            Some("Video A1"),
            Some(300),
            None,
            Some(1),
            None,
        )
        .await
        .unwrap();
        let mut vids_a = repo.get_playlist_videos("sub-a", false).await.unwrap();
        let vid_a1_id = vids_a.remove(0).id;
        repo.mark_video_imported(&vid_a1_id, "doc-video-a1")
            .await
            .unwrap();

        repo.add_playlist_video(
            "pv-b1",
            "sub-b",
            "vid-b1",
            Some("Video B1"),
            Some(300),
            None,
            Some(1),
            None,
        )
        .await
        .unwrap();
        let mut vids_b = repo.get_playlist_videos("sub-b", false).await.unwrap();
        let vid_b1_id = vids_b.remove(0).id;
        repo.mark_video_imported(&vid_b1_id, "doc-video-b1")
            .await
            .unwrap();

        // Run queue interspersion
        let queue = crate::commands::get_queue_with_playlist_intersperse_from_repo(&repo, None)
            .await
            .expect("intersperse queue");

        // The queue has base items (documents, extract, cards)
        // Verify that video from sub-a (higher priority rating: 8 vs 4) is interspersed before sub-b!
        let playlist_items: Vec<_> = queue
            .iter()
            .filter(|item| item.item_type == "playlist-video")
            .collect();

        assert_eq!(playlist_items.len(), 2);
        assert_eq!(playlist_items[0].document_id, "doc-video-a1");
        assert_eq!(playlist_items[1].document_id, "doc-video-b1");
    }
}
