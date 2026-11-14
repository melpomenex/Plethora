# Tasks: Interactive Study Plan Knowledge Graph

## 1. OpenSpec & Architectural Contracts

- [x] 1.1 Create OpenSpec change `interactive-study-plan-graph` (`proposal.md`, `design.md`, `specs/adaptive-learning-paths/spec.md`, `tasks.md`) and pass `openspec validate interactive-study-plan-graph --strict`.

## 2. Graph Projection, Traversal, Layout & Persistence (`src/lib/study-plans/graph/`)

- [x] 2.1 Define pure graph projection and layout domain contracts in `src/lib/study-plans/graph/types.ts`.
- [x] 2.2 Implement `projectStudyPlanGraph` in `src/lib/study-plans/graph/projection.ts` reusing `orderStudyPlan` and `projectPlanHome`, faithfully mapping nodes, prerequisite provenance, source summaries, readiness, evidence, and diagnostics without fabricating edges.
- [x] 2.3 Implement transitive subgraph traversal, client-side node search, and canonical draft edge validation (`validateAndAddPrerequisiteEdge`, `removePrerequisiteEdge`) in `src/lib/study-plans/graph/traversal.ts`.
- [x] 2.4 Implement deterministic Sugiyama-style layered DAG layout (`TB`/`LR`), zero-prerequisite roadmap layout, crossing minimization, cubic Bezier routing, and Source Coverage layout in `src/lib/study-plans/graph/layout.ts`.
- [x] 2.5 Implement per-plan graph preference persistence in `src/lib/study-plans/graph/persistence.ts`.
- [x] 2.6 Add comprehensive unit tests in `src/lib/study-plans/graph/__tests__/{projection,traversal,layout}.test.ts`.

## 3. Theme-Aware Graph UI Components (`src/components/study-plans/graph/`)

- [x] 3.1 Add localized `studyPlans.graph.*` strings to `src/lib/i18n/locales/recentFeatures/{en,zh,es,de,fr,ja}.ts` and verify `recentFeatureCoverage.test.tsx`.
- [x] 3.2 Implement `StudyPlanGraphNode.tsx`, `StudyPlanGraphEdge.tsx`, and `StudyPlanGraphSourceNode.tsx` using Plethora theme CSS tokens, non-color indicators, and zoom-adaptive LOD.
- [x] 3.3 Implement `StudyPlanGraphToolbar.tsx`, `StudyPlanGraphMinimap.tsx`, and `StudyPlanGraphLegend.tsx`.
- [x] 3.4 Implement responsive `StudyPlanGraphInspector.tsx` (desktop side panel, tablet overlay, mobile bottom sheet) with transitive path highlighting, source opening, lesson/practice actions, and draft prerequisite editing.
- [x] 3.5 Implement `StudyPlanGraphView.tsx` integrating pan/zoom/fit/reset, keyboard navigation, edge rationale inspection, connect-prerequisite mode, and `PlanNodeEditor` edit drawer.

## 4. StudyPlanEditor Integration & Verification

- [x] 4.1 Integrate `[List] [Graph]` mode switcher and synchronized `selectedNodeId` / draft editing state into `src/components/study-plans/StudyPlanEditor.tsx`.
- [x] 4.2 Add component and integration tests in `src/components/study-plans/__tests__/StudyPlanGraphView.test.tsx` (including 13-topic *Future of Mathematics* fixture, 0-prerequisite plan, draft/published states, and theme switching).
- [x] 4.3 Run Vitest suites, ESLint, `npm run build:check` (TypeScript, Vite build, docs validation, bundle budget), and update this checklist with observed results.
