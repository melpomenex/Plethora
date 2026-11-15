# Specification: Study Plans Horizon Bridge, Graceful AI Fallbacks & Actionable Knowledge Network

## ADDED Requirements

### Requirement: Today's Horizon unified launch dashboard bridges Top-Down Study Plans and Bottom-Up Queue

`TodaysHorizonBanner` on `DashboardTab` SHALL render two structured lanes side by side:
1. **Top-Down Milestones**: active Study Plans with upcoming due topics and pending/in-progress Assessments with 1-click launch buttons.
2. **Bottom-Up Organic Discovery**: counts of due FSRS reviews and high-priority extracts with a 1-click launch into `QueueScrollPage`.
If either Study Plans or Queue items are empty, that lane SHALL render an actionable empty state rather than collapsing or showing errors.

#### Scenario: Dashboard displays both Top-Down Study Plans and Bottom-Up FSRS discovery counts
- **GIVEN** 1 active Study Plan with 3 upcoming nodes, 1 pending Assessment, and 18 due flashcards plus 7 high-priority extracts
- **WHEN** `TodaysHorizonBanner` renders inside `DashboardTab`
- **THEN** Lane 1 displays the active Study Plan & Assessment launch targets and Lane 2 displays `18 Due Reviews • 7 Priority Extracts`
- **AND** clicking `Launch Queue Session` or `Resume Milestone` navigates to the corresponding workspace

---

### Requirement: Missed assessment rubric items inject high-priority remediation extracts and cards into the queue

`KnowledgeGapCard` (and assessment evidence feedback rows) SHALL provide a 1-click **Inject Weak Concepts into Queue** action on missed/partial concepts that creates linked extract(s) and starter flashcard(s) with high urgency (`priorityDisplaySlider = 8`, strictly `< 10`), referencing the underlying `sourceRef` document/paragraph, and disables duplicate injection once queued.

#### Scenario: Clicking Inject Weak Concepts spawns Priority 8 extract linked to source paragraph
- **GIVEN** a `KnowledgeGapCard` representing missed concept `"Raft Leader Completeness"` backed by `documentId = "doc-raft"` and excerpt text
- **WHEN** the user clicks `Inject Weak Concepts into Queue`
- **THEN** the system creates a child extract linked to `"doc-raft"` with `priorityDisplaySlider = 8` (`< 10`) and marks the gap card as `"Queued for Urgent Review (P8)"`

---

### Requirement: Graceful AI Fallback Cards preserve prompt context and offer manual or smaller-context recovery

Whenever an AI surface (`QACreatorPopup`, `SocraticMarginThread`, `LeechRefactorWizard`) encounters an offline provider or timeout error, it SHALL render `GracefulAiFallbackCard` displaying a clear status badge (`Local LLM Offline` when disconnected/unavailable or `Request Timeout` when timed out), retaining all user-entered prompt/selection context untouched, and providing 1-click **Fallback to Manual Extract** and **Retry with Smaller Context** buttons.

#### Scenario: Timeout preserves user question and allows retry with reduced context
- **GIVEN** `GracefulAiFallbackCard` renders with `errorKind = "timeout"` and preserved quote `"CAP theorem proof"` plus user question `"Compare CP vs AP"`
- **WHEN** the user clicks `Retry with Smaller Context`
- **THEN** the retry callback fires with `contextScale = 0.5` and both quote and question text remain intact

#### Scenario: Local LLM Offline offers immediate manual extract fallback
- **GIVEN** `GracefulAiFallbackCard` renders with `errorKind = "offline"`
- **WHEN** the user clicks `Fallback to Manual Extract`
- **THEN** a clean manual extract flow opens/commits with the preserved source passage without requiring AI connectivity

---

### Requirement: Knowledge Network supports Retrievability and Extract Density heatmaps plus Shift+Drag lasso session launch

`KnowledgeGraphPage` and `ObsidianGraph` SHALL provide a heatmap mode switcher (`Default`, `Retrievability / Leech Heatmap`, `Unprocessed Extract Density`) that recolors nodes deterministically according to node metrics, and SHALL support `Shift+Drag` lasso selection on the graph canvas to highlight all enclosed nodes and expose a floating action bar to launch a focused Cram Queue or Study Assessment over those node IDs.

#### Scenario: Retrievability/Leech heatmap colors low-R or high-lapse nodes distinctively
- **GIVEN** graph nodes with `retrievability = 0.95` (healthy), `retrievability = 0.42` (at-risk), and `lapses = 6` (leech)
- **WHEN** `heatmapMode = "retrievability_leech"` is active
- **THEN** `resolveHeatmapNodeColor` returns distinct colors for healthy, at-risk, and leech states cleanly

#### Scenario: Shift+Drag lasso selects enclosed nodes and offers Cram & Assessment actions
- **GIVEN** graph nodes projected at canvas positions `(120, 120)`, `(180, 160)`, and `(500, 500)`
- **WHEN** the user holds `Shift` and drags a selection box covering `(100, 100)` to `(220, 220)`
- **THEN** `computeLassoSelectedNodes` returns the first 2 node IDs, excludes the 3rd, and the floating selection pill enables `Launch Cram (2 nodes)` and `Create Focused Assessment`
