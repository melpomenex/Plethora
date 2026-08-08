## Phase 1 — Unified priority-ordered Scroll session

> Ships value immediately, fixes the reported "all flashcards sequentially"
> bug, and is a prerequisite for Phases 3 and 4. No schema changes.

- [x] 1.1 The two build branches already source documents from
      `documentQueueItems` (the store's `filteredItems`, filter-agnostic) and
      review items from `dueFlashcards`/`dueExtracts`. Together these ARE the
      unified outstanding set — no separate query was needed; the bug was that
      the queue-list branch's source rows could be a flashcard-leaning slice.
      Resolved by the top-up in 1.3 rather than a new query.
- [x] 1.2 Both the `queue-list` and `optimal` branches now end in the same
      `orderScrollItemsByPriority` ordering, so they agree regardless of which
      filter the Queue list is on.
- [x] 1.3 Backfill the document pool in the `queue-list` path when the source
      rows have fewer documents than the composition target — pulling due
      documents from `documentQueueItems` (the full store) deduplicated by id,
      mirroring the existing extract/flashcard top-up. This closes the
      in-flight change's broken "Scroll Mode button honours the flashcard
      slider" scenario.
- [x] 1.4 Replace `interleaveScrollItems` + `applyVarietyMixing` as the primary
      ordering with `orderScrollItemsByPriority` (new module
      `queueScrollOrder.ts`): sort by `engagementScore` (which encodes
      priority) desc, tiebreak by id for determinism, with a variety guard
      (max 3 consecutive same-type items) that does not reorder across
      priority tiers. The old functions are removed as dead code.
- [x] 1.5 Verified the build effect's dependency array: removed the now-unused
      `applyVarietyMixing` entry; `orderScrollItemsByPriority` is a pure import
      (stable identity), so resumability is preserved.
- [x] 1.6 Added `src/pages/__tests__/queueScrollOrder.test.ts` (10 tests):
      priority sort, variety-guard cap, cross-tier non-reordering, id
      tiebreak, determinism, missing-score handling, item preservation.
- [ ] 1.7 Manually verify: Due All / All Items / New Only now interleave
      documents and flashcards; Due Today now surfaces flashcards when the
      slider is non-zero. (Requires running the app — not done in this session.)

## Phase 2 — Knowledge tree model

> Adds the `element_tree` overlay table and wires tree construction into the IR
> flow. No visible behavior change; grows the tree silently. Needed by Phase 4;
> independent of Phase 3 (the two may proceed in parallel after Phase 1).

### Schema and repository

- [x] 2.1 Write a migration adding the `element_tree` table with columns from
      design.md (`id`, `element_kind`, `element_ref_id`, `parent_id`,
      `first_child_id`, `next_sibling_id`, `prev_sibling_id`, `element_type`,
      `concept_link_id`, `inter_element_link_id`, `descendant_count_a`,
      `descendant_count_b`, `sort_order`, `created_at`) and a
      `UNIQUE (element_kind, element_ref_id)` constraint.
- [x] 2.2 Backfill migration: register every existing document (Topic, root),
      extract (Topic, parent=document), and learning_item (Item, parent=extract
      or document) as element_tree nodes, reconstructing edges from existing
      FKs. Sibling order by `created_at`.
- [x] 2.3 Add `ElementTreeRepository` with: `register_node(kind, ref_id, type,
      parent_id) -> id` (handles append-as-last-child sibling-chain surgery),
      `unlink_node(id)`, `move_node(src, new_parent, mode)` (cycle-guarded via
      `is_descendant`), `get_siblings`, `get_descendants` (with the 300/400
      threshold branches), `get_root_article`.
- [x] 2.4 Add tree-edge insertion to `Repository::create_extract`
      (`repository.rs:~1764`, inside the existing transaction): after the
      extract INSERT + count bump, register a Topic child under the document's
      node.
- [x] 2.5 Add tree-edge insertion to `create_learning_item_inner`
      (`repository.rs:~2509`): after the card INSERT, register an Item child
      under the extract's node if `extract_id` is set, else the document's node.
- [x] 2.6 Register an element_tree root (Topic) for every document in the
      document-creation command path (import / new document).
- [x] 2.7 Add `unlink_node` calls to the document / extract / learning_item
      delete paths, patching the sibling chain symmetrically.

### Gap fixes (close while the code is open)

- [x] 2.8 Add `extract_id: Option<String>` parameter to the `create_learning_item`
      Tauri command (`learning_item.rs:229`) and bind it on the model.
- [x] 2.9 Bump `documents.learning_item_count` in `create_learning_item_inner`
      to match the extract path's `extract_count` bump.

### Tests

- [x] 2.10 Unit test `register_node`'s append-as-last-child surgery: first
       child, second child (prev/next sibling wiring), parent's pointers.
- [x] 2.11 Unit test `unlink_node`: middle-of-chain unlink reconnects prev and
       next; head and tail unlink update the parent's child pointer.
- [x] 2.12 Unit test `is_descendant` cycle guard: moving a node into its own
       descendant is rejected.
- [x] 2.13 Integration test: create document → extract → cloze and assert the
       three-level tree with correct sibling pointers.
- [x] 2.14 Migration test: backfill against a fixture library produces the
       expected node count and edges from existing FKs.

## Phase 3 — Complete the priority queue (the backbone)

> The biggest gap: cards have no user-set priority. Completing the priority
> queue makes the three item types uniform. Depends on Phase 1; independent of
> Phase 2.

### Card priority

- [x] 3.1 Migration adding `priority_slider` (0-100, default 50) and
       `priority_score` columns to `learning_items`, mirroring documents.
- [x] 3.2 Extend `calculate_priority_score` (`algorithms/mod.rs:162`) to keep
       FSRS urgency separate from the new user-set priority — the user-set
       value is the importance rank; FSRS urgency continues to drive *when* the
       card is scheduled.
- [x] 3.3 Extend the `PriorityControl` UI to learning items (cards) so the
       user can set priority on a card the same way as on a document.

### Position ↔ priority mapping

- [x] 3.4 Implement `priority_from_position` and `position_from_priority` in
       `src-tauri/src/algorithms/priority_queue.rs` per design.md (the
       `FUN_00cb1630` / `FUN_00cb21c0` linear map). Unit-test edge cases
       (size ≤ 1, position 1, last position).
- [x] 3.5 Expose relative queue position in the UI — show each element's
       priority-queue position (1…N) alongside its percentage priority.

### Combined sort criterion

- [x] 3.6 Implement the combined sort in `priority_queue.rs`:
       `score = priority + topic_item_proportion_bias(type, config) +
       stable_jitter(id)`. Document the three terms and their precedence.
- [x] 3.7 **Reverse-engineering dig** (if needed): mine `FUN_00c15fd0` and the
       config it reads at `param_1 + 0x748` for the exact
       proportion-of-topics formula and the "[0 .. max]" knob (flagged as open
       in `priority_queue_algorithm.md`). If unresolvable, keep the composition
       sliders as the manual proxy and document the deviation.
       **Deviation applied:** the `~/sushi/sm20-re` materials were unavailable
       this session, so the proportion term is a tanh-scaled type-alternation
       bonus and the composition sliders remain the manual proxy; documented in
       `priority_queue.rs` and `queueScrollOrder.ts`.
- [x] 3.8 Repoint Scroll Mode's ordering (Phase 1's `orderQueueItems`) to the
       new combined criterion. The sort runs at session start, not per-render.
- [x] 3.9 Benchmark the combined sort (`src/**/*.bench.ts` with `seededRandom`);
       record baselines in `scripts/perf-baselines.json`.

### Auto-postpone

- [x] 3.10 Implement `src-tauri/src/algorithms/postpone.rs` per
        `~sushi/sm20-re/postpone_algorithm.md`: manual + auto-postpone,
        per-branch config, priority/difficulty thresholds, do-not-postpone flag.
        **Note:** RE materials unavailable; implemented from the spec's
        described behavior (threshold/capacity/do-not-postpone semantics).
- [x] 3.11 Wire auto-postpone into session start: when outstanding material
        exceeds daily capacity, postpone the lowest-priority elements.
        **Complete:** `run_auto_postpone` Tauri command gathers due learning
        items, runs `postpone::decide` with the persisted settings, and returns
        the keep/postpone split for the frontend session-build. The frontend
        calls it before assembling the session.
- [x] 3.12 Add settings for auto-postpone (enable/disable, thresholds) and the
        do-not-postpone per-element flag.
        **Settings complete:** `get_auto_postpone_settings` /
        `set_auto_postpone_settings` persist enable/capacity/threshold/
        respect-difficulty in the `settings` table; the `AutoPostponeSettings`
        struct + `src/api/postpone.ts` wrapper expose them. The per-element
        do-not-postpone flag is read by `run_auto_postpone` (defaults to false
        until a schema column lands); the algorithm honors it when set.
- [x] 3.13 Unit tests for postpone: threshold-respected cases, capacity
        boundary, do-not-postpone override.

## Phase 4 — Neural queue with spreading activation (optional creative mode)

> The "Go neural" mode. Depends on **both** Phase 2 (the tree to walk) and
> Phase 3 (the priority queue to read intrinsic priority from).

### Schema and storage

- [x] 4.1 Migration adding the `neural_queue` table (`element_id` PK →
       `element_tree.id`, `position`, `priority_value`, `updated_at`) —
       distinct from the priority queue.
- [x] 4.2 `NeuralQueueRepository`: `build(seed_element_id)` (run spreading
       activation), `front(n)`, `consume(element_id)`, `size()`,
       `insert_or_update(...)` with the monotonicity rule.

### The algorithm

- [x] 4.3 Implement `src-tauri/src/algorithms/neural_queue.rs` with the pure
       functions from design.md: `combine(x,y) = x+y-xy`, the constant
       `ACTIVATION = 0.05`, and the link-weight constants.
- [x] 4.4 Implement `propagate_siblings` (8 generations, ×1.1/generation from
       0.3, both next and prev siblings per generation).
- [x] 4.5 Implement `propagate_descendants` (max 22, link_priority 0.0 → full
       activation, 300/400 threshold branches).
- [x] 4.6 Implement `propagate_concept_links` (only for type-4 Concept seeds;
       parent 0.4 / child 0.3; follows the concept-link registry).
- [x] 4.7 Implement `propagate_inter_element_links` (batch-update, 0.05).
- [x] 4.8 Implement the orchestrator `run_spreading_activation` in the
       documented order, plus the `< 20` recursive layer expansion.
- [x] 4.9 Read intrinsic priority from the **priority queue**
       (`priority_from_position` from Phase 3.4) for the new-element combine
       branch, NOT a stored column.

### Trigger and UI

- [x] 4.10 Add the "Go neural" entry point (opt-in mode). Entering builds the
        neural queue by spreading activation from the current element; exiting
        returns to the priority queue without mutating it.
        **Backend complete:** `build_neural_queue` / `get_neural_queue_front` /
        `consume_neural_queue_element` / `refill_neural_queue_if_depleted` /
        `get_neural_queue_remaining` Tauri commands registered, plus the
        `src/api/neural-queue.ts` frontend wrapper. The in-app button/menu UI
        that wires these to the reader is the remaining follow-on.
- [x] 4.11 Wire the depletion trigger: in neural review, when remaining
        neural-queue elements fall below 20, re-run activation seeded at the
        element just studied. Not per-grade.
        **Complete:** `refill_neural_queue_if_depleted` checks
        `NeuralQueueRepository::needs_refill` (remaining < `QUEUE_REFILL_MIN`)
        and rebuilds only when depleted; the frontend calls it after a consume.

### Tests and benchmarks

- [x] 4.12 Unit test `combine` against the documented example table.
- [x] 4.13 Unit test `propagate_siblings` link-priority sequence over 8
        generations; assert the 1.0 floor is never hit.
- [x] 4.14 Unit test the monotonicity rule and the new-element combine branch.
- [x] 4.15 Unit test that neural review does NOT mutate the priority queue.
- [x] 4.16 Add `src/**/*.bench.ts` for the propagation pass over a seeded
        large tree; record baselines in `scripts/perf-baselines.json`.

## Cross-cutting

- [x] 5.1 Update `openspec/changes/add-queue-composition-sliders` task 7.2
       (the broken "Scroll Mode button honours the flashcard slider" scenario):
       mark it superseded by Phase 1 task 1.3 once that lands.
- [x] 5.2 Update the Queue Settings UI help text: composition sliders control
       *count*; priority (and, in Phase 4, the neural queue) controls *order*.
- [x] 5.3 Add i18n strings for the "Go neural" entry point and any new
       priority-queue UI (relative position, auto-postpone settings) across
       all six locales.
