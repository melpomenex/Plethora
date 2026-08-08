# Design — SuperMemo Faithful Queue

## Two queues, not one (the key correction)

SuperMemo has **two distinct queues** with different purposes, backing objects,
and ordering principles. The first draft of this proposal conflated them.

```
   PRIORITY QUEUE  (tree_singleton + 0xd5)        NEURAL QUEUE  (PTR_DAT_01123f90)
   ═══════════════════════════════════════        ═════════════════════════════════
   Backbone of incremental reading                Optional "Go neural" creative mode
   EVERY element ranked 0-100% by user            A SUBSET queue from spreading activation
   Auto-sorted daily; auto-postpones overflow     Rebuilds on depletion from current element
   "What do I study today?"                       "What's related to what I just read?"
   Phase 3                                        Phase 4 (reads intrinsic priority from here)
```

The **neural queue reads from the priority queue**: each element's intrinsic
priority (its position-derived value) is one input to the spreading-activation
formula. So the priority queue must be complete before the neural queue can be
faithfully built. This is why the phases are ordered 3 (priority) → 4 (neural).

Source: [official Priority Queue docs](https://help.supermemo.org/wiki/Priority_queue),
[glossary](https://super-memory.com/help/g.htm), and the decompiled binary's
two separate queue objects. Full documentation in
`~sushi/sm20-re/priority_queue_algorithm.md` (stub) and
`neural_queue_algorithm.md` (complete).

## The core insight that makes this tractable

Three reverse-engineering findings collapse the work dramatically:

1. **Neural-queue activation is constant (0.05).** We never need to derive
   urgency from learning state — SuperMemo doesn't. Urgency is *positional* in
   the priority queue.
2. **Priority is derived from queue position** via linear interpolation. There
   is no priority column to maintain independently; there is a sorted queue to
   reposition in.
3. **The tree maps to SQLite cleanly.** SuperMemo's `contents.dat` /
   `ElementInfo.dat` are fixed-record binary files that are, in spirit,
   relational tables. Element id == record number == `INTEGER PRIMARY KEY`.

## Schema decision: overlay table (not unified elements)

SuperMemo has one `elements` table with a type byte. Incrementum has three
tables (`documents`, `extracts`, `learning_items`) woven through ~200 queries,
stores, and viewers. **Unifying them is a 6-8 week migration with high
regression risk and is not required for either queue.**

The overlay approach adds a thin `element_tree` table that references the
existing tables:

```
element_tree
─────────────────────────────────────────────────────────────
 id                 INTEGER PRIMARY KEY   -- the "element id"
 element_kind       TEXT NOT NULL         -- 'document'|'extract'|'learning_item'
 element_ref_id     TEXT NOT NULL         -- FK → documents/extracts/learning_items.id
 parent_id          INTEGER               -- FK → element_tree.id (nullable for roots)
 first_child_id     INTEGER               -- FK → element_tree.id
 next_sibling_id    INTEGER               -- FK → element_tree.id
 prev_sibling_id    INTEGER               -- FK → element_tree.id
 element_type       INTEGER NOT NULL      -- 0=Topic, 1=Item, 4=Concept (SM taxonomy)
 concept_link_id    INTEGER               -- FK → element_tree.id (concept-group edge)
 inter_element_link_id INTEGER            -- FK → element_tree.id (reference edge)
 descendant_count_a INTEGER DEFAULT 0     -- cached, threshold 300
 descendant_count_b INTEGER DEFAULT 0     -- cached, threshold 400
 sort_order         INTEGER DEFAULT 0     -- user-reorderable child position
 created_at         TEXT NOT NULL
 UNIQUE (element_kind, element_ref_id)
```

**Why this works:** both queues traverse via tree columns (parent/child/sibling)
and read the element type and link ids. They never need the document's
`file_path`, the extract's `html_content`, or the card's `cloze_text` — those
stay where they are. Every existing query against the three tables keeps
working byte-for-byte.

### Migration of existing data

On Phase 2 rollout, a backfill registers every existing document, extract, and
learning_item as an element_tree node:

```
for each document:       element_tree row, kind='document', type=0 (Topic),
                         parent = null (or the collection root)
for each extract:        element_tree row, kind='extract', type=0 (Topic),
                         parent = the extract's document's element_tree row
for each learning_item:  element_tree row, kind='learning_item', type=1 (Item),
                         parent = (extract's row if extract_id set, else document's row)
```

Sibling order within a parent is backfilled by `created_at`.

## Phase 3: completing the priority queue

### The gap: cards have no priority

Documents have `priority_slider` (0-100) and `priority_score`; extracts have
`priority_score`; **learning_items have neither**. Their `QueueItem.priority`
is computed at read time from FSRS urgency/difficulty/review-count
(`calculate_priority_score` at `algorithms/mod.rs:162`), which is *scheduling
urgency*, not the user's importance ranking. SuperMemo's priority queue treats
topics and items uniformly — both have user-set priority. **This is the single
biggest gap.**

Phase 3 adds `learning_items.priority_slider` (0-100) and extends the
`PriorityControl` UI to cards, making the three item types uniform.

### Position ↔ priority mapping

Mirrors SuperMemo's `FUN_00cb1630` and `FUN_00cb21c0`:

```rust
fn priority_from_position(position: usize, size: usize) -> f64 {
    if size <= 1 { return 0.0; }
    ((position - 1) as f64 / (size - 1) as f64) * 100.0
}
fn position_from_priority(priority: f64, size: usize) -> usize {
    round((priority / 100.0) * (size - 1) as f64) as usize + 1
}
```

The +/- buttons reposition; the displayed priority reads back the derived value.

### The combined sort criterion

SuperMemo does NOT use a pure priority sort. From the [docs](https://help.supermemo.org/wiki/Priority_queue)
and the `FUN_00c15fd0` strings (*"Probability of a topic being placed at the
top of the outstanding queue [0 .. max]"*), the session order combines:

1. **Priority** (the user-set 0-100%) — primary.
2. **Proportion of topics vs items** — a stochastic bias so the session is a
   read/quiz mix, not all one type. The composition sliders approximate this
   today; Phase 3 makes it part of the sort.
3. **Randomization** — a degree of noise so equally-prioritized elements vary.

```
score(item) = priority(item)
            + topic_item_proportion_bias(item.type, config)
            + stable_jitter(item.id)     // deterministic per-id, like getStableRandom
```

> **Open RE question** (noted in `priority_queue_algorithm.md`): the exact
> proportion-of-topics formula and the "[0 .. max]" config knob are referenced
> by string in `FUN_00c15fd0` but not yet extracted. A targeted dig may be
> needed during Phase 3 implementation. If it can't be resolved, the
> composition sliders remain as the manual proxy for this criterion.

### Auto-postpone

When outstanding material exceeds what the student can get through, SuperMemo
auto-postpones low-priority excess. The algorithm is fully reverse-engineered
in `~sushi/sm20-re/postpone_algorithm.md` (manual + auto-postpone, per-branch
config, priority/difficulty thresholds). Phase 3 ports it as the overflow
handler.

## Phase 4: the neural queue algorithm

Pure functions, fully specified by `neural_queue_algorithm.md`. Lives in
`src-tauri/src/algorithms/neural_queue.rs`.

```rust
fn combine(x: f64, y: f64) -> f64 { x + y - x * y }   // probabilistic OR

const ACTIVATION: f64 = 0.05;                          // constant from binary
const LINK_CONCEPT:        f64 = 0.01;
const LINK_INTER_ELEMENT:  f64 = 0.05;
const LINK_DESCENDANT:     f64 = 0.10;
const LINK_SIBLING_NORMAL: f64 = 0.95;
const LINK_SIBLING_ROOT:   f64 = 0.13;
const LINK_PARENT:         f64 = 0.99;
const SIBLING_INITIAL:     f64 = 0.30;
const SIBLING_GROWTH:      f64 = 1.10;
const CONCEPT_PARENT:      f64 = 0.40;
const CONCEPT_CHILD:       f64 = 0.30;
const QUEUE_REFILL_MIN:    usize = 20;
```

Each `propagate_*` calls `insert_or_update`, which combines activation with the
link weight and, for new elements, also combines with the element's intrinsic
priority (read **from the priority queue** via `priority_from_position`).
**Update only if the new combined priority is strictly lower** (monotonicity).

### When the neural queue fires

Mirrors SuperMemo's *Learn : Go neural*: an **opt-in mode**, not the normal
learning flow. The neural queue is consumed by neural review; when it runs low,
spreading activation refills it from the current element. **Not** per-grade —
scheduling (FSRS) still updates on every grade; only the neural reservoir
refills on depletion.

This is layered on top of priority-queue learning, exactly as in SuperMemo:
normal days use the priority queue; the neural queue is for creative/
associative exploration sessions.

## Phase ordering rationale

```
   Phase 1 (unified session)        ← fixes the bug, no deps
        │
        ├── Phase 2 (knowledge tree) ← no visible behavior; grows silently
        │       │
        │       └── Phase 4 (neural queue)  ← walks the tree; reads priority queue
        │
        └── Phase 3 (priority queue) ← completes the backbone; extends Phase 1's ordering
```

Phase 2 and Phase 3 are **independent** of each other and can proceed in
parallel after Phase 1. Phase 4 depends on **both** (the tree to walk, the
priority queue to read intrinsic priority from). The numbering reflects a
sensible serial order, not a strict dependency chain — Phase 3 could land
before Phase 2 if the priority-queue work is higher priority.

## Document ↔ element mapping

A **document is a Topic** in the tree, the root of its extraction subtree.
Extracts are child Topics; cards are child Items. This preserves the
"extracted/derived from" semantics and makes the existing FK chain
(document → extract → card) the backbone of the tree.

```
Document (Topic, root)
├── Extract A (Topic)
│   ├── Card A1 (Item, cloze)
│   └── Card A2 (Item, qa)
├── Extract B (Topic)
│   └── Card B1 (Item)
└── (direct cards from the doc, if any) (Item)
```

## Two gaps the Phase 2 work closes opportunistically

1. **`create_learning_item` drops `extract_id`** — the Rust command at
   `learning_item.rs:229` has no `extract_id` parameter even though the frontend
   sends it. Phase 2 adds the param so tree edges are correct.
2. **`create_learning_item` doesn't bump `documents.learning_item_count`**
   (unlike the extract path's `extract_count` bump). Fixed for consistency.

## Non-goals

- **No new scheduling algorithm.** FSRS/SM-18/SM-20 stability/difficulty/
  due-date computation is untouched.
- **No full element unification.** The three tables stay.
- **No manual drag-drop tree editing in v1.** The `sort_order` column reserves
  the capability.
- **No concept-group *authoring* UI in v1.** Concept-link propagation now fires
  for any seed (the type-4 gate was relaxed) and resolves concept peers via
  **tags as a concept-group proxy**: items sharing a tag are concept peers
  (`concept_neighbors` joins the JSON `tags` columns via `json_each`). This
  avoids needing a dedicated concept-authoring surface — tags, which the user
  already sets, double as concept groups. A dedicated concept-group entity and
  management UI remain a follow-on.
- **Semantic similarity via RAG chunk embeddings.** A fifth spreading-activation
  relationship type (`semantic_neighbors`, base weight 0.08) surfaces
  embedding-similar documents. It mean-pools each document's
  `document_chunk_embeddings` into one vector and ranks by cosine similarity,
  firing only when the user has indexed their collection (graceful no-op
  otherwise). The embedding config is threaded from the frontend at build time.
- **No replacement of the composition sliders.** They stay as a transitional
  count control.
- **"Go neural" UI.** The entry point is a "Go neural" button in Scroll Mode,
  seeded at the current item; exit restores the prior reading session.
