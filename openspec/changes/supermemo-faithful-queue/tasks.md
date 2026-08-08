## Phase 1 — Unified priority-ordered Scroll session

> Ships value immediately, fixes the reported "all flashcards sequentially"
> bug, and is a prerequisite for Phases 3 and 4. No schema changes.

- [ ] 1.1 Add a unified "outstanding today" query (Tauri command or store
      selector) returning due documents + due extracts + due learning items
      combined, independent of the active Queue filter. Source it from the same
      due pools the optimal-path builder already uses.
- [ ] 1.2 In `QueueScrollPage.tsx`'s build effect (lines ~1098-1510), source
      both the `queue-list` and `optimal` branches from the unified set rather
      than `customQueueItems` / `documentQueueItems`. The active filter still
      governs the Queue *list* but not the Scroll *session*.
- [ ] 1.3 Backfill the document pool in the `queue-list` path when the unified
      set's documents are fewer than the composition target — mirroring the
      existing extract/flashcard top-up. This closes the in-flight change's
      broken "Scroll Mode button honours the flashcard slider" scenario.
- [ ] 1.4 Replace `interleaveScrollItems` + `applyVarietyMixing` as the primary
      ordering with `orderQueueItems` (the existing `getPriorityScore` sort).
      Keep a reduced variety guard: max 3 consecutive same-type items, without
      reordering across priority boundaries.
- [ ] 1.5 Verify the build effect's dependency array covers the new unified-set
      reads; preserve resumability per `stabilize-queue-order-on-reactivation`.
- [ ] 1.6 Add a regression test that builds a session from a flashcard-leaning
      source (no documents in the filter rows) with due documents available,
      and asserts documents appear interleaved, not absent.
- [ ] 1.7 Manually verify: Due All / All Items / New Only now interleave
      documents and flashcards; Due Today now surfaces flashcards when the
      slider is non-zero.

## Phase 2 — Knowledge tree model

> Adds the `element_tree` overlay table and wires tree construction into the IR
> flow. No visible behavior change; grows the tree silently. Needed by Phase 4;
> independent of Phase 3 (the two may proceed in parallel after Phase 1).

### Schema and repository

- [ ] 2.1 Write a migration adding the `element_tree` table with columns from
      design.md (`id`, `element_kind`, `element_ref_id`, `parent_id`,
      `first_child_id`, `next_sibling_id`, `prev_sibling_id`, `element_type`,
      `concept_link_id`, `inter_element_link_id`, `descendant_count_a`,
      `descendant_count_b`, `sort_order`, `created_at`) and a
      `UNIQUE (element_kind, element_ref_id)` constraint.
- [ ] 2.2 Backfill migration: register every existing document (Topic, root),
      extract (Topic, parent=document), and learning_item (Item, parent=extract
      or document) as element_tree nodes, reconstructing edges from existing
      FKs. Sibling order by `created_at`.
- [ ] 2.3 Add `ElementTreeRepository` with: `register_node(kind, ref_id, type,
      parent_id) -> id` (handles append-as-last-child sibling-chain surgery),
      `unlink_node(id)`, `move_node(src, new_parent, mode)` (cycle-guarded via
      `is_descendant`), `get_siblings`, `get_descendants` (with the 300/400
      threshold branches), `get_root_article`.
- [ ] 2.4 Add tree-edge insertion to `Repository::create_extract`
      (`repository.rs:~1764`, inside the existing transaction): after the
      extract INSERT + count bump, register a Topic child under the document's
      node.
- [ ] 2.5 Add tree-edge insertion to `create_learning_item_inner`
      (`repository.rs:~2509`): after the card INSERT, register an Item child
      under the extract's node if `extract_id` is set, else the document's node.
- [ ] 2.6 Register an element_tree root (Topic) for every document in the
      document-creation command path (import / new document).
- [ ] 2.7 Add `unlink_node` calls to the document / extract / learning_item
      delete paths, patching the sibling chain symmetrically.

### Gap fixes (close while the code is open)

- [ ] 2.8 Add `extract_id: Option<String>` parameter to the `create_learning_item`
      Tauri command (`learning_item.rs:229`) and bind it on the model.
- [ ] 2.9 Bump `documents.learning_item_count` in `create_learning_item_inner`
      to match the extract path's `extract_count` bump.

### Tests

- [ ] 2.10 Unit test `register_node`'s append-as-last-child surgery: first
       child, second child (prev/next sibling wiring), parent's pointers.
- [ ] 2.11 Unit test `unlink_node`: middle-of-chain unlink reconnects prev and
       next; head and tail unlink update the parent's child pointer.
- [ ] 2.12 Unit test `is_descendant` cycle guard: moving a node into its own
       descendant is rejected.
- [ ] 2.13 Integration test: create document → extract → cloze and assert the
       three-level tree with correct sibling pointers.
- [ ] 2.14 Migration test: backfill against a fixture library produces the
       expected node count and edges from existing FKs.

## Phase 3 — Complete the priority queue (the backbone)

> The biggest gap: cards have no user-set priority. Completing the priority
> queue makes the three item types uniform. Depends on Phase 1; independent of
> Phase 2.

### Card priority

- [ ] 3.1 Migration adding `priority_slider` (0-100, default 50) and
       `priority_score` columns to `learning_items`, mirroring documents.
- [ ] 3.2 Extend `calculate_priority_score` (`algorithms/mod.rs:162`) to keep
       FSRS urgency separate from the new user-set priority — the user-set
       value is the importance rank; FSRS urgency continues to drive *when* the
       card is scheduled.
- [ ] 3.3 Extend the `PriorityControl` UI to learning items (cards) so the
       user can set priority on a card the same way as on a document.

### Position ↔ priority mapping

- [ ] 3.4 Implement `priority_from_position` and `position_from_priority` in
       `src-tauri/src/algorithms/priority_queue.rs` per design.md (the
       `FUN_00cb1630` / `FUN_00cb21c0` linear map). Unit-test edge cases
       (size ≤ 1, position 1, last position).
- [ ] 3.5 Expose relative queue position in the UI — show each element's
       priority-queue position (1…N) alongside its percentage priority.

### Combined sort criterion

- [ ] 3.6 Implement the combined sort in `priority_queue.rs`:
       `score = priority + topic_item_proportion_bias(type, config) +
       stable_jitter(id)`. Document the three terms and their precedence.
- [ ] 3.7 **Reverse-engineering dig** (if needed): mine `FUN_00c15fd0` and the
       config it reads at `param_1 + 0x748` for the exact
       proportion-of-topics formula and the "[0 .. max]" knob (flagged as open
       in `priority_queue_algorithm.md`). If unresolvable, keep the composition
       sliders as the manual proxy and document the deviation.
- [ ] 3.8 Repoint Scroll Mode's ordering (Phase 1's `orderQueueItems`) to the
       new combined criterion. The sort runs at session start, not per-render.
- [ ] 3.9 Benchmark the combined sort (`src/**/*.bench.ts` with `seededRandom`);
       record baselines in `scripts/perf-baselines.json`.

### Auto-postpone

- [ ] 3.10 Implement `src-tauri/src/algorithms/postpone.rs` per
        `~sushi/sm20-re/postpone_algorithm.md`: manual + auto-postpone,
        per-branch config, priority/difficulty thresholds, do-not-postpone flag.
- [ ] 3.11 Wire auto-postpone into session start: when outstanding material
        exceeds daily capacity, postpone the lowest-priority elements.
- [ ] 3.12 Add settings for auto-postpone (enable/disable, thresholds) and the
        do-not-postpone per-element flag.
- [ ] 3.13 Unit tests for postpone: threshold-respected cases, capacity
        boundary, do-not-postpone override.

## Phase 4 — Neural queue with spreading activation (optional creative mode)

> The "Go neural" mode. Depends on **both** Phase 2 (the tree to walk) and
> Phase 3 (the priority queue to read intrinsic priority from).

### Schema and storage

- [ ] 4.1 Migration adding the `neural_queue` table (`element_id` PK →
       `element_tree.id`, `position`, `priority_value`, `updated_at`) —
       distinct from the priority queue.
- [ ] 4.2 `NeuralQueueRepository`: `build(seed_element_id)` (run spreading
       activation), `front(n)`, `consume(element_id)`, `size()`,
       `insert_or_update(...)` with the monotonicity rule.

### The algorithm

- [ ] 4.3 Implement `src-tauri/src/algorithms/neural_queue.rs` with the pure
       functions from design.md: `combine(x,y) = x+y-xy`, the constant
       `ACTIVATION = 0.05`, and the link-weight constants.
- [ ] 4.4 Implement `propagate_siblings` (8 generations, ×1.1/generation from
       0.3, both next and prev siblings per generation).
- [ ] 4.5 Implement `propagate_descendants` (max 22, link_priority 0.0 → full
       activation, 300/400 threshold branches).
- [ ] 4.6 Implement `propagate_concept_links` (only for type-4 Concept seeds;
       parent 0.4 / child 0.3; follows the concept-link registry).
- [ ] 4.7 Implement `propagate_inter_element_links` (batch-update, 0.05).
- [ ] 4.8 Implement the orchestrator `run_spreading_activation` in the
       documented order, plus the `< 20` recursive layer expansion.
- [ ] 4.9 Read intrinsic priority from the **priority queue**
       (`priority_from_position` from Phase 3.4) for the new-element combine
       branch, NOT a stored column.

### Trigger and UI

- [ ] 4.10 Add the "Go neural" entry point (opt-in mode). Entering builds the
        neural queue by spreading activation from the current element; exiting
        returns to the priority queue without mutating it.
- [ ] 4.11 Wire the depletion trigger: in neural review, when remaining
        neural-queue elements fall below 20, re-run activation seeded at the
        element just studied. Not per-grade.

### Tests and benchmarks

- [ ] 4.12 Unit test `combine` against the documented example table.
- [ ] 4.13 Unit test `propagate_siblings` link-priority sequence over 8
        generations; assert the 1.0 floor is never hit.
- [ ] 4.14 Unit test the monotonicity rule and the new-element combine branch.
- [ ] 4.15 Unit test that neural review does NOT mutate the priority queue.
- [ ] 4.16 Add `src/**/*.bench.ts` for the propagation pass over a seeded
        large tree; record baselines in `scripts/perf-baselines.json`.

## Cross-cutting

- [ ] 5.1 Update `openspec/changes/add-queue-composition-sliders` task 7.2
       (the broken "Scroll Mode button honours the flashcard slider" scenario):
       mark it superseded by Phase 1 task 1.3 once that lands.
- [ ] 5.2 Update the Queue Settings UI help text: composition sliders control
       *count*; priority (and, in Phase 4, the neural queue) controls *order*.
- [ ] 5.3 Add i18n strings for the "Go neural" entry point and any new
       priority-queue UI (relative position, auto-postpone settings) across
       all six locales.
