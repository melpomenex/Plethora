//! The adaptive learning loop (design D8): telemetry → priors, with no model
//! retraining and no fine-tuning.
//!
//! Three signals, all read from tables that already exist:
//!
//! - **Cluster promotion** — an item with high active dwell *and* extracts made
//!   from it is evidence the reader engages with its neighbourhood, so the
//!   collection and semantic cluster around it get a raised contribution.
//! - **Resistance** — repeated skips, or idle time dominating active time with no
//!   interaction, raise a `split-candidate` or `auto-demote` flag.
//! - **Velocity** — items consumed per active minute against a trailing-30-day
//!   baseline. Below 40% of baseline, the *effective* energy target drops. The
//!   user's configured value is never mutated.
//!
//! Everything degrades to `None`/`Untracked` on insufficient data. A loop that
//! guesses produces confident nonsense, and a confident wrong ranking is worse
//! than an obviously absent one.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

/// The trailing window the velocity baseline is computed over.
pub const VELOCITY_BASELINE_DAYS: i64 = 30;

/// Below this fraction of baseline, the effective energy target is lowered.
pub const VELOCITY_COLLAPSE_RATIO: f64 = 0.40;

/// Below this many observed sessions the baseline is not trustworthy.
pub const VELOCITY_MIN_SESSIONS: i64 = 5;

/// The recommendation a resistance signal raises. Neither ever removes or
/// dismisses anything — both are proposals a user acts on or ignores.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Recommendation {
    /// The item resists because it is too large or too diffuse for one sitting.
    SplitCandidate,
    /// The item resists in a way more material will not fix.
    AutoDemote,
}

/// A raised recommendation plus the evidence that raised it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationFlag {
    pub item_id: String,
    pub recommendation: Recommendation,
    /// Human-readable evidence, shown verbatim in the UI.
    pub evidence: String,
    pub raised_at: DateTime<Utc>,
}

/// The observed counts a resistance decision reads.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResistanceEvidence {
    pub rapid_skip_count: i32,
    pub active_dwell_ms: i64,
    pub idle_time_ms: i64,
    /// Highlights and extracts made from this item.
    pub interactions: i32,
}

/// Above this many skips, the item is a split candidate rather than a demote.
pub const SKIP_COUNT_FOR_SPLIT: i32 = 3;
/// At or above this idle share with no interaction, the item resists.
pub const IDLE_SHARE_FOR_RESISTANCE: f64 = 0.5;

/// Minimum active dwell before engagement can promote anything.
///
/// Without a floor, one accidental highlight in a five-second session scores the
/// same interaction density as a careful ten-minute read, because the rate's
/// denominator is clamped. A minute of genuine reading is the smallest unit that
/// says anything about engagement.
pub const PROMOTION_MIN_ACTIVE_DWELL_MS: i64 = 60_000;

/// What the learning loop concludes about one item.
#[derive(Debug, Clone, PartialEq)]
pub enum LoopConclusion {
    /// Nothing raised. Not "measured as zero" — nothing was measured yet.
    NoSignal,
    /// A recommendation, with its evidence.
    Flagged(RecommendationFlag),
    /// Engagement worth propagating, as a `[0,1]` contribution.
    Promote { boost: f64, evidence: String },
}

/// Decide what an item's telemetry warrants.
///
/// Returns [`LoopConclusion::NoSignal`] for an item with no recorded telemetry at
/// all, which is the normal state for a freshly imported document. An
/// unmeasured item is not a resistant one.
pub fn conclude_for_item(
    item_id: &str,
    evidence: &ResistanceEvidence,
    now: DateTime<Utc>,
) -> LoopConclusion {
    // Engagement promotion first: an item the reader invests in is not a split
    // candidate, and the two signals can co-occur.
    if evidence.active_dwell_ms >= PROMOTION_MIN_ACTIVE_DWELL_MS && evidence.interactions > 0
    {
        // One interaction per five minutes of active dwell is a real engagement
        // threshold; below it, the interaction is incidental.
        let per_five_minutes = evidence.interactions as f64
            / (evidence.active_dwell_ms as f64 / 300_000.0).max(1.0);
        if per_five_minutes >= 0.2 {
            let boost = (per_five_minutes / 2.0).clamp(0.0, 1.0);
            return LoopConclusion::Promote {
                boost,
                evidence: format!(
                    "{} ms active dwell with {} extracts or highlights",
                    evidence.active_dwell_ms, evidence.interactions
                ),
            };
        }
    }

    if evidence.rapid_skip_count >= SKIP_COUNT_FOR_SPLIT {
        return LoopConclusion::Flagged(RecommendationFlag {
            item_id: item_id.to_string(),
            recommendation: Recommendation::SplitCandidate,
            evidence: format!(
                "skipped {} times without engaging",
                evidence.rapid_skip_count
            ),
            raised_at: now,
        });
    }

    let total = evidence.active_dwell_ms + evidence.idle_time_ms;
    if total > 0 && evidence.interactions == 0 {
        let idle_share = evidence.idle_time_ms as f64 / total as f64;
        if idle_share >= IDLE_SHARE_FOR_RESISTANCE {
            return LoopConclusion::Flagged(RecommendationFlag {
                item_id: item_id.to_string(),
                recommendation: Recommendation::AutoDemote,
                evidence: format!(
                    "{:.0}% of the time was spent away, with no interaction",
                    idle_share * 100.0
                ),
                raised_at: now,
            });
        }
    }

    LoopConclusion::NoSignal
}

/// Items consumed per active minute over a window.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Velocity {
    pub items_completed: i64,
    pub active_minutes: f64,
    /// Observed sessions, which is the sample-size gate.
    pub sessions: i64,
}

impl Velocity {
    pub fn per_active_minute(&self) -> Option<f64> {
        if self.active_minutes <= 0.0 {
            return None;
        }
        Some(self.items_completed as f64 / self.active_minutes)
    }
}

/// A velocity reading compared against the user's own trailing baseline.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VelocityComparison {
    pub current: Velocity,
    pub baseline: Velocity,
    /// Current velocity as a fraction of baseline.
    pub ratio: f64,
    /// Whether the baseline had enough sessions to mean anything.
    pub baseline_sufficient: bool,
}

/// Compare a window's velocity against the trailing baseline.
///
/// Returns `None` when the baseline is too small to compare against — the same
/// sample-size rule `knowledge-health-analytics` applies, and the reason a brand
/// new user's queue never gets an energy downshift nobody asked for.
pub fn compare_velocity(
    current: Velocity,
    baseline: Velocity,
    baseline_days: i64,
) -> Option<VelocityComparison> {
    let _ = baseline_days;
    if baseline.sessions < VELOCITY_MIN_SESSIONS {
        return None;
    }
    let current_rate = current.per_active_minute()?;
    let baseline_rate = baseline.per_active_minute()?;
    if baseline_rate <= 0.0 {
        return None;
    }
    Some(VelocityComparison {
        ratio: current_rate / baseline_rate,
        current,
        baseline,
        baseline_sufficient: true,
    })
}

/// The window start for a trailing baseline, for callers that build the query.
pub fn baseline_window_start(now: DateTime<Utc>) -> DateTime<Utc> {
    now - Duration::days(VELOCITY_BASELINE_DAYS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        use chrono::TimeZone;
        Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap()
    }

    fn engaged(dwell_ms: i64, interactions: i32) -> ResistanceEvidence {
        ResistanceEvidence {
            rapid_skip_count: 0,
            active_dwell_ms: dwell_ms,
            idle_time_ms: 0,
            interactions,
        }
    }

    #[test]
    fn no_telemetry_raises_nothing() {
        let empty = ResistanceEvidence::default();
        assert_eq!(
            conclude_for_item("doc-1", &empty, now()),
            LoopConclusion::NoSignal,
            "an unmeasured item is not a resistant one"
        );
    }

    #[test]
    fn dwell_without_interaction_promotes_nothing() {
        let evidence = engaged(600_000, 0);
        assert_eq!(conclude_for_item("doc-1", &evidence, now()), LoopConclusion::NoSignal);
    }

    #[test]
    fn dwell_with_extracts_promotes_the_cluster() {
        // 20 minutes of dwell, four extracts: 0.2 per five minutes.
        let evidence = engaged(1_200_000, 4);
        match conclude_for_item("doc-1", &evidence, now()) {
            LoopConclusion::Promote { boost, evidence: why } => {
                assert!(boost > 0.0, "a promotion must be non-zero");
                assert!(why.contains("1200000 ms"), "the evidence names the measurement");
            }
            other => panic!("expected a promotion, got {other:?}"),
        }
    }

    #[test]
    fn promotion_boost_is_bounded() {
        let heavy = engaged(600_000, 500);
        match conclude_for_item("doc-1", &heavy, now()) {
            LoopConclusion::Promote { boost, .. } => assert!((0.0..=1.0).contains(&boost)),
            other => panic!("expected a promotion, got {other:?}"),
        }
    }

    #[test]
    fn repeated_skips_raise_a_split_candidate_with_evidence() {
        let evidence = ResistanceEvidence {
            rapid_skip_count: 4,
            ..Default::default()
        };
        match conclude_for_item("doc-1", &evidence, now()) {
            LoopConclusion::Flagged(flag) => {
                assert_eq!(flag.recommendation, Recommendation::SplitCandidate);
                assert!(flag.evidence.contains("skipped 4 times"));
                assert_eq!(flag.item_id, "doc-1");
            }
            other => panic!("expected a flag, got {other:?}"),
        }
    }

    #[test]
    fn idle_dominance_with_no_interaction_raises_an_auto_demote() {
        let evidence = ResistanceEvidence {
            active_dwell_ms: 30_000,
            idle_time_ms: 90_000,
            rapid_skip_count: 0,
            interactions: 0,
        };
        match conclude_for_item("doc-1", &evidence, now()) {
            LoopConclusion::Flagged(flag) => {
                assert_eq!(flag.recommendation, Recommendation::AutoDemote);
                assert!(flag.evidence.contains("75%"), "got: {}", flag.evidence);
            }
            other => panic!("expected a flag, got {other:?}"),
        }
    }

    #[test]
    fn idle_dominance_with_interaction_is_not_resistance() {
        let evidence = ResistanceEvidence {
            active_dwell_ms: 30_000,
            idle_time_ms: 90_000,
            interactions: 2,
            ..Default::default()
        };
        assert_eq!(conclude_for_item("doc-1", &evidence, now()), LoopConclusion::NoSignal);
    }

    #[test]
    fn a_short_idle_tail_is_not_resistance() {
        let evidence = ResistanceEvidence {
            active_dwell_ms: 90_000,
            idle_time_ms: 45_000,
            ..Default::default()
        };
        assert_eq!(
            conclude_for_item("doc-1", &evidence, now()),
            LoopConclusion::NoSignal,
            "50% is the threshold; below it is ordinary reading"
        );
    }

    #[test]
    fn engagement_outranks_a_skip_flag_when_both_fire() {
        let evidence = ResistanceEvidence {
            rapid_skip_count: 5,
            active_dwell_ms: 1_200_000,
            idle_time_ms: 0,
            interactions: 4,
        };
        assert!(
            matches!(
                conclude_for_item("doc-1", &evidence, now()),
                LoopConclusion::Promote { .. }
            ),
            "an item the reader invests in is not a split candidate"
        );
    }

    #[test]
    fn velocity_needs_a_trustworthy_baseline() {
        let current = Velocity { items_completed: 30, active_minutes: 60.0, sessions: 30 };
        let tiny = Velocity { items_completed: 30, active_minutes: 60.0, sessions: 2 };
        assert_eq!(
            compare_velocity(current, tiny, VELOCITY_BASELINE_DAYS),
            None,
            "a two-session baseline cannot support a downshift"
        );

        let solid = Velocity { items_completed: 30, active_minutes: 60.0, sessions: 40 };
        let comparison = compare_velocity(current, solid, VELOCITY_BASELINE_DAYS)
            .expect("a 40-session baseline is enough");
        assert!(comparison.baseline_sufficient);
        assert_eq!(comparison.ratio, 1.0);
    }

    #[test]
    fn velocity_needs_a_nonzero_rate_on_both_sides() {
        let current = Velocity { items_completed: 0, active_minutes: 0.0, sessions: 10 };
        let baseline = Velocity { items_completed: 10, active_minutes: 10.0, sessions: 10 };
        assert_eq!(compare_velocity(current, baseline, 30), None);

        let current = Velocity { items_completed: 10, active_minutes: 10.0, sessions: 10 };
        let baseline = Velocity { items_completed: 10, active_minutes: 0.0, sessions: 10 };
        assert_eq!(compare_velocity(current, baseline, 30), None);
    }

    #[test]
    fn a_collapse_is_below_forty_percent_of_baseline() {
        let baseline = Velocity { items_completed: 30, active_minutes: 60.0, sessions: 40 };
        let half = Velocity { items_completed: 15, active_minutes: 60.0, sessions: 40 };
        let quarter = Velocity { items_completed: 7, active_minutes: 60.0, sessions: 40 };

        let half_ratio = compare_velocity(half, baseline, 30).expect("comparable").ratio;
        let quarter_ratio = compare_velocity(quarter, baseline, 30).expect("comparable").ratio;
        assert!(half_ratio > VELOCITY_COLLAPSE_RATIO);
        assert!(quarter_ratio < VELOCITY_COLLAPSE_RATIO);
    }

    #[test]
    fn the_baseline_window_is_thirty_days() {
        let instant = now();
        assert_eq!(
            baseline_window_start(instant),
            instant - Duration::days(30),
            "the documented baseline window"
        );
        assert_eq!(VELOCITY_BASELINE_DAYS, 30);
    }
}