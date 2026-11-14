# Design: Interactive Study Plan Knowledge Graph

## 1. Context & Architectural Evaluation

Plethora already contains:
- **Authoritative Study Plan state**: `StudyPlanDetail` (`plan`, `version`, `activityByNodeId`, `sourceRefs`) managed by `useLearningPathsStore` and `StudyPlanEditor.tsx`.
- **Canonical DAG validation & ordering**: `orderStudyPlan`, `calculateManualMoveBounds`, and `reorderStudyPlanNode` in `src/lib/study-plans/topology.ts`.
- **Next-topic recommendation**: `projectPlanHome` in `src/lib/study-plans/home/projection.ts` and `StudyPlanEditor` unfinished-node lookup.
- **Source resolution & opening**: `openStudySource` in `src/lib/study-plans/openStudySource.ts` and `PlanSourceList.tsx`.
- **Theme tokens**: `ThemeContext.tsx` (`applyThemeToDOM`) and `materialRoles.ts` injecting `--color-background`, `--color-surface`, `--color-card`, `--color-card-foreground`, `--color-primary`, `--color-secondary`, `--color-tertiary`, `--color-border`, `--color-outline`, `--color-outline-variant`, `--color-error`, `--color-warning`, `--color-success`, and `--color-surface-container*`.
- **Existing graph components**: `ObsidianGraph.tsx`, `KnowledgeGraph.tsx`, `TasDependencyGraph.tsx` — all force-directed or circular HTML `<canvas>` renderers built for unstructured knowledge-base exploration.

### Layout & Rendering Library Decision

| Option | Deterministic DAG | Bundle Impact | Theme & DOM A11y | Cross-Platform (WebKitGTK / Mobile) | Verdict |
|---|---|---|---|---|---|
| Reuse `ObsidianGraph` (`<canvas>` + Barnes-Hut physics) | No (force-directed physics) | 0 KB | Canvas draw loops; poor screen-reader / focus support per topic card | Works, but physics jitter & illegible dense cards | **Rejected** |
| Add `@xyflow/react` + `elkjs` | Yes | ~1.5–2.0 MB minified (threatens `totalDistBytes` 31 MB cap in `scripts/bundle-budgets.json`) | Requires CSS overrides to match Plethora M3 theme tokens | Extra WebKitGTK SVG/DOM layer overhead | **Rejected** |
| **Zero-dependency Sugiyama Layered DAG (`src/lib/study-plans/graph/`) + Hybrid SVG Edges & Accessible DOM Cards** | **Yes (100% deterministic)** | **~15–20 KB** (well under bundle budget) | **Native Plethora theme CSS vars, crisp typography, native `tabIndex`/`aria-*` focus rings** | **Zero external runtime dependencies; deterministic in WebKitGTK, macOS, Windows, iOS/Android** | **Selected** |

**Alternative & Tradeoff Note**: Because Plethora caps curriculum plans at 100 nodes (`STUDY_PLAN_LIMITS` / `orderStudyPlan`), a clean TypeScript Sugiyama implementation executes in under 1 ms while guaranteeing zero layout drift, full testability in Vitest without canvas mocking, and native Tailwind/ThemeContext styling.

---

## 2. User Interaction & UX Model

### 2.1 List / Graph Mode Switch
- Directly under the `StudyPlanEditor` tablist when `activeTab === 'outline'`, a segmented switch renders `[List] [Graph]`.
- Switching between `List` and `Graph` shares the exact same `nodes`, `prerequisites`, `selectedNodeId`, `isDirty`, and `activityByNodeId` state in `StudyPlanEditor`.
- Mode preference (`list` vs `graph`), orientation (`TB` vs `LR`), minimap visibility, and legend visibility persist per `planId` in `localStorage` (`plethora:study-plan-graph-prefs:<planId>`). Viewport pan/zoom is purely visual and never marks a plan draft dirty.

### 2.2 Graph Modes & View Layers
- **Curriculum (default)**: Displays all included topics (`included === true`, optional filter to inspect excluded tombstones) and real `PlanPrerequisite` directed edges (`prerequisiteNodeId -> dependentNodeId`).
- **Source Coverage**: Displays deduplicated source-document nodes (`StudyPlanSourceGraphNode`) in an upstream layer connected by dashed source-evidence curves (`StudyPlanSourceGraphEdge`) to the topics they ground. Selecting a source node highlights every topic supported by that document and exposes an **Open source** action without ever conflating source-evidence edges with prerequisite dependencies.
- **Zero-Prerequisite Plans**: When `edges.length === 0` (and not in Source Coverage layer), renders an ordered curriculum roadmap grid with an explicit banner stating that no prerequisite dependencies have been defined, never inventing arrows from `position`.

### 2.3 Zoom-Adaptive Node Detail & Non-Conflated Semantics
- Overview zoom (`zoom < 0.55`): Topic number badge, title, and activity status indicator.
- Normal / Focused zoom (`zoom >= 0.55`): Topic number badge, title, activity status pill (icon + text), source count or `Stale source` / `Missing source` warning badge, authoring `Locked` badge (explicitly distinguished from learning lock), prerequisite readiness badge (`Needs N prereq` when incoming prerequisites are neither `completed` nor `skipped`), and demonstrated mastery / active gap chip only when real `NodeLearningProgress` / `KnowledgeGapView` data exists.
- Hover/selected/highlighted states use theme `--color-primary` halo/outline (`box-shadow` / `ring`), while dimmed nodes during path exploration fade cleanly (`opacity-30`).

### 2.4 Contextual Inspector & Draft Graph Editing
- Clicking any node opens `StudyPlanGraphInspector`:
  - Desktop (`>= 1024px`): docked right-hand inspector column alongside the canvas (`w-[340px] xl:w-[376px]`), collapsible via Close button.
  - Tablet (`640px..1023px`): floating right overlay sheet.
  - Mobile (`< 640px`): bottom sheet overlay.
- Clicking a topic in Draft mode also lets authors toggle **Connect Prerequisite** mode (select source topic, then click target dependent topic) or add/remove prerequisites directly inside the inspector. All mutations call `validateAndAddPrerequisiteEdge` / `removePrerequisiteEdge`, which validate via `orderStudyPlan` (rejecting self-links, duplicates, excluded/missing endpoints, and cycles) before updating `StudyPlanEditor` state and marking `isDirty = true`.
- Clicking **Edit topic** in the inspector opens the existing `PlanNodeEditor` inside a clean drawer/sheet synchronized with `selectedNodeId`, avoiding duplicated form code.

---

## 3. Data Projection & Layout Stability

### 3.1 Graph Data Projection (`src/lib/study-plans/graph/projection.ts`)
- Input: `nodes`, `prerequisites`, `activityByNodeId`, `sourceRefs`, `knowledgeAuthority`, plus optional `nodeEvidence` and `activeGaps`.
- Every `included` node appears exactly once; excluded nodes can optionally be toggled into view with distinct tombstone styling.
- Every `PlanPrerequisite` edge maps faithfully; malformed edges (self-edge, duplicate, dangling or excluded endpoint, or cycle detected by `orderStudyPlan`) are surfaced in `projection.diagnostics` rather than crashing or silently hiding problems.
- Produces a deterministic `structuralKey` derived solely from sorted `(nodeId, included, position)` and `(prerequisiteNodeId, dependentNodeId, support)` tuples.

### 3.2 Deterministic Sugiyama Layout (`src/lib/study-plans/graph/layout.ts`)
- Memoized strictly on `(projection.structuralKey, orientation, viewLayer, supportFilter, includeExcluded)`.
- **Non-structural updates** (selecting a node, opening/closing inspector, updating activity status, typing in search, toggling minimap/legend, highlighting paths) **never recompute layout** and **never reset user pan/zoom**.
- Algorithm stages:
  1. Build active subgraph (if `supportFilter !== 'all'`, filter edges by `support`).
  2. Deterministic cycle-breaking guard (only if malformed input contains a cycle; reverses back-edges in rank pass while keeping real edge direction and flagging diagnostic warning).
  3. Longest-path rank assignment for connected components (`rank(v) = max(rank(u) + 1)`). Nodes with 0 incident edges (isolated topics) are placed cleanly in balanced rows beneath/after connected layers (or in a grid when zero prerequisites exist) so wide disconnected plans stay compact.
  4. 4-pass deterministic barycenter ordering per rank with tie-breaking by `(position, normalizedTitle, nodeId)`.
  5. Coordinate assignment for `'TB'` (top-to-bottom) and `'LR'` (left-to-right), plus cubic Bezier edge routing with source/target port spreading.

---

## 4. Scroll Safety, Accessibility & Theme Compliance

- **Wheel / Scroll Safety**: Wheel zoom on the canvas zooms only when `Ctrl`/`Meta` is held OR when the pointer is directly interacting inside the focused/active graph canvas with non-overflowed scroll bounds, OR via explicit `+` / `-` zoom buttons; wheel events inside the inspector/modals never zoom the canvas, and all `ResizeObserver` / window pointer listeners are cleaned up on unmount.
- **Keyboard Navigation**: Canvas nodes are focusable `<div role="button" tabIndex={0}>` elements with arrow-key / `Tab` traversal, `Enter`/`Space` selection, `Escape` to clear highlight/connect mode or close inspector, and edge `<g role="button" tabIndex={0}>` inspection.
- **Reduced Motion**: Respects `prefers-reduced-motion` and `:root[data-animations="off"]` / `[data-reduced-motion="true"]` via `--md-duration-short`.
- **Localization (`recentFeatureCoverage.test.tsx`)**: All UI strings in `src/components/study-plans/graph/*` and `StudyPlanEditor.tsx` use `useI18n()` + `t("studyPlans.graph....")` keys registered across `src/lib/i18n/locales/recentFeatures/{en,zh,es,de,fr,ja}.ts`.
