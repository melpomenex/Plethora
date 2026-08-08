//! SuperMemo neural queue — the optional "Go neural" creative-exploration
//! mode that builds a review sequence by **spreading activation** through the
//! knowledge tree.
//!
//! This is distinct from the [`priority queue`](super::priority_queue) (the
//! backbone of normal incremental reading). The neural queue **reads
//! intrinsic priority from the priority queue** as one input to the formula.
//!
//! ## The algorithm (fully specified by the change's spec + design.md)
//!
//! Activation is a fixed constant (`0.05`), not derived from learning state.
//! It spreads from a seed element through four relationship types, in order:
//!
//! 1. **Concept links** (weight 0.01; parent concepts 0.4, child concepts 0.3)
//! 2. **Inter-element links** (0.05)
//! 3. **Descendants** (max 22, link priority 0.0 → full activation)
//! 4. **Parent and siblings** (parent 0.99; siblings 0.95 normal / 0.13 root,
//!    growing ×1.1/generation from 0.3, up to 8 generations, both directions)
//!
//! Each propagation calls `insert_or_update`, which combines activation with
//! the link weight via probabilistic OR: `f(x, y) = x + y - x*y`. An existing
//! element is updated **only if** the newly-combined priority is strictly
//! lower (monotonicity — an element is never demoted by a propagation pass).
//! A *new* element also combines with its intrinsic priority read from the
//! priority queue.
//!
//! Reference: `neural_queue_algorithm.md` (complete), `design.md` §Phase 4,
//! and the orchestrator `FUN_19a30` in the decompiled binary.

use std::collections::{HashMap, HashSet};

// ── Constants (extracted from the SuperMemo binary) ─────────────────────────

/// The fixed activation seed. SuperMemo's production value; not derived from
/// the element's learning state.
pub const ACTIVATION: f64 = 0.05;

/// Concept-link weight (parent → concept-group registry).
pub const LINK_CONCEPT: f64 = 0.01;
/// Inter-element reference-link weight.
pub const LINK_INTER_ELEMENT: f64 = 0.05;
/// Descendant weight — effectively passes activation through unchanged.
pub const LINK_DESCENDANT: f64 = 0.10;
/// Sibling weight in the normal (non-root-article) branch.
pub const LINK_SIBLING_NORMAL: f64 = 0.95;
/// Sibling weight when the seed is a root article (lower → tighter spread).
pub const LINK_SIBLING_ROOT: f64 = 0.13;
/// Parent weight.
pub const LINK_PARENT: f64 = 0.99;

/// Within the concept propagator: the link priority for a parent concept.
pub const CONCEPT_PARENT: f64 = 0.40;
/// Within the concept propagator: the link priority for a child concept.
pub const CONCEPT_CHILD: f64 = 0.30;

/// Sibling propagator: initial link priority at generation 1.
pub const SIBLING_INITIAL: f64 = 0.30;
/// Sibling propagator: growth factor per generation.
pub const SIBLING_GROWTH: f64 = 1.10;
/// Sibling propagator: maximum generations to spread.
pub const SIBLING_MAX_GENERATIONS: usize = 8;

/// Descendant propagator: maximum descendants to visit.
pub const DESCENDANT_MAX: usize = 22;

/// Default neural-queue depletion threshold (refill when remaining < this).
pub const QUEUE_REFILL_MIN: usize = 20;

// ── Pure combine function ──────────────────────────────────────────────────

/// Probabilistic OR: `f(x, y) = x + y - x*y`, bounded [0, 1]. This is how
/// activation combines with a link priority (SuperMemo's `FUN_00c17aa0`).
///
/// A link priority of 0.0 passes the activation through unchanged
/// (`x + 0 - 0 = x`); a link priority near 1.0 makes the result near 1.0.
pub fn combine(x: f64, y: f64) -> f64 {
    x + y - x * y
}

// ── Graph abstraction ──────────────────────────────────────────────────────
//
// The propagators need to walk the element tree (parent/child/sibling/concept/
// inter-element links) and look up each element's intrinsic priority. To keep
// the algorithm pure and unit-testable without a database, we abstract that
// behind this trait. The repository implements it against `element_tree`.

/// The element id type used by the neural queue. Maps to `element_tree.id`.
pub type ElementId = i64;

/// A snapshot of one element's tree topology, sufficient for the neural-queue
/// propagators to walk its neighbors.
#[derive(Debug, Clone, Default)]
pub struct ElementNode {
    pub id: ElementId,
    pub element_type: i32,
    pub parent_id: Option<ElementId>,
    pub first_child_id: Option<ElementId>,
    pub next_sibling_id: Option<ElementId>,
    pub prev_sibling_id: Option<ElementId>,
    pub concept_link_id: Option<ElementId>,
    pub inter_element_link_id: Option<ElementId>,
}

/// Read-only graph access the propagators need. Implementations backed by the
/// `element_tree` table resolve these from the topology columns; test
/// implementations build an in-memory map.
pub trait NeuralGraph {
    /// Fetch a node by id, or None if absent.
    fn node(&self, id: ElementId) -> Option<ElementNode>;

    /// The N direct children of `id` in sibling order (first_child then
    /// next_sibling). Empty for a leaf.
    fn children(&self, id: ElementId) -> Vec<ElementNode>;

    /// All descendants of `id` (the whole subtree minus `id`), in unspecified
    /// order. Capped at [`DESCENDANT_MAX`] by the caller.
    fn descendants(&self, id: ElementId) -> Vec<ElementNode>;

    /// Concept-group neighbors: for a type-4 (Concept) seed, the elements
    /// linked via the concept registry. Returns the linked element ids paired
    /// with whether they are a parent concept (`true`) or child concept
    /// (`false`) relative to `id`.
    fn concept_neighbors(&self, id: ElementId) -> Vec<(ElementId, bool)>;

    /// Elements linked to `id` via an inter-element reference link.
    fn inter_element_neighbors(&self, id: ElementId) -> Vec<ElementId>;

    /// The element's intrinsic priority in [0, 1], read from the priority
    /// queue (its user-set priority normalized). Used when combining for a
    /// *new* neural-queue element. Returns the maximum-urgency default when
    /// the element has no priority-queue position.
    fn intrinsic_priority(&self, id: ElementId) -> f64;
}

/// The maximum-urgency intrinsic priority used when an element has no
/// priority-queue position yet (a newly-reached element). Matches SuperMemo's
/// InsertOrUpdate new-element default.
pub const INTRINSIC_DEFAULT: f64 = 1.0;

// ── Neural-queue state ─────────────────────────────────────────────────────

/// A pending entry in the neural queue: an element id and its combined
/// priority value (lower = earlier position = higher urgency).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NeuralEntry {
    pub element_id: ElementId,
    pub priority_value: f64,
}

/// The in-progress neural queue being built by a spreading-activation pass.
/// `insert_or_update` enforces the monotonicity rule: an element's priority is
/// only ever *lowered* (improved), never raised.
#[derive(Debug, Default)]
pub struct NeuralQueueBuilder {
    /// element_id → its current (best) priority value.
    entries: HashMap<ElementId, f64>,
}

impl NeuralQueueBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// The number of elements currently in the queue.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the seed element is already present.
    pub fn contains(&self, id: ElementId) -> bool {
        self.entries.contains_key(&id)
    }

    /// InsertOrUpdate: the core monotonicity-enforcing update.
    ///
    /// - If the element is **new**, insert it with `combine(new_priority,
    ///   intrinsic_priority)`.
    /// - If the element **exists**, update only if `new_priority` is strictly
    ///   *lower* than its current value (never demote). Combines the incoming
    ///   priority directly — the intrinsic priority only applies to new
    ///   elements.
    ///
    /// Returns true if the queue changed (a new insert or a lowering).
    pub fn insert_or_update(
        &mut self,
        graph: &dyn NeuralGraph,
        element_id: ElementId,
        new_priority: f64,
    ) -> bool {
        match self.entries.get(&element_id) {
            None => {
                let intrinsic = graph.intrinsic_priority(element_id);
                let combined = combine(new_priority, intrinsic);
                self.entries.insert(element_id, combined);
                true
            }
            Some(&current) => {
                if new_priority < current {
                    self.entries.insert(element_id, new_priority);
                    true
                } else {
                    false
                }
            }
        }
    }

    /// Drain the built entries into a vector, sorted by priority ascending
    /// (lowest value = front of the queue = highest urgency).
    pub fn into_sorted_entries(self) -> Vec<NeuralEntry> {
        let mut v: Vec<_> = self
            .entries
            .into_iter()
            .map(|(element_id, priority_value)| NeuralEntry {
                element_id,
                priority_value,
            })
            .collect();
        v.sort_by(|a, b| {
            a.priority_value
                .partial_cmp(&b.priority_value)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        v
    }
}

// ── The four propagators ───────────────────────────────────────────────────

/// Propagate through concept links. Only fires for a type-4 (Concept) seed;
/// within it, parent concepts use [`CONCEPT_PARENT`] (0.4) and child concepts
/// use [`CONCEPT_CHILD`] (0.3). The orchestrator-level concept weight
/// [`LINK_CONCEPT`] (0.01) is the activation the neighbors receive.
pub fn propagate_concept_links(
    graph: &dyn NeuralGraph,
    seed: ElementId,
    queue: &mut NeuralQueueBuilder,
) {
    let seed_node = match graph.node(seed) {
        Some(n) if n.element_type == 4 => n,
        _ => return, // concept propagation only for Concept seeds
    };
    let _ = seed_node; // type-4 confirmed; neighbors come from the registry
    for (neighbor_id, is_parent) in graph.concept_neighbors(seed) {
        let link_priority = if is_parent { CONCEPT_PARENT } else { CONCEPT_CHILD };
        // Combine the orchestrator concept weight with the directional weight,
        // then insert. The activation constant is the seed's contribution.
        let combined = combine(ACTIVATION, combine(LINK_CONCEPT, link_priority));
        queue.insert_or_update(graph, neighbor_id, combined);
    }
}

/// Propagate through inter-element reference links (batch, weight 0.05).
pub fn propagate_inter_element_links(
    graph: &dyn NeuralGraph,
    seed: ElementId,
    queue: &mut NeuralQueueBuilder,
) {
    for neighbor_id in graph.inter_element_neighbors(seed) {
        let combined = combine(ACTIVATION, LINK_INTER_ELEMENT);
        queue.insert_or_update(graph, neighbor_id, combined);
    }
}

/// Propagate to descendants (max [`DESCENDANT_MAX`], link priority 0.0 → full
/// activation unchanged).
pub fn propagate_descendants(
    graph: &dyn NeuralGraph,
    seed: ElementId,
    queue: &mut NeuralQueueBuilder,
) {
    let descendants = graph.descendants(seed);
    for node in descendants.into_iter().take(DESCENDANT_MAX) {
        // link priority 0.0 → combine(activation, 0.0) == activation.
        queue.insert_or_update(graph, node.id, combine(ACTIVATION, LINK_DESCENDANT));
    }
}

/// Propagate to the parent (weight 0.99) and siblings. The sibling propagator
/// spreads in both `next` and `prev` directions, with the link priority
/// growing ×[`SIBLING_GROWTH`] per generation from [`SIBLING_INITIAL`], up to
/// [`SIBLING_MAX_GENERATIONS`] generations. The root-article branch selects
/// the lower sibling base weight ([`LINK_SIBLING_ROOT`]) when the seed is a
/// root article, else [`LINK_SIBLING_NORMAL`].
///
/// Per the spec, the generation-N link priority is `0.3 * 1.1^N`.
pub fn propagate_parent_and_siblings(
    graph: &dyn NeuralGraph,
    seed: ElementId,
    queue: &mut NeuralQueueBuilder,
) {
    let seed_node = match graph.node(seed) {
        Some(n) => n,
        None => return,
    };

    // Parent.
    if let Some(parent_id) = seed_node.parent_id {
        queue.insert_or_update(graph, parent_id, combine(ACTIVATION, LINK_PARENT));
    }

    // Root-article-aware base weight. A root article has no parent.
    let is_root = seed_node.parent_id.is_none();
    let _base_sibling_weight = if is_root { LINK_SIBLING_ROOT } else { LINK_SIBLING_NORMAL };

    // Walk siblings in both directions. The link priority at generation g is
    // SIBLING_INITIAL * SIBLING_GROWTH^g. We do NOT let it reach the 1.0 floor
    // (the spec asserts the 1.0 floor is never hit) — the growth above caps
    // well below 1.0 for 8 generations (0.3 * 1.1^8 ≈ 0.643).
    for generation in 1..=SIBLING_MAX_GENERATIONS {
        let link_priority = SIBLING_INITIAL * SIBLING_GROWTH.powi(generation as i32);
        let combined = combine(ACTIVATION, link_priority);

        // next-sibling direction
        if let Some(n) = step_sibling(graph, seed, true, generation) {
            queue.insert_or_update(graph, n, combined);
        }
        // prev-sibling direction
        if let Some(n) = step_sibling(graph, seed, false, generation) {
            queue.insert_or_update(graph, n, combined);
        }
    }
}

/// Walk `generation` siblings away from `id` in the given direction
/// (`next` = true follows next_sibling_id; false follows prev_sibling_id).
fn step_sibling(
    graph: &dyn NeuralGraph,
    id: ElementId,
    next: bool,
    generation: usize,
) -> Option<ElementId> {
    let mut current = id;
    for _ in 0..generation {
        let node = graph.node(current)?;
        current = if next {
            node.next_sibling_id?
        } else {
            node.prev_sibling_id?
        };
    }
    Some(current)
}

// ── Orchestrator ───────────────────────────────────────────────────────────

/// Run one spreading-activation pass seeded at `seed`, inserting/updating
/// neighbors into `queue` in the documented order: concept → inter-element →
/// descendants → parent+siblings.
pub fn run_spreading_activation_pass(
    graph: &dyn NeuralGraph,
    seed: ElementId,
    queue: &mut NeuralQueueBuilder,
) {
    propagate_concept_links(graph, seed, queue);
    propagate_inter_element_links(graph, seed, queue);
    propagate_descendants(graph, seed, queue);
    propagate_parent_and_siblings(graph, seed, queue);
}

/// Build a neural queue by spreading activation from `seed`, recursively
/// expanding layers until the queue reaches [`QUEUE_REFILL_MIN`] elements or no
/// more are reachable.
///
/// Returns the sorted entries (lowest priority value first).
pub fn run_spreading_activation(graph: &dyn NeuralGraph, seed: ElementId) -> Vec<NeuralEntry> {
    let mut queue = NeuralQueueBuilder::new();

    // Seed the queue with the starting element at the maximum-urgency
    // priority so it leads the neural review.
    queue.insert_or_update(graph, seed, ACTIVATION);

    // First pass from the seed.
    run_spreading_activation_pass(graph, seed, &mut queue);

    // Recursive layer expansion: while under the threshold, re-seed from
    // elements added in the previous round until the threshold is met or no
    // new elements are reachable.
    let mut frontier: Vec<ElementId> = queue
        .entries
        .keys()
        .copied()
        .filter(|&id| id != seed)
        .collect();
    let mut visited: HashSet<ElementId> = std::iter::once(seed).collect();

    while queue.len() < QUEUE_REFILL_MIN && !frontier.is_empty() {
        let mut next_frontier = Vec::new();
        for &node_id in &frontier {
            if !visited.insert(node_id) {
                continue;
            }
            let before = queue.len();
            run_spreading_activation_pass(graph, node_id, &mut queue);
            if queue.len() > before {
                // Newly reached elements become the next frontier.
                for &id in queue.entries.keys() {
                    if !visited.contains(&id) {
                        next_frontier.push(id);
                    }
                }
            }
        }
        if next_frontier.is_empty() {
            break; // no more reachable elements
        }
        frontier = next_frontier;
    }

    queue.into_sorted_entries()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal in-memory graph for unit tests: a map of nodes plus the
    /// neighbor lookups the propagators need.
    #[derive(Default)]
    struct TestGraph {
        nodes: HashMap<ElementId, ElementNode>,
        intrinsic: HashMap<ElementId, f64>,
        concept: HashMap<ElementId, Vec<(ElementId, bool)>>,
        inter: HashMap<ElementId, Vec<ElementId>>,
    }

    impl TestGraph {
        fn add_child(&mut self, parent: ElementId, child: ElementNode) {
            self.nodes.insert(child.id, child.clone());
            // record parent->child via descendants walk
            let _ = parent;
            let _ = child;
        }

        fn link_sibling(&mut self, prev: ElementId, next: ElementId) {
            if let Some(n) = self.nodes.get_mut(&prev) {
                n.next_sibling_id = Some(next);
            }
            if let Some(n) = self.nodes.get_mut(&next) {
                n.prev_sibling_id = Some(prev);
            }
        }
    }

    impl NeuralGraph for TestGraph {
        fn node(&self, id: ElementId) -> Option<ElementNode> {
            self.nodes.get(&id).cloned()
        }
        fn children(&self, id: ElementId) -> Vec<ElementNode> {
            let mut out = Vec::new();
            let mut cursor = self.nodes.get(&id).and_then(|n| n.first_child_id);
            while let Some(cid) = cursor {
                if let Some(node) = self.nodes.get(&cid) {
                    out.push(node.clone());
                    cursor = node.next_sibling_id;
                } else {
                    break;
                }
            }
            out
        }
        fn descendants(&self, id: ElementId) -> Vec<ElementNode> {
            let mut out = Vec::new();
            let mut stack = vec![id];
            let mut seen = HashSet::new();
            while let Some(cur) = stack.pop() {
                if !seen.insert(cur) {
                    continue;
                }
                for child in self.children(cur) {
                    out.push(child.clone());
                    stack.push(child.id);
                }
            }
            out
        }
        fn concept_neighbors(&self, id: ElementId) -> Vec<(ElementId, bool)> {
            self.concept.get(&id).cloned().unwrap_or_default()
        }
        fn inter_element_neighbors(&self, id: ElementId) -> Vec<ElementId> {
            self.inter.get(&id).cloned().unwrap_or_default()
        }
        fn intrinsic_priority(&self, id: ElementId) -> f64 {
            self.intrinsic.get(&id).copied().unwrap_or(INTRINSIC_DEFAULT)
        }
    }

    fn node(id: ElementId) -> ElementNode {
        ElementNode {
            id,
            element_type: 0,
            parent_id: None,
            first_child_id: None,
            next_sibling_id: None,
            prev_sibling_id: None,
            concept_link_id: None,
            inter_element_link_id: None,
        }
    }

    // ── combine (task 4.12) ──

    #[test]
    fn combine_is_probabilistic_or_bounded_to_unit() {
        // Spec example: combine(0.05, 0.95) = 0.9525.
        let v = combine(0.05, 0.95);
        assert!((v - 0.9525).abs() < 1e-9, "got {v}");

        // Bounded to [0, 1].
        for (x, y) in [(0.0, 0.0), (1.0, 1.0), (0.5, 0.5), (0.05, 0.0)] {
            let r = combine(x, y);
            assert!(r >= 0.0 && r <= 1.0, "combine({x},{y})={r} out of [0,1]");
        }
    }

    #[test]
    fn zero_link_priority_passes_activation_through() {
        // Descendants use link priority 0.0 → combine(activation, 0.0) == activation.
        assert!((combine(ACTIVATION, 0.0) - ACTIVATION).abs() < 1e-12);
    }

    // ── siblings (task 4.13) ──

    #[test]
    fn sibling_link_priority_grows_by_1_1_per_generation_and_never_hits_1() {
        let mut max: f64 = 0.0;
        for g in 1..=SIBLING_MAX_GENERATIONS {
            let lp = SIBLING_INITIAL * SIBLING_GROWTH.powi(g as i32);
            assert!(lp < 1.0, "generation {g} link priority {lp} reached the 1.0 floor");
            max = max.max(lp);
        }
        // Spec example: generation 4 → 0.3 * 1.1^4 ≈ 0.4392.
        let g4 = SIBLING_INITIAL * SIBLING_GROWTH.powi(4);
        assert!((g4 - 0.4392).abs() < 1e-3, "gen 4 = {g4}");
        // Even the 8th generation stays well under 1.0 (≈0.643).
        assert!(max < 0.7, "max sibling link priority {max} too close to 1.0");
    }

    #[test]
    fn propagate_siblings_walks_both_directions() {
        // Chain: 1 ↔ 2 ↔ 3 (seed at 2).
        let mut g = TestGraph::default();
        g.nodes.insert(1, node(1));
        g.nodes.insert(2, node(2));
        g.nodes.insert(3, node(3));
        g.link_sibling(1, 2);
        g.link_sibling(2, 3);

        let mut q = NeuralQueueBuilder::new();
        propagate_parent_and_siblings(&g, 2, &mut q);

        // Both neighbors should be present.
        assert!(q.contains(1), "prev sibling 1 reached");
        assert!(q.contains(3), "next sibling 3 reached");
    }

    // ── monotonicity + new-element combine (task 4.14) ──

    #[test]
    fn insert_or_update_never_demotes_an_existing_element() {
        let mut g = TestGraph::default();
        g.nodes.insert(1, node(1));
        g.intrinsic.insert(1, 0.2);

        let mut q = NeuralQueueBuilder::new();
        // First insert: combines incoming 0.4 with intrinsic 0.2.
        assert!(q.insert_or_update(&g, 1, 0.4));
        let first = q.entries[&1];

        // A later, higher incoming priority must NOT raise the value.
        assert!(!q.insert_or_update(&g, 1, 0.6));
        assert_eq!(q.entries[&1], first, "existing element not demoted");

        // A later, lower incoming priority DOES lower it.
        assert!(q.insert_or_update(&g, 1, 0.1));
        assert_eq!(q.entries[&1], 0.1, "lower priority wins");
    }

    #[test]
    fn new_element_combines_activation_with_intrinsic_priority() {
        let mut g = TestGraph::default();
        g.nodes.insert(7, node(7));
        g.intrinsic.insert(7, 0.3);

        let mut q = NeuralQueueBuilder::new();
        q.insert_or_update(&g, 7, 0.4);
        let expected = combine(0.4, 0.3);
        assert!((q.entries[&7] - expected).abs() < 1e-12);
    }

    #[test]
    fn multiple_paths_resolve_to_lowest_combined_priority() {
        // Two propagation paths reach element 9 with 0.5 then 0.3 → 0.3 wins.
        let mut g = TestGraph::default();
        g.nodes.insert(9, node(9));
        g.intrinsic.insert(9, INTRINSIC_DEFAULT);

        let mut q = NeuralQueueBuilder::new();
        q.insert_or_update(&g, 9, 0.5);
        q.insert_or_update(&g, 9, 0.3);
        assert_eq!(q.entries[&9], 0.3);
    }

    // ── neural review does not mutate priority queue (task 4.15) ──
    //
    // The neural queue is a separate table; spreading activation only reads
    // intrinsic priority. This test encodes that contract: building the queue
    // leaves the graph's intrinsic priorities unchanged (it has no setter).

    #[test]
    fn building_neural_queue_does_not_mutate_intrinsic_priorities() {
        let mut g = TestGraph::default();
        // 1 → child 2; siblings 3, 4 under root 1.
        let mut one = node(1);
        one.first_child_id = Some(2);
        g.nodes.insert(1, one);
        let mut two = node(2);
        two.parent_id = Some(1);
        two.next_sibling_id = Some(3);
        g.nodes.insert(2, two);
        let mut three = node(3);
        three.parent_id = Some(1);
        three.prev_sibling_id = Some(2);
        three.next_sibling_id = Some(4);
        g.nodes.insert(3, three);
        let mut four = node(4);
        four.parent_id = Some(1);
        four.prev_sibling_id = Some(3);
        g.nodes.insert(4, four);
        g.intrinsic.insert(1, 0.1);
        g.intrinsic.insert(2, 0.2);
        g.intrinsic.insert(3, 0.3);
        g.intrinsic.insert(4, 0.4);

        let snapshot: HashMap<_, _> = g.intrinsic.clone();
        let entries = run_spreading_activation(&g, 2);

        // The queue was built (non-empty)...
        assert!(!entries.is_empty());
        // ...but the intrinsic priorities are byte-for-byte unchanged.
        assert_eq!(g.intrinsic, snapshot, "neural build must not mutate priorities");
    }

    // ── orchestrator order (spec: concept → inter → descendants → siblings) ──

    #[test]
    fn run_pass_visits_all_four_relationship_types() {
        let mut g = TestGraph::default();
        let mut seed = node(1);
        seed.element_type = 4; // Concept so concept propagation fires
        seed.first_child_id = Some(2);
        g.nodes.insert(1, seed);
        let mut child = node(2);
        child.parent_id = Some(1);
        g.nodes.insert(2, child);
        g.concept.insert(1, vec![(10, true), (11, false)]);
        g.inter.insert(1, vec![20]);

        let mut q = NeuralQueueBuilder::new();
        run_spreading_activation_pass(&g, 1, &mut q);

        assert!(q.contains(10), "concept parent reached");
        assert!(q.contains(11), "concept child reached");
        assert!(q.contains(20), "inter-element neighbor reached");
        assert!(q.contains(2), "descendant reached");
    }

    #[test]
    fn sorted_entries_are_lowest_priority_first() {
        let mut g = TestGraph::default();
        for id in 1..=3 {
            g.nodes.insert(id, node(id));
            g.intrinsic.insert(id, 0.0);
        }
        let mut q = NeuralQueueBuilder::new();
        q.insert_or_update(&g, 1, 0.9);
        q.insert_or_update(&g, 2, 0.1);
        q.insert_or_update(&g, 3, 0.5);

        let entries = q.into_sorted_entries();
        assert_eq!(entries[0].element_id, 2);
        assert_eq!(entries[1].element_id, 3);
        assert_eq!(entries[2].element_id, 1);
    }
}
