# knowledge-universe Specification

## ADDED Requirements

### Requirement: Galaxy layout encodes knowledge structure
The Knowledge Universe SHALL render the collection as a galaxy in which spatial position encodes structure: each document is a star, each extract orbits its parent document as a planet, each flashcard orbits its parent extract as a moon, and documents sharing a category form a visually grouped constellation with a nebula backdrop. Node positions MUST be deterministic (derived from stable identifiers), so the same collection produces the same universe across sessions.

#### Scenario: Documents render as stars grouped by category
- **WHEN** the Universe view loads a collection containing documents with categories
- **THEN** each document renders as a star, and documents of the same category appear spatially clustered with a shared nebula tint

#### Scenario: Extracts and flashcards orbit their parents
- **WHEN** a document star gains focus (system view)
- **THEN** its extracts appear on orbit rings around the star and each extract's flashcards appear on tight orbits around that extract

#### Scenario: Layout is stable across sessions
- **WHEN** the same unchanged collection is opened in two separate app sessions
- **THEN** every node occupies the same position in both sessions

### Requirement: Semantic zoom navigation
The Universe SHALL provide three focus levels — universe (all constellations and stars), system (one document centered with its orbiting extracts and flashcards), and node (a single selected node with detail panel) — connected by animated camera transitions. Clicking a star SHALL fly the camera into that star's system. Pressing Escape, clicking empty space, or using the breadcrumb SHALL move focus up one level. A breadcrumb trail SHALL always show the current focus path. Users MUST be able to reach every document and every node by click-through alone.

#### Scenario: Fly into a star system
- **WHEN** the user clicks a document star at universe level
- **THEN** the camera animates to center that star, its extract orbits expand, and non-focused stars dim toward the background

#### Scenario: Zoom back out
- **WHEN** the user presses Escape (or clicks empty space) at system level
- **THEN** the camera animates back to universe level and dimmed nodes restore

#### Scenario: Breadcrumb reflects and controls focus
- **WHEN** the user is focused on an extract inside a document system
- **THEN** the breadcrumb shows the path (Universe › category › document › extract) and clicking an earlier crumb refocuses that level

### Requirement: Node interaction parity with the Sphere
The Universe SHALL preserve every node interaction the Sphere supports, via the same component callback contract (`onNodeClick`, `onNodeHover`, `onNodeDoubleClick`, `onNodeContextMenu`, `onNodeDelete`, `onNodeSave`): hover highlighting with a label, click-to-select with a detail panel (type, description, category, tags, connection breakdown), double-click to open (document viewer / extract view / review session), right-click context menu, inline edit-and-save, and delete with confirmation.

#### Scenario: Hover highlights a node
- **WHEN** the pointer moves over a node
- **THEN** the node brightens and its label appears, and it restores when the pointer leaves

#### Scenario: Open a document from the universe
- **WHEN** the user double-clicks a document star
- **THEN** the document opens in a document-viewer tab, exactly as it does from the Sphere today

#### Scenario: Edit and delete still work
- **WHEN** the user selects a node and uses Edit (saving changes) or Delete (confirming)
- **THEN** the same save/delete flows run as in the Sphere, and the universe refreshes to reflect the change

### Requirement: Search with warp travel
The Universe SHALL provide a search input that matches node labels as the user types, visually pulsing matching nodes. Selecting a result SHALL animate ("warp") the camera to that node and focus it.

#### Scenario: Warp to a search result
- **WHEN** the user types a query matching a document title and selects the result
- **THEN** matching nodes pulse during typing, and on selection the camera animates to the document and opens its system view with the node selected

### Requirement: Keyboard navigation
The Universe SHALL support keyboard travel: Arrow keys / Tab cycle between sibling nodes at the current focus level, Enter opens the selected node, and Escape moves focus up one level.

#### Scenario: Cycle and open by keyboard
- **WHEN** the user is in system view and presses Tab twice then Enter
- **THEN** selection moves across two sibling orbit nodes and the selected node opens

### Requirement: Idle-zero resource budget
The Universe renderer SHALL render zero frames when idle: with no interaction, no active animation, and ambient drift paused, no requestAnimationFrame callbacks run and no draw calls are issued. Rendering MUST pause entirely when the document is hidden and resume on visibility. Ambient drift MUST be frame-capped (≤ 30 fps) and auto-pause after at most 30 seconds without interaction. Device pixel ratio MUST be capped at 2. When `prefers-reduced-motion` is set, ambient drift MUST be disabled and camera transitions replaced with instant cuts. Unmounting MUST dispose all GPU resources (renderer, geometries, materials, textures).

#### Scenario: No frames while idle
- **WHEN** the Universe is visible but the user has not interacted for over 30 seconds
- **THEN** no animation frames are scheduled and CPU/GPU usage from the view is at baseline (static frame persists on screen)

#### Scenario: Hidden document halts rendering
- **WHEN** the app window/tab becomes hidden while an animation is in progress
- **THEN** the frame loop stops immediately and resumes only when visibility returns

#### Scenario: Reduced motion respected
- **WHEN** the OS reports prefers-reduced-motion
- **THEN** ambient drift never runs and focus changes apply instantly without camera tweens

### Requirement: Bounded rendering cost via instancing
The renderer SHALL draw all nodes, edges, and backdrop elements using instanced/batched geometry such that the number of draw calls is constant (independent of node count), and per-node hover/selection/dim state changes update buffer attributes rather than creating or destroying scene objects. Pointer picking MUST run only on discrete pointer events, never per animation frame.

#### Scenario: Draw calls stay flat as the collection grows
- **WHEN** a collection grows from hundreds to thousands of nodes
- **THEN** the scene still renders in a constant small number of draw calls and interaction frame times do not grow with per-node JavaScript work

### Requirement: WebGL fallback to the Sphere
When a WebGL context cannot be created (or is irrecoverably lost), the view SHALL automatically render the existing Canvas 2D Sphere (`ObsidianSphere`) with identical props, preserving all interactions.

#### Scenario: Fallback on missing WebGL
- **WHEN** WebGL context creation fails on the host system
- **THEN** the Sphere renders in place of the Universe and all node interactions continue to work

### Requirement: Localized Universe UI
All new user-facing strings (view name "Universe", breadcrumb labels, search placeholder, controls, info panel) SHALL be added to all six locales (en, es, zh, de, ja, fr) via the existing i18n system, with no hardcoded English in the components.

#### Scenario: Non-English locale
- **WHEN** the app language is set to any supported non-English locale
- **THEN** the Universe view's chrome (header, breadcrumbs, search, controls, info) appears in that language
