//! Repository CRUD operations for podcast chapters, advertisement intervals, and settings.

use sqlx::Row;
use uuid::Uuid;

use super::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::{
    PodcastAdCorrection, PodcastAdInterval, PodcastAdSettings, PodcastChapter,
    PodcastProcessingJob,
};

impl Repository {
    /// Upsert an ordered set of podcast chapters for an episode atomically.
    pub async fn upsert_podcast_chapters(
        &self,
        episode_id: &str,
        chapters: &[PodcastChapter],
    ) -> Result<()> {
        let mut tx = self.pool().begin().await?;

        sqlx::query("DELETE FROM podcast_chapters WHERE episode_id = ?")
            .bind(episode_id)
            .execute(&mut *tx)
            .await?;

        for (idx, ch) in chapters.iter().enumerate() {
            let id = if ch.id.trim().is_empty() {
                Uuid::new_v4().to_string()
            } else {
                ch.id.clone()
            };

            sqlx::query(
                "INSERT INTO podcast_chapters (
                    id, episode_id, chapter_index, title, start_ms, end_ms,
                    image_url, link_url, source, is_advertisement
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(episode_id)
            .bind(ch.chapter_index.max(idx as i32))
            .bind(&ch.title)
            .bind(ch.start_ms)
            .bind(ch.end_ms)
            .bind(&ch.image_url)
            .bind(&ch.link_url)
            .bind(&ch.source)
            .bind(if ch.is_advertisement { 1 } else { 0 })
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Retrieve all stored chapters for an episode, ordered by chapter index and start time.
    pub async fn get_podcast_chapters(&self, episode_id: &str) -> Result<Vec<PodcastChapter>> {
        let rows = sqlx::query(
            "SELECT id, episode_id, chapter_index, title, start_ms, end_ms,
                    image_url, link_url, source, is_advertisement
             FROM podcast_chapters
             WHERE episode_id = ?
             ORDER BY chapter_index ASC, start_ms ASC",
        )
        .bind(episode_id)
        .fetch_all(self.pool())
        .await?;

        let mut chapters = Vec::with_capacity(rows.len());
        for row in rows {
            let is_ad: i64 = row.try_get("is_advertisement").unwrap_or(0);
            chapters.push(PodcastChapter {
                id: row.get("id"),
                episode_id: row.get("episode_id"),
                chapter_index: row.get("chapter_index"),
                title: row.get("title"),
                start_ms: row.get("start_ms"),
                end_ms: row.get("end_ms"),
                image_url: row.try_get("image_url").ok().flatten(),
                link_url: row.try_get("link_url").ok().flatten(),
                source: row.get("source"),
                is_advertisement: is_ad != 0,
            });
        }

        Ok(chapters)
    }

    /// Atomically replaces detected ad intervals for an episode while preserving manual user overrides.
    pub async fn upsert_ad_intervals(
        &self,
        episode_id: &str,
        intervals: &[PodcastAdInterval],
    ) -> Result<()> {
        let mut tx = self.pool().begin().await?;

        // Remove previous non-manual detected intervals
        sqlx::query(
            "DELETE FROM podcast_ad_intervals WHERE episode_id = ? AND origin != 'manual_user'",
        )
        .bind(episode_id)
        .execute(&mut *tx)
        .await?;

        for interval in intervals {
            let id = if interval.id.trim().is_empty() {
                Uuid::new_v4().to_string()
            } else {
                interval.id.clone()
            };

            sqlx::query(
                "INSERT OR REPLACE INTO podcast_ad_intervals (
                    id, episode_id, media_revision, start_ms, end_ms,
                    category, confidence, origin, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(episode_id)
            .bind(&interval.media_revision)
            .bind(interval.start_ms)
            .bind(interval.end_ms)
            .bind(&interval.category)
            .bind(interval.confidence)
            .bind(&interval.origin)
            .bind(&interval.metadata_json)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Retrieve all ad intervals for an episode, sorted chronologically.
    pub async fn get_ad_intervals(&self, episode_id: &str) -> Result<Vec<PodcastAdInterval>> {
        let rows = sqlx::query(
            "SELECT id, episode_id, media_revision, start_ms, end_ms,
                    category, confidence, origin, metadata_json
             FROM podcast_ad_intervals
             WHERE episode_id = ?
             ORDER BY start_ms ASC",
        )
        .bind(episode_id)
        .fetch_all(self.pool())
        .await?;

        let mut intervals = Vec::with_capacity(rows.len());
        for row in rows {
            intervals.push(PodcastAdInterval {
                id: row.get("id"),
                episode_id: row.get("episode_id"),
                media_revision: row.get("media_revision"),
                start_ms: row.get("start_ms"),
                end_ms: row.get("end_ms"),
                category: row.get("category"),
                confidence: row.get("confidence"),
                origin: row.get("origin"),
                metadata_json: row.try_get("metadata_json").ok().flatten(),
            });
        }

        Ok(intervals)
    }

    /// Save or replace a user-defined manual ad interval.
    pub async fn save_manual_ad_interval(
        &self,
        episode_id: &str,
        interval: &PodcastAdInterval,
    ) -> Result<()> {
        let id = if interval.id.trim().is_empty() {
            Uuid::new_v4().to_string()
        } else {
            interval.id.clone()
        };

        sqlx::query(
            "INSERT OR REPLACE INTO podcast_ad_intervals (
                id, episode_id, media_revision, start_ms, end_ms,
                category, confidence, origin, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual_user', ?)",
        )
        .bind(id)
        .bind(episode_id)
        .bind(&interval.media_revision)
        .bind(interval.start_ms)
        .bind(interval.end_ms)
        .bind(&interval.category)
        .bind(interval.confidence)
        .bind(&interval.metadata_json)
        .execute(self.pool())
        .await?;

        Ok(())
    }

    /// Delete a single ad interval by its ID.
    pub async fn delete_ad_interval(&self, interval_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM podcast_ad_intervals WHERE id = ?")
            .bind(interval_id)
            .execute(self.pool())
            .await?;

        Ok(())
    }

    /// Update the ad removal status and optional ad-free duration on an episode.
    pub async fn update_episode_ad_status(
        &self,
        episode_id: &str,
        status: &str,
    ) -> Result<()> {
        sqlx::query("UPDATE podcast_episodes SET ad_removal_status = ? WHERE id = ?")
            .bind(status)
            .bind(episode_id)
            .execute(self.pool())
            .await?;

        Ok(())
    }

    /// Update the chapters source recorded for an episode.
    pub async fn update_episode_chapters_source(
        &self,
        episode_id: &str,
        source: &str,
    ) -> Result<()> {
        sqlx::query("UPDATE podcast_episodes SET chapters_source = ? WHERE id = ?")
            .bind(source)
            .bind(episode_id)
            .execute(self.pool())
            .await?;

        Ok(())
    }

    /// Retrieve the podcast ad removal settings, returning defaults if not found.
    pub async fn get_podcast_ad_settings(&self) -> Result<PodcastAdSettings> {
        let row = sqlx::query(
            "SELECT id, auto_detect_ads, skip_external_ads, skip_cross_promo,
                    skip_self_promo, min_confidence, min_ad_duration_seconds,
                    mobile_charging_only, processing_mode
             FROM podcast_ad_settings
             WHERE id = 'default'
             LIMIT 1",
        )
        .fetch_optional(self.pool())
        .await?;

        if let Some(row) = row {
            let auto_detect: i64 = row.try_get("auto_detect_ads").unwrap_or(1);
            let skip_ext: i64 = row.try_get("skip_external_ads").unwrap_or(1);
            let skip_cross: i64 = row.try_get("skip_cross_promo").unwrap_or(1);
            let skip_self: i64 = row.try_get("skip_self_promo").unwrap_or(0);
            let mobile_charging: i64 = row.try_get("mobile_charging_only").unwrap_or(1);
            let min_conf: f32 = row.try_get("min_confidence").unwrap_or(0.85);
            let min_dur: i32 = row.try_get("min_ad_duration_seconds").unwrap_or(10);
            let mode: String = row
                .try_get("processing_mode")
                .unwrap_or_else(|_| "smart".to_string());

            Ok(PodcastAdSettings {
                id: row.get("id"),
                auto_detect_ads: auto_detect != 0,
                skip_external_ads: skip_ext != 0,
                skip_cross_promo: skip_cross != 0,
                skip_self_promo: skip_self != 0,
                min_confidence: min_conf,
                min_ad_duration_seconds: min_dur,
                mobile_charging_only: mobile_charging != 0,
                processing_mode: mode,
            })
        } else {
            Ok(PodcastAdSettings::default())
        }
    }

    /// Update the global podcast ad removal settings.
    pub async fn update_podcast_ad_settings(&self, settings: &PodcastAdSettings) -> Result<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO podcast_ad_settings (
                id, auto_detect_ads, skip_external_ads, skip_cross_promo,
                skip_self_promo, min_confidence, min_ad_duration_seconds,
                mobile_charging_only, processing_mode, updated_at
            ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(if settings.auto_detect_ads { 1 } else { 0 })
        .bind(if settings.skip_external_ads { 1 } else { 0 })
        .bind(if settings.skip_cross_promo { 1 } else { 0 })
        .bind(if settings.skip_self_promo { 1 } else { 0 })
        .bind(settings.min_confidence)
        .bind(settings.min_ad_duration_seconds)
        .bind(if settings.mobile_charging_only { 1 } else { 0 })
        .bind(&settings.processing_mode)
        .execute(self.pool())
        .await?;

        Ok(())
    }

    /// Record a user correction on an ad interval.
    pub async fn save_podcast_ad_correction(
        &self,
        correction: &PodcastAdCorrection,
    ) -> Result<()> {
        let id = if correction.id.trim().is_empty() {
            Uuid::new_v4().to_string()
        } else {
            correction.id.clone()
        };

        sqlx::query(
            "INSERT OR REPLACE INTO podcast_ad_corrections (
                id, episode_id, correction_type, start_ms, end_ms, user_note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(id)
        .bind(&correction.episode_id)
        .bind(&correction.correction_type)
        .bind(correction.start_ms)
        .bind(correction.end_ms)
        .bind(&correction.user_note)
        .execute(self.pool())
        .await?;

        Ok(())
    }

    /// Retrieve all user corrections for an episode.
    pub async fn get_podcast_ad_corrections(
        &self,
        episode_id: &str,
    ) -> Result<Vec<PodcastAdCorrection>> {
        let rows = sqlx::query(
            "SELECT id, episode_id, correction_type, start_ms, end_ms, user_note, created_at
             FROM podcast_ad_corrections
             WHERE episode_id = ?
             ORDER BY start_ms ASC",
        )
        .bind(episode_id)
        .fetch_all(self.pool())
        .await?;

        let mut corrections = Vec::with_capacity(rows.len());
        for row in rows {
            corrections.push(PodcastAdCorrection {
                id: row.get("id"),
                episode_id: row.get("episode_id"),
                correction_type: row.get("correction_type"),
                start_ms: row.get("start_ms"),
                end_ms: row.get("end_ms"),
                user_note: row.try_get("user_note").ok().flatten(),
                created_at: row.try_get("created_at").ok().flatten(),
            });
        }

        Ok(corrections)
    }

    /// Upsert podcast processing job state.
    pub async fn upsert_podcast_processing_job(&self, job: &PodcastProcessingJob) -> Result<()> {
        let id = if job.id.trim().is_empty() {
            Uuid::new_v4().to_string()
        } else {
            job.id.clone()
        };

        sqlx::query(
            "INSERT OR REPLACE INTO podcast_processing_jobs (
                id, episode_id, status, stage_progress, overall_progress,
                error_message, deferral_reason, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(id)
        .bind(&job.episode_id)
        .bind(&job.status)
        .bind(job.stage_progress)
        .bind(job.overall_progress)
        .bind(&job.error_message)
        .bind(&job.deferral_reason)
        .execute(self.pool())
        .await?;

        Ok(())
    }

    /// Fetch podcast processing job by episode ID.
    pub async fn get_podcast_processing_job(
        &self,
        episode_id: &str,
    ) -> Result<Option<PodcastProcessingJob>> {
        let row = sqlx::query(
            "SELECT id, episode_id, status, stage_progress, overall_progress,
                    error_message, deferral_reason, updated_at
             FROM podcast_processing_jobs
             WHERE episode_id = ?
             LIMIT 1",
        )
        .bind(episode_id)
        .fetch_optional(self.pool())
        .await?;

        if let Some(row) = row {
            Ok(Some(PodcastProcessingJob {
                id: row.get("id"),
                episode_id: row.get("episode_id"),
                status: row.get("status"),
                stage_progress: row.get("stage_progress"),
                overall_progress: row.get("overall_progress"),
                error_message: row.try_get("error_message").ok().flatten(),
                deferral_reason: row.try_get("deferral_reason").ok().flatten(),
                updated_at: row.get("updated_at"),
            }))
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use std::path::PathBuf;

    async fn create_test_db() -> (Database, String, String) {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("test db");
        db.migrate().await.expect("migrate");

        let feed_id = "feed-1";
        let episode_id = "ep-1";

        sqlx::query(
            "INSERT INTO podcast_feeds (id, title, feed_url, subscribed_at)
             VALUES (?, 'Test Podcast', 'https://example.com/feed.xml', '2026-01-01')",
        )
        .bind(feed_id)
        .execute(db.pool())
        .await
        .expect("insert feed");

        sqlx::query(
            "INSERT INTO podcast_episodes (id, feed_id, title, audio_url, played)
             VALUES (?, ?, 'Episode 1', 'https://example.com/ep1.mp3', 0)",
        )
        .bind(episode_id)
        .bind(feed_id)
        .execute(db.pool())
        .await
        .expect("insert episode");

        (db, feed_id.to_string(), episode_id.to_string())
    }

    #[tokio::test]
    async fn test_podcast_chapters_crud() {
        let (db, _, ep_id) = create_test_db().await;
        let repo = Repository::new(db.pool().clone());

        let chapters = vec![
            PodcastChapter {
                id: "chap-1".to_string(),
                episode_id: ep_id.clone(),
                chapter_index: 0,
                title: "Introduction".to_string(),
                start_ms: 0,
                end_ms: 60_000,
                image_url: None,
                link_url: None,
                source: "podcast20_json".to_string(),
                is_advertisement: false,
            },
            PodcastChapter {
                id: "chap-2".to_string(),
                episode_id: ep_id.clone(),
                chapter_index: 1,
                title: "Midroll Sponsor".to_string(),
                start_ms: 60_000,
                end_ms: 120_000,
                image_url: Some("https://example.com/ad.png".to_string()),
                link_url: Some("https://sponsor.com".to_string()),
                source: "podcast20_json".to_string(),
                is_advertisement: true,
            },
        ];

        repo.upsert_podcast_chapters(&ep_id, &chapters).await.expect("upsert chapters");
        let fetched = repo.get_podcast_chapters(&ep_id).await.expect("get chapters");

        assert_eq!(fetched.len(), 2);
        assert_eq!(fetched[0].title, "Introduction");
        assert_eq!(fetched[1].title, "Midroll Sponsor");
        assert!(fetched[1].is_advertisement);
    }

    #[tokio::test]
    async fn test_podcast_ad_intervals_crud() {
        let (db, _, ep_id) = create_test_db().await;
        let repo = Repository::new(db.pool().clone());

        let intervals = vec![
            PodcastAdInterval {
                id: "ad-1".to_string(),
                episode_id: ep_id.clone(),
                media_revision: "rev1".to_string(),
                start_ms: 10_000,
                end_ms: 40_000,
                category: "external_ad".to_string(),
                confidence: 0.9,
                origin: "classifier_llm".to_string(),
                metadata_json: None,
            },
        ];

        repo.upsert_ad_intervals(&ep_id, &intervals).await.expect("upsert intervals");
        let fetched = repo.get_ad_intervals(&ep_id).await.expect("get intervals");
        assert_eq!(fetched.len(), 1);
        assert_eq!(fetched[0].id, "ad-1");

        // Save manual user override
        let manual = PodcastAdInterval {
            id: "manual-1".to_string(),
            episode_id: ep_id.clone(),
            media_revision: "rev1".to_string(),
            start_ms: 70_000,
            end_ms: 100_000,
            category: "host_self_promo".to_string(),
            confidence: 1.0,
            origin: "manual_user".to_string(),
            metadata_json: None,
        };
        repo.save_manual_ad_interval(&ep_id, &manual).await.expect("save manual");

        // Re-upserting detected intervals must preserve manual overrides
        let new_detected = vec![
            PodcastAdInterval {
                id: "ad-2".to_string(),
                episode_id: ep_id.clone(),
                media_revision: "rev1".to_string(),
                start_ms: 15_000,
                end_ms: 45_000,
                category: "external_ad".to_string(),
                confidence: 0.95,
                origin: "classifier_llm".to_string(),
                metadata_json: None,
            },
        ];
        repo.upsert_ad_intervals(&ep_id, &new_detected).await.expect("re-upsert");
        let all = repo.get_ad_intervals(&ep_id).await.expect("get all intervals");
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|i| i.id == "ad-2"));
        assert!(all.iter().any(|i| i.id == "manual-1"));

        // Delete interval
        repo.delete_ad_interval("ad-2").await.expect("delete interval");
        let after_delete = repo.get_ad_intervals(&ep_id).await.expect("get after delete");
        assert_eq!(after_delete.len(), 1);
        assert_eq!(after_delete[0].id, "manual-1");
    }

    #[tokio::test]
    async fn test_podcast_ad_settings_and_status() {
        let (db, _, ep_id) = create_test_db().await;
        let repo = Repository::new(db.pool().clone());

        let settings = repo.get_podcast_ad_settings().await.expect("get default settings");
        assert!(settings.auto_detect_ads);

        let mut custom = settings.clone();
        custom.skip_self_promo = true;
        custom.min_ad_duration_seconds = 15;
        custom.processing_mode = "battery_saver".to_string();

        repo.update_podcast_ad_settings(&custom).await.expect("update settings");
        let loaded = repo.get_podcast_ad_settings().await.expect("get updated settings");
        assert!(loaded.skip_self_promo);
        assert_eq!(loaded.min_ad_duration_seconds, 15);
        assert_eq!(loaded.processing_mode, "battery_saver");

        // Status update
        repo.update_episode_ad_status(&ep_id, "ready").await.expect("update status");
        let (status,): (String,) = sqlx::query_as("SELECT ad_removal_status FROM podcast_episodes WHERE id = ?")
            .bind(&ep_id)
            .fetch_one(db.pool())
            .await
            .expect("check status");
        assert_eq!(status, "ready");
    }
}
