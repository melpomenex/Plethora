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
use serde::{Deserialize, Serialize};

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
    /// The decision model's judgement of how well this item serves the session
    /// goal, in `[0,1]`. Session-dependent, so never served from the content-hash
    /// cache.
    pub goal_alignment: Option<f64>,
    /// The same judgement derived locally by lexical overlap between the goal and
    /// the item's own text, in `[0,1]`. `None` when no goal is set or the item has
    /// nothing comparable, which is what makes the term *unavailable* rather than
    /// zero in that case.
    ///
    /// Kept apart from `relevance` rather than merged into it: `relevance` is a
    /// four-signal blend owned by `algorithms::relevance` with weight
    /// redistribution, and folding a goal score into it would both fork that blend
    /// and make the breakdown unattributable.
    pub local_goal_alignment: Option<f64>,
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

/// Canonical ranking components computed at a fixed UTC instant (D2).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CanonicalUrgencyEvidence {
    pub temporal_urgency: f64,
    pub temporal_available: bool,
    pub overdue_urgency: f64,
    pub memory_urgency: f64,
    pub canonical_priority: f64,
    pub priority_available: bool,
}

/// Calculate pure explicit-clock canonical urgency evidence (D2).
///
/// `M = 0.8 * T + 0.2 * P`
///
/// Rotational items:
///   T = 0.0 if valid due_at > now
///   T = A   if valid due_at <= now
///   T = 0.5 if new / missing due date
///
/// Recall items:
///   R = 1 - r (when r is valid scheduler retrievability at now)
///   T = R         if future due and r is valid; else 0.0
///   T = max(R, A) if due and r is valid; else A
///   T = 0.5       if new / missing due date
pub fn calculate_canonical_urgency(
    item: &QueueItem,
    now: DateTime<Utc>,
    priority_override: Option<f64>,
) -> CanonicalUrgencyEvidence {
    // 1. Resolve canonical priority P
    let (p_raw, p_avail) = if let Some(p) = priority_override {
        if p.is_finite() && (0.0..=1.0).contains(&p) {
            (p, true)
        } else {
            (0.5, false)
        }
    } else if let Some(p) = item.canonical_priority {
        if p.is_finite() && (0.0..=1.0).contains(&p) {
            (p, item.priority_available.unwrap_or(true))
        } else {
            (0.5, false)
        }
    } else if let Some(slider) = item.priority_slider {
        ((slider.clamp(0, 100) as f64) / 100.0, true)
    } else if let Some(rating) = item.priority_rating {
        ((crate::algorithms::resolve_priority_slider(0, rating) as f64) / 100.0, true)
    } else {
        (0.5, false)
    };
    let p = p_raw.clamp(0.0, 1.0);

    // 2. Parse due date & compute overdue readiness A and lateness O
    let due = parse_due(item.due_date.as_deref());
    let (d, o, a) = match due {
        Some(due_at) if due_at <= now => {
            let ms = (now - due_at).num_milliseconds() as f64;
            let d_frac = if ms.is_finite() && ms >= 0.0 {
                ms / 86_400_000.0
            } else {
                0.0
            };
            let o_val: f64 = if d_frac > 0.0 {
                let raw_o = -(-d_frac / 14.0).exp_m1();
                if raw_o.is_finite() {
                    raw_o.clamp(0.0, 1.0)
                } else {
                    1.0
                }
            } else {
                0.0
            };
            let a_val = (0.5_f64 + 0.5_f64 * o_val).clamp(0.0, 1.0);
            (d_frac, o_val, a_val)
        }
        Some(_) => (0.0, 0.0, 0.5),
        None => (0.0, 0.0, 0.5),
    };
    let _ = d;

    // 3. Evaluate retrievability r for recall items (learning-item)
    let is_recall = item.item_type == "learning-item";
    let (t, t_avail) = if is_recall {
        let r_val = if let Some(ret) = item.retrievability {
            if ret.is_finite() && (0.0..=1.0).contains(&ret) {
                Some(ret)
            } else {
                None
            }
        } else if let (Some(stab), Some(diff)) = (item.stability, item.difficulty) {
            if stab > 0.0 && diff > 0.0 && stab.is_finite() && diff.is_finite() {
                let last_rev = parse_due(item.last_review_date.as_deref());
                let elapsed_days = match last_rev {
                    Some(lr) if lr <= now => {
                        let ms = (now - lr).num_milliseconds() as f64;
                        if ms >= 0.0 && ms.is_finite() {
                            Some(ms / 86_400_000.0)
                        } else {
                            None
                        }
                    }
                    _ => None,
                };
                if let Some(elapsed) = elapsed_days {
                    let ms = crate::models::MemoryState {
                        stability: stab,
                        difficulty: diff,
                        stability_fast: item.stability_fast,
                    };
                    crate::algorithms::fsrs7::current_retrievability(&ms, elapsed)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        match (due, r_val) {
            (Some(due_at), Some(r)) => {
                let r_risk = (1.0 - r).clamp(0.0, 1.0);
                if due_at > now {
                    (r_risk, true)
                } else {
                    (r_risk.max(a).clamp(0.0, 1.0), true)
                }
            }
            (Some(due_at), None) => {
                if due_at > now {
                    (0.0, false)
                } else {
                    (a, true)
                }
            }
            (None, _) => (0.5, false),
        }
    } else {
        // Rotational items
        match due {
            Some(due_at) if due_at > now => (0.0, true),
            Some(_) => (a, true),
            None => (0.5, false),
        }
    };

    let m_raw = 0.8 * t + 0.2 * p;
    let m = if m_raw.is_finite() {
        m_raw.clamp(0.0, 1.0)
    } else {
        0.5
    };

    CanonicalUrgencyEvidence {
        temporal_urgency: t,
        temporal_available: t_avail,
        overdue_urgency: o,
        memory_urgency: m,
        canonical_priority: p,
        priority_available: p_avail,
    }
}

/// `R_srs(i)` — spaced-repetition urgency in `[0,1]` (D2).
pub fn srs_urgency(
    item: &QueueItem,
    _signals: Option<&ItemSignals>,
    ctx: &RankContext<'_>,
) -> TermValue {
    let evidence = calculate_canonical_urgency(item, ctx.now, None);
    if evidence.temporal_available || evidence.priority_available {
        TermValue::measured(evidence.memory_urgency)
    } else {
        TermValue::defaulted(evidence.memory_urgency)
    }
}

// ------------------------------------------------------- M_relevance

/// A `[0,1]` value, or `None` when absent, non-finite, or out of range.
///
/// One gate for every term input: a value outside the unit interval is rejected
/// rather than clamped, because a clamped value is indistinguishable from a real
/// measurement and would present a broken producer as a plausible source of signal.
fn finite_unit(value: Option<f64>) -> Option<f64> {
    match value {
        Some(value) if value.is_finite() && (0.0..=1.0).contains(&value) => Some(value),
        _ => None,
    }
}

/// `M_relevance(i)` — how well the item serves the session goal, in `[0,1]`.
///
/// Resolves from three tiers, strongest evidence first:
///
/// 1. the decision model's judgement of this item against the goal
///    (`ItemSignals::goal_alignment`) — a real verdict, reported as measured;
/// 2. local lexical overlap between the goal and the item's own text
///    (`ItemSignals::local_goal_alignment`) — a stand-in for having no model,
///    reported as **defaulted** so the breakdown can say it was derived rather than
///    judged;
/// 3. `relevance.rs`'s tag-affinity composite, used when there is no goal to compare
///    against at all.
///
/// With no goal, no model verdict and no relevance value, the term reports itself
/// unavailable. That is the whole point of the tiering: "the user has not said what
/// they are studying" must not be rendered as "nothing here is relevant".
///
/// Tier 3 still delegates rather than recomputing: `relevance.rs` owns the
/// four-signal blend (classifier 0.4 / tag affinity 0.25 / rating history 0.2 /
/// semantic 0.15) and redistributes a missing signal's weight proportionally among
/// the survivors with a 0.5 cold start. Re-deriving any of that here would fork the
/// scoring and let the two drift.
pub fn goal_relevance(signals: Option<&ItemSignals>, _knob_w: f64) -> TermValue {
    let Some(signals) = signals else {
        return TermValue::unavailable();
    };
    if let Some(measured) = signals.goal_alignment_value() {
        return TermValue::measured(measured);
    }
    if let Some(derived) = signals.local_goal_alignment_value() {
        return TermValue::defaulted(derived);
    }
    match signals.relevalscore_value() {
        Some(value) => TermValue::measured(value),
        None => TermValue::unavailable(),
    }
}

impl ItemSignals {
    /// The decision model's goal-alignment verdict, rejected when it is not a
    /// usable number — same reasoning as [`Self::relevalscore_value`], because a
    /// provider reporting `1.7` is broken and a clamped value would be
    /// indistinguishable from a real one.
    pub fn goal_alignment_value(&self) -> Option<f64> {
        finite_unit(self.goal_alignment)
    }

    /// The locally derived alignment, validated on the same terms.
    pub fn local_goal_alignment_value(&self) -> Option<f64> {
        finite_unit(self.local_goal_alignment)
    }

    /// The relevance value, rejected when it is not a usable number rather than
    /// clamped — a model or signal pipeline reporting `1.7` is broken, and
    /// silently clamping it would present a fabricated score.
    pub fn relevalscore_value(&self) -> Option<f64> {
        finite_unit(self.relevance)
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
            ..Default::default()
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
    fn a_local_alignment_is_available_but_never_looks_measured() {
        // No decision model, but the goal matched something: a real number the UI
        // can rank by, flagged so it is never presented as a model verdict.
        let signals = ItemSignals { local_goal_alignment: Some(0.4), ..Default::default() };
        let term = goal_relevance(Some(&signals), 0.3);
        assert!(term.available);
        assert!(term.defaulted);
        assert_eq!(term.effective(), 0.4);
    }

    #[test]
    fn a_model_verdict_outranks_a_locally_derived_one_and_is_not_defaulted() {
        let signals = ItemSignals {
            goal_alignment: Some(0.9),
            local_goal_alignment: Some(0.1),
            ..Default::default()
        };
        let term = goal_relevance(Some(&signals), 0.3);
        assert!(term.available && !term.defaulted, "a real verdict is measured");
        assert_eq!(term.effective(), 0.9);
    }

    #[test]
    fn an_out_of_range_goal_verdict_is_rejected_and_falls_through() {
        // A provider claiming 1.7 is broken. Refusing it lands on the local tier
        // rather than presenting a clamped 1.0 as a measurement.
        let signals = ItemSignals {
            goal_alignment: Some(1.7),
            local_goal_alignment: Some(0.5),
            ..Default::default()
        };
        let term = goal_relevance(Some(&signals), 0.3);
        assert!(term.defaulted);
        assert_eq!(term.effective(), 0.5);
    }

    #[test]
    fn a_non_finite_goal_verdict_is_rejected() {
        let signals = ItemSignals { goal_alignment: Some(f64::NAN), ..Default::default() };
        assert_eq!(signals.goal_alignment_value(), None);
        assert!(!goal_relevance(Some(&signals), 0.3).available);
    }

    #[test]
    fn no_goal_leaves_the_term_unavailable_rather_than_scoring_zero() {
        // The distinction the goal field exists to preserve: the user has not said
        // what they are studying, which is not the same as nothing being relevant.
        let signals = ItemSignals { relevance: None, ..Default::default() };
        let term = goal_relevance(Some(&signals), 0.3);
        assert!(!term.available);
        assert!(!term.defaulted);
        assert_eq!(term.effective(), 0.0);
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

    #[test]
    fn r01_boundary_matrix_overdue_saturation() {
        let n = now();
        let days = [0.0, 1.0, 7.0, 14.0, 30.0, 90.0, 300.0];
        let expected_o = [
            0.0,
            0.06893739,
            0.39346934,
            0.63212056,
            0.88270342,
            0.99838515,
            0.9999999995,
        ];

        for (i, &d) in days.iter().enumerate() {
            let due = n - chrono::Duration::milliseconds((d * 86_400_000.0) as i64);
            let mut item = queue_item("doc-test", "document", Some(&due.to_rfc3339()));
            item.canonical_priority = Some(0.5);
            let evidence = calculate_canonical_urgency(&item, n, None);

            assert!(
                (evidence.overdue_urgency - expected_o[i]).abs() < 1e-4,
                "d={}: expected O ≈ {}, got {}",
                d,
                expected_o[i],
                evidence.overdue_urgency
            );

            let expected_a = 0.5 + 0.5 * expected_o[i];
            assert!(
                (evidence.temporal_urgency - expected_a).abs() < 1e-4,
                "d={}: expected A/T ≈ {}, got {}",
                d,
                expected_a,
                evidence.temporal_urgency
            );
        }
    }

    #[test]
    fn r01_independent_m_slope_is_point_two() {
        let n = now();
        let mut item = queue_item("card-slope", "learning-item", None);
        // New item: T = 0.5
        let p_steps = [0.0, 0.25, 0.50, 0.75, 1.0];
        let mut prev_m: Option<f64> = None;

        for &p in &p_steps {
            item.canonical_priority = Some(p);
            let ev = calculate_canonical_urgency(&item, n, None);
            assert_eq!(ev.temporal_urgency, 0.5, "T must not contain manual input");

            let expected_m = 0.8 * 0.5 + 0.2 * p;
            assert!(
                (ev.memory_urgency - expected_m).abs() < 1e-12,
                "p={}: expected M={}, got {}",
                p,
                expected_m,
                ev.memory_urgency
            );

            if let Some(prev) = prev_m {
                let diff: f64 = ev.memory_urgency - prev;
                assert!(
                    (diff - 0.05).abs() < 1e-12,
                    "each 0.25 step in P must produce exactly 0.05 step in M, got {}",
                    diff
                );
            }
            prev_m = Some(ev.memory_urgency);
        }
    }

    #[test]
    fn r01_weak_recall_card_and_important_new_acceptance_judgments() {
        let n = now();

        // 1. Weak recall card: r = 0.2, due now -> R = 0.8, A = 0.5, T = 0.8.
        // With P = 0.5: M = 0.8 * 0.8 + 0.2 * 0.5 = 0.74.
        let mut weak_card = queue_item("weak", "learning-item", Some(&n.to_rfc3339()));
        weak_card.retrievability = Some(0.2);
        weak_card.canonical_priority = Some(0.5);
        let weak_ev = calculate_canonical_urgency(&weak_card, n, None);
        assert!((weak_ev.temporal_urgency - 0.8).abs() < 1e-12);
        assert!((weak_ev.memory_urgency - 0.74).abs() < 1e-12);

        // 2. Important new item (P = 1.0, T = 0.5 -> M = 0.60)
        let mut important_new = queue_item("new-top", "document", None);
        important_new.canonical_priority = Some(1.0);
        let new_ev = calculate_canonical_urgency(&important_new, n, None);
        assert!((new_ev.memory_urgency - 0.60).abs() < 1e-12);

        // 3. Modest 7-day overdue item with low priority (P = 0.0)
        let week_ago = n - chrono::Duration::days(7);
        let mut overdue_low = queue_item("overdue-low", "document", Some(&week_ago.to_rfc3339()));
        overdue_low.canonical_priority = Some(0.0);
        let overdue_ev = calculate_canonical_urgency(&overdue_low, n, None);
        // A ≈ 0.696735, M = 0.8 * A ≈ 0.55739 < 0.60
        assert!(
            new_ev.memory_urgency > overdue_ev.memory_urgency,
            "Important new item (M={}) must outrank modest 7-day overdue low-priority item (M={})",
            new_ev.memory_urgency,
            overdue_ev.memory_urgency
        );
    }

    #[test]
    fn r01_missing_and_extreme_values_safe_fallback() {
        let n = now();
        let mut nan_item = queue_item("nan", "document", None);
        nan_item.canonical_priority = Some(f64::NAN);
        let ev = calculate_canonical_urgency(&nan_item, n, None);
        assert_eq!(ev.canonical_priority, 0.5);
        assert!(!ev.priority_available);
        assert_eq!(ev.memory_urgency, 0.5);

        let mut future_doc = queue_item("future", "document", Some(&(n + chrono::Duration::days(5)).to_rfc3339()));
        future_doc.canonical_priority = Some(0.8);
        let fut_ev = calculate_canonical_urgency(&future_doc, n, None);
        assert_eq!(fut_ev.temporal_urgency, 0.0, "Future rotational items have T=0");
        assert!((fut_ev.memory_urgency - 0.16).abs() < 1e-12);
    }

    #[test]
    fn r01_fixed_workload_design_table_parity() {
        let n = now();

        // 1. New important document, slider/rank 75% -> M = 0.550000
        let mut d1 = queue_item("d1", "document", None);
        d1.canonical_priority = Some(0.75);
        let ev1 = calculate_canonical_urgency(&d1, n, None);
        assert!((ev1.memory_urgency - 0.550000).abs() < 1e-5);

        // 2. 30-day late document, 25% -> M = 0.803072
        let mut d2 = queue_item("d2", "document", Some(&(n - chrono::Duration::days(30)).to_rfc3339()));
        d2.canonical_priority = Some(0.25);
        let ev2 = calculate_canonical_urgency(&d2, n, None);
        assert!((ev2.memory_urgency - 0.803072).abs() < 1e-4);

        // 3. 14-day late document, 25% -> M = 0.702848
        let mut d3 = queue_item("d3", "document", Some(&(n - chrono::Duration::days(14)).to_rfc3339()));
        d3.canonical_priority = Some(0.25);
        let ev3 = calculate_canonical_urgency(&d3, n, None);
        assert!((ev3.memory_urgency - 0.702848).abs() < 1e-4);

        // Monotone lateness check: 30-day late MUST beat 14-day late (no day-14 decline!)
        assert!(ev2.memory_urgency > ev3.memory_urgency, "30-day late must outrank 14-day late (no day-14 decline)");

        // 4. Due now document, 25% -> M = 0.450000
        let mut d4 = queue_item("d4", "document", Some(&n.to_rfc3339()));
        d4.canonical_priority = Some(0.25);
        let ev4 = calculate_canonical_urgency(&d4, n, None);
        assert!((ev4.memory_urgency - 0.450000).abs() < 1e-5);

        // 5. Due now document, 75% -> M = 0.550000 (ΔM = 0.10 for ΔP = 0.50)
        let mut d5 = queue_item("d5", "document", Some(&n.to_rfc3339()));
        d5.canonical_priority = Some(0.75);
        let ev5 = calculate_canonical_urgency(&d5, n, None);
        assert!((ev5.memory_urgency - 0.550000).abs() < 1e-5);
        assert!((ev5.memory_urgency - ev4.memory_urgency - 0.10).abs() < 1e-5);

        // 6. New top-ranked document, 100% -> M = 0.600000
        let mut d6 = queue_item("d6", "document", None);
        d6.canonical_priority = Some(1.0);
        let ev6 = calculate_canonical_urgency(&d6, n, None);
        assert!((ev6.memory_urgency - 0.600000).abs() < 1e-5);

        // 7. 7-day late bottom-ranked document, explicit 0% -> M = 0.557388
        let mut d7 = queue_item("d7", "document", Some(&(n - chrono::Duration::days(7)).to_rfc3339()));
        d7.canonical_priority = Some(0.0);
        d7.priority_explicitly_set = Some(true);
        let ev7 = calculate_canonical_urgency(&d7, n, None);
        assert!((ev7.memory_urgency - 0.557388).abs() < 1e-4);

        // Top-priority new beats 7-day late bottom-ranked
        assert!(ev6.memory_urgency > ev7.memory_urgency);

        // 8. Future reviewed document +7 days, 100% -> M = 0.200000
        let mut d8 = queue_item("d8", "document", Some(&(n + chrono::Duration::days(7)).to_rfc3339()));
        d8.canonical_priority = Some(1.0);
        let ev8 = calculate_canonical_urgency(&d8, n, None);
        assert!((ev8.memory_urgency - 0.200000).abs() < 1e-5);

        // 9. Due card with r = 0.20, P = 0.50, O = 0 -> M = 0.740000
        let mut c9 = queue_item("c9", "learning-item", Some(&n.to_rfc3339()));
        c9.retrievability = Some(0.20);
        c9.canonical_priority = Some(0.50);
        let ev9 = calculate_canonical_urgency(&c9, n, None);
        assert!((ev9.memory_urgency - 0.740000).abs() < 1e-5);
    }

    #[test]
    fn r01_monotonicity_and_saturation_properties() {
        let n = now();
        let mut prev_o = -1.0;
        let mut prev_a = -1.0;
        for day in 0..=365 {
            let due = n - chrono::Duration::days(day);
            let mut item = queue_item("doc", "document", Some(&due.to_rfc3339()));
            item.canonical_priority = Some(0.5);
            let ev = calculate_canonical_urgency(&item, n, None);
            assert!(ev.overdue_urgency >= prev_o);
            assert!(ev.temporal_urgency >= prev_a);
            assert!(ev.overdue_urgency <= 1.0);
            assert!(ev.temporal_urgency <= 1.0);
            assert!(ev.memory_urgency <= 1.0);
            assert!(ev.memory_urgency >= 0.0);
            prev_o = ev.overdue_urgency;
            prev_a = ev.temporal_urgency;
        }

        // Extreme overdue (100,000 days)
        let huge_due = n - chrono::Duration::days(100_000);
        let mut huge_item = queue_item("doc-huge", "document", Some(&huge_due.to_rfc3339()));
        huge_item.canonical_priority = Some(0.5);
        let huge_ev = calculate_canonical_urgency(&huge_item, n, None);
        assert!((huge_ev.overdue_urgency - 1.0).abs() < 1e-6);
        assert!((huge_ev.temporal_urgency - 1.0).abs() < 1e-6);
        assert!((huge_ev.memory_urgency - 0.9).abs() < 1e-6);
    }

    #[test]
    fn r01_unicode_identities_and_deterministic_ordering() {
        let n = now();
        let mut item_a = queue_item("карточка-1", "learning-item", Some(&n.to_rfc3339()));
        let mut item_b = queue_item("карточка-2", "learning-item", Some(&n.to_rfc3339()));
        item_a.canonical_priority = Some(0.5);
        item_b.canonical_priority = Some(0.5);

        let selector = crate::algorithms::queue_selector::QueueSelector::default();
        let mut list = vec![item_b.clone(), item_a.clone()];
        selector.sort_queue_items_at(&mut list, n);
        assert_eq!(list[0].id, "карточка-1");
        assert_eq!(list[1].id, "карточка-2");
    }
}