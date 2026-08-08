//! SuperMemo priority queue — the backbone of normal incremental reading.
//!
//! Every element (document, extract, or learning item) is ranked 0%–100% by
//! user-set importance. The learning session is auto-sorted by a combined
//! criterion, and low-priority overflow is auto-postponed. This mirrors the
//! SuperMemo priority queue (`FUN_00cb1630` / `FUN_00cb21c0` for the
//! position↔priority map; `FUN_00c15fd0` for the combined sort).
//!
//! This is distinct from the optional [`neural queue`](super::neural_queue),
//! which reads intrinsic priority from this queue as one input to its
//! spreading-activation formula.

/// `priority_from_position` — derive a 0–100 priority from an element's
/// 1-based position in the priority queue.
///
/// Mirrors SuperMemo's `FUN_00cb1630`. Position 1 (the front) is the highest
/// importance; the *displayed* priority value is inverted so that the front
/// reads as the most important. Here we return the raw linear interpolation;
/// callers that want "higher = more important" invert as needed.
///
/// - `position` is 1-based (1 = front of queue).
/// - `size` is the total number of elements in the queue.
/// - Returns 0.0 when `size <= 1` (a single-element queue has no ranking to
///   express).
///
/// # Formula
/// `priority = ((position - 1) / (size - 1)) * 100`
///
/// This matches design.md. Position 1 → priority 0 (front); the last position
/// → priority 100.
pub fn priority_from_position(position: usize, size: usize) -> f64 {
    if size <= 1 {
        return 0.0;
    }
    let pos = position.max(1) as f64;
    ((pos - 1.0) / (size - 1) as f64) * 100.0
}

/// `position_from_priority` — the inverse of [`priority_from_position`]:
/// reposition an element so its derived priority matches a desired 0–100
/// value. Mirrors SuperMemo's `FUN_00cb21c0`.
///
/// Returns a 1-based position in `1..=size`.
pub fn position_from_priority(priority: f64, size: usize) -> usize {
    if size <= 1 {
        return 1;
    }
    let raw = (priority.clamp(0.0, 100.0) / 100.0) * (size - 1) as f64;
    raw.round() as usize + 1
}

/// The type of an element as the combined sort's proportion bias sees it.
///
/// Topics (documents, extracts) and items (cards) are interleaved so the
/// session is a read/quiz mix rather than all one type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SortElementType {
    Topic,
    Item,
}

/// Configuration for the combined sort criterion.
#[derive(Debug, Clone)]
pub struct CombinedSortConfig {
    /// Weight of the proportion-of-topics-vs-items bias. Higher pushes the
    /// session harder toward a balanced topic/item mix. Defaults to a gentle
    /// nudge; the exact SuperMemo formula for this term is not yet
    /// reverse-engineered (see the deviation note below).
    pub proportion_weight: f64,
}

impl Default for CombinedSortConfig {
    fn default() -> Self {
        Self {
            proportion_weight: 15.0,
        }
    }
}

/// A sortable element in the combined-criterion session sort.
#[derive(Debug, Clone)]
pub struct SortElement<'a> {
    /// Stable id used for the deterministic jitter tiebreak.
    pub id: &'a str,
    /// User-set 0–100 importance rank (the primary term).
    pub priority: f64,
    /// Topic or Item — drives the proportion bias.
    pub element_type: SortElementType,
}

/// Compute the combined-criterion score for a single element.
///
/// Per design.md, the criterion combines three terms:
///
/// 1. **Priority** (the user-set 0–100) — primary.
/// 2. **Proportion-of-topics-vs-items bias** — a per-element nudge so the
///    session is a read/quiz mix. The exact SuperMemo formula is referenced by
///    string in `FUN_00c15fd0` ("Probability of a topic/item being placed at
///    the top of the outstanding queue [0 .. max]") but the production
///    coefficient at `param_1 + 0x748` has not been extracted. Until it is,
///    this term is a simple type-alternation bias (topics nudged up when the
///    running session is item-heavy, and vice versa), and the composition
///    sliders remain the manual proxy for the *count* split. See the deviation
///    note in the change's tasks.md (3.7).
/// **Higher score = earlier in the session.** The caller sorts descending.
///
/// Randomization is deliberately *not* a term here. SuperMemo varies the order
/// of **equally** prioritized elements; adding a jitter term to every score
/// instead blurs genuinely distinct priorities (with the old ±5 weight, an
/// element at 48 routinely beat one at 52). [`stable_jitter`] is now applied by
/// [`sort_session`] only to break exact ties.
pub fn combined_score(
    element: &SortElement<'_>,
    config: &CombinedSortConfig,
    // Running tally of topics/items already placed, used by the proportion
    // bias to decide which type to nudge. Pass `(0, 0)` at the start.
    placed: (usize, usize),
) -> f64 {
    let priority_term = element.priority;

    // Proportion bias: nudge the under-represented type up. If more items than
    // topics have been placed so far, a topic gets a bonus; symmetric for
    // items. The bonus scales with the imbalance.
    let (topics_placed, items_placed) = placed;
    let imbalance = match element.element_type {
        SortElementType::Topic => items_placed as f64 - topics_placed as f64,
        SortElementType::Item => topics_placed as f64 - items_placed as f64,
    };
    let proportion_term = config.proportion_weight * imbalance.max(0.0).tanh();

    priority_term + proportion_term
}

/// Produce a deterministic pseudo-random value in `[-1.0, 1.0)` from a string
/// id. Used as the stable per-id jitter term so equally-prioritized elements
/// vary in order without reshuffling across renders (mirrors the frontend's
/// `getStableRandom`).
pub fn stable_jitter(id: &str) -> f64 {
    // FxHash-style fold. Cheap, deterministic, no allocation.
    let mut hash: u64 = 0xcbf29ce484222325; // FNV offset basis
    for &byte in id.as_bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3); // FNV prime
    }
    // Map to [0, 1) then to [-1, 1).
    let unit = (hash % 1_000_003) as f64 / 1_000_003.0;
    unit * 2.0 - 1.0
}

/// Sort a session by the combined criterion, returning indices into the input
/// in presentation order (front first).
///
/// This is a greedy insertion sort: at each step it scores every remaining
/// element against the running `(topics, items)` tally and picks the highest.
/// O(n²), but n is a daily session (tens to low hundreds of elements), so this
/// is negligible; the benchmark in `priority_queue.bench.ts` guards the
/// constant.
///
/// The sort is **deterministic**: the same input + config always yields the
/// same order, preserving resumability.
pub fn sort_session(elements: &[SortElement<'_>], config: &CombinedSortConfig) -> Vec<usize> {
    let mut remaining: Vec<usize> = (0..elements.len()).collect();
    let mut order = Vec::with_capacity(elements.len());
    let mut placed = (0usize, 0usize);

    while !remaining.is_empty() {
        // Pick the highest-scoring remaining element. Exact ties break by the
        // stable per-id jitter — SuperMemo varies the order of equally
        // prioritized elements, and only those.
        let mut best_idx = 0;
        let mut best_score = f64::NEG_INFINITY;
        let mut best_jitter = f64::NEG_INFINITY;
        for (i, &elem_idx) in remaining.iter().enumerate() {
            let score = combined_score(&elements[elem_idx], config, placed);
            let jitter = stable_jitter(elements[elem_idx].id);
            if score > best_score || (score == best_score && jitter > best_jitter) {
                best_score = score;
                best_jitter = jitter;
                best_idx = i;
            }
        }
        let chosen_elem_idx = remaining.swap_remove(best_idx);
        match elements[chosen_elem_idx].element_type {
            SortElementType::Topic => placed.0 += 1,
            SortElementType::Item => placed.1 += 1,
        }
        order.push(chosen_elem_idx);
    }

    order
}

// ─── Reverse-engineering deviation note (task 3.7) ─────────────────────────
//
// The exact SuperMemo proportion-of-topics-vs-items formula and its "[0 .. max]"
// config knob are referenced by string in `FUN_00c15fd0` but the production
// coefficient at `param_1 + 0x748` has NOT been extracted from the binary.
// The reference materials (`~/sushi/sm20-re/priority_queue_algorithm.md`) were
// not available during this implementation session.
//
// DEVIATION: until the formula is recovered, the proportion term here is a
// tanh-scaled type-alternation bonus (above), and the existing composition
// sliders (add-queue-composition-sliders) remain the manual proxy for the
// *count* split between topics and items. The priority term (the primary
// ordering) is faithful to the design.
//
// The `priority` fed to this sort is the element's rank-derived percentile —
// see `database::priority_rank`, which is what makes it a total order with no
// ties to blur in the first place.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priority_from_position_front_is_zero() {
        // Position 1 of 100 → priority 0 (front / highest importance).
        assert_eq!(priority_from_position(1, 100), 0.0);
    }

    #[test]
    fn priority_from_position_last_is_near_100() {
        // Last position of 100 → priority 100.
        assert!((priority_from_position(100, 100) - 100.0).abs() < 1e-9);
    }

    #[test]
    fn priority_from_position_size_one_is_zero() {
        assert_eq!(priority_from_position(1, 1), 0.0);
        assert_eq!(priority_from_position(5, 1), 0.0);
    }

    #[test]
    fn priority_from_position_midpoint() {
        // Position 51 of 101 → (50/100)*100 = 50.
        assert!((priority_from_position(51, 101) - 50.0).abs() < 1e-9);
    }

    #[test]
    fn position_from_priority_round_trips() {
        for size in [10usize, 50, 100, 250] {
            for pos in 1..=size {
                let p = priority_from_position(pos, size);
                let back = position_from_priority(p, size);
                assert!(
                    (back as i64 - pos as i64).abs() <= 1,
                    "size={size} pos={pos} → priority {p} → position {back} (drift > 1)"
                );
            }
        }
    }

    #[test]
    fn position_from_priority_size_one_is_one() {
        assert_eq!(position_from_priority(50.0, 1), 1);
    }

    #[test]
    fn position_from_priority_clamps_out_of_range() {
        assert_eq!(position_from_priority(-10.0, 100), 1);
        assert_eq!(position_from_priority(200.0, 100), 100);
    }

    #[test]
    fn stable_jitter_is_deterministic_and_bounded() {
        let a = stable_jitter("card-123");
        let b = stable_jitter("card-123");
        assert_eq!(a, b, "same id must yield same jitter");
        assert!(a >= -1.0 && a < 1.0, "jitter must be in [-1, 1), got {a}");
        // Different ids very likely differ.
        let c = stable_jitter("card-999");
        assert_ne!(a, c);
    }

    #[test]
    fn high_priority_surfaces_first() {
        let elems = vec![
            SortElement { id: "low", priority: 10.0, element_type: SortElementType::Item },
            SortElement { id: "high", priority: 90.0, element_type: SortElementType::Topic },
        ];
        let order = sort_session(&elems, &CombinedSortConfig::default());
        assert_eq!(order[0], 1, "higher-priority element leads");
    }

    #[test]
    fn equal_priorities_interleave_types() {
        // Two topics and two items, all equal priority. The proportion bias
        // should push toward alternation rather than clustering.
        let elems = vec![
            SortElement { id: "t1", priority: 50.0, element_type: SortElementType::Topic },
            SortElement { id: "t2", priority: 50.0, element_type: SortElementType::Topic },
            SortElement { id: "i1", priority: 50.0, element_type: SortElementType::Item },
            SortElement { id: "i2", priority: 50.0, element_type: SortElementType::Item },
        ];
        let order = sort_session(&elems, &CombinedSortConfig::default());
        let types: Vec<_> = order.iter().map(|&i| elems[i].element_type).collect();
        // No two adjacent same-type beyond a small run.
        let mut max_run = 0;
        let mut run = 0;
        for w in types.windows(2) {
            if w[0] == w[1] {
                run += 1;
            } else {
                max_run = max_run.max(run);
                run = 0;
            }
        }
        max_run = max_run.max(run);
        assert!(max_run <= 1, "topics and items interleave; max same-type run was {max_run}");
    }

    #[test]
    fn close_priorities_are_never_reordered() {
        // The regression the jitter term used to cause: a 4-point priority gap
        // was inside the old ±5 jitter band, so 48 could beat 52. Same type on
        // both sides so the proportion bias cannot explain a flip either.
        for i in 0..200 {
            let low = Box::leak(format!("low{i}").into_boxed_str());
            let high = Box::leak(format!("high{i}").into_boxed_str());
            let elems = vec![
                SortElement { id: low, priority: 48.0, element_type: SortElementType::Item },
                SortElement { id: high, priority: 52.0, element_type: SortElementType::Item },
            ];
            let order = sort_session(&elems, &CombinedSortConfig::default());
            assert_eq!(order[0], 1, "id pair {i}: the 52 must lead the 48");
        }
    }

    #[test]
    fn sort_is_deterministic_across_calls() {
        let elems: Vec<_> = (0..12)
            .map(|i| SortElement {
                id: Box::leak(format!("e{i}").into_boxed_str()),
                priority: 50.0,
                element_type: if i % 2 == 0 { SortElementType::Topic } else { SortElementType::Item },
            })
            .collect();
        let a = sort_session(&elems, &CombinedSortConfig::default());
        let b = sort_session(&elems, &CombinedSortConfig::default());
        assert_eq!(a, b, "same input must yield same order");
    }
}
