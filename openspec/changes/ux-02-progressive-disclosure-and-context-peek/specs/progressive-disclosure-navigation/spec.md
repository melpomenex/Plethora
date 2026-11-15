# Specification: Progressive Disclosure, Command Spine & Context Navigation

## ADDED Requirements

### Requirement: Zen Mode and Architect Mode toggle global telemetry density

The system SHALL maintain a persistent `densityMode` (`"zen" | "architect"`, defaulting to `"zen"`) in `useUIStore`, toggled globally via `Cmd/Ctrl + \` (ignoring inputs where appropriate or explicitly bound to backslash chord) and via the Command Palette. In `"zen"` mode, reading and review views SHALL hide raw algorithm telemetry (`stability`, `difficulty`, `R-values`, `DaqeScoreBreakdown`, `FSRSInspector` trigger badges, and raw numeric priority sliders). In `"architect"` mode, those telemetry panels and scheduling HUDs SHALL be rendered.

#### Scenario: Toggling from Zen to Architect reveals telemetry without mutating card state
- **GIVEN** `useUIStore.getState().densityMode === "zen"` on an active `FlashcardScrollItem` with FSRS-7 stability `14.2d`, difficulty `5.1`, and retrievability `0.91`
- **WHEN** the user presses `Ctrl+\` (or `Cmd+\` on macOS)
- **THEN** `densityMode` updates to `"architect"` and persists to `localStorage`
- **AND** raw telemetry HUDs (`DaqeScoreBreakdown`, stability/difficulty/R badges, `FSRSInspector` trigger) become visible immediately

#### Scenario: Zen Mode suppresses raw telemetry during extract and document review
- **GIVEN** `densityMode === "zen"`
- **WHEN** an `ExtractScrollItem` or `DocumentViewer` renders in the queue
- **THEN** raw scheduling telemetry panels (`[data-architect-telemetry="true"]`) are omitted from the viewport while core content and `[data-queue-header]` remain clean

---

### Requirement: Universal Command Palette binds navigation, queue ordering, extract actions, and hotkey badges

`CommandPalette` (`Cmd/Ctrl + K`) and `src/commandPalette/registry.tsx` SHALL register commands covering view switches, queue ordering toggles (`Adaptive` <-> `Strict Manual`), Zen/Architect density toggle, extract & docked Q&A actions, and theme switches, rendering right-aligned `<kbd>` hotkey hints on every command row with a shortcut.

#### Scenario: Fuzzy search finds queue ordering switch with right-aligned hotkey badge
- **GIVEN** the Command Palette is opened with `Cmd/Ctrl + K`
- **WHEN** the user types `"strict manual"` or `"ordering"`
- **THEN** matching queue ordering commands appear sorted by `CommandMatchTier` and display right-aligned hotkey badges (e.g., `Cmd+\` on UI density toggle)
- **AND** selecting `Queue: Switch to Strict Manual Ordering` updates `queueOrderingSettings` and closes the palette

---

### Requirement: Ghost Context Peek reveals surrounding parent paragraphs and breadcrumb path on Alt hold or upward overscroll

When reviewing an isolated `ExtractScrollItem`, holding `Alt` OR triggering an upward overscroll pull (`deltaY < -35` while `scrollTop === 0`) SHALL reveal `GhostContextPeek` showing the breadcrumb lineage (`Document > Chapter > Section`) plus up to 2 preceding paragraphs and 2 succeeding paragraphs from the parent document in muted dashed-border typography (`[data-ghost-context-peek="true"]`). Releasing `Alt` or scrolling back down SHALL smoothly collapse the ghost context without mutating the extract's saved text.

#### Scenario: Holding Alt reveals surrounding parent paragraphs and breadcrumb path
- **GIVEN** an `ExtractScrollItem` whose parent document contains 5 paragraphs and the extract matches paragraph 3 under heading `"Consensus Protocols > Raft"`
- **WHEN** the user presses and holds `Alt` (with no text input active)
- **THEN** `[data-ghost-context-peek="true"]` renders breadcrumb `"DocTitle > Consensus Protocols > Raft"`, muted paragraphs 1–2 above the extract, and muted paragraphs 4–5 below the extract
- **WHEN** the user releases `Alt`
- **THEN** the surrounding paragraphs collapse cleanly

#### Scenario: Missing parent document gracefully shows extract-only breadcrumb fallback
- **GIVEN** an extract whose parent document content fails to load or is deleted
- **WHEN** the user triggers Ghost Context Peek
- **THEN** the component displays a non-crashing muted notice `"Parent context unavailable"` without throwing

---

### Requirement: Parent-Child Subway Minimap visualizes extract and card mastery hierarchy

`SubwayMinimap` inside the document viewer sidebar (`ExtractsList.tsx` / `DocumentViewer.tsx`) SHALL render a vertical branching node tree mapping `Root Document -> Child Extracts -> Grandchild Flashcards`. Each node SHALL display a mastery status indicator (`Mastered` when `stability >= 21` days, `In Queue` when scheduled/due with `reps > 0`, `Unread` when `reps === 0`) and clicking a child/grandchild node SHALL offer side-by-side reference opening or scroll-to-highlight navigation.

#### Scenario: Subway Minimap renders three mastery states and jumps to reference
- **GIVEN** a document with 2 child extracts (Extract A with a grandchild card `stability = 30d`, Extract B `reps = 0`)
- **WHEN** `SubwayMinimap` renders in the viewer sidebar
- **THEN** Extract A's card node renders with `Mastered` status, Extract B renders with `Unread` status, and clicking Extract A invokes side-by-side reference focus / scroll-to-extract
