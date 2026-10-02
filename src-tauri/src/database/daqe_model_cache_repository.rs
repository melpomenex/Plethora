//! Cache for decision-model judgements (`daqe_model_cache`, migration 117).
//!
//! The cache exists because the decision model is far more expensive than the
//! ranker that consumes it. A judgement that depends only on an item's *content*
//! is keyed by a hash of that content plus the rubric version, so:
//!
//! - a repeat evaluation costs one indexed read instead of an inference,
//! - editing an item produces a different hash, so staleness is implicit and no
//!   sweep job can forget to run,
//! - bumping the rubric version invalidates every entry without touching content.
//!
//! Judgements that depend on session state — alignment to the current goal,
//! fatigue-adjusted relevance — are deliberately **not** cached: they are wrong
//! the moment the session changes, and a cache hit for them would be a bug
//! wearing a performance optimisation's clothes.

use sqlx::{Pool, Sqlite};

use crate::error::Result;
use crate::models::daqe::DecisionModelTier;

/// One row of `daqe_model_cache`, as read back. Named because the tuple is long
/// enough that an inline type would hide which column is which.
type CacheRow = (Option<f64>, Option<String>, Option<bool>, String);

/// One cached judgement.
#[derive(Debug, Clone, PartialEq)]
pub struct CachedDecision {
    pub score: Option<f64>,
    pub tier: Option<DecisionModelTier>,
    pub gate: Option<bool>,
    pub computed_at: String,
}

/// Storage for [`CachedDecision`]s.
#[derive(Debug, Clone)]
pub struct DaqeModelCacheRepository {
    pool: Pool<Sqlite>,
}

impl DaqeModelCacheRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    /// The cache key: a hash of the item's content plus the rubric version.
    ///
    /// The version is part of the key rather than a WHERE clause so two rubric
    /// versions can coexist — a user mid-ranking-pass never sees a half-swapped
    /// cache.
    pub fn key(content_hash: &str, rubric_version: i32) -> String {
        format!("{content_hash}:{rubric_version}")
    }

    /// A cache hit, or `None`.
    ///
    /// `None` is the normal cold-start answer and is never an error: the ranker
    /// treats a miss as "issue the inference", and a read failure as "use the
    /// local fallback". Neither reaches the queue.
    pub async fn get(
        &self,
        content_hash: &str,
        rubric_version: i32,
    ) -> Result<Option<CachedDecision>> {
        let row: Option<CacheRow> = sqlx::query_as(
            "SELECT score, tier, gate, computed_at FROM daqe_model_cache WHERE content_hash = ?",
        )
        .bind(Self::key(content_hash, rubric_version))
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|(score, tier, gate, computed_at)| CachedDecision {
            score,
            // An unrecognised tier string reads as absent rather than as a guess:
            // the cache was written by an older build, or the row was edited.
            tier: tier.as_deref().and_then(DecisionModelTier::from_str),
            gate,
            computed_at,
        }))
    }

    /// Write (or overwrite) a judgement. `INSERT OR REPLACE` because the key is
    /// the cache identity and a re-evaluation of the same content supersedes.
    pub async fn put(
        &self,
        content_hash: &str,
        rubric_version: i32,
        score: Option<f64>,
        tier: Option<DecisionModelTier>,
        gate: Option<bool>,
    ) -> Result<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO daqe_model_cache
                (content_hash, rubric_version, score, tier, gate, computed_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(Self::key(content_hash, rubric_version))
        .bind(rubric_version)
        .bind(score)
        .bind(tier.map(|t| t.as_str()))
        .bind(gate.map(|g| i32::from(g)))
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Drop entries for one content hash across every rubric version.
    ///
    /// Called when an item's content is edited or deleted. With content-hash
    /// keying this is a courtesy cleanup, not a correctness requirement — the
    /// new content simply produces a different key — but it stops the table
    /// growing without bound as documents are edited.
    pub async fn invalidate(&self, content_hash: &str) -> Result<u64> {
        let result = sqlx::query("DELETE FROM daqe_model_cache WHERE content_hash LIKE ?")
            .bind(format!("{content_hash}:%"))
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// Drop entries older than `days`, so an abandoned rubric version does not
    /// linger forever.
    pub async fn prune_older_than(&self, days: i64) -> Result<u64> {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(days.max(0));
        let result = sqlx::query("DELETE FROM daqe_model_cache WHERE computed_at < ?")
            .bind(cutoff.to_rfc3339())
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// How many entries are held. Reported in the settings UI so a user can see
    /// the cache is doing something.
    pub async fn count(&self) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM daqe_model_cache")
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }
}

/// A hash of the parts of an item the decision model actually sees.
///
/// Only the structural outline and the length are hashed — never the body. That
/// keeps the hash stable when a document's prose is reflowed by a theme change
/// while still changing when its *structure* does, which is what the model reads.
pub fn content_hash_for(item_type: &str, outline: &[String], length_chars: usize) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a offset basis
    let mut absorb = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x1000_0000_01b3);
        }
    };
    absorb(item_type.as_bytes());
    absorb(b"\x1f");
    absorb(length_chars.to_string().as_bytes());
    for heading in outline {
        absorb(b"\x1e");
        absorb(heading.trim().to_lowercase().as_bytes());
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn migrated_pool() -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory database");
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS _schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("migrations table");
        crate::database::migrations::run_migrations(&pool)
            .await
            .expect("migrate");
        pool
    }

    fn outline() -> Vec<String> {
        vec![
            "1 Introduction".to_string(),
            "2 Model Architecture".to_string(),
        ]
    }

    #[tokio::test]
    async fn a_miss_is_none_and_not_an_error() {
        let repo = DaqeModelCacheRepository::new(migrated_pool().await);
        assert_eq!(repo.get("nothing-here", 1).await.expect("read"), None);
    }

    #[tokio::test]
    async fn a_written_judgement_round_trips() {
        let repo = DaqeModelCacheRepository::new(migrated_pool().await);
        repo.put(
            "hash-1",
            1,
            Some(0.75),
            Some(DecisionModelTier::DeepFoundational),
            Some(true),
        )
        .await
        .expect("write");

        let cached = repo.get("hash-1", 1).await.expect("read").expect("hit");
        assert_eq!(cached.score, Some(0.75));
        assert_eq!(cached.tier, Some(DecisionModelTier::DeepFoundational));
        assert_eq!(cached.gate, Some(true));
    }

    #[tokio::test]
    async fn a_second_rubric_version_is_a_different_key() {
        let pool = migrated_pool().await;
        let repo = DaqeModelCacheRepository::new(pool.clone());
        repo.put("hash-1", 1, Some(0.5), None, None).await.expect("v1");
        repo.put("hash-1", 2, Some(0.9), None, None).await.expect("v2");

        assert_eq!(repo.get("hash-1", 1).await.expect("read").expect("hit").score, Some(0.5));
        assert_eq!(repo.get("hash-1", 2).await.expect("read").expect("hit").score, Some(0.9));
        // Both coexist, so a ranking pass mid-rubric-change never sees a half
        // swapped cache.
        assert_eq!(repo.count().await.expect("count"), 2);
    }

    #[tokio::test]
    async fn writing_the_same_key_supersedes_rather_than_accumulating() {
        let repo = DaqeModelCacheRepository::new(migrated_pool().await);
        repo.put("hash-1", 1, Some(0.2), None, None).await.expect("first");
        repo.put("hash-1", 1, Some(0.8), None, None).await.expect("second");
        assert_eq!(repo.count().await.expect("count"), 1);
        assert_eq!(
            repo.get("hash-1", 1).await.expect("read").expect("hit").score,
            Some(0.8)
        );
    }

    #[tokio::test]
    async fn an_unrecognised_tier_reads_as_absent_rather_than_a_guess() {
        let repo = DaqeModelCacheRepository::new(migrated_pool().await);
        sqlx::query(
            "INSERT INTO daqe_model_cache (content_hash, rubric_version, score, tier, gate, computed_at)
             VALUES ('hash-1:1', 1, 0.5, 'tier-from-a-removed-build', 1, '2026-01-01T00:00:00Z')",
        )
        .execute(&repo.pool)
        .await
        .expect("seed row");

        let cached = repo.get("hash-1", 1).await.expect("read").expect("hit");
        assert_eq!(cached.tier, None);
        assert_eq!(cached.score, Some(0.5), "the usable parts still read");
    }

    #[tokio::test]
    async fn invalidation_removes_every_rubric_version_for_one_content_hash() {
        let pool = migrated_pool().await;
        let repo = DaqeModelCacheRepository::new(pool.clone());
        repo.put("hash-1", 1, Some(0.5), None, None).await.expect("v1");
        repo.put("hash-1", 2, Some(0.5), None, None).await.expect("v2");
        repo.put("hash-2", 1, Some(0.5), None, None).await.expect("other");

        assert_eq!(repo.invalidate("hash-1").await.expect("invalidate"), 2);
        assert!(repo.get("hash-1", 1).await.expect("read").is_none());
        assert!(repo.get("hash-1", 2).await.expect("read").is_none());
        assert!(repo.get("hash-2", 1).await.expect("read").is_some(), "unrelated survives");
    }

    #[tokio::test]
    async fn pruning_leaves_recent_entries_alone() {
        let pool = migrated_pool().await;
        let repo = DaqeModelCacheRepository::new(pool.clone());
        repo.put("fresh", 1, Some(0.5), None, None).await.expect("fresh");
        sqlx::query(
            "INSERT INTO daqe_model_cache (content_hash, rubric_version, score, computed_at)
             VALUES ('ancient:1', 1, 0.5, '2020-01-01T00:00:00Z')",
        )
        .execute(&repo.pool)
        .await
        .expect("seed old");

        assert_eq!(repo.prune_older_than(30).await.expect("prune"), 1);
        assert!(repo.get("fresh", 1).await.expect("read").is_some());
        assert!(repo.get("ancient", 1).await.expect("read").is_none());
    }

    #[test]
    fn the_content_hash_changes_with_structure_but_not_with_whitespace() {
        let a = content_hash_for("document", &outline(), 1000);
        let b = content_hash_for("document", &outline(), 1000);
        assert_eq!(a, b, "same structure hashes the same");

        let reordered = content_hash_for(
            "document",
            &["2 Model Architecture".to_string(), "1 Introduction".to_string()],
            1000,
        );
        assert_ne!(a, reordered, "reordering headings is a structural change");

        let cased = content_hash_for(
            "document",
            &["1 introduction".to_string(), "2 model architecture".to_string()],
            1000,
        );
        assert_eq!(a, cased, "heading case is not a structural change");

        assert_ne!(a, content_hash_for("document", &outline(), 1001), "length matters");
        assert_ne!(a, content_hash_for("extract", &outline(), 1000), "type matters");
        assert_ne!(
            a,
            content_hash_for("document", &outline().into_iter().chain(["3 Results".to_string()]).collect::<Vec<_>>(), 1000),
            "adding a heading matters"
        );
    }

    #[test]
    fn the_content_hash_reads_no_body_text() {
        // The function's signature is the guarantee: there is no body parameter to
        // pass, so prose cannot reach the key and the cache cannot be poisoned by
        // content the model never saw.
        assert!(content_hash_for("document", &[], 0).len() == 16);
    }
}