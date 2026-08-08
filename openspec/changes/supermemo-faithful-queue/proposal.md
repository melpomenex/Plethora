## Why

When a user customizes their Optimal Queue to include Documents and Flashcards,
Scroll Mode ("Queue List Order") shows **all flashcards sequentially** on the
common filters (Due All / All Items / New Only), and **all documents** on Due
Today. The two types never interleave. The user asked for SuperMemo-style
incremental reading — and investigation revealed *why* the symptom is
unreachable with the current architecture:

1. **Scroll Mode builds its session from whichever rows the active filter
   returned**, not from a unified "outstanding today" set. A flashcard-leaning
   filter hands the builder an empty document pool, and the interleaver's
   `else` branch returns `[...flashcards]` verbatim
   ([QueueScrollPage.tsx:282](src/pages/QueueScrollPage.tsx)).

2. **The existing priority scorer is a per-item weighted sum**
   ([reviewUx.ts:127](src/utils/reviewUx.ts)) — a legitimate multi-factor ranker,
   but it is architecturally unlike SuperMemo. SuperMemo's priority **emerges
   from relationships in a knowledge tree** (siblings, descendants, concept
   links, inter-element links), via spreading activation and a sorted position
   queue. Incrementum has no such tree: documents, extracts, and cards live in
   three tables with a single-level FK chain used only for cascade deletes.

3. The in-flight `add-queue-composition-sliders` change (26/31 tasks) added
   three composition sliders that decide *how many* of each type appear, but it
   explicitly does **not** backfill the document pool, so its own headline
   scenario ("Scroll Mode button honours the flashcard slider") is broken on the
   filters where users hit the bug.

To emulate SuperMemo incremental reading faithfully, this change ports the
priority algorithm reverse-engineered from `sm20.exe` (documented in
`priority_algorithm.md` after this round of mining) and the data structures it
operates on, in three sequential phases. Each phase ships value independently.

### What was reverse-engineered (and corrected) this round

Mining the decompiled binary (`~sushi/sm20-re`) corrected three prior
assumptions and surfaced the full algorithm:

- **Activation is a fixed constant (0.05), not derived from learning state.**
  The "neural queue" is fixed-strength spreading activation seeded at the
  current element, not a learned-urgency scalar. This removes the hardest
  reverse-engineering target — SuperMemo never computes urgency from
  retrievability/overdue-ness; urgency is *positional* in the queue.
- **Intrinsic priority is derived from queue position** via linear interpolation
  (`priority = (position−1)/(queue_size−1) × 100`), not a stored column.
- **Propagation fires on queue depletion** (learning state-machine phase 3:
  "feed next element from neural queue"), not per-grade review. It is a
  streaming/just-in-time queue.
- The **orchestrator** `FUN_00c19a30` is the only caller of all four
  propagators, with a fully extracted link-weight table (0.01 concept /
  0.05 inter-element / 0.10 descendant / 0.95–0.13 sibling / 0.99 parent).
- The **knowledge tree** is a pair of file-backed fixed-record tables
  (`contents.dat` 37B, `ElementInfo.dat` 118B), trivially mappable to SQLite.
- The tree is **built automatically by extract and cloze**, both calling one
  constructor (`AddNewElement`) that appends a child to the current element.

The corrected and expanded `priority_algorithm.md` was pushed to
`~sushi/sm20-re` (commit `7561da6d`).

## What Changes

This is a **single proposal with three sequential phases**. Each phase is
independently shippable and gates the next.

### Phase 1 — Unified priority-ordered Scroll session (fixes the bug)

- Scroll Mode builds its session from a **unified "outstanding today" set**
  (due documents + due extracts + due cards), not from the active filter's rows.
- Order Scroll Mode by **priority** (the existing `orderQueueItems`), replacing
  the type-even-spacing `interleaveScrollItems` + `applyVarietyMixing`
  engagement reshuffle. Priority becomes the arrangement principle, as in
  SuperMemo.
- Retire the type-even-spacing interleave as the primary arrangement; keep a
  gentle "no more than N of the same type in a row" guard so a run of P1 cards
  doesn't cluster. Filters become **list-view conveniences**, not things that
  change what the learning session contains.

This alone restores Doc-Card-Doc-Card variety and fixes the reported symptom,
without needing the tree.

### Phase 2 — Knowledge tree model (the data structure the algorithm needs)

- Add a thin **`element_tree` overlay table** referencing the existing three
  tables via `(element_kind, element_ref_id)`. All existing documents / extracts
  / learning_items code keeps working untouched.
- Add the **element-tree columns** SuperMemo's algorithm traverses:
  `parent_id`, `first_child_id`, `next_sibling_id`, `prev_sibling_id`,
  `element_type` (Topic/Item/Concept…), `concept_link_id`,
  `inter_element_link_id`, and cached descendant counts.
- **Wire tree construction into the IR flow** — the two repository INSERT
  chokepoints (`create_extract`, `create_learning_item`) also append a child
  edge to the current element, mirroring SuperMemo's `AddNewElement`.
  Documents auto-register a Topic node on import; extracts become child Topics;
  cards become child Items. The parent-child edge means "extracted/derived from."

Phase 2 ships no visible behavior change; it grows the tree silently as users
read and extract, ready for Phase 3 to consume.

### Phase 3 — Neural queue with spreading activation (the faithful algorithm)

- Add a **neural-queue table** (sorted priority positions over elements) and the
  **spreading-activation algorithm** fully specified by `priority_algorithm.md`:
  the `f(x,y) = x + y - xy` combination formula, the constant 0.05 activation,
  the per-link-type weights (0.01 concept / 0.05 inter-element / 0.10
  descendant / 0.95 sibling / 0.99 parent / 0.3 sibling decay × 1.1/generation),
  and the four propagation passes.
- **Priority is derived from queue position** (`(pos−1)/(size−1) × 100`), not
  scored per-item. The +/- buttons reposition; spreading activation lowers
  neighbors on refill.
- **Propagation fires when the queue runs low** (mirrors SuperMemo's phase-3
  "serve next / refill"), not per-grade. Seed at the current element with
  activation 0.05; recursive layer expansion when the queue is under a
  threshold.
- A card's intrinsic priority enters through its **element-tree node** (cards
  currently have no priority field; this gives them one via queue position).

### What stays

- The composition sliders from `add-queue-composition-sliders` **ship and stay**
  as a transitional manual override of how many of each type appear — they do
  not control *order*, which priority now does. Eventually (out of scope here)
  they may be replaced by review-load-driven auto-balancing.
- FSRS/SM-18/SM-20 **scheduling** (stability/difficulty/due-date) is untouched.
  This change is about *ordering the session*, not about *when* items recur.
- Extracts and cards keep their existing creation commands, viewers, and stores.

## Capabilities

### New Capabilities
- `scroll-session-unified-priority` (Phase 1): Scroll Mode assembles the session
  from a unified outstanding-today set and orders it by priority, so documents
  and flashcards interleave naturally and the session is independent of the
  active Queue filter.
- `knowledge-tree-model` (Phase 2): a persisted parent/child/sibling element
  tree, built automatically by extract and cloze actions, overlaying the
  existing documents/extracts/learning_items tables without modifying them.
- `neural-queue-priority` (Phase 3): SuperMemo's spreading-activation neural
  queue — constant activation, per-link-type weights, position-derived priority,
  fired on queue depletion.

### Modified Capabilities
- `queue-item-type-routing`: the item-type toggles remain authoritative for
  *which* types appear; the *order* is now priority-driven rather than
  type-even-spaced. An unchecked type still contributes nothing.

## Impact

- **Database schema** (`src-tauri/migrations/`, `src-tauri/src/database/`):
  new migration adding the `element_tree` table (Phase 2) and `neural_queue`
  table (Phase 3); repository functions for tree-edge insertion at
  `repository.rs:1764` (after extract INSERT) and `repository.rs:2509` (after
  card INSERT).
- **Priority module** — a new `src-tauri/src/algorithms/neural_queue.rs`
  (Phase 3) implementing the spreading-activation algorithm with unit tests
  against the documented constants.
- **Queue store / Scroll Mode** (`src/stores/queueStore.ts`,
  `src/pages/QueueScrollPage.tsx`): Phase 1 swaps the session source and
  arrangement; the `interleaveScrollItems`/`applyVarietyMixing` path is retired
  as primary ordering.
- **Frontend creation hooks** — none required at the React layer in Phase 2;
  tree edges are written by the Rust repositories, transparently to existing
  callers.
- **Benchmarks** — new `neural_queue.bench.ts` (Phase 3) covering the
  propagation pass over a seeded large tree; baselines recorded in the same PR.
- **The `add-queue-composition-sliders` change** — Phase 1 supersedes its
  broken "Scroll Mode button honours the flashcard slider" scenario by making
  the session source unified. The composition sliders themselves remain.
