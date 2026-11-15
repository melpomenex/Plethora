# Proposal: Study Plans Horizon Bridge, Graceful AI Fallbacks & Actionable Knowledge Network

## Why

Plethora now has rich Study Plans, Assessments (`KnowledgeGapCard`), local/cloud AI generation pipelines, and a Canvas 2D Knowledge Graph (`ObsidianGraph.tsx`), yet they act as disconnected islands:
1. `DashboardTab.tsx` does not unify Top-Down curriculum milestones (Study Plans & due Assessments) with Bottom-Up incremental reading/FSRS due items into a cohesive daily starting point ("Today's Horizon").
2. Missed rubric items in `KnowledgeGapCard.tsx` show weak concepts without a 1-click feedback loop to inject urgent (`Priority < 10`) remediation extracts/flashcards directly into the active queue.
3. AI generation failures (Local LLM Offline / Request Timeout) often show raw errors or wipe the user's draft prompt instead of offering contextual manual fallback or smaller-context retry.
4. `ObsidianGraph.tsx` and `KnowledgeGraphPage.tsx` visualize links nicely but lack FSRS Retrievability/Leech and Unprocessed Extract Density heatmap overlays or `Shift+Drag` lasso selection to start a focused cram/assessment session.

## What Changes

### ADDED
- **"Today's Horizon" Unified Launch Dashboard**: `TodaysHorizonBanner.tsx` in `DashboardTab.tsx` rendering a symmetric two-lane launch strip: **Top-Down Milestones** (due Study Plan nodes & pending Assessments) and **Bottom-Up Discovery** (due FSRS flashcards & high-priority extracts) with 1-click session launches.
- **Assessment-to-Extract Feedback Loop**: Enhance `KnowledgeGapCard.tsx` (and assessment breakdown views) with 1-click **Inject Weak Concepts into Queue**, creating linked extracts/flashcards at high urgency (`priorityDisplaySlider = 8`, `Priority < 10`) anchored to the cited paragraph/source ref.
- **Graceful AI Fallback Cards**: Reusable `GracefulAiFallbackCard.tsx` displaying distinct `Local LLM Offline` / `Timeout` status badges, preserving user text/prompt state, and exposing 1-click **Fallback to Manual Extract** and **Retry with Smaller Context** actions.
- **Knowledge Network Heatmaps & Lasso-to-Queue**: Enhance `ObsidianGraph.tsx` and `KnowledgeGraphPage.tsx` with overlay toggles (`Retrievability / Leech Heatmap`, `Unprocessed Extract Density`) and `Shift+Drag` rectangular/freeform lasso node selection triggering a **Start Cram / Assessment from Selection** bar.

### MODIFIED
- **`DashboardTab.tsx`, `KnowledgeGapCard.tsx`, `QACreatorPopup.tsx`, `SocraticMarginThread.tsx`, `LeechRefactorWizard.tsx`, `KnowledgeGraphPage.tsx`, `ObsidianGraph.tsx`**: Integrate Horizon bridge, gap injection, graceful AI fallback cards, and graph heatmaps/lasso selection.

### REMOVED
- None. Existing graph coloring and Study Plan storage contracts remain unchanged.

## Capabilities

### New Capabilities
- `study-plans-graph-bridge`: Two-lane Today's Horizon dashboard, missed-assessment-to-queue remediation loop, offline-resilient AI fallback cards, and Knowledge Graph heatmaps with `Shift+Drag` lasso cram/assessment launch.

### Modified Capabilities
- None.

## Impact

- **Frontend Modules**: `src/components/dashboard/TodaysHorizonBanner.tsx` (new), `src/components/tabs/DashboardTab.tsx`, `src/components/study-plans/evidence/KnowledgeGapCard.tsx`, `src/components/common/GracefulAiFallbackCard.tsx` (new), `src/pages/KnowledgeGraphPage.tsx`, `src/components/graph/ObsidianGraph.tsx`.
- **Invariants**: Follows Study Plans ADR rules—graph lasso sessions and assessment gap injections NEVER silently invent global `concept_links` edges or alter Study Plan DAG structure, and queue injection uses explicit `priority_rank` / extract creation APIs cleanly.
- **Risks**: Canvas 2D coordinate projection between screen drag rectangle and world graph space in `ObsidianGraph.tsx`; solved cleanly using the existing zoom/pan transform inverse matrix helper.
