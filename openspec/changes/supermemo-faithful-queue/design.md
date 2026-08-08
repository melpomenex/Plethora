# Design — SuperMemo Faithful Queue

## The core insight that makes this tractable

Three reverse-engineering findings collapse the work dramatically:

1. **Activation is constant (0.05).** We never need to derive urgency from
   learning state — SuperMemo doesn't. Urgency is *positional* in the queue.
2. **Priority is derived from queue position** via linear interpolation. There
   is no priority column to maintain; there is a sorted queue to reposition in.
3. **The tree maps to SQLite cleanly.** SuperMemo's `contents.dat` /
   `ElementInfo.dat` are fixed-record binary files that are, in spirit,
   relational tables. Element id == record number == `INTEGER PRIMARY KEY`.

This means the "faithful port" is: a sorted-priority table + a tree table +
~150 lines of arithmetic (the `x + y - xy` combination and four propagation
loops), not a research problem.

## Schema decision: overlay table (not unified elements)

SuperMemo has one `elements` table with a type byte. Incrementum has three
tables (`documents`, `extracts`, `learning_items`) woven through ~200 queries,
stores, and viewers. **Unifying them is a 6-8 week migration with high
regression risk and is not required for the algorithm.**

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

**Why this works:** the priority algorithm only ever traverses via the tree
columns (parent/child/sibling) and reads the element type and link ids. It
never needs the document's `file_path`, the extract's `html_content`, or the
card's `cloze_text` — those stay where they are. The overlay is a uniform
handle the algorithm can walk, while every existing query against the three
tables keeps working byte-for-byte.

The trade-off: resolving an element_tree row back to its concrete row needs a
join on `(element_kind, element_ref_id)`. This only happens at render time
(populating the Scroll session), not in the hot propagation path, so the cost
is negligible.

### Why not unify extracts + cards only (the hybrid option)

Considered. It would require rewriting every extracts query and every
learning_items query to discriminate by type, plus migrating existing rows.
The overlay gives the same algorithmic fidelity for less disruption. Hybrid
remains a future option if the overlay's joins ever become a bottleneck — but
they won't, given the read pattern.

### Migration of existing data

On Phase 2 rollout, a backfill registers every existing document, extract, and
learning_item as an element_tree node:

```
for each document:       element_tree row, kind='document', type=0 (Topic),
                         parent = the collection's root (or null)
for each extract:        element_tree row, kind='extract', type=0 (Topic),
                         parent = the extract's document's element_tree row
for each learning_item:  element_tree row, kind='learning_item', type=1 (Item),
                         parent = (extract's element_tree row if extract_id set,
                                   else document's element_tree row)
```

This reconstructs the 1-level lineage that already exists in the FK columns as
tree edges, making it N-level-traversable. Sibling order within a parent is
backfilled by `created_at`.

## The neural queue table (Phase 3)

```
neural_queue
─────────────────────────────────────────────────────────────
 element_id      INTEGER PRIMARY KEY   -- FK → element_tree.id
 position        INTEGER NOT NULL      -- 1-based rank, 1 = front (next to study)
 priority_value  REAL NOT NULL         -- derived: (position-1)/(size-1)*100
 updated_at      TEXT NOT NULL
```

Priority is **derived and always consistent with position** — there is no
independent priority to keep in sync. The +/- buttons call a `reposition`
command that moves an element within the sorted order and, if needed, cascades
descendant repositioning. Reading "priority" is always `SELECT` from this table
joined to `element_tree`.

This mirrors SuperMemo's model exactly: the queue object at `singleton + 0xd5`
is a sorted-index, and `FUN_00cb1630` computes priority from position.

## The spreading-activation algorithm (Phase 3)

Pure functions, fully specified by `priority_algorithm.md`. Lives in
`src-tauri/src/algorithms/neural_queue.rs`.

```rust
// The combination formula. Probabilistic OR, bounded [0,1].
fn combine(x: f64, y: f64) -> f64 { x + y - x * y }

// Activation is the constant from the binary.
const ACTIVATION: f64 = 0.05;

// Link weights from the orchestrator FUN_00c19a30.
const LINK_CONCEPT:        f64 = 0.01;
const LINK_INTER_ELEMENT:  f64 = 0.05;
const LINK_DESCENDANT:     f64 = 0.10;
const LINK_SIBLING_NORMAL: f64 = 0.95;
const LINK_SIBLING_ROOT:   f64 = 0.13;
const LINK_PARENT:         f64 = 0.99;
// Within-propagator weights.
const SIBLING_INITIAL:     f64 = 0.30;
const SIBLING_GROWTH:      f64 = 1.10;  // per generation
const CONCEPT_PARENT:      f64 = 0.40;
const CONCEPT_CHILD:       f64 = 0.30;
const QUEUE_REFILL_MIN:    usize = 20;

fn run_spreading_activation(
    tree: &ElementTree,
    queue: &mut NeuralQueue,
    seed_element_id: i64,
) {
    // 1. concept links (only if seed is type Concept)
    propagate_concept_links(tree, queue, seed_element_id, ACTIVATION, LINK_CONCEPT);
    // 2. inter-element links
    propagate_inter_element_links(tree, queue, seed_element_id, ACTIVATION, LINK_INTER_ELEMENT);
    // 3. descendants (max 22, link_priority 0 → full activation passthrough)
    propagate_descendants(tree, queue, seed_element_id, ACTIVATION, LINK_DESCENDANT);
    // 4. parent + siblings (root-article-aware branch)
    let root = tree.root_article(seed_element_id);
    if root == 0 {
        propagate_parent(tree, queue, seed_element_id, ACTIVATION, LINK_PARENT);
        propagate_siblings(tree, queue, seed_element_id, ACTIVATION, LINK_SIBLING_NORMAL);
    } else {
        queue.insert_or_update(root, ACTIVATION, LINK_INTER_ELEMENT);
        propagate_siblings(tree, queue, seed_element_id, ACTIVATION, LINK_SIBLING_ROOT);
    }
    // 5. recursive layer expansion if queue still under min
    if queue.size() < QUEUE_REFILL_MIN {
        expand_layers(tree, queue, seed_element_id, ACTIVATION, QUEUE_REFILL_MIN);
    }
}
```

Each `propagate_*` calls `insert_or_update`, which combines activation with the
link weight and, for new elements, also combines with the element's intrinsic
priority (its current `(position-1)/(size-1)*100 / 100`). **Update only if the
new combined priority is strictly lower** (SuperMemo's monotonicity rule —
elements never get demoted mid-pass).

## When propagation fires (the trigger)

Mirrors SuperMemo's learning state-machine phase 3. Concretely in Incrementum:

- The Scroll session is the front slice of the neural queue (the next N
  elements to study).
- When the user advances past the loaded window and the remaining queue falls
  below `QUEUE_REFILL_MIN` (20), the next queue-build runs
  `run_spreading_activation` seeded at the element just studied.
- **Not** per-grade. Scheduling (FSRS stability/difficulty/due-date) still
  updates on every grade; only the *ordering reservoir* refills on depletion.

This preserves Scroll Mode's existing resumability/stability properties
(`stabilize-queue-order-on-reactivation`): the queue is a durable sorted table,
not recomputed wholesale on each render.

## Phase 1: ordering by priority without the tree

Phase 1 must ship before the tree exists. It uses the **existing** per-item
`getPriorityScore` / `orderQueueItems` as the arrangement, and the existing
`composeSession` to decide counts. The only structural change is the **session
source**: build from a unified "outstanding today" query instead of the active
filter's rows.

```
Phase 1 pipeline (no tree yet):
  unified outstanding-today query (due docs + due extracts + due cards)
    → composeSession (counts, from the in-flight change)
    → orderQueueItems (existing priority sort)
    → gentle type-variety guard (max 3 same-type adjacent)
    → render

Phase 3 pipeline (tree + neural queue):
  neural_queue front slice
    → composeSession (counts, still applies as a cap)
    → render in queue position order (priority IS the order)
    → on depletion: run_spreading_activation from current element
```

Phase 1's `orderQueueItems` is a placeholder for Phase 3's position-ordering.
The transition is clean: when the neural queue lands, `orderQueueItems` is
replaced by `SELECT ... FROM neural_queue JOIN element_tree ORDER BY position`.

## Document ↔ element mapping

A documented design decision: **a document is a Topic** in the tree, and is the
root of its extraction subtree. Extracts are child Topics; cards are child
Items. This preserves the "extracted/derived from" semantics and makes the
existing FK chain (document → extract → card) the backbone of the tree.

```
Document (Topic, root)
├── Extract A (Topic)
│   ├── Card A1 (Item, cloze)
│   └── Card A2 (Item, qa)
├── Extract B (Topic)
│   └── Card B1 (Item)
└── (direct cards from the doc, if any) (Item)
```

SuperMemo additionally allows topics to have child topics (nested reading).
Phase 2's schema supports this (an extract's parent can be another extract's
element_tree row), but the IR flow in Phase 2 only creates the document→extract
and extract→card edges. Nested extracts are a natural follow-on, not in scope.

## Two gaps the Phase 2 work closes opportunistically

Found during mining, worth fixing as Phase 2 lands since the code is open:

1. **`create_learning_item` drops `extract_id`** — the Rust command at
   `learning_item.rs:229` has no `extract_id` parameter even though the frontend
   sends it and the model supports it. Cards authored directly in the Studio
   can't record their extract parent. Phase 2 adds the param so tree edges are
   correct.
2. **`create_learning_item` doesn't bump `documents.learning_item_count`**
   (unlike the extract path's `extract_count` bump). Fixed for consistency.

## Non-goals

- **No new scheduling algorithm.** FSRS/SM-18/SM-20 stability/difficulty/
  due-date computation is untouched. This change is about *ordering*, not
  *when* items recur.
- **No full element unification.** The three tables stay. The overlay is the
  algorithm's handle; existing code is not rewritten.
- **No manual drag-drop tree editing in v1.** SuperMemo supports it; we don't
  need it for the algorithm to work. The `sort_order` column reserves the
  capability.
- **No concept-group UI in v1.** Concept-link propagation is implemented (the
  algorithm needs it for type-4 nodes), but there's no UI to *create* concept
  groups initially — most users won't have concept nodes until a future change.
- **No replacement of the composition sliders.** They stay as a transitional
  count control. Replacing them with review-load-driven auto-balancing is a
  future change.
