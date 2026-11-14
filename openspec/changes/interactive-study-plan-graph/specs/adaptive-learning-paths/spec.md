## ADDED Requirements

### Requirement: Curriculum Outline provides synchronized List and Graph modes

The Study Plan editor SHALL preserve the six existing editor tabs and provide an immediate `[List] [Graph]` view switcher inside the Curriculum Outline section. Selecting a topic in List mode or Graph mode SHALL remain synchronized when toggling views, draft edits made in either mode SHALL participate in the same `isDirty` / Save Draft / Review & Publish lifecycle, and the chosen view mode SHALL persist per Study Plan without marking the plan dirty.

#### Scenario: Topic selection and draft edits stay synchronized across List and Graph views
- **WHEN** a learner selects Topic 7 in List mode, switches to Graph mode, selects Topic 3, and switches back to List mode
- **THEN** Topic 7 is selected upon entering Graph mode, Topic 3 is selected upon returning to List mode, and any unsaved draft edits remain intact

#### Scenario: Mode preference persists per plan without altering plan revision
- **WHEN** a learner switches a plan's Curriculum Outline to Graph mode and reopens the editor for that plan
- **THEN** Graph mode is restored for that plan while the plan's revision and dirty state remain unchanged

### Requirement: Graph projection faithfully represents topics and real prerequisite edges

The graph projection SHALL represent every included topic once, represent every `PlanPrerequisite` edge as a directed `prerequisite -> dependent` edge, preserve disconnected components, multi-prerequisite convergence, and fan-out hubs, and SHALL NEVER fabricate prerequisite edges solely from curriculum `position` order. Plans with zero prerequisite edges SHALL render as an ordered curriculum roadmap with an explicit notice stating that no prerequisite dependencies are defined. Malformed edges (self-edges, duplicates, dangling/excluded endpoints, or cycles) SHALL surface visible diagnostic warnings without crashing the view.

#### Scenario: Zero-prerequisite plan renders as an ordered roadmap without false arrows
- **WHEN** a study plan has 8 included topics and zero `PlanPrerequisite` records
- **THEN** all 8 topics appear in ordered roadmap placement with zero dependency edges and a clear indication that no prerequisites are defined

#### Scenario: Malformed prerequisite edge surfaces diagnostic notice safely
- **WHEN** a study plan version contains a dangling or cyclic prerequisite reference
- **THEN** the graph still renders all included topics without throwing and displays a visible diagnostic notice describing the issue

### Requirement: Prerequisite edges distinguish provenance and expose evidence on inspection

Graph edges SHALL visually differentiate `user`, `confirmed-concept-link`, `inferred`, and `unsupported` provenance using distinct stroke styling, line emphasis, and labels rather than color alone. Clicking or activating an edge SHALL display its provenance, rationale, and linked source references when present.

#### Scenario: Inspecting an inferred or unsupported prerequisite edge shows rationale and provenance
- **WHEN** a learner selects an edge between two topics
- **THEN** an edge detail popover displays the source topic, target topic, provenance classification (`user`, `confirmed-concept-link`, `inferred`, or `unsupported`), and rationale or missing-evidence indicator

### Requirement: Graph canvas provides zoom, pan, fit, reset, search, orientation, minimap, and legend controls

The graph toolbar SHALL provide Zoom in, Zoom out, Fit to view, Reset view, client-side topic search with match navigation, prerequisite provenance filters, Curriculum vs Source Coverage layer switch, Top-to-Bottom / Left-to-Right orientation switch, optional Highlight Next Topic action, and collapsible Minimap and Legend panels. Interactive wheel/pointer/resize listeners SHALL clean up on unmount and SHALL NOT hijack scrolling outside the graph stage or trigger timed viewport resets.

#### Scenario: Search locates matching topics and centers the selected match
- **WHEN** a learner types a keyword into the graph search box and steps through matches
- **THEN** matching nodes are highlighted, non-matching nodes remain stable in place, and the selected match is brought into view

### Requirement: Topic inspector reveals relationships, path highlights, sources, and native actions

Selecting a topic node SHALL open a responsive contextual inspector displaying topic position, summary, learning objectives, study progress (`NodeActivityControl`), direct prerequisites and dependents with click-to-navigate links, transitive **Highlight prerequisite path** and **Highlight dependents** toggles (dimming unrelated nodes/edges until cleared), linked source citations with verification/staleness badges and **Open source**, and functional **Start lesson**, **Edit topic**, and **Practice topic** actions respecting read-only published state.

#### Scenario: Highlighting prerequisite path isolates transitive dependencies
- **WHEN** a learner selects a downstream topic and activates **Highlight prerequisite path**
- **THEN** the selected topic and all transitive prerequisite nodes and edges remain prominent while unrelated nodes and edges dim until the highlight is cleared

#### Scenario: Opening a source from the inspector delegates to Study Plans source navigation
- **WHEN** a learner clicks **Open source** on a valid citation in the inspector
- **THEN** the existing Study Plans source opener (`onOpenSource` / `openStudySource`) is invoked with that citation reference

### Requirement: Visual states keep activity, authoring lock, readiness, source support, and mastery distinct

Topic nodes and inspector views SHALL render `not-started`, `in-progress`, `completed`, and `skipped` activity using both color and non-color icons/labels, SHALL keep `node.locked` (authoring lock) distinct from prerequisite readiness (`entry` / `ready` / `incomplete-prerequisites`), SHALL flag stale or missing sources explicitly, and SHALL display demonstrated mastery or knowledge gaps only from real evidence without inventing percentages.

#### Scenario: Author-locked topic does not imply learning lock
- **WHEN** a topic has `locked: true` and all its prerequisites are completed
- **THEN** the node shows an authoring `Locked` badge while remaining interactive for Start lesson, activity updates, and source navigation

### Requirement: Source Coverage layer distinguishes source evidence from prerequisites

Switching to the **Source Coverage** layer SHALL display deduplicated library source nodes connected to supported topics via visually distinct source-evidence connectors (never prerequisite arrowheads), SHALL allow selecting a source node to highlight all topics it supports and open the source directly, and SHALL preserve `knowledgeAuthority` truthfulness.

#### Scenario: Selecting a source node highlights supported topics
- **WHEN** the graph is switched to Source Coverage and a learner selects a source document node
- **THEN** topics citing that source are highlighted and the source document can be opened directly

### Requirement: Draft mode supports safe prerequisite editing and topic editing

In Draft mode (`version.state === 'draft'`), authors SHALL be able to connect a prerequisite `A -> B` or remove an existing prerequisite edge from the canvas or inspector, validating every change through canonical `orderStudyPlan`. Self-links, duplicate edges, excluded/missing targets, and circular dependencies SHALL be rejected with clear error feedback without mutating valid state. Valid edits SHALL mark the draft dirty and integrate with Save Draft / Review & Publish, while Published plans SHALL enforce read-only behavior. Clicking **Edit topic** SHALL open `PlanNodeEditor` synchronized with the selected topic.

#### Scenario: Connecting a cycle-inducing prerequisite in Draft mode is rejected
- **WHEN** an author attempts to connect Topic B -> Topic A when Topic A is already a prerequisite of Topic B
- **THEN** the connection is rejected with a circular-dependency alert, the edge list remains unchanged, and the draft stays valid

#### Scenario: Published plan disables graph structural mutations
- **WHEN** a published Study Plan version is opened in Graph mode
- **THEN** prerequisite creation, edge removal, topic addition, and topic property editing are unavailable while inspection, navigation, and study activity updates remain available

### Requirement: Graph styling is fully theme-aware, responsive, accessible, deterministic, and performant

All graph surfaces, nodes, edges, controls, minimap, legend, and inspector panels SHALL derive colors and typography from Plethora's active theme tokens (`ThemeContext` and CSS custom properties), automatically updating across light, dark, OLED, and warm/sepia themes without reload. Layout coordinates SHALL be 100% deterministic for identical structural inputs, remain stable across non-structural interactions, render responsive desktop/tablet/mobile layouts, support keyboard selection/navigation/inspection, and compute layout for 100+ topics smoothly.

#### Scenario: Layout remains deterministic and stable across selection and theme switches
- **WHEN** a learner selects nodes, opens/closes the inspector, updates topic activity, or switches themes in Graph mode
- **THEN** node layout coordinates and current viewport zoom/pan remain unchanged while colors and contrast adapt immediately to the active theme
