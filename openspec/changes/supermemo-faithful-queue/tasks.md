## Phase 1 — Unified priority-ordered Scroll session

> Ships value immediately, fixes the reported "all flashcards sequentially"
> bug, and is a prerequisite for Phases 2 and 3. No schema changes.

- [ ] 1.1 Add a unified "outstanding today" query (Tauri command or store
      selector) returning due documents + due extracts + due learning items
      combined, independent of the active Queue filter. Source it from the same
      due pools the optimal-path builder already uses
      (`getDueQueueItems` / `getDueDocumentsOnly` / `getDueExtracts`).
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
      reads; preserve resumability (no re-sort on tab re-entry without a
      priority change) per `stabilize-queue-order-on-reactivation`.
- [ ] 1.6 Add a regression test that builds a session from a flashcard-leaning
      source (no documents in the filter rows) with due documents available,
      and asserts documents appear interleaved, not absent.
- [ ] 1.7 Manually verify: Due All / All Items / New Only now interleave
      documents and flashcards; Due Today now surfaces flashcards when the
      slider is non-zero.

## Phase 2 — Knowledge tree model

> Adds the `element_tree` overlay table and wires tree construction into the IR
> flow. No visible behavior change; grows the tree silently. Gates Phase 3.

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
      document-creation command path (import / new document), so the tree has a
      root to build under.
- [ ] 2.7 Add `unlink_node` calls to the document / extract / learning_item
      delete paths, patching the sibling chain symmetrically.

### Gap fixes (close while the code is open)

- [ ] 2.8 Add `extract_id: Option<String>` parameter to the `create_learning_item`
      Tauri command (`learning_item.rs:229`) and bind it on the model, so
      Studio-authored cards can record their extract parent.
- [ ] 2.9 Bump `documents.learning_item_count` in `create_learning_item_inner`
      to match the extract path's `extract_count` bump (consistency fix).

### Tests

- [ ] 2.10 Unit test `register_node`'s append-as-last-child surgery: first
      child, second child (prev/next sibling wiring), and parent's
      `first_child_id` / last-child `next_sibling_id` correctness.
- [ ] 2.11 Unit test `unlink_node`: middle-of-chain unlink reconnects prev and
      next; head and tail unlink update the parent's child pointer.
- [ ] 2.12 Unit test `is_descendant` cycle guard: moving a node into its own
      descendant is rejected.
- [ ] 2.13 Integration test: create document → extract → cloze and assert the
      three-level tree (document root, extract child, card grandchild) with
      correct sibling pointers.
- [ ] 2.14 Migration test: backfill against a fixture library produces the
      expected node count and edges from existing FKs.

## Phase 3 — Neural queue with spreading activation

> The faithful algorithm. Depends on Phase 2's tree.

### Schema and storage

- [ ] 3.1 Migration adding the `neural_queue` table (`element_id` PK →
      `element_tree.id`, `position` 1-based, `priority_value` derived, `updated_at`).
- [ ] 3.2 Seed the neural queue on migration from existing element_tree nodes
      ordered by a stable priority proxy (current `priority_score` for
      documents/extracts, FSRS-urgency for cards), so the queue is non-empty
      day one.
- [ ] 3.3 `NeuralQueueRepository`: `front(n)` (the next N by position),
      `consume(element_id)` (remove from queue when studied),
      `reposition(element_id, new_position)`, `size()`, `insert_or_update(...)`
      implementing the monotonicity rule (only update if strictly lower).

### The algorithm

- [ ] 3.4 Implement `src-tauri/src/algorithms/neural_queue.rs` with the pure
      functions from design.md: `combine(x,y) = x+y-xy`, the constant
      `ACTIVATION = 0.05`, and the link-weight constants (LINK_CONCEPT 0.01,
      LINK_INTER_ELEMENT 0.05, LINK_DESCENDANT 0.10, LINK_SIBLING_NORMAL 0.95,
      LINK_SIBLING_ROOT 0.13, LINK_PARENT 0.99, SIBLING_INITIAL 0.3,
      SIBLING_GROWTH 1.1, CONCEPT_PARENT 0.4, CONCEPT_CHILD 0.3).
- [ ] 3.5 Implement `propagate_siblings` (8 generations, ×1.1/generation from
      0.3, both next and prev siblings per generation).
- [ ] 3.6 Implement `propagate_descendants` (max 22, link_priority 0.0 → full
      activation passthrough, 300/400 threshold for simple vs optimized
      descendant collection).
- [ ] 3.7 Implement `propagate_concept_links` (only for type-4 Concept seeds;
      parent 0.4 / child 0.3 within the propagator; follows the concept-link
      registry).
- [ ] 3.8 Implement `propagate_inter_element_links` (batch-update via the
      inter-element-link registry, link_priority 0.05).
- [ ] 3.9 Implement the orchestrator `run_spreading_activation` in the
      documented order (concept → inter-element → descendants → root-article
      branch → siblings), plus the `< 20` recursive layer expansion.
- [ ] 3.10 Wire the trigger: when the Scroll session's remaining neural-queue
       elements fall below `QUEUE_REFILL_MIN` (20), run
       `run_spreading_activation` seeded at the element just studied.

### Priority derivation and UI

- [ ] 3.11 Implement `intrinsic_priority(position, size) = (position-1)/(size-1)*100`
       (with the pos≤1 and size≤1 edge cases) and its inverse
       `position_from_priority(priority, size)`. Unit-test against the
       SuperMemo formula.
- [ ] 3.12 Repoint the priority +/- UI to call `reposition` on the neural
       queue; the displayed priority reads back the derived `priority_value`.
- [ ] 3.13 Repoint Scroll Mode's ordering: replace Phase 1's `orderQueueItems`
       with `SELECT ... FROM neural_queue JOIN element_tree ORDER BY position`.
       The composition targets continue to cap how many of each type appear.

### Tests and benchmarks

- [ ] 3.14 Unit test `combine` against the documented example table
       (`priority_algorithm.md`): f(0.5,0.3)=0.65, f(0.05,0.95)=0.9525, etc.
- [ ] 3.15 Unit test `propagate_siblings`: over 8 generations the link
       priority sequence is 0.3, 0.33, 0.363, … ≈ 0.643, and the floor (1.0)
       is never hit.
- [ ] 3.16 Unit test the monotonicity rule: an existing element at 0.4 is not
       overwritten by a path computing 0.6.
- [ ] 3.17 Unit test the new-element branch: activation combines with
       intrinsic priority on insert.
- [ ] 3.18 Add `src/**/*.bench.ts` for the propagation pass over a seeded
       large tree (use `seededRandom` from `src/test/bench-support.ts`),
       consuming the result into a module-level sink; record baselines in
       `scripts/perf-baselines.json` in the same PR.
- [ ] 3.19 Run the bundle-budget check; update `scripts/bundle-budgets.json`
       if the new algorithm module changes the bundle size meaningfully.

## Cross-cutting

- [ ] 4.1 Update `openspec/changes/add-queue-composition-sliders` task 7.2
       (the broken "Scroll Mode button honours the flashcard slider" scenario):
       mark it superseded by Phase 1 task 1.3 once that lands.
- [ ] 4.2 Update the Queue Settings UI help text to clarify that composition
       sliders control *count*, while priority (and, in Phase 3, the neural
       queue) controls *order*.
- [ ] 4.3 Add an i18n string for the variety-guard limit if it becomes
       user-configurable; otherwise leave hardcoded at 3.
