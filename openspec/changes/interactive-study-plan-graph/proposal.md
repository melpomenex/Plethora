# Interactive Study Plan Knowledge Graph

## Why

Plethora's Study Plan Editor currently presents the **Curriculum Outline** tab strictly as a numbered linear list paired with a selected-topic editor (`PlanOutline` + `PlanNodeEditor`). While functional for linear editing, a numbered list makes it difficult for learners and curriculum authors to grasp the overall knowledge topology:

- Which topics are foundational entry points versus downstream topics enabled by prerequisites.
- How prerequisites branch, converge, or form independent topic clusters.
- Which topics are completed, in progress, not started, skipped, author-locked, or backed by stale/missing sources.
- Which topics become ready to study once a prerequisite is completed, and how source material connects across topics.

Replacing the linear curriculum with a chaotic force-directed graph (`ObsidianGraph` / `KnowledgeGraph`) would obscure dependency direction and hurt readability. Instead, Study Plans need a deterministic, theme-aware, accessible **Interactive Study Plan Knowledge Graph** embedded directly inside **Curriculum Outline** via a `[List] [Graph]` mode switcher.

## What Changes

- **List / Graph view switch inside Curriculum Outline**: Retain the six existing `StudyPlanEditor` tabs (`Curriculum Outline`, `Source Material`, `Assessments`, `Version Diff`, `Version History`, `Evidence & Gaps`) and introduce a `[List] [Graph]` toggle immediately below the tab navigation, persisting the chosen mode per plan (`localStorage`) and keeping the selected topic (`selectedNodeId`) synchronized in both directions.
- **Deterministic Layered DAG Graph Core (`src/lib/study-plans/graph/`)**:
  - Pure projection from canonical `StudyPlanVersionNode[]`, `PlanPrerequisite[]`, `activityByNodeId`, `sourceRefs`, and optional learning evidence/gaps without creating a second curriculum model or fabricating edges from sequence numbers.
  - Deterministic Sugiyama-style layered DAG layout (`Top-to-Bottom` and `Left-to-Right` orientations) with crossing-minimization sweeps, smooth Bezier curves, multi-edge port spreading, and a clean ordered roadmap layout when a plan has zero prerequisite edges.
  - Transitive prerequisite and dependent reachability traversal, client-side search, and safe draft edge creation/removal validated exclusively through `orderStudyPlan`.
- **Interactive Theme-Aware Graph UI (`src/components/study-plans/graph/`)**:
  - Accessible hybrid SVG-edges + DOM-topic-card canvas with zoom-adaptive level of detail, pan/zoom/fit/reset controls, scroll-safe wheel handling, search navigation, prerequisite provenance filters, Curriculum vs Source Coverage layers, collapsible overview minimap, collapsible live-count legend, and responsive contextual inspector (desktop side panel, tablet overlay, mobile bottom sheet).
  - Visual distinction between activity status (`not-started`, `in-progress`, `completed`, `skipped`), authoring locks (`node.locked`), prerequisite readiness, source health (`current`, `stale`, `missing`, `unverified`), edge provenance (`user`, `confirmed-concept-link`, `inferred`, `unsupported`), and demonstrated mastery evidence.
  - Safe draft editing directly in Graph mode (connect/remove prerequisites with cycle/self/duplicate validation, add topic, inline activity updates, and `Edit topic` drawer reusing `PlanNodeEditor`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `adaptive-learning-paths`: Add interactive Graph mode inside Curriculum Outline with deterministic layered DAG layout, truthful prerequisite/source/progress visualization, contextual inspector, synchronized selection, draft graph editing, full theme fidelity, accessibility, and responsive mobile support.

## Non-Goals

- Replacing or removing the existing List mode (`PlanOutline` + `PlanNodeEditor`).
- Creating a separate persistent graph database or SQLite migration.
- Triggering cloud AI inference or semantic vector search during normal graph navigation.
- Using force-directed physics simulation as the primary curriculum layout.

## User Journeys & Success Criteria

1. **Structural Orientation**: A learner opens a Study Plan (e.g., *Future of Mathematics* with 13 topics), switches **Curriculum Outline** to **Graph**, and immediately sees entry topics, layered prerequisite paths, completed/in-progress/not-started/skipped states, author-locked cards, and stale-source alerts.
2. **Synchronized Exploration**: Selecting Topic 7 in List mode and switching to Graph mode preserves selection and reveals Topic 7; selecting Topic 3 in Graph mode and switching back to List mode shows Topic 3 in `PlanNodeEditor`.
3. **Path & Source Investigation**: Clicking a topic opens the responsive inspector showing summary, objectives, direct prerequisites/dependents, **Highlight prerequisite path** / **Highlight dependents**, **Start lesson**, **Open source** (using `openStudySource` with exact page/timestamp jumps), and **Practice topic**.
4. **Safe Draft Authoring**: In Draft mode, connecting Topic A to Topic B creates `A -> B` through `orderStudyPlan`, rejects cycles/self-links/duplicates with clear feedback, marks the draft dirty, and participates in Save Draft / Review & Publish.
5. **Theme & Accessibility Parity**: Switching across light, dark, OLED, and warm/sepia themes updates all graph surfaces, borders, edges, and text seamlessly; keyboard users can focus, select, inspect, and navigate nodes and edges without mouse input.
