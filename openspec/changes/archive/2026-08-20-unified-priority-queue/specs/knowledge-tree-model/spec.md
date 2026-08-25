## ADDED Requirements

### Requirement: An element tree overlays the existing item tables

A persisted `element_tree` table SHALL provide a uniform parent/child/sibling
tree over documents, extracts, and learning items, without modifying those
three tables. Each row references one concrete item via
`(element_kind, element_ref_id)` and carries the tree topology columns the
priority algorithm traverses: `parent_id`, `first_child_id`,
`next_sibling_id`, `prev_sibling_id`, `element_type`, `concept_link_id`, and
`inter_element_link_id`.

The three existing tables SHALL continue to be queryable exactly as before;
the overlay is additive. Resolving an element_tree row to its concrete item is
a join on `(element_kind, element_ref_id)`.

Every existing document, extract, and learning item SHALL be registered as an
element_tree node on migration, with edges reconstructed from the existing
foreign keys (extract → its document; learning item → its extract if set, else
its document).

#### Scenario: Existing data is backfilled
- **WHEN** the migration runs against a library that already has documents, extracts, and cards
- **THEN** every one of those items has an element_tree row
- **AND** each extract's element_tree parent is its document's element_tree row
- **AND** each card's element_tree parent is its extract's row (or its document's row when no extract is set)

#### Scenario: Existing queries keep working
- **WHEN** any code queries documents, extracts, or learning_items after the overlay is added
- **THEN** the query results are unchanged
- **AND** no existing store, viewer, or command is modified to accommodate the tree

### Requirement: Element types follow the Plethora taxonomy

The `element_type` column SHALL use the Plethora type byte: 0 = Topic, 1 =
Item, 4 = Concept (2 = Task and 3 = Template are reserved for future use).
Documents and extracts are Topics (0); learning items are Items (1). Concepts
are created explicitly (no v1 UI to create them, but the algorithm handles
them when present).

#### Scenario: Documents and extracts are Topics
- **WHEN** a document and an extract are registered as element_tree nodes
- **THEN** both have `element_type = 0`

#### Scenario: Learning items are Items
- **WHEN** a learning item is registered as an element_tree node
- **THEN** it has `element_type = 1`

### Requirement: Extract and cloze actions build tree edges

Creating an extract SHALL also append an element_tree child node (Topic) under
the source document's element_tree node, appending as the last sibling. Creating
a learning item (cloze, Q&A, or basic) SHALL also append an element_tree child
node (Item) under the source — its extract if `extract_id` is set, else its
document. Both SHALL use the same "append as last child" semantics as
Plethora's `AddNewElement`.

These tree-edge writes SHALL occur in the same transaction as the item INSERT,
so a failure rolls both back.

#### Scenario: Extract creation links to its document
- **WHEN** the user creates an extract from a document
- **THEN** an element_tree node is created with `element_kind='extract'`, `element_type=0`, and `parent_id` pointing at the document's element_tree node
- **AND** the document's `first_child_id` / the prior last child's `next_sibling_id` are updated to include the new node

#### Scenario: Cloze creation links to its extract
- **WHEN** the user creates a cloze from an extract
- **THEN** an element_tree node is created with `element_kind='learning_item'`, `element_type=1`, and `parent_id` pointing at the extract's element_tree node

#### Scenario: Card created directly from a document links to the document
- **WHEN** a learning item is created with a `document_id` but no `extract_id`
- **THEN** its element_tree parent is the document's element_tree node

### Requirement: Documents auto-register as root Topics on import

Importing or creating a document SHALL register an element_tree root node
(Topic, no parent or parent = the collection root) for that document, so the
tree has a root to build under as the user reads and extracts.

#### Scenario: Importing a document creates a tree root
- **WHEN** a new document is imported
- **THEN** an element_tree row is created with `element_kind='document'`, `element_type=0`, and `parent_id` null (or the collection root)

### Requirement: create_learning_item records its extract parent

The `create_learning_item` Tauri command SHALL accept and persist an
`extract_id` parameter, so learning items authored directly in the Studio can
record their extract lineage. (Today the parameter is sent by the frontend but
silently dropped because the Rust command lacks it.)

#### Scenario: Studio-authored card links to an extract
- **WHEN** the user creates a card in Flashcard Studio with an extract selected
- **THEN** the persisted learning item has `extract_id` set to that extract's id
- **AND** the element_tree parent is the extract's node

### Requirement: Tree edges are maintained on item deletion

Deleting a document, extract, or learning item SHALL also unlink its
element_tree node from the topology (patching the prev/next sibling chain and
the parent's child pointer), mirroring Plethora's symmetric doubly-linked
unlink. The element_tree row MAY be retained with a `deleted` flag for history,
or removed; the concrete item's cascade-delete behavior is unchanged.

#### Scenario: Deleting a card unlinks its node
- **WHEN** a learning item is deleted
- **THEN** its element_tree node is unlinked from the sibling chain and the parent's child pointer
- **AND** the prev and next siblings are reconnected to each other
