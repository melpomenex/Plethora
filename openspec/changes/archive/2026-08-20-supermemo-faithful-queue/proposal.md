## Why

When a user customizes their Optimal Queue to include Documents and Flashcards,
Scroll Mode ("Queue List Order") shows **all flashcards sequentially** on the
common filters (Due All / All Items / New Only), and **all documents** on Due
Today. The two types never interleave. The user wants to emulate SuperMemo-style
incremental reading, and investigation revealed *why* the symptom is
unreachable with the current architecture:

1. **Scroll Mode builds its session from whichever rows the active filter
   returned**, not from a unified "outstanding today" set. A flashcard-leaning
   filter hands the builder an empty document pool, and the interleaver's
   `else` branch returns `[...flashcards]` verbatim
   ([QueueScrollPage.tsx:282](src/pages/QueueScrollPage.tsx)).

2. **The existing priority scorer is a per-item weighted sum**
   ([reviewUx.ts:127](src/utils/reviewUx.ts)) — a legitimate multi-factor ranker,
   but it is architecturally unlike SuperMemo. SuperMemo incremental reading is
   driven by a **priority queue**: every element ranked 0%–100% by user-set
   importance, auto-sorted daily, with low-priority overflow auto-postponed.

3. The in-flight `add-queue-composition-sliders` change (26/31 tasks) added
   three composition sliders that decide *how many* of each type appear, but it
   explicitly does **not** backfill the document pool, so its own headline
   scenario ("Scroll Mode button honours the flashcard slider") is broken on the
   filters where users hit the bug.

### Naming correction discovered this round

SuperMemo has **two distinct queues**, which the first draft of this proposal
conflated. Mining the decompiled binary (`~sushi/sm20-re`) plus the
[official docs](https://help.supermemo.org/wiki/Priority_queue) and
[glossary](https://super-memory.com/help/g.htm) made the split unambiguous:

| | **Priority queue** | **Neural queue** |
|---|---|---|
| Purpose | Backbone of IR; "what do I study today" | Optional creative mode; "what's related to what I just read" |
| Object in binary | `tree_singleton + 0xd5` | `PTR_DAT_01123f90` |
| Ordering | User-set priority 0–100%, auto-sorted daily | Spreading activation from a seed element |
| Trigger | Normal learning | *Learn : Go neural* (`Ctrl+F2`); "carries a degree of randomness" |

What was originally documented as `priority_algorithm.md` actually describes
the **neural queue** construction. That file was renamed to
`neural_queue_algorithm.md` and a `priority_queue_algorithm.md` stub added
(commit `8f401c20` on `~sushi/sm20-re`). **The neural queue reads from the
priority queue** (each element's intrinsic priority is one input to the
spreading-activation formula), so the priority queue must come first.

### What was reverse-engineered this round

- **Neural queue** (fully specified in `neural_queue_algorithm.md`): activation
  is a fixed constant (0.05), not derived from learning state; intrinsic
  priority is derived from priority-queue position via `(pos−1)/(size−1) × 100`;
  propagation fires on neural-queue depletion. The orchestrator
  `FUN_00c19a30` has the full link-weight table (0.01 concept / 0.05
  inter-element / 0.10 descendant / 0.95–0.13 sibling / 0.99 parent).
- **Priority queue** (stub in `priority_queue_algorithm.md`): user-set 0–100%
  ranking, position↔priority linear map (`FUN_00cb1630`/`cb21c0`),
  proportion-of-topics-vs-items sorting criterion (referenced by `FUN_00c15fd0`
  strings), and auto-postpone overflow (companion `postpone_algorithm.md`).
- **Knowledge tree**: two file-backed fixed-record tables (`contents.dat` 37B,
  `ElementInfo.dat` 118B), trivially mappable to SQLite. Built automatically by
  extract/cloze via one constructor (`AddNewElement`) that appends a child.

## What Changes

This is a **single proposal with four sequential phases**. Each phase is
independently shippable and gates the next. The order reflects the dependency:
priority queue before neural queue (the neural queue reads intrinsic priority
from it).

### Phase 1 — Unified priority-ordered Scroll session (fixes the bug)

- Scroll Mode builds its session from a **unified "outstanding today" set**
  (due documents + due extracts + due cards), not from the active filter's rows.
- Order Scroll Mode by **priority** (the existing `orderQueueItems`), replacing
  the type-even-spacing `interleaveScrollItems` + `applyVarietyMixing`
  engagement reshuffle. Priority becomes the arrangement principle, as in
  SuperMemo.
- Retire the type-even-spacing interleave as the primary arrangement; keep a
  gentle "no more than N of the same type in a row" guard so a run of equally-
  prioritized cards doesn't cluster. Filters become **list-view conveniences**,
  not things that change what the learning session contains.

This alone restores Doc-Card-Doc-Card variety and fixes the reported symptom,
without needing the tree.

### Phase 2 — Knowledge tree model (shared by phases 3 and 4)

- Add a thin **`element_tree` overlay table** referencing the existing three
  tables via `(element_kind, element_ref_id)`. All existing documents / extracts
  / learning_items code keeps working untouched.
- Add the **element-tree columns** both queues traverse: `parent_id`,
  `first_child_id`, `next_sibling_id`, `prev_sibling_id`, `element_type`,
  `concept_link_id`, `inter_element_link_id`, cached descendant counts.
- **Wire tree construction into the IR flow** — the two repository INSERT
  chokepoints (`create_extract`, `create_learning_item`) also append a child
  edge to the current element. Documents auto-register a Topic node on import;
  extracts become child Topics; cards become child Items.

Phase 2 ships no visible behavior change; it grows the tree silently as users
read and extract. The **priority queue (phase 3) does not strictly need it**
(priority is per-item), but the **neural queue (phase 4) does** (spreading
activation walks it).

### Phase 3 — Complete the priority queue (the backbone)

The biggest gap: **cards have no user-set priority today** (their `QueueItem.priority`
is computed from FSRS urgency at read time). Completing the priority queue:

- **Add a user-set priority to cards** (`learning_items.priority_slider`),
  mirroring documents. The `PriorityControl` UI extends to cards.
- **Expose relative queue position** — show each element's priority-queue
  position (1…N) via the `FUN_00cb1630` linear map, so the user sees ranking.
- **Auto-sort the learning session** by SuperMemo's combined criterion
  (priority + proportion-of-topics-vs-items + randomization), replacing the
  per-item weighted-sum scorer as the primary ordering.
- **Auto-postpone low-priority overflow** per the reverse-engineered
  `postpone_algorithm.md` — the companion algorithm already documented in
  `~sushi/sm20-re`.

### Phase 4 — Neural queue with spreading activation (the optional creative mode)

The algorithm fully specified by `neural_queue_algorithm.md`:

- Add a **neural_queue table** (sorted positions over elements for neural
  review) and the **spreading-activation algorithm**: the `f(x,y)=x+y-xy`
  combination formula, the constant 0.05 activation, the per-link-type weights,
  and the four propagation passes.
- **Activation fires when the neural queue runs low**, seeded at the current
  element (mirrors SuperMemo's phase-3 "serve next / refill").
- This is an **optional, opt-in mode** (SuperMemo's *Learn : Go neural*),
  layered on top of normal priority-queue learning — not a replacement for it.

### What stays

- The composition sliders from `add-queue-composition-sliders` **ship and stay**
  as a transitional manual override of how many of each type appear.
- FSRS/SM-18/SM-20 **scheduling** (stability/difficulty/due-date) is untouched.
- Extracts and cards keep their existing creation commands, viewers, and stores.

## Capabilities

### New Capabilities
- `scroll-session-unified-priority` (Phase 1): Scroll Mode assembles the session
  from a unified outstanding-today set and orders it by priority.
- `knowledge-tree-model` (Phase 2): a persisted parent/child/sibling element
  tree, built automatically by extract and cloze actions.
- `priority-queue` (Phase 3): every element (including cards) has user-set
  priority; the learning session is auto-sorted by SuperMemo's combined
  criterion with auto-postpone of overflow.
- `neural-queue` (Phase 4): SuperMemo's spreading-activation neural queue for
  the optional "Go neural" creative-exploration mode.

### Modified Capabilities
- `queue-item-type-routing`: the item-type toggles remain authoritative for
  *which* types appear; the *order* is now priority-driven.

## Impact

- **Database schema** (`src-tauri/migrations/`, `src-tauri/src/database/`):
  new migration adding the `element_tree` table (Phase 2); `priority_slider`
  on `learning_items` (Phase 3); `neural_queue` table (Phase 4); repository
  tree-edge insertion at `repository.rs:1764` (extract) and `:2509` (card).
- **Priority modules** — `src-tauri/src/algorithms/priority_queue.rs` (Phase 3,
  the combined sort criterion + position mapping) and `neural_queue.rs`
  (Phase 4, spreading activation) with unit tests against documented constants.
- **Queue store / Scroll Mode** (`src/stores/queueStore.ts`,
  `src/pages/QueueScrollPage.tsx`): Phase 1 swaps the session source and
  arrangement; Phase 3 repoints ordering to the priority-queue criterion.
- **Priority UI** (`src/components/.../PriorityControl`): Phase 3 extends to
  cards and exposes relative queue position.
- **Benchmarks** — new benches for the combined sort (Phase 3) and the
  propagation pass (Phase 4); baselines recorded in the same PR.
- **The `add-queue-composition-sliders` change** — Phase 1 supersedes its
  broken "Scroll Mode button honours the flashcard slider" scenario.
