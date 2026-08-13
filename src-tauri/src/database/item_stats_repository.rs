//! Per-item statistics read path.
//!
//! Two entry points with deliberately different costs:
//!
//! * [`ItemStatsRepository::summary`] — the ≤6 values the Details popover
//!   shows. Indexed lookups on the item row plus two aggregates, so opening
//!   the popover stays as fast as it is today.
//! * [`ItemStatsRepository::detail`] — everything else, including the event
//!   timeline and the rank query. Runs only when the full modal opens.
//!
//! Events come from three places and leave here in one shape: documents union
//! `item_activity_log` with `reading_sessions`, extracts read
//! `item_activity_log`, and flashcards read `review_results` in place — that
//! table is already the synced revlog and copying it would fork the truth.

use crate::database::item_activity_repository::parse_stored_timestamp;
use crate::error::{IncrementumError, Result};
use crate::models::item_stats::{
    median_seconds, retention_curve, IntervalPoint, ItemContentStats, ItemHistoryStats,
    ItemScheduleStats, ItemStatsDetail, ItemStatsEvent, ItemStatsSummary, ItemTimeStats, Metric,
    RatingDistribution, StatsItemType, TimeInvestedRank,
};
use chrono::Utc;
use sqlx::{Pool, Row, Sqlite};

/// Days of forgetting curve to project for a single item.
const RETENTION_HORIZON_DAYS: i64 = 60;

/// Words per minute used to turn a document's length into an expected reading
/// time. Matches the mid-range adult silent-reading rate the rest of the app
/// assumes for its estimates.
const READING_WORDS_PER_MINUTE: f64 = 200.0;

#[derive(Clone)]
pub struct ItemStatsRepository {
    pool: Pool<Sqlite>,
}

impl ItemStatsRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    // ---------------------------------------------------------------- summary

    /// The popover payload. Indexed lookups only.
    pub async fn summary(
        &self,
        item_type: StatsItemType,
        item_id: &str,
    ) -> Result<ItemStatsSummary> {
        // RSS articles have no persisted per-item record in this change; every
        // metric is "does not apply" rather than a fabricated zero.
        if item_type == StatsItemType::Rss {
            return Ok(ItemStatsSummary {
                item_type,
                item_id: item_id.to_string(),
                total_active_seconds: Metric::NotApplicable,
                repetitions: Metric::NotApplicable,
                average_seconds_per_repetition: Metric::NotApplicable,
                first_interaction_at: Metric::NotApplicable,
                last_interaction_at: Metric::NotApplicable,
            });
        }

        let (total_seconds, repetitions) = self.totals(item_type, item_id).await?;
        let (first_at, last_at) = self.interaction_bounds(item_type, item_id).await?;

        // The average is only meaningful when both halves are real. A total
        // with no repetitions (a document read but never rated) has no
        // per-repetition figure to report.
        let average = match (total_seconds, repetitions) {
            (Some(total), Some(reps)) if reps > 0 => Metric::value(total / reps),
            _ => Metric::Untracked,
        };

        Ok(ItemStatsSummary {
            item_type,
            item_id: item_id.to_string(),
            total_active_seconds: Metric::tracked(total_seconds),
            repetitions: Metric::tracked(repetitions),
            average_seconds_per_repetition: average,
            first_interaction_at: Metric::tracked(first_at),
            last_interaction_at: Metric::tracked(last_at),
        })
    }

    /// Cumulative active seconds and repetition/session count.
    ///
    /// Documents and extracts read their denormalised column; flashcards sum
    /// `review_results`, which is where their time has always lived. `None`
    /// means never recorded, which the UI renders as "not recorded".
    async fn totals(
        &self,
        item_type: StatsItemType,
        item_id: &str,
    ) -> Result<(Option<i64>, Option<i64>)> {
        match item_type {
            StatsItemType::Document => {
                let row: Option<(Option<i64>, Option<i64>, i64)> = sqlx::query_as(
                    "SELECT total_time_spent, reps, reading_count FROM documents WHERE id = ?1",
                )
                .bind(item_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_err("document totals"))?;

                let Some((total, reps, reading_count)) = row else {
                    return Ok((None, None));
                };

                // Reader sessions count as interactions too, so a document
                // read but never rated still reports a session count.
                let (sessions,): (i64,) = sqlx::query_as(
                    "SELECT COUNT(*) FROM reading_sessions WHERE document_id = ?1 AND ended_at IS NOT NULL",
                )
                .bind(item_id)
                .fetch_one(&self.pool)
                .await
                .map_err(map_err("reading session count"))?;

                let repetitions = reps.unwrap_or(reading_count) + sessions;
                let repetitions = if repetitions > 0 {
                    Some(repetitions)
                } else {
                    None
                };
                Ok((total, repetitions))
            }
            StatsItemType::Extract => {
                let row: Option<(Option<i64>, i64)> = sqlx::query_as(
                    "SELECT total_time_spent, reps FROM extracts WHERE id = ?1",
                )
                .bind(item_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_err("extract totals"))?;

                let Some((total, reps)) = row else {
                    return Ok((None, None));
                };
                Ok((total, if reps > 0 { Some(reps) } else { None }))
            }
            StatsItemType::LearningItem => {
                let row: Option<(Option<i64>, i64)> = sqlx::query_as(
                    "SELECT SUM(time_taken), COUNT(*) FROM review_results WHERE item_id = ?1",
                )
                .bind(item_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_err("flashcard totals"))?;

                let Some((total, count)) = row else {
                    return Ok((None, None));
                };
                Ok((total, if count > 0 { Some(count) } else { None }))
            }
            StatsItemType::Rss => Ok((None, None)),
        }
    }

    /// First and last recorded interaction, as RFC3339 strings.
    async fn interaction_bounds(
        &self,
        item_type: StatsItemType,
        item_id: &str,
    ) -> Result<(Option<String>, Option<String>)> {
        let sql = match item_type {
            StatsItemType::Document => {
                "SELECT MIN(at), MAX(at) FROM (
                     SELECT started_at AS at FROM item_activity_log
                     WHERE item_type = 'document' AND item_id = ?1
                     UNION ALL
                     SELECT started_at AS at FROM reading_sessions WHERE document_id = ?1
                 )"
            }
            StatsItemType::Extract => {
                "SELECT MIN(started_at), MAX(started_at) FROM item_activity_log
                 WHERE item_type = 'extract' AND item_id = ?1"
            }
            StatsItemType::LearningItem => {
                "SELECT MIN(timestamp), MAX(timestamp) FROM review_results WHERE item_id = ?1"
            }
            StatsItemType::Rss => return Ok((None, None)),
        };

        let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(sql)
            .bind(item_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_err("interaction bounds"))?;

        Ok(row.map(|(first, last)| (first, last)).unwrap_or((None, None)))
    }

    // --------------------------------------------------------------- timeline

    /// The item's interactions in one shape, oldest first.
    ///
    /// Documents interleave their two sources here — a queue rating and a
    /// reader session land in the same ordered list, so the UI never sees the
    /// split.
    pub async fn timeline(
        &self,
        item_type: StatsItemType,
        item_id: &str,
    ) -> Result<Vec<ItemStatsEvent>> {
        let mut events: Vec<ItemStatsEvent> = Vec::new();

        match item_type {
            StatsItemType::Document | StatsItemType::Extract => {
                let stored_type = if item_type == StatsItemType::Document {
                    "document"
                } else {
                    "extract"
                };

                let rows = sqlx::query(
                    "SELECT surface, started_at, ended_at, active_seconds, rating,
                            resulting_interval_days, progress_start, progress_end
                     FROM item_activity_log
                     WHERE item_type = ?1 AND item_id = ?2",
                )
                .bind(stored_type)
                .bind(item_id)
                .fetch_all(&self.pool)
                .await
                .map_err(map_err("activity timeline"))?;

                for row in rows {
                    let started_at: String = row.try_get("started_at").unwrap_or_default();
                    let ended_at: Option<String> = row.try_get("ended_at").ok().flatten();
                    let progress_start: Option<f64> = row.try_get("progress_start").ok().flatten();
                    let progress_end: Option<f64> = row.try_get("progress_end").ok().flatten();

                    events.push(ItemStatsEvent {
                        at: ended_at.unwrap_or(started_at),
                        active_seconds: row.try_get::<i64, _>("active_seconds").ok(),
                        surface: row
                            .try_get::<String, _>("surface")
                            .unwrap_or_else(|_| "queue".to_string()),
                        rating: row.try_get::<Option<i32>, _>("rating").ok().flatten(),
                        resulting_interval_days: row
                            .try_get::<Option<f64>, _>("resulting_interval_days")
                            .ok()
                            .flatten(),
                        progress_delta: match (progress_start, progress_end) {
                            (Some(start), Some(end)) => Some(end - start),
                            _ => None,
                        },
                    });
                }

                if item_type == StatsItemType::Document {
                    let rows = sqlx::query(
                        "SELECT started_at, ended_at, duration_seconds, progress_start, progress_end
                         FROM reading_sessions
                         WHERE document_id = ?1 AND ended_at IS NOT NULL",
                    )
                    .bind(item_id)
                    .fetch_all(&self.pool)
                    .await
                    .map_err(map_err("reading session timeline"))?;

                    for row in rows {
                        let started_at: String = row.try_get("started_at").unwrap_or_default();
                        let ended_at: Option<String> = row.try_get("ended_at").ok().flatten();
                        let progress_start: Option<f64> =
                            row.try_get("progress_start").ok().flatten();
                        let progress_end: Option<f64> = row.try_get("progress_end").ok().flatten();

                        events.push(ItemStatsEvent {
                            at: ended_at.unwrap_or(started_at),
                            active_seconds: row.try_get::<i64, _>("duration_seconds").ok(),
                            surface: "reader".to_string(),
                            rating: None,
                            resulting_interval_days: None,
                            progress_delta: match (progress_start, progress_end) {
                                (Some(start), Some(end)) => Some(end - start),
                                _ => None,
                            },
                        });
                    }
                }
            }
            StatsItemType::LearningItem => {
                // Read in place from the revlog — never copied into
                // item_activity_log, so a card's history has exactly one row
                // per review and cannot be double-counted.
                let rows = sqlx::query(
                    "SELECT timestamp, time_taken, rating, new_interval
                     FROM review_results WHERE item_id = ?1",
                )
                .bind(item_id)
                .fetch_all(&self.pool)
                .await
                .map_err(map_err("review timeline"))?;

                for row in rows {
                    events.push(ItemStatsEvent {
                        at: row.try_get::<String, _>("timestamp").unwrap_or_default(),
                        active_seconds: row.try_get::<i64, _>("time_taken").ok(),
                        surface: "review".to_string(),
                        rating: row.try_get::<i32, _>("rating").ok(),
                        resulting_interval_days: row
                            .try_get::<i64, _>("new_interval")
                            .ok()
                            .map(|days| days as f64),
                        progress_delta: None,
                    });
                }
            }
            StatsItemType::Rss => {}
        }

        // Sort on parsed timestamps rather than the raw strings: the two
        // sources store slightly different textual forms, so lexical order
        // would interleave them wrongly.
        events.sort_by_key(|event| {
            parse_stored_timestamp(&event.at).unwrap_or_else(|| chrono::DateTime::UNIX_EPOCH)
        });

        Ok(events)
    }

    // ----------------------------------------------------------------- detail

    /// Everything the full modal needs, in one round trip.
    pub async fn detail(
        &self,
        item_type: StatsItemType,
        item_id: &str,
        leech_threshold: i32,
    ) -> Result<ItemStatsDetail> {
        let summary = self.summary(item_type, item_id).await?;
        let events = self.timeline(item_type, item_id).await?;

        let time = self.time_stats(item_type, item_id, &summary, &events).await?;
        let schedule = self.schedule_stats(item_type, item_id, &events).await?;
        let history = self.history_stats(item_type, item_id, events, leech_threshold).await?;
        let content = self.content_stats(item_type, item_id).await?;
        let rank = self.rank_by_time_invested(item_type, item_id).await?;

        Ok(ItemStatsDetail {
            summary,
            time,
            schedule,
            history,
            content,
            rank_by_time_invested: rank,
        })
    }

    async fn time_stats(
        &self,
        item_type: StatsItemType,
        item_id: &str,
        summary: &ItemStatsSummary,
        events: &[ItemStatsEvent],
    ) -> Result<Option<ItemTimeStats>> {
        if item_type == StatsItemType::Rss {
            return Ok(None);
        }

        let mut queue_seconds = 0i64;
        let mut reader_seconds = 0i64;
        let mut durations: Vec<i64> = Vec::new();

        for event in events {
            let seconds = event.active_seconds.unwrap_or(0);
            match event.surface.as_str() {
                "reader" => reader_seconds += seconds,
                _ => queue_seconds += seconds,
            }
            if seconds > 0 {
                durations.push(seconds);
            }
        }

        // With no events at all, a split is not "0 / 0" — it is unknown. The
        // item's pre-existing total came from before this history existed.
        let has_events = !events.is_empty();
        let split = |value: i64| {
            if has_events {
                Metric::value(value)
            } else {
                Metric::Untracked
            }
        };

        let estimated_reading_seconds = match item_type {
            StatsItemType::Document => {
                Metric::tracked(self.estimated_reading_seconds(item_id).await?)
            }
            _ => Metric::NotApplicable,
        };

        Ok(Some(ItemTimeStats {
            total_active_seconds: summary.total_active_seconds.clone(),
            queue_seconds: split(queue_seconds),
            reader_seconds: if item_type == StatsItemType::Document {
                split(reader_seconds)
            } else {
                Metric::NotApplicable
            },
            session_count: split(events.len() as i64),
            longest_session_seconds: Metric::tracked(durations.iter().copied().max()),
            average_session_seconds: Metric::tracked(if durations.is_empty() {
                None
            } else {
                Some(durations.iter().sum::<i64>() / durations.len() as i64)
            }),
            median_session_seconds: Metric::tracked(median_seconds(&durations)),
            estimated_reading_seconds,
        }))
    }

    /// What the document's length suggests it should take to read.
    async fn estimated_reading_seconds(&self, document_id: &str) -> Result<Option<i64>> {
        let row: Option<(Option<String>, Option<i64>)> =
            sqlx::query_as("SELECT content, total_pages FROM documents WHERE id = ?1")
                .bind(document_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_err("document content"))?;

        let Some((content, _total_pages)) = row else {
            return Ok(None);
        };

        let words = content
            .as_ref()
            .map(|text| text.split_whitespace().count())
            .filter(|count| *count > 0);

        Ok(words.map(|words| ((words as f64 / READING_WORDS_PER_MINUTE) * 60.0).round() as i64))
    }

    async fn schedule_stats(
        &self,
        item_type: StatsItemType,
        item_id: &str,
        events: &[ItemStatsEvent],
    ) -> Result<Option<ItemScheduleStats>> {
        // RSS articles have no scheduling state at all — the section is
        // omitted rather than rendered with empty values.
        if item_type == StatsItemType::Rss {
            return Ok(None);
        }

        let interval_history: Vec<IntervalPoint> = events
            .iter()
            .filter_map(|event| event.resulting_interval_days)
            .enumerate()
            .map(|(index, interval_days)| IntervalPoint {
                repetition: index as i64 + 1,
                interval_days,
            })
            .collect();

        let (stability, difficulty, due_date, interval_modifier, current_interval) = match item_type
        {
            StatsItemType::Document => {
                let row: Option<(Option<f64>, Option<f64>, Option<String>, Option<f64>)> =
                    sqlx::query_as(
                        "SELECT stability, difficulty, next_reading_date, interval_modifier
                         FROM documents WHERE id = ?1",
                    )
                    .bind(item_id)
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(map_err("document schedule"))?;

                let Some((stability, difficulty, due, modifier)) = row else {
                    return Ok(None);
                };
                (stability, difficulty, due, modifier, stability)
            }
            StatsItemType::Extract => {
                let row: Option<(Option<f64>, Option<f64>, Option<String>)> = sqlx::query_as(
                    "SELECT memory_state_stability, memory_state_difficulty, next_review_date
                     FROM extracts WHERE id = ?1",
                )
                .bind(item_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_err("extract schedule"))?;

                let Some((stability, difficulty, due)) = row else {
                    return Ok(None);
                };
                (stability, difficulty, due, None, stability)
            }
            StatsItemType::LearningItem => {
                let row: Option<(Option<f64>, Option<f64>, String, f64)> = sqlx::query_as(
                    "SELECT memory_state_stability, memory_state_difficulty, due_date, interval
                     FROM learning_items WHERE id = ?1",
                )
                .bind(item_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_err("learning item schedule"))?;

                let Some((stability, difficulty, due, interval)) = row else {
                    return Ok(None);
                };
                (stability, difficulty, Some(due), None, Some(interval))
            }
            StatsItemType::Rss => unreachable!("handled above"),
        };

        let retrievability = retrievability_now(stability, due_date.as_deref(), current_interval);

        Ok(Some(ItemScheduleStats {
            stability: Metric::tracked(stability),
            difficulty: Metric::tracked(difficulty),
            retrievability: Metric::tracked(retrievability),
            current_interval_days: Metric::tracked(current_interval),
            next_interval_days: Metric::tracked(
                interval_history.last().map(|point| point.interval_days),
            ),
            due_date: Metric::tracked(due_date),
            interval_modifier: match interval_modifier {
                Some(modifier) => Metric::value(modifier),
                None if item_type == StatsItemType::Document => Metric::Untracked,
                None => Metric::NotApplicable,
            },
            interval_history,
            retention_curve: retention_curve(stability, RETENTION_HORIZON_DAYS),
        }))
    }

    async fn history_stats(
        &self,
        item_type: StatsItemType,
        item_id: &str,
        events: Vec<ItemStatsEvent>,
        leech_threshold: i32,
    ) -> Result<Option<ItemHistoryStats>> {
        if item_type == StatsItemType::Rss {
            return Ok(None);
        }

        let mut rating_distribution = RatingDistribution::default();
        let mut lapse_positions = Vec::new();

        for (index, event) in events.iter().enumerate() {
            if let Some(rating) = event.rating {
                rating_distribution.add(rating);
                if rating == 1 {
                    lapse_positions.push(index);
                }
            }
        }

        // Flashcards carry an authoritative lapse counter that predates this
        // change; for everything else the timeline is the only source, so an
        // item with no history reports "not recorded" rather than zero.
        let lapses = match item_type {
            StatsItemType::LearningItem => {
                let row: Option<(i64,)> =
                    sqlx::query_as("SELECT lapses FROM learning_items WHERE id = ?1")
                        .bind(item_id)
                        .fetch_optional(&self.pool)
                        .await
                        .map_err(map_err("learning item lapses"))?;
                Metric::tracked(row.map(|(lapses,)| lapses))
            }
            _ if events.is_empty() => Metric::Untracked,
            _ => Metric::value(lapse_positions.len() as i64),
        };

        let is_leech = lapses
            .as_value()
            .is_some_and(|count| *count >= leech_threshold as i64);

        Ok(Some(ItemHistoryStats {
            events,
            rating_distribution,
            lapse_positions,
            lapses,
            is_leech,
            leech_threshold,
        }))
    }

    async fn content_stats(
        &self,
        item_type: StatsItemType,
        item_id: &str,
    ) -> Result<Option<ItemContentStats>> {
        match item_type {
            StatsItemType::Document => {
                let row = sqlx::query(
                    "SELECT date_added, first_reviewed_at, content, progress_percent,
                            extract_count, learning_item_count, priority_score, priority_slider,
                            category, tags
                     FROM documents WHERE id = ?1",
                )
                .bind(item_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_err("document content stats"))?;

                let Some(row) = row else { return Ok(None) };
                let created_at: Option<String> = row.try_get("date_added").ok();
                let content: Option<String> = row.try_get("content").ok().flatten();

                Ok(Some(ItemContentStats {
                    age_days: Metric::tracked(age_days(created_at.as_deref())),
                    created_at: Metric::tracked(created_at),
                    first_seen_at: Metric::tracked(
                        row.try_get::<Option<String>, _>("first_reviewed_at")
                            .ok()
                            .flatten(),
                    ),
                    word_count: Metric::tracked(
                        content.as_ref().map(|c| c.split_whitespace().count() as i64),
                    ),
                    character_count: Metric::tracked(content.as_ref().map(|c| c.chars().count() as i64)),
                    progress_percent: Metric::tracked(
                        row.try_get::<Option<f64>, _>("progress_percent").ok().flatten(),
                    ),
                    extracts_yielded: Metric::value(
                        row.try_get::<i64, _>("extract_count").unwrap_or(0),
                    ),
                    flashcards_yielded: Metric::value(
                        row.try_get::<i64, _>("learning_item_count").unwrap_or(0),
                    ),
                    priority_score: Metric::value(
                        row.try_get::<f64, _>("priority_score").unwrap_or(0.0),
                    ),
                    priority_slider: Metric::value(
                        row.try_get::<i64, _>("priority_slider").unwrap_or(0),
                    ),
                    category: Metric::tracked(row.try_get::<Option<String>, _>("category").ok().flatten()),
                    tags: parse_tags(row.try_get::<String, _>("tags").ok()),
                }))
            }
            StatsItemType::Extract => {
                let row = sqlx::query(
                    "SELECT e.date_created, e.content, e.priority_score, e.category, e.tags,
                            (SELECT COUNT(*) FROM learning_items li WHERE li.extract_id = e.id) AS cards
                     FROM extracts e WHERE e.id = ?1",
                )
                .bind(item_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_err("extract content stats"))?;

                let Some(row) = row else { return Ok(None) };
                let created_at: Option<String> = row.try_get("date_created").ok();
                let content: Option<String> = row.try_get("content").ok();

                Ok(Some(ItemContentStats {
                    age_days: Metric::tracked(age_days(created_at.as_deref())),
                    created_at: Metric::tracked(created_at),
                    first_seen_at: Metric::NotApplicable,
                    word_count: Metric::tracked(
                        content.as_ref().map(|c| c.split_whitespace().count() as i64),
                    ),
                    character_count: Metric::tracked(content.as_ref().map(|c| c.chars().count() as i64)),
                    progress_percent: Metric::NotApplicable,
                    // An extract never yields extracts; the metric does not
                    // apply rather than being a zero the user must interpret.
                    extracts_yielded: Metric::NotApplicable,
                    flashcards_yielded: Metric::value(row.try_get::<i64, _>("cards").unwrap_or(0)),
                    priority_score: Metric::value(
                        row.try_get::<f64, _>("priority_score").unwrap_or(0.0),
                    ),
                    priority_slider: Metric::NotApplicable,
                    category: Metric::tracked(row.try_get::<Option<String>, _>("category").ok().flatten()),
                    tags: parse_tags(row.try_get::<String, _>("tags").ok()),
                }))
            }
            StatsItemType::LearningItem => {
                let row = sqlx::query(
                    "SELECT date_created, first_reviewed_at, question, answer, cloze_text,
                            priority_score, priority_slider, tags
                     FROM learning_items WHERE id = ?1",
                )
                .bind(item_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_err("learning item content stats"))?;

                let Some(row) = row else { return Ok(None) };
                let created_at: Option<String> = row.try_get("date_created").ok();
                let text = [
                    row.try_get::<String, _>("question").unwrap_or_default(),
                    row.try_get::<Option<String>, _>("answer")
                        .ok()
                        .flatten()
                        .unwrap_or_default(),
                    row.try_get::<Option<String>, _>("cloze_text")
                        .ok()
                        .flatten()
                        .unwrap_or_default(),
                ]
                .join(" ");

                Ok(Some(ItemContentStats {
                    age_days: Metric::tracked(age_days(created_at.as_deref())),
                    created_at: Metric::tracked(created_at),
                    first_seen_at: Metric::tracked(
                        row.try_get::<Option<String>, _>("first_reviewed_at")
                            .ok()
                            .flatten(),
                    ),
                    word_count: Metric::value(text.split_whitespace().count() as i64),
                    character_count: Metric::value(text.chars().count() as i64),
                    progress_percent: Metric::NotApplicable,
                    extracts_yielded: Metric::NotApplicable,
                    flashcards_yielded: Metric::NotApplicable,
                    priority_score: Metric::value(
                        row.try_get::<f64, _>("priority_score").unwrap_or(0.0),
                    ),
                    priority_slider: Metric::value(
                        row.try_get::<i64, _>("priority_slider").unwrap_or(0),
                    ),
                    category: Metric::NotApplicable,
                    tags: parse_tags(row.try_get::<String, _>("tags").ok()),
                }))
            }
            StatsItemType::Rss => Ok(None),
        }
    }

    /// Where this item sits among the others of its type by time invested.
    ///
    /// One indexed `COUNT(*)`; detail-only, so it never runs on the popover
    /// path.
    async fn rank_by_time_invested(
        &self,
        item_type: StatsItemType,
        item_id: &str,
    ) -> Result<Metric<TimeInvestedRank>> {
        let (ahead_sql, total_sql) = match item_type {
            StatsItemType::Document => (
                "SELECT COUNT(*) FROM documents WHERE COALESCE(total_time_spent, 0) >
                 (SELECT COALESCE(total_time_spent, 0) FROM documents WHERE id = ?1)",
                "SELECT COUNT(*) FROM documents",
            ),
            StatsItemType::Extract => (
                "SELECT COUNT(*) FROM extracts WHERE COALESCE(total_time_spent, 0) >
                 (SELECT COALESCE(total_time_spent, 0) FROM extracts WHERE id = ?1)",
                "SELECT COUNT(*) FROM extracts",
            ),
            StatsItemType::LearningItem => (
                "SELECT COUNT(*) FROM (
                     SELECT item_id, SUM(time_taken) AS total FROM review_results
                     GROUP BY item_id
                     HAVING total > (SELECT COALESCE(SUM(time_taken), 0) FROM review_results WHERE item_id = ?1)
                 )",
                "SELECT COUNT(*) FROM learning_items",
            ),
            StatsItemType::Rss => return Ok(Metric::NotApplicable),
        };

        let (ahead,): (i64,) = sqlx::query_as(ahead_sql)
            .bind(item_id)
            .fetch_one(&self.pool)
            .await
            .map_err(map_err("time-invested rank"))?;
        let (total,): (i64,) = sqlx::query_as(total_sql)
            .fetch_one(&self.pool)
            .await
            .map_err(map_err("time-invested total"))?;

        if total == 0 {
            return Ok(Metric::Untracked);
        }

        Ok(Metric::value(TimeInvestedRank {
            rank: ahead + 1,
            total,
        }))
    }
}

fn map_err(what: &'static str) -> impl Fn(sqlx::Error) -> IncrementumError {
    move |e| IncrementumError::Internal(format!("Failed to read {what}: {e}"))
}

fn parse_tags(raw: Option<String>) -> Vec<String> {
    raw.and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
        .unwrap_or_default()
}

fn age_days(created_at: Option<&str>) -> Option<i64> {
    let created = parse_stored_timestamp(created_at?)?;
    Some(Utc::now().signed_duration_since(created).num_days().max(0))
}

/// Retrievability right now, from the FSRS forgetting curve.
///
/// Elapsed days are taken from how far the due date is from now, offset by the
/// current interval — the same relationship the scheduler uses. Returns `None`
/// when either half is unknown; a guessed retrievability is worse than an
/// honest "not recorded".
fn retrievability_now(
    stability: Option<f64>,
    due_date: Option<&str>,
    interval_days: Option<f64>,
) -> Option<f64> {
    let stability = stability.filter(|s| *s > 0.0)?;
    let due = parse_stored_timestamp(due_date?)?;
    let interval = interval_days?;

    let days_until_due = due.signed_duration_since(Utc::now()).num_seconds() as f64 / 86_400.0;
    let elapsed = (interval - days_until_due).max(0.0);

    Some((1.0 + elapsed / (9.0 * stability)).powf(-1.0).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use std::path::PathBuf;

    async fn setup() -> ItemStatsRepository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        let pool = db.pool().clone();

        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, date_added, date_modified, total_time_spent, reps, progress_percent)
             VALUES ('doc-1', 'Doc', '/tmp/doc.pdf', 'pdf', 'one two three four five', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 0, 12.5)",
        )
        .execute(&pool)
        .await
        .expect("seed document");

        sqlx::query(
            "INSERT INTO extracts (id, document_id, content, date_created, date_modified)
             VALUES ('ext-1', 'doc-1', 'Extract body', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("seed extract");

        sqlx::query(
            "INSERT INTO learning_items (id, item_type, question, answer, date_created, date_modified, due_date, lapses)
             VALUES ('card-1', 'flashcard', 'Q?', 'A', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 0)",
        )
        .execute(&pool)
        .await
        .expect("seed learning item");

        ItemStatsRepository::new(pool)
    }

    async fn insert_activity(
        repo: &ItemStatsRepository,
        id: &str,
        item_type: &str,
        item_id: &str,
        surface: &str,
        at: &str,
        seconds: i64,
        rating: Option<i32>,
    ) {
        sqlx::query(
            "INSERT INTO item_activity_log (id, item_type, item_id, surface, started_at, ended_at, active_seconds, rating, resulting_interval_days)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, 3.0)",
        )
        .bind(id)
        .bind(item_type)
        .bind(item_id)
        .bind(surface)
        .bind(at)
        .bind(seconds)
        .bind(rating)
        .execute(repo.pool())
        .await
        .expect("insert activity");
    }

    #[tokio::test]
    async fn a_document_with_both_event_sources_returns_them_interleaved_chronologically() {
        let repo = setup().await;

        // Queue ratings and reader sessions alternate in time.
        insert_activity(
            &repo,
            "act-1",
            "document",
            "doc-1",
            "queue",
            "2026-03-01T10:00:00Z",
            60,
            Some(3),
        )
        .await;
        insert_activity(
            &repo,
            "act-2",
            "document",
            "doc-1",
            "queue",
            "2026-03-03T10:00:00Z",
            90,
            Some(1),
        )
        .await;

        for (id, started, ended, seconds) in [
            ("sess-1", "2026-03-02T09:00:00Z", "2026-03-02T09:10:00Z", 600),
            ("sess-2", "2026-03-04T09:00:00Z", "2026-03-04T09:05:00Z", 300),
        ] {
            sqlx::query(
                "INSERT INTO reading_sessions (id, document_id, started_at, ended_at, duration_seconds, progress_start, progress_end)
                 VALUES (?1, 'doc-1', ?2, ?3, ?4, 0.0, 10.0)",
            )
            .bind(id)
            .bind(started)
            .bind(ended)
            .bind(seconds)
            .execute(repo.pool())
            .await
            .expect("insert session");
        }

        let events = repo
            .timeline(StatsItemType::Document, "doc-1")
            .await
            .expect("timeline");

        assert_eq!(events.len(), 4);
        let surfaces: Vec<&str> = events.iter().map(|e| e.surface.as_str()).collect();
        assert_eq!(
            surfaces,
            vec!["queue", "reader", "queue", "reader"],
            "the two sources interleave by time, not by source"
        );

        let timestamps: Vec<_> = events
            .iter()
            .map(|e| parse_stored_timestamp(&e.at).expect("parse"))
            .collect();
        assert!(
            timestamps.windows(2).all(|w| w[0] <= w[1]),
            "events are ordered oldest first"
        );

        // The split by surface follows the same union.
        let detail = repo
            .detail(StatsItemType::Document, "doc-1", 8)
            .await
            .expect("detail");
        let time = detail.time.expect("time section");
        assert_eq!(time.queue_seconds.as_value(), Some(&150));
        assert_eq!(time.reader_seconds.as_value(), Some(&900));
        assert_eq!(time.longest_session_seconds.as_value(), Some(&600));
        assert_eq!(time.median_session_seconds.as_value(), Some(&195));
    }

    #[tokio::test]
    async fn an_item_with_no_events_reports_its_pre_existing_total_with_untracked_history() {
        let repo = setup().await;

        // A pre-change document: a total accumulated before this history
        // existed, and no event rows at all.
        sqlx::query("UPDATE documents SET total_time_spent = 3600, reps = 4 WHERE id = 'doc-1'")
            .execute(repo.pool())
            .await
            .expect("seed pre-change total");

        let summary = repo
            .summary(StatsItemType::Document, "doc-1")
            .await
            .expect("summary");
        assert_eq!(
            summary.total_active_seconds.as_value(),
            Some(&3600),
            "the pre-existing total is reported, not reset"
        );
        assert_eq!(summary.repetitions.as_value(), Some(&4));
        assert_eq!(summary.average_seconds_per_repetition.as_value(), Some(&900));
        assert!(
            summary.first_interaction_at.is_untracked(),
            "no event rows means no known first interaction — not a fabricated date"
        );

        let detail = repo
            .detail(StatsItemType::Document, "doc-1", 8)
            .await
            .expect("detail");
        let history = detail.history.expect("history section");
        assert!(history.events.is_empty());
        assert!(
            history.lapses.is_untracked(),
            "a document with no history reports 'not recorded', never 0 lapses"
        );
        assert!(!history.is_leech);

        let time = detail.time.expect("time section");
        assert!(
            time.queue_seconds.is_untracked(),
            "an unknown split must not be presented as a zero split"
        );
        assert_eq!(
            time.total_active_seconds.as_value(),
            Some(&3600),
            "the total the user already had is still shown"
        );
    }

    #[tokio::test]
    async fn a_flashcard_timeline_comes_from_review_results_and_is_not_duplicated() {
        let repo = setup().await;

        for (index, (rating, seconds)) in [(3i32, 12i64), (1, 30), (3, 9)].iter().enumerate() {
            sqlx::query(
                "INSERT INTO review_results (id, item_id, rating, time_taken, new_due_date, new_interval, new_ease_factor, timestamp)
                 VALUES (?1, 'card-1', ?2, ?3, '2026-04-01T00:00:00Z', ?4, 2.5, ?5)",
            )
            .bind(format!("rev-{index}"))
            .bind(rating)
            .bind(seconds)
            .bind((index as i64 + 1) * 2)
            .bind(format!("2026-03-0{}T10:00:00Z", index + 1))
            .execute(repo.pool())
            .await
            .expect("insert review result");
        }

        // A stray activity row for the same id must not leak into a card's
        // timeline — flashcards read review_results and nothing else.
        insert_activity(
            &repo,
            "act-stray",
            "document",
            "card-1",
            "queue",
            "2026-03-02T12:00:00Z",
            999,
            Some(4),
        )
        .await;

        let events = repo
            .timeline(StatsItemType::LearningItem, "card-1")
            .await
            .expect("timeline");

        assert_eq!(events.len(), 3, "one entry per review, no duplicates");
        assert!(events.iter().all(|e| e.surface == "review"));
        assert_eq!(events[0].active_seconds, Some(12));
        assert_eq!(events[1].rating, Some(1));
        assert_eq!(events[2].resulting_interval_days, Some(6.0));

        let summary = repo
            .summary(StatsItemType::LearningItem, "card-1")
            .await
            .expect("summary");
        assert_eq!(summary.total_active_seconds.as_value(), Some(&51));
        assert_eq!(summary.repetitions.as_value(), Some(&3));
        assert_eq!(summary.average_seconds_per_repetition.as_value(), Some(&17));

        let detail = repo
            .detail(StatsItemType::LearningItem, "card-1", 8)
            .await
            .expect("detail");
        let history = detail.history.expect("history section");
        assert_eq!(history.rating_distribution.again, 1);
        assert_eq!(history.rating_distribution.good, 2);
        assert_eq!(history.lapse_positions, vec![1]);
    }

    #[tokio::test]
    async fn rss_items_omit_the_sections_they_have_no_data_for() {
        let repo = setup().await;

        let detail = repo
            .detail(StatsItemType::Rss, "rss-1", 8)
            .await
            .expect("detail");

        assert!(
            detail.schedule.is_none(),
            "RSS articles have no scheduling state; the section is omitted, not empty"
        );
        assert!(detail.time.is_none());
        assert!(detail.history.is_none());
        assert!(detail.summary.total_active_seconds.is_not_applicable());
        assert!(detail.rank_by_time_invested.is_not_applicable());
    }

    #[tokio::test]
    async fn extract_stats_show_time_reviews_and_the_cards_it_produced() {
        let repo = setup().await;

        sqlx::query("UPDATE extracts SET total_time_spent = 75, reps = 2 WHERE id = 'ext-1'")
            .execute(repo.pool())
            .await
            .expect("seed extract totals");
        sqlx::query("UPDATE learning_items SET extract_id = 'ext-1' WHERE id = 'card-1'")
            .execute(repo.pool())
            .await
            .expect("link card to extract");
        insert_activity(
            &repo,
            "act-e1",
            "extract",
            "ext-1",
            "queue",
            "2026-03-01T10:00:00Z",
            45,
            Some(3),
        )
        .await;

        let detail = repo
            .detail(StatsItemType::Extract, "ext-1", 8)
            .await
            .expect("detail");

        assert_eq!(detail.summary.total_active_seconds.as_value(), Some(&75));
        assert_eq!(detail.summary.repetitions.as_value(), Some(&2));

        let content = detail.content.expect("content section");
        assert_eq!(content.flashcards_yielded.as_value(), Some(&1));
        assert!(
            content.extracts_yielded.is_not_applicable(),
            "an extract cannot yield extracts; the metric does not apply"
        );
        assert_eq!(content.word_count.as_value(), Some(&2));

        let time = detail.time.expect("time section");
        assert!(
            time.reader_seconds.is_not_applicable(),
            "extracts are never read in the Reader"
        );
        assert!(time.estimated_reading_seconds.is_not_applicable());
    }

    #[tokio::test]
    async fn a_genuine_zero_stays_a_zero_while_an_unknown_stays_unknown() {
        let repo = setup().await;

        // A document nothing was ever made from: its extract count is a real
        // zero, while its unrecorded time is genuinely unknown. The surface
        // has to tell those two apart.
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, date_added, date_modified, progress_percent)
             VALUES ('doc-zero', 'Untouched', '/tmp/z.pdf', 'pdf', 'one two three four five', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 12.5)",
        )
        .execute(repo.pool())
        .await
        .expect("seed untouched document");

        let detail = repo
            .detail(StatsItemType::Document, "doc-zero", 8)
            .await
            .expect("detail");
        let content = detail.content.expect("content section");

        assert_eq!(
            content.extracts_yielded.as_value(),
            Some(&0),
            "a document with no extracts genuinely has zero"
        );
        assert!(
            detail.summary.total_active_seconds.is_untracked(),
            "a document with no recorded time is unknown, not zero"
        );
        assert_eq!(content.word_count.as_value(), Some(&5));
        assert_eq!(content.progress_percent.as_value(), Some(&12.5));

        // And the seeded document, which does have an extract, reports it.
        let with_extract = repo
            .detail(StatsItemType::Document, "doc-1", 8)
            .await
            .expect("detail")
            .content
            .expect("content section");
        assert_eq!(with_extract.extracts_yielded.as_value(), Some(&1));
    }

    #[tokio::test]
    async fn the_leech_flag_follows_the_configured_threshold() {
        let repo = setup().await;

        sqlx::query("UPDATE learning_items SET lapses = 5 WHERE id = 'card-1'")
            .execute(repo.pool())
            .await
            .expect("seed lapses");

        let below = repo
            .detail(StatsItemType::LearningItem, "card-1", 8)
            .await
            .expect("detail")
            .history
            .expect("history");
        assert!(!below.is_leech);
        assert_eq!(below.leech_threshold, 8);

        let above = repo
            .detail(StatsItemType::LearningItem, "card-1", 5)
            .await
            .expect("detail")
            .history
            .expect("history");
        assert!(above.is_leech, "at the threshold the item is a leech");
    }

    #[tokio::test]
    async fn rank_by_time_invested_counts_only_items_ahead() {
        let repo = setup().await;

        for (id, seconds) in [("doc-2", 900), ("doc-3", 100)] {
            sqlx::query(
                "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified, total_time_spent)
                 VALUES (?1, 'Other', '/tmp/o.pdf', 'pdf', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?2)",
            )
            .bind(id)
            .bind(seconds)
            .execute(repo.pool())
            .await
            .expect("seed other document");
        }
        sqlx::query("UPDATE documents SET total_time_spent = 300 WHERE id = 'doc-1'")
            .execute(repo.pool())
            .await
            .expect("seed total");

        let rank = repo
            .detail(StatsItemType::Document, "doc-1", 8)
            .await
            .expect("detail")
            .rank_by_time_invested;
        let rank = rank.as_value().expect("rank");

        assert_eq!(rank.rank, 2, "one document has more time invested");
        assert_eq!(rank.total, 3);
    }

    #[test]
    fn retrievability_is_none_when_either_half_is_unknown() {
        assert!(retrievability_now(None, Some("2026-01-01T00:00:00Z"), Some(5.0)).is_none());
        assert!(retrievability_now(Some(5.0), None, Some(5.0)).is_none());
        assert!(retrievability_now(Some(5.0), Some("2026-01-01T00:00:00Z"), None).is_none());
        assert!(retrievability_now(Some(0.0), Some("2026-01-01T00:00:00Z"), Some(5.0)).is_none());
    }

    #[test]
    fn retrievability_is_one_when_nothing_has_elapsed_yet() {
        let due = (Utc::now() + chrono::Duration::days(10)).to_rfc3339();
        let r = retrievability_now(Some(10.0), Some(&due), Some(10.0)).expect("retrievability");
        assert!(
            (r - 1.0).abs() < 0.01,
            "a review just performed has ~full retrievability, got {r}"
        );
    }
}
