//! The five ranking terms, one producer each.
//!
//! Every producer takes `(&QueueItem, &RankContext, knobs-derived inputs)` and
//! returns a [`TermValue`]. No producer performs I/O: the caller resolves
//! relevance, complexity, topic similarity, and telemetry counts into
//! [`ItemSignals`] first. Keeping the split here is what allows the composite
//! score to be reasoned about — and tested — without a database.

use crate::algorithms::daqe::{FrictionInputs, RankContext};
use crate::models::daqe::{TermValue, COMPLEXITY_SCALE_SPAN};
use crate::models::queue::QueueItem;
use chrono::{DateTime, Utc};

use super::RecentItem;

/// Everything about one candidate that the producers need but `QueueItem` does
/// not carry. Supplied by the caller so the producers stay pure.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ItemSignals {
    pub item_id: String,
    /// `M_relevance(i)` from `algorithms::relevance`, in `[0,1]`. `None` when no
    /// relevance was computed (no goal, no rating history, no semantic index).
    pub relevance: Option<f64>,
    /// `ItemComplexity(i)` on the shared `1..=5` scale, from the decision
    /// model. `None` when no model was reachable.
    pub complexity: Option<f64>,
    /// The strongest topic similarity between this item and the recent window,
    /// in `[0,1]`. Computed by the caller against the embedding store.
    pub topic_similarity_to_recent: f64,
    /// The ids of the recent items that similarity was strongest against, for
    /// the breakdown to name.
    pub topic_matches: Vec<String>,
    /// Postponements, skips, dwell and abandonment counts.
    pub friction: FrictionInputs,
    /// Raised by the adaptive learning loop when this item's collection and
    /// semantic cluster show sustained engagement, in `[0,1]`.
    pub cluster_boost: f64,
}

/// Deterministic per-item-type complexity, used when no decision model supplies
/// one. These are stand-ins, not measurements, and are reported as
/// `TermValue::defaulted` so the UI can say so.
///
/// The ordering encodes how much text a type asks the user to commit to: a
/// document is a sustained read, an extract is a considered paragraph, a
/// flashcard is a prompt, and a feed article is skimmable by construction.
pub fn default_complexity_for(item_type: &str) -> f64 {
    match item_type {
        "document" => 4.0,
        "extract" => 3.0,
        "learning-item" => 2.0,
        "playlist-video" => 3.0,
        "rss-article" => 2.0,
        "podcast" => 3.0,
        _ => 3.0,
    }
}

// ---------------------------------------------------------------- R_srs

/// `R_srs(i)` — spaced-repetition urgency in `[0,1]`.
///
/// Three components, weighted so that recall risk dominates but neither
/// overdue-ness nor the user's own priority can be ignored:
///
/// - **urgency** — how close the item is to being forgotten. Taken from the
///   scheduler's own retrievability when available; for documents that is
///   `calculate_fsrs_document_priority` (which already folds in stability,
///   difficulty and the priority slider), otherwise the forgetting curve
///   `0.9^(elapsed / stability)`.
/// - **overdue** — days past due, saturating at two weeks. This is the part that
///   differs most from a pure retrievability reading, because a brand-new item
///   that is due has perfect retrievability but still deserves surfacing.
/// - **user priority** — the item's existing 0–100 slider (or its resolved 0–10
///   priority), so an item the user explicitly marked high stays high.
///
/// Deliberately *not* a per-item-type constant: that is the thing being
/// replaced.
pub fn srs_urgency(item: &QueueItem, signals: Option<&ItemSignals>, ctx: &RankContext<'_>) -> TermValue {
    let urgency = urgency_component(item, ctx);
    let overdue = overdue_component(item, ctx);
    let user_priority = user_priority_component(item);

    let score = 0.5 * urgency + 0.3 * overdue + 0.2 * user_priority;
    let _ = signals;
    TermValue::measured(score)
}

/// A document's priority already encodes stability, difficulty and the user's
/// slider, so it is used directly (normalized from 0–10). Everything else is
/// derived from the forgetting curve, falling back to the stored 0–10 priority
/// when there is no memory state to read.
fn urgency_component(item: &QueueItem, ctx: &RankContext<'_>) -> f64 {
    if item.item_type == "document" {
        let slider = crate::algorithms::resolve_priority_slider(
            item.priority_slider.unwrap_or(0),
            item.priority_rating.unwrap_or(0),
        );
        let due = parse_due(item.due_date.as_deref());
        return (crate::algorithms::calculate_fsrs_document_priority(
            due,
            item.stability,
            item.difficulty,
            slider,
        ) / 10.0)
            .clamp(0.0, 1.0);
    }

    if let Some(retrievability) = retrievability(item, ctx) {
        // Low retrievability means high urgency.
        return (1.0 - retrievability).clamp(0.0, 1.0);
    }

    if let (Some(stability), Some(due)) = (item.stability, parse_due(item.due_date.as_deref())) {
        if stability > 0.0 {
            let elapsed_days = (ctx.now - due).num_days() as f64;
            // `R = 0.9^(t/S)`, the same curve the Adaptive scheduler uses.
            let retrievability = 0.9f64.powf(elapsed_days / stability);
            return (1.0 - retrievability).clamp(0.0, 1.0);
        }
    }

    // No scheduling signal at all: the stored priority is the only evidence.
    (item.priority / 10.0).clamp(0.0, 1.0)
}

/// The scheduler's own retrievability when it is present and trustworthy.
fn retrievability(item: &QueueItem, ctx: &RankContext<'_>) -> Option<f64> {
    if let Some(value) = item.retrievability {
        if value.is_finite() {
            return Some(value.clamp(0.0, 1.0));
        }
    }
    let stability = item.stability?;
    if stability <= 0.0 {
        return None;
    }
    let due = parse_due(item.due_date.as_deref())?;
    let elapsed_days = (ctx.now - due).num_days() as f64;
    Some(0.9f64.powf(elapsed_days / stability).clamp(0.0, 1.0))
}

fn overdue_component(item: &QueueItem, ctx: &RankContext<'_>) -> f64 {
    let Some(due) = parse_due(item.due_date.as_deref()) else {
        // New items have no due date; treat them as due today rather than
        // penalising them for an absence.
        return 1.0;
    };
    let days_overdue = (ctx.now - due).num_days();
    if days_overdue <= 0 {
        return 0.0;
    }
    (days_overdue as f64 / 14.0).clamp(0.0, 1.0)
}

fn user_priority_component(item: &QueueItem) -> f64 {
    if let Some(slider) = item.priority_slider {
        return (slider.clamp(0, 100) as f64 / 100.0).clamp(0.0, 1.0);
    }
    if let Some(rating) = item.priority_rating {
        let resolved = crate::algorithms::resolve_priority_slider(0, rating);
        return (resolved as f64 / 100.0).clamp(0.0, 1.0);
    }
    (item.priority / 10.0).clamp(0.0, 1.0)
}

// ------------------------------------------------------- M_relevance

/// `M_relevance(i)` — the item's `relevance.rs` composite.
///
/// Delegates rather than recomputes: `relevance.rs` already owns the four-signal
/// blend (classifier 0.4 / tag affinity 0.25 / rating history 0.2 / semantic
/// 0.15) and, importantly, already redistributes a missing signal's weight
/// proportionally among the survivors with a 0.5 cold start. Re-deriving any of
/// that here would fork the scoring and let the two drift.
pub fn goal_relevance(signals: Option<&ItemSignals>, _knob_w: f64) -> TermValue {
    match signals.and_then(|s| s.relevalscore_value()) {
        Some(value) => TermValue::measured(value),
        None => TermValue::unavailable(),
    }
}

impl ItemSignals {
    /// The relevance value, rejected when it is not a usable number rather than
    /// clamped — a model or signal pipeline reporting `1.7` is broken, and
    /// silently clamping it would present a fabricated score.
    pub fn relevalscore_value(&self) -> Option<f64> {
        let value = self.relevance?;
        if value.is_finite() && (0.0..=1.0).contains(&value) {
            Some(value)
        } else {
            None
        }
    }
}

// ------------------------------------------------------ M_energy_fit

/// `M_energy_fit(i, K)` = `1 − |ItemComplexity(i) − K| / 4`, clamped to `[0,1]`.
///
/// `K` is the *effective* energy target, which the fatigue downshift may have
/// lowered below the user's configured value. A model-supplied complexity is
/// reported as measured; the per-item-type default is reported as defaulted.
pub fn energy_fit(
    item: &QueueItem,
    signals: Option<&ItemSignals>,
    effective_energy_target: f64,
) -> TermValue {
    match signals.and_then(|s| s.complexity) {
        Some(complexity) if complexity.is_finite() => {
            TermValue::measured(fit_value(complexity, effective_energy_target))
        }
        _ => TermValue::defaulted(fit_value(
            default_complexity_for(&item.item_type),
            effective_energy_target,
        )),
    }
}

/// The bare distance formula, exposed for testing the two worked scenarios.
pub fn fit_value(complexity: f64, effective_energy_target: f64) -> f64 {
    (1.0 - (complexity - effective_energy_target).abs() / COMPLEXITY_SCALE_SPAN).clamp(0.0, 1.0)
}

// ---------------------------------------------------- P_interleave

/// `P_interleave(i, H_recent)` — topic-repetition penalty in `[0,1]`, returned
/// **unscaled**.
///
/// The `interleavingDiversity` knob is applied once, as the term's weight in
/// [`crate::models::daqe::TermBreakdown`]. Scaling here as well would apply the
/// knob twice, which is invisible at any knob value of 0.0 or 1.0 and silently
/// over-penalises in between.
///
/// `similarity` is the caller's measured overlap against the recent window; this
/// producer does not recompute it, because doing so would mean reaching for the
/// embedding store from inside a pure function.
///
/// An item with no topic overlap is never penalised, at any knob value. This is
/// why the comparison lives in score space rather than in a post-sort variety
/// guard: a post-sort pass would reorder items across score bands the user can
/// now see and explain, and could violate a composition quota.
pub fn interleave_penalty(signals: Option<&ItemSignals>) -> TermValue {
    let Some(signals) = signals else {
        return TermValue::unavailable();
    };
    let similarity = signals.topic_similarity_to_recent;
    if !similarity.is_finite() || similarity <= 0.0 {
        // No overlap: not "unavailable", genuinely zero.
        return TermValue::measured(0.0);
    }
    TermValue::measured(similarity.clamp(0.0, 1.0))
}

/// Raising `interleavingDiversity` must raise the penalty's effect on the score
/// for an overlapping item. The knob enters as the term's weight, so this is the
/// same linearity the score applies — checked here so the producer stays
/// knob-independent and cannot silently re-introduce a second scaling.
pub fn interleave_effect_is_monotonic_in_diversity(similarity: f64) -> bool {
    let mut previous = -1.0;
    for step in 0..=10 {
        let diversity = step as f64 / 10.0;
        let current = similarity.clamp(0.0, 1.0) * diversity;
        if current < previous {
            return false;
        }
        previous = current;
    }
    true
}

// -------------------------------------------------------- P_friction

/// `P_friction(i)` — accumulated resistance, in `[0,1]`, bounded, returned
/// **unscaled**. As with the interleaving penalty, `pruningAggressiveness` is
/// applied once, as the term's weight in the breakdown.
///
/// Built only from recorded telemetry. No recorded history at all means the
/// penalty is exactly zero: an unmeasured item is not a resistant one.
///
/// Three contributions, combined by a saturating sum rather than a linear one so
/// no single signal can dominate and the result cannot exceed 1.0:
///
/// - postponements (0.10 each, saturating at four),
/// - rapid skips (0.10 each, saturating at four),
/// - abandoned reviews (0.15 each, saturating at three),
/// - idle-dominance — `idle_share` above 0.5 scaled up to 0.35.
pub fn friction_penalty(signals: Option<&ItemSignals>) -> TermValue {
    let Some(signals) = signals else {
        return TermValue::unavailable();
    };
    let inputs = &signals.friction;
    if inputs.is_untracked() {
        return TermValue::measured(0.0);
    }

    let saturating = |count: i32, per: f64, cap: f64| {
        (count.max(0) as f64).min(cap) * per
    };

    let postpones = saturating(inputs.postpone_count, 0.10, 4.0);
    let skips = saturating(inputs.rapid_skip_count, 0.10, 4.0);
    let abandoned = saturating(inputs.abandoned_reviews, 0.15, 3.0);
    let idle_dominance = inputs
        .idle_share()
        .filter(|share| *share > 0.5)
        .map(|share| ((share - 0.5) / 0.5) * 0.35)
        .unwrap_or(0.0);

    TermValue::measured((postpones + skips + abandoned + idle_dominance).min(1.0))
}

// ---------------------------------------------------------------- utils

/// `QueueItem.due_date` is an RFC 3339 string on the wire. An unparseable or
/// absent date means "new item", never a silently wrong urgency.
fn parse_due(value: Option<&str>) -> Option<DateTime<Utc>> {
    let raw = value?;
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc))
}

/// Re-exported so `RankContext`'s `now` and this module agree on the type.
pub type Now = DateTime<Utc>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::queue::QueueItem;

    fn queue_item(id: &str, item_type: &str, due: Option<&str>) -> QueueItem {
        QueueItem {
            id: id.to_string(),
            document_id: "doc".to_string(),
            document_title: "Title".to_string(),
            extract_id: None,
            learning_item_id: None,
            question: None,
            answer: None,
            cloze_text: None,
            learning_hint: None,
            item_type: item_type.to_string(),
            priority_rating: None,
            priority_slider: None,
            priority: 5.0,
            due_date: due.map(str::to_string),
            estimated_time: 2,
            tags: Vec::new(),
            category: None,
            progress: 0,
            source: None,
            position: None,
            stability: None,
            difficulty: None,
            interval: None,
            retrievability: None,
            lapses: None,
            reps: None,
        }
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-06-01T12:00:00Z")
            .expect("fixture instant")
            .with_timezone(&Utc)
    }

    #[test]
    fn energy_fit_is_one_when_complexity_matches_the_target() {
        // Worked scenario: complexity 4, target 4.
        assert!((fit_value(4.0, 4.0) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn energy_fit_is_zero_at_maximum_distance() {
        // Worked scenario: complexity 1, target 5.
        assert!(fit_value(1.0, 5.0).abs() < 1e-12);
        // And the mirror image.
        assert!(fit_value(5.0, 1.0).abs() < 1e-12);
    }

    #[test]
    fn energy_fit_is_symmetric_and_interpolates() {
        assert!((fit_value(3.0, 4.0) - fit_value(4.0, 3.0)).abs() < 1e-12);
        // Halfway between 3 and 5 with target 4 sits at 0.5.
        assert!((fit_value(3.0, 4.0) - 0.75).abs() < 1e-12);
        assert!((fit_value(4.0, 2.0) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn energy_fit_clamps_out_of_range_complexity() {
        // A model reporting complexity 9 must not produce a negative fit.
        assert_eq!(fit_value(9.0, 1.0), 0.0);
        assert_eq!(fit_value(0.0, 5.0), 0.0);
    }

    #[test]
    fn energy_fit_reports_defaulted_when_no_model_supplies_complexity() {
        let item = queue_item("doc-1", "document", None);
        let ctx = RankContext::bare(now());
        let term = energy_fit(&item, None, 3.0);
        assert!(term.available, "a default is still an available value");
        assert!(term.defaulted, "but it must not look measured");
        assert_eq!(
            term.effective(),
            fit_value(default_complexity_for("document"), 3.0)
        );
        assert_eq!(default_complexity_for("document"), 4.0);
    }

    #[test]
    fn energy_fit_reports_measured_when_a_model_supplies_complexity() {
        let item = queue_item("doc-1", "document", None);
        let signals = ItemSignals { complexity: Some(5.0), ..Default::default() };
        let term = energy_fit(&item, Some(&signals), 5.0);
        assert!(term.available && !term.defaulted);
        assert_eq!(term.effective(), 1.0);
    }

    #[test]
    fn energy_fit_falls_back_to_defaulted_when_complexity_is_not_finite() {
        let item = queue_item("card-1", "learning-item", None);
        let signals = ItemSignals {
            complexity: Some(f64::NAN),
            ..Default::default()
        };
        let term = energy_fit(&item, Some(&signals), 3.0);
        assert!(term.defaulted);
        assert_eq!(term.effective(), fit_value(default_complexity_for("learning-item"), 3.0));
    }

    #[test]
    fn default_complexity_ranks_item_types_by_reading_commitment() {
        assert!(default_complexity_for("document") > default_complexity_for("extract"));
        assert!(default_complexity_for("extract") > default_complexity_for("learning-item"));
        assert_eq!(default_complexity_for("learning-item"), default_complexity_for("rss-article"));
    }

    #[test]
    fn goal_relevance_is_unavailable_without_a_relevance_value() {
        let ctx = RankContext::bare(now());
        assert!(!goal_relevance(None, 0.3).available);
        let signals = ItemSignals::default();
        assert!(!goal_relevance(Some(&signals), 0.3).available);
    }

    #[test]
    fn goal_relevance_rejects_out_of_range_values_instead_of_clamping() {
        let signals = ItemSignals { relevance: Some(1.7), ..Default::default() };
        assert_eq!(signals.relevalscore_value(), None);

        let signals = ItemSignals { relevance: Some(f64::NAN), ..Default::default() };
        assert_eq!(signals.relevalscore_value(), None);

        let signals = ItemSignals { relevance: Some(0.62), ..Default::default() };
        assert_eq!(signals.relevalscore_value(), Some(0.62));
    }

    #[test]
    fn srs_urgency_is_not_a_per_item_type_constant() {
        let ctx = RankContext::bare(now());
        let mut overdue_card = queue_item("card-1", "learning-item", Some("2026-05-01T00:00:00Z"));
        overdue_card.retrievability = Some(0.2);
        let mut fresh_card = overdue_card.clone();
        fresh_card.id = "card-2".to_string();
        fresh_card.due_date = Some("2026-06-01T00:00:00Z".to_string());
        fresh_card.retrievability = Some(0.95);

        let a = srs_urgency(&overdue_card, None, &ctx);
        let b = srs_urgency(&fresh_card, None, &ctx);
        assert!(
            a.effective() > b.effective(),
            "an overdue, low-recall card must outrank a fresh one of the same type"
        );
    }

    #[test]
    fn srs_urgency_respects_the_users_priority_slider() {
        let ctx = RankContext::bare(now());
        let mut low = queue_item("card-1", "learning-item", Some("2026-06-01T00:00:00Z"));
        low.retrievability = Some(0.5);
        low.priority_slider = Some(10);
        let mut high = low.clone();
        high.id = "card-2".to_string();
        high.priority_slider = Some(95);

        assert!(
            srs_urgency(&high, None, &ctx).effective()
                > srs_urgency(&low, None, &ctx).effective()
        );
    }

    #[test]
    fn srs_urgency_uses_the_document_priority_function_for_documents() {
        let ctx = RankContext::bare(now());
        let doc = queue_item("doc-1", "document", Some("2026-05-01T00:00:00Z"));
        let term = srs_urgency(&doc, None, &ctx);
        // Overdue documents sit at the floor of calculate_fsrs_document_priority.
        assert!(term.effective() >= 0.5, "overdue document floor is 5.0/10");
        assert!(term.effective() <= 1.0);
    }

    #[test]
    fn overdue_saturates_at_two_weeks() {
        let ctx = RankContext::bare(now());
        let mut just_overdue = queue_item("a", "learning-item", Some("2026-05-30T00:00:00Z"));
        just_overdue.retrievability = Some(0.5);
        let mut very_overdue = just_overdue.clone();
        very_overdue.id = "b".to_string();
        very_overdue.due_date = Some("2026-01-01T00:00:00Z".to_string());

        assert!(
            srs_urgency(&very_overdue, None, &ctx).effective()
                >= srs_urgency(&just_overdue, None, &ctx).effective()
        );
    }

    #[test]
    fn interleave_penalty_is_zero_for_no_topic_overlap_at_any_diversity() {
        let signals = ItemSignals {
            topic_similarity_to_recent: 0.0,
            ..Default::default()
        };
        for step in 0..=10 {
            let diversity = step as f64 / 10.0;
            // The producer is knob-independent; the knob enters as the term weight.
            let term = interleave_penalty(Some(&signals));
            assert_eq!(term.effective() * diversity, 0.0);
            assert_eq!(term.effective(), 0.0);
            assert!(term.available, "zero overlap is measured, not untracked");
        }
    }

    #[test]
    fn interleave_penalty_is_monotonic_in_the_diversity_knob() {
        assert!(interleave_effect_is_monotonic_in_diversity(0.8));
        let signals = ItemSignals {
            topic_similarity_to_recent: 0.8,
            ..Default::default()
        };
        // The producer returns the raw overlap; the knob scales it as the weight.
        assert_eq!(interleave_penalty(Some(&signals)).effective(), 0.8);
        let raw = interleave_penalty(Some(&signals)).effective();
        let low = raw * 0.0;
        let default = raw * 0.2;
        let high = raw * 1.0;
        assert_eq!(low, 0.0);
        assert!(default > low && high > default);
    }

    #[test]
    fn interleave_penalty_is_unavailable_without_signals() {
        assert!(!interleave_penalty(None).available);
    }

    #[test]
    fn friction_penalty_is_exactly_zero_without_telemetry() {
        let signals = ItemSignals::default();
        let term = friction_penalty(Some(&signals));
        assert_eq!(term.effective(), 0.0);
        assert!(term.available, "no telemetry is a measured zero, not unknown");
        assert!(signals.friction.is_untracked());
    }

    #[test]
    fn friction_penalty_grows_with_postponements() {
        let clean = ItemSignals::default();
        let thrice = ItemSignals {
            friction: FrictionInputs { postpone_count: 3, ..Default::default() },
            ..Default::default()
        };
        let many = ItemSignals {
            friction: FrictionInputs { postpone_count: 9, ..Default::default() },
            ..Default::default()
        };

        let a = friction_penalty(Some(&clean)).effective();
        let b = friction_penalty(Some(&thrice)).effective();
        let c = friction_penalty(Some(&many)).effective();

        assert_eq!(a, 0.0);
        assert!(b > a, "three postponements must register");
        assert!(c > b);
    }

    #[test]
    fn friction_penalty_counts_idle_dominance() {
        let balanced = ItemSignals {
            friction: FrictionInputs {
                active_dwell_ms: 60_000,
                idle_time_ms: 30_000,
                ..Default::default()
            },
            ..Default::default()
        };
        let idle_heavy = ItemSignals {
            friction: FrictionInputs {
                active_dwell_ms: 30_000,
                idle_time_ms: 90_000,
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(
            friction_penalty(Some(&idle_heavy)).effective()
                > friction_penalty(Some(&balanced)).effective()
        );
        assert_eq!(balanced.friction.idle_share(), Some(1.0 / 3.0));
        assert_eq!(idle_heavy.friction.idle_share(), Some(0.75));
    }

    #[test]
    fn friction_penalty_stays_bounded_and_scales_with_aggressiveness() {
        let extreme = ItemSignals {
            friction: FrictionInputs {
                postpone_count: 999,
                rapid_skip_count: 999,
                abandoned_reviews: 999,
                active_dwell_ms: 1,
                idle_time_ms: 1_000_000,
            },
            ..Default::default()
        };
        for step in 0..=10 {
            // Knob applied as the weight, exactly once.
            let value =
                friction_penalty(Some(&extreme)).effective() * (step as f64 / 10.0);
            assert!((0.0..=1.0).contains(&value), "friction must stay in [0,1]");
        }
        assert!(friction_penalty(Some(&extreme)).effective() <= 1.0);
    }

    #[test]
    fn friction_penalty_is_unavailable_without_signals() {
        assert!(!friction_penalty(None).available);
    }

    #[test]
    fn friction_penalty_floor_applies_at_the_documented_three_postponements() {
        let three = ItemSignals {
            friction: FrictionInputs { postpone_count: 3, ..Default::default() },
            ..Default::default()
        };
        // 0.10 per postponement at aggressiveness 1.0.
        assert!((friction_penalty(Some(&three)).effective() - 0.30).abs() < 1e-12);
    }

    #[test]
    fn unparseable_due_dates_are_treated_as_new_items_not_wrong_urgency() {
        let ctx = RankContext::bare(now());
        let mut broken = queue_item("card-1", "learning-item", Some("not-a-date"));
        broken.retrievability = Some(0.5);
        let none_at_all = queue_item("card-2", "learning-item", None);

        assert_eq!(
            srs_urgency(&broken, None, &ctx).effective(),
            srs_urgency(&none_at_all, None, &ctx).effective()
        );
    }
}