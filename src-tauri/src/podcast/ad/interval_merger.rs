//! Interval Merger, Deduplicator & Safety Sanity Guard
//!
//! Merges overlapping and closely spaced ad intervals (<5.0s gap), filters micro-intervals (<10s),
//! enforces the 8-minute max single ad segment cap, and validates episode sanity limits (>40% ad duration guard).

use crate::models::podcast_ad::PodcastAdInterval;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const MAX_SINGLE_AD_DURATION_MS: i64 = 480_000; // 8 minutes
const MERGE_GAP_MS: i64 = 5_000; // 5 seconds

/// Result of interval processing and sanity checks
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntervalMergeResult {
    pub intervals: Vec<PodcastAdInterval>,
    pub total_ad_duration_ms: i64,
    pub episode_duration_ms: i64,
    pub is_suspicious: bool,
}

/// Merge overlapping and adjacent intervals, filter micro-intervals, and check sanity limits.
pub fn merge_and_filter_intervals(
    mut raw_intervals: Vec<PodcastAdInterval>,
    episode_duration_ms: i64,
    min_ad_duration_ms: i64,
) -> IntervalMergeResult {
    if raw_intervals.is_empty() {
        return IntervalMergeResult {
            intervals: Vec::new(),
            total_ad_duration_ms: 0,
            episode_duration_ms,
            is_suspicious: false,
        };
    }

    // 1. Sort by start timestamp
    raw_intervals.sort_by_key(|inv| inv.start_ms);

    // 2. Merge overlapping or closely adjacent intervals (< 3000ms gap)
    let mut merged: Vec<PodcastAdInterval> = Vec::new();

    for inv in raw_intervals {
        if inv.end_ms <= inv.start_ms {
            continue;
        }

        if let Some(prev) = merged.last_mut() {
            // Check if current interval overlaps or is within 5.0s of previous interval
            if inv.start_ms <= prev.end_ms + MERGE_GAP_MS {
                // Merge: extend end time, take max confidence
                prev.end_ms = prev.end_ms.max(inv.end_ms);
                prev.confidence = prev.confidence.max(inv.confidence);
                continue;
            }
        }

        merged.push(inv);
    }

    // 3. Filter out micro-intervals shorter than min_ad_duration_ms (default 10,000ms)
    //    and runaway segments exceeding 8 minutes (480,000ms).
    let min_dur = if min_ad_duration_ms > 0 {
        min_ad_duration_ms
    } else {
        10_000
    };
    let mut filtered: Vec<PodcastAdInterval> = merged
        .into_iter()
        .filter(|inv| {
            let dur = inv.end_ms - inv.start_ms;
            dur >= min_dur && dur <= MAX_SINGLE_AD_DURATION_MS
        })
        .collect();

    // 4. Compute total ad duration and enforce <= 40% sanity limit
    let mut total_ad_duration_ms: i64 = filtered.iter().map(|inv| inv.end_ms - inv.start_ms).sum();
    let max_total_ms = if episode_duration_ms > 0 {
        (episode_duration_ms * 40) / 100
    } else {
        i64::MAX
    };
    let is_suspicious = episode_duration_ms > 0 && total_ad_duration_ms > max_total_ms;

    if is_suspicious {
        // Drop lowest-confidence non-manual intervals until total <= 40% of episode duration
        while total_ad_duration_ms > max_total_ms {
            let drop_idx = filtered
                .iter()
                .enumerate()
                .filter(|(_, inv)| inv.origin != "manual_user")
                .min_by(|(_, a), (_, b)| {
                    a.confidence
                        .partial_cmp(&b.confidence)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|(idx, _)| idx);

            let Some(idx) = drop_idx else {
                break;
            };
            let removed = filtered.remove(idx);
            total_ad_duration_ms -= removed.end_ms - removed.start_ms;
        }
    }

    IntervalMergeResult {
        intervals: filtered,
        total_ad_duration_ms,
        episode_duration_ms,
        is_suspicious,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inv(start_ms: i64, end_ms: i64, cat: &str, conf: f32) -> PodcastAdInterval {
        PodcastAdInterval {
            id: Uuid::new_v4().to_string(),
            episode_id: "ep-test".into(),
            media_revision: "rev-1".into(),
            start_ms,
            end_ms,
            category: cat.into(),
            confidence: conf,
            origin: "test".into(),
            metadata_json: None,
        }
    }

    #[test]
    fn merges_overlapping_and_adjacent_intervals() {
        let raw = vec![
            inv(10_000, 40_000, "external_ad", 0.85),
            inv(35_000, 65_000, "external_ad", 0.95), // overlaps with first
            inv(67_000, 95_000, "external_ad", 0.90), // 2.0s gap from previous (< 3s)
            inv(150_000, 180_000, "host_self_promo", 0.80), // isolated
        ];

        let res = merge_and_filter_intervals(raw, 300_000, 10_000);
        assert_eq!(res.intervals.len(), 2);

        // First 3 merged into one continuous block: 10_000 to 95_000
        assert_eq!(res.intervals[0].start_ms, 10_000);
        assert_eq!(res.intervals[0].end_ms, 95_000);
        assert_eq!(res.intervals[0].confidence, 0.95);

        // Second interval preserved
        assert_eq!(res.intervals[1].start_ms, 150_000);
        assert_eq!(res.intervals[1].end_ms, 180_000);
    }

    #[test]
    fn discards_micro_intervals_shorter_than_min_duration() {
        let raw = vec![
            inv(10_000, 14_000, "external_ad", 0.90), // 4s (< 10s min)
            inv(30_000, 60_000, "external_ad", 0.90), // 30s
        ];

        let res = merge_and_filter_intervals(raw, 200_000, 10_000);
        assert_eq!(res.intervals.len(), 1);
        assert_eq!(res.intervals[0].start_ms, 30_000);
    }

    #[test]
    fn triggers_suspicious_flag_and_caps_when_ads_exceed_40_percent() {
        let raw = vec![
            inv(0, 50_000, "external_ad", 0.90), // 50s out of 100s episode (> 40%)
        ];

        let res = merge_and_filter_intervals(raw, 100_000, 10_000);
        assert!(res.is_suspicious);
        assert_eq!(res.total_ad_duration_ms, 0);
    }

    #[test]
    fn does_not_trigger_suspicious_for_normal_ad_duration() {
        let raw = vec![
            inv(10_000, 30_000, "external_ad", 0.90), // 20s out of 100s episode (20%)
        ];

        let res = merge_and_filter_intervals(raw, 100_000, 10_000);
        assert!(!res.is_suspicious);
    }
}
