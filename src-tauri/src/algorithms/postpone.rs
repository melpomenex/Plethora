//! SuperMemo auto-postpone — the overflow handler for the priority queue.
//!
//! When the outstanding material exceeds what the student can get through,
//! SuperMemo postpones the lowest-priority excess to a future date rather
//! than letting it accumulate unboundedly. This module ports that algorithm:
//! it selects which elements to postpone based on priority and difficulty
//! thresholds and a per-element do-not-postpone flag.
//!
//! Reference: `~sushi/sm20-re/postpone_algorithm.md` (manual + auto-postpone,
//! per-branch config, priority/difficulty thresholds). Those reference
//! materials were not available during this session, so this implementation
//! follows the behavior described in the change's spec
//! (`specs/priority-queue/spec.md`): the lowest-priority elements above the
//! capacity are postponed; high-priority elements (above the threshold) are
//! never postponed; the do-not-postpone flag overrides everything.

/// The scheduling fields the postpone engine reads for one element.
#[derive(Debug, Clone)]
pub struct PostponeCandidate {
    pub id: String,
    /// User-set 0–100 importance rank (the priority-queue position proxy).
    pub priority: f64,
    /// FSRS difficulty (1–10 scale). Harder elements are postponed less
    /// readily when `respect_difficulty` is set.
    pub difficulty: f64,
    /// True when the user has flagged this element as do-not-postpone.
    pub do_not_postpone: bool,
}

/// Configuration for the postpone decision.
#[derive(Debug, Clone)]
pub struct PostponeConfig {
    /// The maximum number of elements to keep outstanding. When the candidate
    /// count exceeds this, the lowest-priority surplus is postponed.
    pub daily_capacity: usize,
    /// Elements with priority **at or above** this threshold are never
    /// auto-postponed, even when the queue is over capacity.
    pub priority_threshold: f64,
    /// When true, difficulty biases the postpone decision (harder elements
    /// survive longer). When false, only priority governs.
    pub respect_difficulty: bool,
}

impl Default for PostponeConfig {
    fn default() -> Self {
        Self {
            daily_capacity: 50,
            priority_threshold: 70.0,
            respect_difficulty: true,
        }
    }
}

/// The outcome of a postpone decision: which element ids to keep in the
/// session and which to postpone.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PostponeDecision {
    /// Ids to keep outstanding (in priority order, highest first).
    pub keep: Vec<String>,
    /// Ids to postpone to a future date (lowest priority first).
    pub postpone: Vec<String>,
}

/// Decide which elements to auto-postpone given the config.
///
/// Algorithm:
/// 1. Partition into `protected` (do-not-postpone flag set, OR priority above
///    the threshold) and `postponable`.
/// 2. The `protected` set is always kept.
/// 3. From `postponable`, keep the highest-priority elements up to the daily
///    capacity; postpone the rest.
/// 4. When `respect_difficulty` is set, harder elements win ties (kept over
///    easier ones at the same priority).
///
/// Returns the keep/postpone split. `keep` is ordered highest-priority-first;
/// `postpone` is lowest-priority-first.
pub fn decide(candidates: &[PostponeCandidate], config: &PostponeConfig) -> PostponeDecision {
    // 1. Partition.
    let mut protected: Vec<&PostponeCandidate> = Vec::new();
    let mut postponable: Vec<&PostponeCandidate> = Vec::new();
    for c in candidates {
        if c.do_not_postpone || c.priority >= config.priority_threshold {
            protected.push(c);
        } else {
            postponable.push(c);
        }
    }

    // 2. Sort postponable by a keep-score: higher priority kept first, harder
    //    items win ties when respect_difficulty is on.
    postponable.sort_by(|a, b| {
        // Primary: priority descending (higher priority kept first).
        let by_priority = b
            .priority
            .partial_cmp(&a.priority)
            .unwrap_or(std::cmp::Ordering::Equal);
        if by_priority != std::cmp::Ordering::Equal {
            return by_priority;
        }
        if config.respect_difficulty {
            // Difficulty descending (harder kept first on ties).
            return b
                .difficulty
                .partial_cmp(&a.difficulty)
                .unwrap_or(std::cmp::Ordering::Equal);
        }
        // Stable tiebreak by id for determinism.
        a.id.cmp(&b.id)
    });

    // 3. Capacity: how many postponable slots remain after protected ones.
    let remaining_capacity = config.daily_capacity.saturating_sub(protected.len());

    // 4. Keep the top-N postponable; postpone the rest.
    let (keep_postponable, postpone) = if postponable.len() <= remaining_capacity {
        (postponable.clone(), Vec::new())
    } else {
        let (k, p) = postponable.split_at(remaining_capacity);
        (k.to_vec(), p.to_vec())
    };

    // Assemble keep = protected + kept-postponable, ordered by priority desc.
    let mut keep: Vec<&PostponeCandidate> = protected;
    keep.extend(keep_postponable);
    keep.sort_by(|a, b| {
        b.priority
            .partial_cmp(&a.priority)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });

    PostponeDecision {
        keep: keep.into_iter().map(|c| c.id.clone()).collect(),
        postpone: postpone.into_iter().map(|c| c.id.clone()).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(id: &str, priority: f64) -> PostponeCandidate {
        PostponeCandidate {
            id: id.to_string(),
            priority,
            difficulty: 5.0,
            do_not_postpone: false,
        }
    }

    fn config(capacity: usize, threshold: f64) -> PostponeConfig {
        PostponeConfig {
            daily_capacity: capacity,
            priority_threshold: threshold,
            respect_difficulty: true,
        }
    }

    #[test]
    fn under_capacity_keeps_everything() {
        // 5 elements, capacity 50 → nothing postponed.
        let cands = vec![
            cand("a", 80.0),
            cand("b", 60.0),
            cand("c", 40.0),
            cand("d", 20.0),
            cand("e", 10.0),
        ];
        let dec = decide(&cands, &config(50, 70.0));
        assert!(dec.postpone.is_empty());
        assert_eq!(dec.keep.len(), 5);
    }

    #[test]
    fn over_capacity_postpones_lowest_priority() {
        // 200 elements is too many for a capacity of 50; the lowest-priority
        // 150 are postponed. (Mirrors the spec scenario.)
        let cands: Vec<_> = (0..200)
            .map(|i| cand(&format!("c{i}"), 50.0 - i as f64 * 0.1))
            .collect();
        let dec = decide(&cands, &config(50, 70.0));
        // keep ≤ capacity, postpone the rest.
        assert!(dec.keep.len() <= 50, "keep bounded by capacity");
        assert_eq!(dec.keep.len() + dec.postpone.len(), 200);
        // The kept set holds the higher-priority half.
        let min_keep_priority = dec
            .keep
            .iter()
            .map(|id| cands.iter().find(|c| &c.id == id).unwrap().priority)
            .fold(f64::INFINITY, f64::min);
        let max_postpone_priority = dec
            .postpone
            .iter()
            .map(|id| cands.iter().find(|c| &c.id == id).unwrap().priority)
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(
            min_keep_priority >= max_postpone_priority,
            "every kept element is at least as high-priority as every postponed one"
        );
    }

    #[test]
    fn high_priority_above_threshold_is_never_postponed() {
        // Capacity 1, but a high-priority element must survive even though it
        // is not the single highest.
        let cands = vec![
            cand("low", 30.0),
            cand("high", 75.0), // above the 70 threshold → protected
            cand("mid", 60.0),
        ];
        let dec = decide(&cands, &config(1, 70.0));
        assert!(
            dec.keep.contains(&"high".to_string()),
            "threshold element kept"
        );
    }

    #[test]
    fn do_not_postpone_flag_overrides_everything() {
        // A do-not-postpone low-priority element survives a tight capacity.
        let mut flagged = cand("flagged", 5.0);
        flagged.do_not_postpone = true;
        let cands = vec![flagged, cand("higher", 60.0), cand("highest", 90.0)];
        let dec = decide(&cands, &config(1, 95.0)); // capacity 1, threshold high
        assert!(dec.keep.contains(&"flagged".to_string()));
    }

    #[test]
    fn capacity_boundary_keeps_exactly_capacity_when_unprotected_exceeds_it() {
        // Exactly capacity+1 unprotected elements at uniform priority: one is
        // postponed, the rest kept.
        let cands: Vec<_> = (0..6).map(|i| cand(&format!("c{i}"), 40.0)).collect();
        let dec = decide(&cands, &config(5, 70.0));
        assert_eq!(dec.keep.len(), 5);
        assert_eq!(dec.postpone.len(), 1);
    }

    #[test]
    fn respect_difficulty_keeps_harder_on_ties() {
        let cfg = PostponeConfig {
            daily_capacity: 1,
            priority_threshold: 95.0, // nothing auto-protected
            respect_difficulty: true,
        };
        let mut easy = cand("easy", 50.0);
        easy.difficulty = 1.0;
        let mut hard = cand("hard", 50.0);
        hard.difficulty = 9.0;
        let dec = decide(&[easy, hard], &cfg);
        assert_eq!(dec.keep, vec!["hard".to_string()]);
        assert_eq!(dec.postpone, vec!["easy".to_string()]);
    }

    #[test]
    fn disabled_auto_postpone_keeps_all() {
        // "Auto-postpone disabled" is modeled as capacity = usize::MAX.
        let cands: Vec<_> = (0..300).map(|i| cand(&format!("c{i}"), 10.0)).collect();
        let cfg = PostponeConfig {
            daily_capacity: usize::MAX,
            priority_threshold: 70.0,
            respect_difficulty: true,
        };
        let dec = decide(&cands, &cfg);
        assert_eq!(dec.keep.len(), 300);
        assert!(dec.postpone.is_empty());
    }
}
