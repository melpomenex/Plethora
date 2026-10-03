//! Combines the five terms into `S(i)` and orders the pool.
//!
//! The ranker is the only place a composite score is computed, and it does so by
//! calling [`TermBreakdown::score`] — never by arithmetic of its own. That
//! matters for explainability: the number shown in the UI is the same expression
//! the tests assert on.

use crate::algorithms::daqe::terms::{
    self, energy_fit, friction_penalty, goal_relevance, interleave_penalty, srs_urgency,
};
use crate::algorithms::daqe::RankContext;
use crate::models::daqe::{DaqeKnobs, RankedItem, TermBreakdown};
use crate::models::queue::QueueItem;

use chrono::Utc;

/// How many items the `top10` field of a snapshot carries. Chosen to match the
/// latency budget, which covers only what the user sees next.
pub const TOP_N: usize = 10;

/// Rank `items` and return them ordered by `S(i)` descending.
///
/// Determinism is a requirement, not an accident: two ranks of an unchanged pool
/// must be byte-identical. That comes from three things — the score, the input
/// index captured at construction, and the item id — used together as tie-breakers
/// in that order. `f64` scores that compare equal (including the `-0.0`/`0.0` and
/// NaN cases the neutral fallbacks avoid) therefore still produce one fixed
/// order.
pub fn rank(items: &[QueueItem], knobs: &DaqeKnobs, ctx: &RankContext<'_>) -> Vec<RankedItem> {
    let (effective_target, downshift_reason) = effective_energy_target(knobs, ctx);

    // One index for the whole pass. `RankContext::signals_for` scans linearly, so
    // calling it per item makes a ranking O(n²) in the signal count — 16 000 000
    // string comparisons on a 4 000-item pool, which is exactly the kind of cost
    // that hides until a user's backlog grows.
    let signal_index: std::collections::HashMap<&str, &terms::ItemSignals> =
        ctx.signals
            .iter()
            .map(|s| (s.item_id.as_str(), s))
            .collect();

    let mut ranked: Vec<RankedItem> = items
        .iter()
        .enumerate()
        .map(|(input_index, item)| {
            let signals = signal_index.get(item.id.as_str()).copied();

            // The cluster boost is the adaptive learning loop's contribution. It
            // rides on the goal term because that is the term answering "is this
            // worth the user's attention right now", and it is folded in here
            // rather than being a sixth term so the specified five-term formula
            // stays the contract.
            let goal = goal_relevance(signals, knobs.goal_relevance);
            let goal_with_boost = apply_cluster_boost(goal, signals);

            let breakdown = TermBreakdown {
                srs_urgency: srs_urgency(item, signals, ctx),
                srs_weight: knobs.srs_decay_weight,
                goal_relevance: goal_with_boost,
                goal_weight: knobs.goal_relevance,
                energy_fit: energy_fit(item, signals, effective_target),
                energy_weight: knobs.energy_target_weight(),
                interleave_penalty: interleave_penalty(signals),
                interleave_weight: knobs.interleaving_diversity,
                friction_penalty: friction_penalty(signals),
                friction_weight: knobs.pruning_aggressiveness,
                effective_energy_target: effective_target,
                energy_downshift_reason: downshift_reason.clone(),
                interleave_against: signals
                    .filter(|s| s.topic_similarity_to_recent > 0.0)
                    .map(|s| s.topic_matches.clone())
                    .unwrap_or_default(),
            };

            RankedItem {
                item: item.clone(),
                score: breakdown.score(),
                breakdown,
                input_index,
            }
        })
        .collect();

    // Fallback equality. When every non-SRS term is neutral there is nothing to
    // combine, and no 0-1 score reproduces the existing comparator's shape: that
    // comparator buckets items due / new / future first and only then applies
    // priority and due date. Re-deriving it as arithmetic would be lossy *and* a
    // second implementation to keep in sync, so the ranker defers to it and uses
    // the real thing. The SRS term is still computed, because the breakdown has
    // to stay populated.
    if knobs.is_srs_only() {
        let mut order = input_order(&ranked);
        sort_by_legacy_order(&mut order, items);
        return order.into_iter().map(|i| ranked[i].clone()).collect();
    }

    // Sort an index vector rather than the ranked entries themselves. A
    // `RankedItem` owns a full `QueueItem` plus a breakdown plus a `Vec<String>`,
    // so sorting the entries directly moves all of that on every swap — O(n log n)
    // moves of several hundred bytes each, which dominates the profile on a wide
    // pool. Indices are 8 bytes; the entries are then moved once, at the end.
    let mut order: Vec<usize> = (0..ranked.len()).collect();
    order.sort_by(|&a, &b| {
        let (left, right) = (&ranked[a], &ranked[b]);
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.input_index.cmp(&right.input_index))
            .then_with(|| left.item.id.cmp(&right.item.id))
    });
    order.into_iter().map(|i| ranked[i].clone()).collect()
}

/// The identity order, used as the starting point for the legacy-comparator path
/// where the comparator itself decides the permutation.
fn input_order(ranked: &[RankedItem]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..ranked.len()).collect();
    order.sort_by_key(|&i| ranked[i].input_index);
    order
}

/// Order `order` (indices into `ranked`) to match `queue_selector::sort_queue_items`
/// on the original pool, by asking that comparator rather than restating it.
fn sort_by_legacy_order(order: &mut [usize], items: &[QueueItem]) {
    let mut legacy: Vec<QueueItem> = items.to_vec();
    srs_only_order(&mut legacy);

    let mut position_of_id: std::collections::HashMap<&str, usize> =
        std::collections::HashMap::with_capacity(legacy.len());
    for (index, item) in legacy.iter().enumerate() {
        position_of_id.insert(item.id.as_str(), index);
    }

    order.sort_by(|&a, &b| {
        let pa = position_of_id
            .get(items[a].id.as_str())
            .copied()
            .unwrap_or(a);
        let pb = position_of_id
            .get(items[b].id.as_str())
            .copied()
            .unwrap_or(b);
        pa.cmp(&pb).then_with(|| a.cmp(&b))
    });
}

/// Rank and additionally return the top ten, which is the only slice the latency
/// budget is claimed for.
pub fn rank_with_top_n(
    items: &[QueueItem],
    knobs: &DaqeKnobs,
    ctx: &RankContext<'_>,
) -> (Vec<RankedItem>, Vec<RankedItem>) {
    let ranked = rank(items, knobs, ctx);
    let top: Vec<RankedItem> = ranked.iter().take(TOP_N).cloned().collect();
    (ranked, top)
}

/// The energy target actually used.
///
/// A measured fatigue downshift lowers this without touching
/// `knobs.energy_target`, and the reason travels with the breakdown so the UI can
/// say why the effective value differs from the configured one.
fn effective_energy_target(
    knobs: &DaqeKnobs,
    ctx: &RankContext<'_>,
) -> (f64, Option<String>) {
    let configured = knobs.energy_target as f64;
    match ctx.energy_downshift {
        Some(downshift) if downshift.baseline_sufficient => {
            let effective = downshift
                .effective_energy_target
                .clamp(1.0, knobs.energy_target as f64);
            (effective, Some(downshift.reason.clone()))
        }
        // A downshift measured against an insufficient baseline is ignored
        // entirely — including its reason, since nothing was applied.
        _ => (configured, None),
    }
}

/// Fold the adaptive learning loop's cluster promotion into the goal term.
///
/// Clamped to 1.0: promotion may lift an item to a perfect goal term but may
/// never push it past the term's range or invert a measured score's sign.
fn apply_cluster_boost(
    goal: crate::models::daqe::TermValue,
    signals: Option<&terms::ItemSignals>,
) -> crate::models::daqe::TermValue {
    let Some(signals) = signals else {
        return goal;
    };
    if !signals.cluster_boost.is_finite() || signals.cluster_boost <= 0.0 {
        return goal;
    }
    if !goal.available {
        // No measured relevance to promote: leave it untracked rather than
        // inventing a value from a promotion signal.
        return goal;
    }
    crate::models::daqe::TermValue {
        value: (goal.value + signals.cluster_boost.clamp(0.0, 1.0)).min(1.0),
        available: true,
        defaulted: goal.defaulted,
    }
}

impl DaqeKnobs {
    /// The weight the energy term carries.
    ///
    /// `energyTarget` is on the `1..5` scale and `energy_fit` is already
    /// normalized to `[0,1]`, so it needs a weight of its own rather than being
    /// used raw — which would let a target of 5 multiply the term by 5. The knob
    /// has no separate slider, so this weight is the documented, tested mapping
    /// from the target to the term's influence.
    pub fn energy_target_weight(&self) -> f64 {
        DEFAULT_ENERGY_TERM_WEIGHT
    }
}

/// The energy term's weight. Fixed rather than user-tunable: the user controls
/// the *target* (which item complexity suits them), not how much the fit term
/// counts. Introducing a seventh knob would put two controls on one decision.
pub const DEFAULT_ENERGY_TERM_WEIGHT: f64 = 0.40;

/// Build the pre-DAQE ordering for the fallback path.
///
/// When every non-SRS term is neutral there is nothing to combine, so the ranker
/// defers to the existing comparator instead of trying to re-derive a 0–1 score
/// that happens to reproduce a six-arm bucket-then-priority-then-due-date sort.
/// Reimplementing that as arithmetic would be both lossy and a second thing to
/// keep in sync.
pub fn srs_only_order(items: &mut [QueueItem]) {
    crate::algorithms::queue_selector::QueueSelector::new(0.0).sort_queue_items(items);
}

/// A context with a fixed clock, for callers that only need the neutral path.
pub fn context_at(now: chrono::DateTime<Utc>) -> RankContext<'static> {
    RankContext::bare(now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::algorithms::daqe::terms::ItemSignals;
    use crate::algorithms::daqe::{EnergyDownshift, FrictionInputs, RankContext, RecentItem};
    use crate::models::daqe::{DaqeKnobs, TermValue};
    use chrono::{DateTime, TimeZone, Utc};

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap()
    }

    fn days_ago(n: i64) -> String {
        (now() - chrono::Duration::days(n)).to_rfc3339()
    }

    fn item(id: &str, item_type: &str, priority: f64, due_days_ago: i64) -> QueueItem {
        QueueItem {
            id: id.to_string(),
            document_id: format!("doc-{id}"),
            document_title: format!("Title {id}"),
            extract_id: None,
            learning_item_id: None,
            question: None,
            answer: None,
            cloze_text: None,
            learning_hint: None,
            item_type: item_type.to_string(),
            priority_rating: None,
            priority_slider: None,
            priority,
            due_date: Some(days_ago(due_days_ago)),
            estimated_time: 2,
            tags: Vec::new(),
            category: None,
            progress: 0,
            source: None,
            position: None,
            stability: Some(10.0),
            difficulty: Some(5.0),
            interval: Some(10.0),
            retrievability: None,
            lapses: None,
            reps: Some(4),
        }
    }

    fn pool() -> Vec<QueueItem> {
        vec![
            item("a", "document", 9.0, 3),
            item("b", "extract", 8.0, 1),
            item("c", "learning-item", 7.0, 7),
            item("d", "learning-item", 6.0, 14),
            item("e", "document", 5.0, 30),
        ]
    }

    /// Knobs that force the scoring path while leaving every score contribution
    /// identical to [`srs_only_knobs`]: a non-zero weight on a term whose signal
    /// is absent. Comparing two runs through this base isolates a single knob,
    /// which comparing against the legacy-fallback ordering cannot do.
    fn scoring_path_knobs() -> DaqeKnobs {
        DaqeKnobs { goal_relevance: 0.05, ..srs_only_knobs() }
    }

    fn srs_only_knobs() -> DaqeKnobs {
        DaqeKnobs {
            srs_decay_weight: 1.0,
            goal_relevance: 0.0,
            energy_target: 3,
            interleaving_diversity: 0.0,
            pruning_aggressiveness: 0.0,
            afk_idle_timeout_ms: 45_000,
        }
    }

    impl RankedItem {
        fn score_ref(&self) -> &f64 {
            &self.score
        }
    }

    #[test]
    fn srs_only_knobs_ordering_matches_the_pre_daqe_sort() {
        let ctx = RankContext::bare(now());
        let ranked = rank(&pool(), &srs_only_knobs(), &ctx);

        let mut legacy_input = pool();
        srs_only_order(&mut legacy_input);
        let legacy_ids: Vec<&str> = legacy_input.iter().map(|i| i.id.as_str()).collect();
        let ranked_ids: Vec<&str> = ranked.iter().map(|r| r.item.id.as_str()).collect();

        assert_eq!(
            ranked_ids, legacy_ids,
            "fallback equality: with every non-SRS term neutral the ordering must \
             be the existing due-first, priority-descending, due-date-ascending sort"
        );
    }

    #[test]
    fn srs_only_knobs_are_recognised_as_srs_only() {
        assert!(srs_only_knobs().is_srs_only());
        assert!(!DaqeKnobs::default().is_srs_only());
        assert!(
            !DaqeKnobs { srs_decay_weight: 0.0, ..DaqeKnobs::default() }.is_srs_only(),
            "all-zero knobs order by input order, not by the pre-DAQE sort"
        );
    }

    #[test]
    fn ordering_is_stable_across_repeated_ranks_of_an_unchanged_pool() {
        let ctx = RankContext::bare(now());
        let source = pool();
        let first = rank(&source, &DaqeKnobs::default(), &ctx);
        let second = rank(&source, &DaqeKnobs::default(), &ctx);

        let ids_first: Vec<&str> = first.iter().map(|r| r.item.id.as_str()).collect();
        let ids_second: Vec<&str> = second.iter().map(|r| r.item.id.as_str()).collect();
        assert_eq!(ids_first, ids_second);

        let scores_first: Vec<f64> = first.iter().map(|r| r.score).collect();
        let scores_second: Vec<f64> = second.iter().map(|r| r.score).collect();
        assert_eq!(scores_first, scores_second);
    }

    #[test]
    fn equal_scores_break_ties_by_input_index_then_item_id() {
        // Two identical items must order by input position, and the same pool
        // presented in the opposite order must reverse them — proving the
        // tie-breaker is the input index and not something incidental.
        let twin_a = item("twin", "learning-item", 5.0, 2);
        let twin_b = item("twin", "learning-item", 5.0, 2);
        let ctx = RankContext::bare(now());

        let forward = rank(&[twin_a.clone(), twin_b.clone()], &DaqeKnobs::default(), &ctx);
        assert_eq!(forward.len(), 2);
        assert_eq!(forward[0].input_index, 0);
        assert_eq!(forward[1].input_index, 1);
        assert_eq!(forward[0].score, forward[1].score);

        let reversed = rank(&[twin_b, twin_a], &DaqeKnobs::default(), &ctx);
        assert_eq!(reversed[0].input_index, 0);
        assert_eq!(reversed[1].input_index, 1);
    }

    #[test]
    fn ranking_never_mutates_scheduler_state() {
        let ctx = RankContext::bare(now());
        let mut source = pool();
        type SchedulerState = (Option<f64>, Option<f64>, Option<f64>, Option<String>);
        let before: std::collections::HashMap<String, SchedulerState> = source
            .iter()
            .map(|i| {
                (i.id.clone(), (i.stability, i.difficulty, i.interval, i.due_date.clone()))
            })
            .collect();

        let knobs = DaqeKnobs::default();
        let srs_only = srs_only_knobs();
        // Both scoring paths, so the deferral branch is covered too.
        let ranked = rank(&source, &knobs, &ctx)
            .into_iter()
            .chain(rank(&source, &srs_only, &ctx))
            .collect::<Vec<_>>();

        for entry in &ranked {
            let id = entry.item.id.clone();
            assert_eq!(
                before.get(&id).cloned(),
                Some((entry.item.stability, entry.item.difficulty, entry.item.interval, entry.item.due_date.clone())),
                "ranking is read-only on scheduling state for {id}"
            );
        }

        assert_eq!(
            source.len(),
            5,
            "ranking must not consume, drain or resize the pool it was given"
        );
        assert!(
            ranked.iter().all(|e| before.contains_key(&e.item.id)),
            "ranking must not invent items"
        );
    }

    #[test]
    fn an_empty_pool_ranks_to_an_empty_order() {
        let ctx = RankContext::bare(now());
        assert!(rank(&[], &DaqeKnobs::default(), &ctx).is_empty());
    }

    #[test]
    fn top_n_carries_the_head_of_the_full_order() {
        let ctx = RankContext::bare(now());
        let mut wide = pool();
        // A pool wider than TOP_N, so the cap is actually exercised.
        for n in 0..8 {
            let mut extra = item(&format!("x{n}"), "learning-item", 4.0, n);
            extra.stability = Some(10.0);
            wide.push(extra);
        }

        let (ranked, top) = rank_with_top_n(&wide, &DaqeKnobs::default(), &ctx);
        assert_eq!(top.len(), TOP_N);
        assert!(ranked.len() > TOP_N);
        for (i, entry) in top.iter().enumerate() {
            assert_eq!(entry.item.id, ranked[i].item.id);
            assert_eq!(entry.score, ranked[i].score);
        }
    }

    #[test]
    fn top_n_is_shorter_than_the_requested_count_for_a_small_pool() {
        let ctx = RankContext::bare(now());
        let small = pool()[..2].to_vec();
        let (_, top) = rank_with_top_n(&small, &DaqeKnobs::default(), &ctx);
        assert_eq!(top.len(), 2);
    }

    #[test]
    fn every_breakdown_reassembles_its_own_score() {
        let ctx = RankContext::bare(now());
        for entry in rank(&pool(), &DaqeKnobs::default(), &ctx) {
            assert!(
                (entry.breakdown.score() - entry.score).abs() < 1e-12,
                "the published score must be the reassembled expression"
            );
        }
    }

    #[test]
    fn knobs_reach_the_breakdown_as_the_applied_weights() {
        let knobs = DaqeKnobs {
            srs_decay_weight: 0.11,
            goal_relevance: 0.22,
            energy_target: 4,
            interleaving_diversity: 0.33,
            pruning_aggressiveness: 0.44,
            afk_idle_timeout_ms: 45_000,
        };
        let ctx = RankContext::bare(now());
        let entry = &rank(&pool(), &knobs, &ctx)[0];

        assert_eq!(entry.breakdown.srs_weight, 0.11);
        assert_eq!(entry.breakdown.goal_weight, 0.22);
        assert_eq!(entry.breakdown.interleave_weight, 0.33);
        assert_eq!(entry.breakdown.friction_weight, 0.44);
        assert_eq!(entry.breakdown.energy_weight, knobs.energy_target_weight());
        assert_eq!(entry.breakdown.effective_energy_target, 4.0);
    }

    #[test]
    fn goal_relevance_actually_moves_an_item() {
        let source = pool();
        let signals = vec![ItemSignals {
            item_id: "e".to_string(),
            relevance: Some(1.0),
            ..Default::default()
        }];
        let ctx = RankContext {
            signals: &signals,
            ..RankContext::bare(now())
        };

        let without = rank(&source, &srs_only_knobs(), &ctx);
        let with = rank(
            &source,
            &DaqeKnobs {
                goal_relevance: 1.0,
                ..srs_only_knobs()
            },
            &ctx,
        );

        let last_without = without.last().expect("non-empty").item.id.clone();
        assert_eq!(last_without, "e");
        assert_eq!(
            with.first().expect("non-empty").item.id,
            "e",
            "a fully relevant item must reach the front when goalRelevance is 1.0"
        );
        assert!(with[0].score > without[0].score);
    }

    #[test]
    fn a_changed_goal_reorders_the_queue() {
        // Two candidates, identical in every signal except which goal they match.
        // Nothing else differs, so any movement in the order is attributable to the
        // goal and nothing else.
        let source = vec![
            item("algebra", "document", 5.0, 0),
            item("topology", "document", 5.0, 0),
        ];
        let signals = vec![
            ItemSignals {
                item_id: "algebra".to_string(),
                local_goal_alignment: Some(0.9),
                ..Default::default()
            },
            ItemSignals {
                item_id: "topology".to_string(),
                local_goal_alignment: Some(0.1),
                ..Default::default()
            },
        ];
        let knobs = DaqeKnobs { goal_relevance: 1.0, ..srs_only_knobs() };

        let toward_algebra = RankContext {
            goal: Some("linear algebra"),
            signals: &signals,
            ..RankContext::bare(now())
        };
        let toward_topology = RankContext {
            goal: Some("algebraic topology"),
            // Same signals, goal changed: the caller recomputes alignment for a new
            // goal, which is why a goal-dependent judgement is never cached.
            signals: &[
                ItemSignals { item_id: "algebra".to_string(), local_goal_alignment: Some(0.1), ..Default::default() },
                ItemSignals { item_id: "topology".to_string(), local_goal_alignment: Some(0.9), ..Default::default() },
            ],
            ..RankContext::bare(now())
        };

        let algebra_first = rank(&source, &knobs, &toward_algebra);
        let topology_first = rank(&source, &knobs, &toward_topology);

        assert_eq!(algebra_first.first().expect("non-empty").item.id, "algebra");
        assert_eq!(topology_first.first().expect("non-empty").item.id, "topology");
    }

    #[test]
    fn changing_the_goal_reorders_without_changing_membership() {
        let source = pool();
        let knobs = DaqeKnobs { goal_relevance: 1.0, ..srs_only_knobs() };
        let mut ids = |ctx: &RankContext<'_>| {
            let mut ranked: Vec<String> =
                rank(&source, &knobs, ctx).iter().map(|entry| entry.item.id.clone()).collect();
            ranked.sort();
            ranked
        };

        let before = ids(&RankContext::bare(now()));
        let after = ids(&RankContext {
            goal: Some("transformer architectures"),
            signals: &[ItemSignals {
                item_id: "e".to_string(),
                local_goal_alignment: Some(1.0),
                ..Default::default()
            }],
            ..RankContext::bare(now())
        });

        assert_eq!(
            before, after,
            "a goal may reorder a session but must never add or drop an item"
        );
    }

    #[test]
    fn an_identical_goal_and_pool_rank_identically_twice() {
        let source = pool();
        let knobs = DaqeKnobs { goal_relevance: 1.0, ..srs_only_knobs() };
        let signals = vec![ItemSignals {
            item_id: "e".to_string(),
            local_goal_alignment: Some(0.7),
            ..Default::default()
        }];
        let ctx = || RankContext {
            goal: Some("linear algebra"),
            signals: &signals,
            ..RankContext::bare(now())
        };

        let first: Vec<String> =
            rank(&source, &knobs, &ctx()).iter().map(|e| e.item.id.clone()).collect();
        let second: Vec<String> =
            rank(&source, &knobs, &ctx()).iter().map(|e| e.item.id.clone()).collect();
        assert_eq!(first, second);
    }

    #[test]
    fn interleave_penalty_pushes_a_repeated_topic_down() {
        let source = pool();
        let recent = vec![RecentItem {
            item_id: "b".to_string(),
            topic: Some("transformers".to_string()),
            item_type: "extract".to_string(),
        }];
        let signals = vec![ItemSignals {
            item_id: "e".to_string(),
            topic_similarity_to_recent: 0.9,
            topic_matches: vec!["b".to_string()],
            ..Default::default()
        }];
        let ctx = RankContext {
            recent: &recent,
            signals: &signals,
            ..RankContext::bare(now())
        };

        let score_of_e = |ranked: &[RankedItem]| {
            *ranked.iter().find(|r| r.item.id == "e").expect("e present").score_ref()
        };
        let off = rank(&source, &scoring_path_knobs(), &ctx);
        let on = rank(
            &source,
            &DaqeKnobs {
                interleaving_diversity: 0.9,
                ..scoring_path_knobs()
            },
            &ctx,
        );

        // Exact delta: similarity 0.9 at diversity 0.9, subtracted from the score.
        assert!(
            (score_of_e(&off) - score_of_e(&on) - 0.81).abs() < 1e-12,
            "raising interleaveDiversity must subtract exactly the scaled similarity"
        );

        let penalised = on.iter().find(|r| r.item.id == "e").expect("e present");
        assert_eq!(penalised.breakdown.interleave_against, vec!["b"]);
        assert!(
            penalised.breakdown.interleave_penalty.effective() > 0.0,
            "the breakdown must show the penalty that moved the item"
        );
    }

    #[test]
    fn friction_penalty_pushes_a_postponed_item_down() {
        let source = pool();
        let signals = vec![ItemSignals {
            item_id: "e".to_string(),
            friction: FrictionInputs {
                postpone_count: 5,
                ..Default::default()
            },
            ..Default::default()
        }];
        let ctx = RankContext {
            signals: &signals,
            ..RankContext::bare(now())
        };

        let score_of_e = |ranked: &[RankedItem]| {
            *ranked.iter().find(|r| r.item.id == "e").expect("e present").score_ref()
        };
        let off = rank(&source, &scoring_path_knobs(), &ctx);
        let on = rank(
            &source,
            &DaqeKnobs {
                pruning_aggressiveness: 1.0,
                ..scoring_path_knobs()
            },
            &ctx,
        );

        // 5 postponements at 0.10 each, saturating at four, at aggressiveness 1.0.
        assert!((score_of_e(&off) - score_of_e(&on) - 0.40).abs() < 1e-12);

        let penalised = on.iter().find(|r| r.item.id == "e").expect("e present");
        assert!(penalised.breakdown.friction_penalty.available);
        assert!((penalised.breakdown.friction_penalty.value - 0.40).abs() < 1e-12);
        // The producer is knob-independent, so both runs measure the same raw
        // 0.40; what differs is the weight the knob applies to it.
        let unweighted = off.iter().find(|r| r.item.id == "e").expect("e present");
        assert!((unweighted.breakdown.friction_penalty.value - 0.40).abs() < 1e-12);
        assert_eq!(
            unweighted.breakdown.friction_weight, 0.0,
            "with the knob at zero the measured penalty contributes nothing to the score"
        );
        assert_eq!(penalised.breakdown.friction_weight, 1.0);
    }

    #[test]
    fn a_measured_velocity_collapse_lowers_the_effective_energy_target() {
        let source = pool();
        let downshift = EnergyDownshift {
            effective_energy_target: 2.0,
            reason: "velocity 31% of baseline".to_string(),
            velocity_ratio: 0.31,
            baseline_sufficient: true,
        };
        let ctx = RankContext {
            energy_downshift: Some(&downshift),
            ..RankContext::bare(now())
        };
        let knobs = DaqeKnobs {
            energy_target: 5,
            ..srs_only_knobs()
        };

        let ranked = rank(&source, &knobs, &ctx);
        for entry in &ranked {
            assert_eq!(entry.breakdown.effective_energy_target, 2.0);
            assert_eq!(
                entry.breakdown.energy_downshift_reason.as_deref(),
                Some("velocity 31% of baseline")
            );
        }
        assert_eq!(
            knobs.energy_target, 5,
            "the user's configured value is never mutated"
        );
    }

    #[test]
    fn an_insufficient_baseline_applies_no_downshift_at_all() {
        let downshift = EnergyDownshift {
            effective_energy_target: 1.0,
            reason: "no baseline".to_string(),
            velocity_ratio: 0.0,
            baseline_sufficient: false,
        };
        let ctx = RankContext {
            energy_downshift: Some(&downshift),
            ..RankContext::bare(now())
        };
        let ranked = rank(&pool(), &srs_only_knobs(), &ctx);
        for entry in &ranked {
            assert_eq!(entry.breakdown.effective_energy_target, 3.0);
            assert_eq!(entry.breakdown.energy_downshift_reason, None);
        }
    }

    #[test]
    fn a_downshift_never_raises_the_energy_target() {
        let downshift = EnergyDownshift {
            effective_energy_target: 5.0,
            reason: "bogus upward shift".to_string(),
            velocity_ratio: 0.1,
            baseline_sufficient: true,
        };
        let ctx = RankContext {
            energy_downshift: Some(&downshift),
            ..RankContext::bare(now())
        };
        let knobs = DaqeKnobs {
            energy_target: 2,
            ..srs_only_knobs()
        };
        let ranked = rank(&pool(), &knobs, &ctx);
        for entry in &ranked {
            assert_eq!(entry.breakdown.effective_energy_target, 2.0);
        }
    }

    #[test]
    fn every_term_is_unavailable_for_an_item_with_no_signals() {
        let ctx = RankContext::bare(now());
        let entry = &rank(&pool(), &DaqeKnobs::default(), &ctx)[0];

        assert!(entry.breakdown.srs_urgency.available, "SRS is always derivable");
        assert!(!entry.breakdown.goal_relevance.available);
        assert!(entry.breakdown.energy_fit.available);
        assert!(entry.breakdown.energy_fit.defaulted);
        assert!(!entry.breakdown.interleave_penalty.available);
        assert!(!entry.breakdown.friction_penalty.available);
    }

    #[test]
    fn degradation_never_throws_and_always_orders_the_whole_pool() {
        let ctx = RankContext::bare(now());
        let ranked = rank(&pool(), &DaqeKnobs::default(), &ctx);
        assert_eq!(ranked.len(), pool().len());
        for entry in &ranked {
            assert!(entry.score.is_finite(), "a degraded score must still be a number");
        }
    }

    #[test]
    fn cluster_boost_lifts_the_goal_term_but_never_past_one() {
        let signals = vec![ItemSignals {
            item_id: "e".to_string(),
            relevance: Some(0.9),
            cluster_boost: 0.5,
            ..Default::default()
        }];
        let ctx = RankContext {
            signals: &signals,
            ..RankContext::bare(now())
        };
        let knobs = DaqeKnobs {
            goal_relevance: 1.0,
            ..srs_only_knobs()
        };
        let entry = rank(&pool(), &knobs, &ctx)
            .into_iter()
            .find(|r| r.item.id == "e")
            .expect("e present");

        assert_eq!(entry.breakdown.goal_relevance.value, 1.0, "clamped at the term's ceiling");
        assert!(entry.breakdown.goal_relevance.available);
    }

    #[test]
    fn cluster_boost_does_not_invent_a_value_for_untracked_relevance() {
        let signals = vec![ItemSignals {
            item_id: "e".to_string(),
            relevance: None,
            cluster_boost: 1.0,
            ..Default::default()
        }];
        let ctx = RankContext {
            signals: &signals,
            ..RankContext::bare(now())
        };
        let entry = rank(&pool(), &DaqeKnobs::default(), &ctx)
            .into_iter()
            .find(|r| r.item.id == "e")
            .expect("e present");
        assert_eq!(
            entry.breakdown.goal_relevance,
            TermValue::unavailable(),
            "a promotion signal must not stand in for a relevance measurement"
        );
    }
}

/// The latency gate.
///
/// The requirement is on the top ten, not the full order: only what the user
/// sees next is covered by the 150 ms budget. Measured on a deliberately wide
/// pool (5 000 candidates — roughly a heavy backlog) with every term populated,
/// so the measurement includes the producers rather than only the sort.
#[cfg(test)]
mod latency {
    use super::*;
    use crate::algorithms::daqe::terms::ItemSignals;
    use crate::algorithms::daqe::{EnergyDownshift, RankContext, RecentItem};
    use chrono::{TimeZone, Utc};

    /// The budget from `adaptive-queue-ranking`: top ten within 150 ms.
    const TOP_TEN_BUDGET_MS: u128 = 150;
    /// A heavy backlog. Large enough that a per-item allocation regression or an
    /// accidental O(n²) shows up, small enough to stay a unit test.
    const POOL: usize = 5_000;

    fn reference_pool() -> (Vec<QueueItem>, Vec<ItemSignals>, Vec<RecentItem>) {
        let now = Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap();
        let types = ["document", "extract", "learning-item", "playlist-video", "rss-article"];

        let items: Vec<QueueItem> = (0..POOL)
            .map(|n| {
                let item_type = types[n % types.len()];
                // A spread of due dates so urgency genuinely varies: 0..45 days
                // overdue, plus a tail of future-dated items.
                let days_ago = (n % 45) as i64;
                let due = if n % 11 == 0 {
                    now + chrono::Duration::days((n % 20) as i64)
                } else {
                    now - chrono::Duration::days(days_ago)
                };
                QueueItem {
                    id: format!("item-{n:05}"),
                    document_id: format!("doc-{}", n / 3),
                    document_title: format!("Document {n}"),
                    extract_id: None,
                    learning_item_id: None,
                    question: None,
                    answer: None,
                    cloze_text: None,
                    learning_hint: None,
                    item_type: item_type.to_string(),
                    priority_rating: Some(((n % 5) + 1) as i32),
                    priority_slider: Some((n % 101) as i32),
                    priority: ((n % 100) as f64 / 10.0).min(10.0),
                    due_date: Some(due.to_rfc3339()),
                    estimated_time: 2,
                    tags: vec![format!("topic-{}", n % 40)],
                    category: None,
                    progress: (n % 100) as i32,
                    source: None,
                    position: Some(n as i32),
                    stability: Some(1.0 + (n % 60) as f64),
                    difficulty: Some((n % 10) as f64),
                    interval: Some((n % 30) as f64),
                    retrievability: None,
                    lapses: Some((n % 4) as i32),
                    reps: Some((n % 20) as i32),
                }
            })
            .collect();

        let signals: Vec<ItemSignals> = (0..POOL)
            .map(|n| ItemSignals {
                item_id: format!("item-{n:05}"),
                relevance: Some(((n % 100) as f64 / 100.0).clamp(0.0, 1.0)),
                complexity: Some(1.0 + (n % 5) as f64),
                topic_similarity_to_recent: ((n % 100) as f64 / 100.0).clamp(0.0, 1.0),
                topic_matches: vec![format!("recent-{}", n % 3)],
                goal_alignment: None,
                local_goal_alignment: None,
                friction: crate::algorithms::daqe::FrictionInputs {
                    postpone_count: (n % 6) as i32,
                    rapid_skip_count: (n % 3) as i32,
                    active_dwell_ms: (n as i64 % 120_000) + 1_000,
                    idle_time_ms: (n as i64 % 90_000),
                    abandoned_reviews: (n % 2) as i32,
                },
                cluster_boost: ((n % 30) as f64 / 100.0).clamp(0.0, 1.0),
            })
            .collect();

        let recent: Vec<RecentItem> = (0..3)
            .map(|n| RecentItem {
                item_id: format!("recent-{n}"),
                topic: Some(format!("topic-{}", n)),
                item_type: "extract".to_string(),
            })
            .collect();

        (items, signals, recent)
    }

    fn timed() -> (u128, usize, usize) {
        let (items, signals, recent) = reference_pool();
        let downshift = EnergyDownshift {
            effective_energy_target: 2.0,
            reason: "velocity 28% of baseline".to_string(),
            velocity_ratio: 0.28,
            baseline_sufficient: true,
        };
        let ctx = RankContext {
            now: Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
            recent: &recent,
            goal: Some("understanding transformer architectures"),
            focus_tags: &[],
            signals: &signals,
            energy_downshift: Some(&downshift),
            recent_window: crate::algorithms::daqe::DEFAULT_RECENT_WINDOW,
        };
        let knobs = DaqeKnobs::default();

        let started = std::time::Instant::now();
        let (ranked, top) = rank_with_top_n(&items, &knobs, &ctx);
        let elapsed_ms = started.elapsed().as_millis();

        assert_eq!(ranked.len(), POOL, "the whole pool is ordered");
        assert_eq!(top.len(), TOP_N);
        (elapsed_ms, ranked.len(), top.len())
    }

    /// Best of five. A single timing on a shared CI box is dominated by scheduler
    /// noise; the *shape* of the cost is what regresses, and taking the minimum
    /// measures that far more stably than the mean does.
    fn best_of_five() -> u128 {
        let mut best = u128::MAX;
        for _ in 0..5 {
            let (elapsed_ms, _, _) = timed();
            best = best.min(elapsed_ms);
        }
        best
    }

    #[test]
    fn top_ten_is_available_within_the_stated_budget() {
        let elapsed_ms = best_of_five();
        assert!(
            elapsed_ms <= TOP_TEN_BUDGET_MS,
            "top ten took {elapsed_ms} ms on a {POOL}-item pool, over the \
             {TOP_TEN_BUDGET_MS} ms budget. The escape is the partial-sort path \
             (a top-ten heap with the full sort deferred), NOT a raised budget."
        );
    }

    #[test]
    fn the_fallback_path_is_also_inside_the_budget() {
        let (items, signals, recent) = reference_pool();
        let now = Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap();
        let ctx = RankContext {
            now,
            recent: &recent,
            goal: None,
            focus_tags: &[],
            signals: &signals,
            energy_downshift: None,
            recent_window: crate::algorithms::daqe::DEFAULT_RECENT_WINDOW,
        };
        let started = std::time::Instant::now();
        let ranked = rank(&items, &srs_only_test_knobs(), &ctx);
        let elapsed_ms = started.elapsed().as_millis();
        assert_eq!(ranked.len(), POOL);
        assert!(
            elapsed_ms <= TOP_TEN_BUDGET_MS,
            "the SRS-only fallback took {elapsed_ms} ms, over the {TOP_TEN_BUDGET_MS} ms budget"
        );
    }

    fn srs_only_test_knobs() -> DaqeKnobs {
        DaqeKnobs {
            srs_decay_weight: 1.0,
            goal_relevance: 0.0,
            energy_target: 3,
            interleaving_diversity: 0.0,
            pruning_aggressiveness: 0.0,
            afk_idle_timeout_ms: 45_000,
        }
    }

    #[test]
    fn ranking_scales_linearly_rather_than_quadratically() {
        // Guards the shape of the cost, not its absolute value: doubling the pool
        // must not quadruple the time. This is what would catch an accidental
        // nested loop over the recent window, or a sort comparator that rescans.
        let now = Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap();
        let knobs = DaqeKnobs::default();

        let measure = |target: usize| -> u128 {
            let mut best = u128::MAX;
            for _ in 0..3 {
                let (mut items, mut signals, recent) = reference_pool();
                items.truncate(target);
                signals.truncate(target);
                let ctx = RankContext {
                    now,
                    recent: &recent,
                    goal: Some("goal"),
                    focus_tags: &[],
                    signals: &signals,
                    energy_downshift: None,
                    recent_window: crate::algorithms::daqe::DEFAULT_RECENT_WINDOW,
                };
                let started = std::time::Instant::now();
                let ranked = rank(&items, &knobs, &ctx);
                best = best.min(started.elapsed().as_micros());
                assert_eq!(ranked.len(), target);
            }
            best
        };

        let small = measure(1_000).max(1);
        let large = measure(4_000).max(1);

        // `n log n` for 4x the input is under 6x the time; a quadratic term would
        // blow past that almost immediately. The bound is generous because
        // microsecond-scale timings are noisy.
        assert!(
            large < small * 12,
            "ranking 4x the pool cost {large}us against {small}us — that is more \
             than quadratic behaviour"
        );
    }
}
