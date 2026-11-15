# Design: Study Plans Horizon Bridge, Graceful AI Fallbacks & Actionable Knowledge Network

## Context

- `src/components/tabs/DashboardTab.tsx` currently mounts `StudyPlansDashboardCard` separately from queue statistics.
- `src/components/study-plans/evidence/KnowledgeGapCard.tsx` (lines 1–116) displays concept gaps and evidence states without queue remediation injection.
- `src/pages/KnowledgeGraphPage.tsx` and `src/components/graph/ObsidianGraph.tsx` render Canvas 2D force-directed nodes/edges with pan/zoom camera transforms.

## Goals / Non-Goals

**Goals:**
- Bridge structured Study Plans & due Assessments with Bottom-Up FSRS/extract discovery in a single uncluttered Hero card (`TodaysHorizonBanner`).
- Close the assessment remediation loop cleanly with high-urgency (`slider = 8`) source-linked extracts & flashcards.
- Make AI failures recoverable in 1 click without losing user text (`GracefulAiFallbackCard`).
- Turn `ObsidianGraph` into an interactive query/launch surface using pure heatmap color resolvers and world-space `Shift+Drag` lasso projection.

**Non-Goals:**
- Rewriting ObsidianGraph's Barnes-Hut physics solver; only extend overlay color resolver and canvas Shift-drag hit-testing.

## Decisions

### 1. TodaysHorizonBanner (`src/components/dashboard/TodaysHorizonBanner.tsx`)
Accepts typed props or reads `useLearningPathsStore` + `queue` summary counts:
- Left Card (**Top-Down Milestones**): active Study Plans count, next uncompleted plan node title, due/draft assessments count, CTA `Continue Milestone`.
- Right Card (**Bottom-Up Discovery**): due flashcard count, high-priority (`P<=25`) extract count, unread discovery count, CTA `Start Adaptive Queue`.

### 2. Gap Remediation Injector (`src/components/study-plans/evidence/KnowledgeGapCard.tsx`)
- Add optional callback/service `onInjectIntoQueue?: (gap: KnowledgeGapInput) => Promise<void>` (with default implementation calling extract creation + `dispatchPriorityCommit` with `URGENT_REMEDIATION_PRIORITY_SLIDER = 8` + starter Q&A/cloze flashcard).
- Maintains local `"idle" | "injecting" | "queued" | "error"` button status to prevent double submits.

### 3. GracefulAiFallbackCard (`src/components/common/GracefulAiFallbackCard.tsx`)
```ts
export type AiFailureKind = "offline" | "timeout" | "error";
export interface GracefulAiFallbackProps {
  errorKind: AiFailureKind;
  preservedQuote?: string;
  preservedPrompt?: string;
  errorMessage?: string;
  onFallbackManual: () => void;
  onRetrySmallerContext: (contextScale: number) => void;
}
```
Maps `"offline"` -> `"Local LLM Offline"` amber/slate pill, `"timeout"` -> `"Request Timeout"` pill, and shows the preserved quote/prompt inside a read-only preview strip above action buttons.

### 4. Graph Heatmaps & Shift-Drag Lasso (`src/components/graph/ObsidianGraph.tsx` & `KnowledgeGraphPage.tsx`)
Pure exported helpers (unit-testable without Canvas pixel reading):
- `export type GraphHeatmapMode = "default" | "retrievability_leech" | "extract_density";`
- `resolveHeatmapNodeColor(node, mode)`:
  - `"retrievability_leech"`:
    - Leech (`(node.lapses ?? 0) >= 4`): Crimson `#ef4444`
    - Critical Low R (`(node.retrievability ?? 1) < 0.65`): Amber `#f97316`
    - Healthy R (`>= 0.85`): Emerald `#10b981`
    - Neutral / Non-SRS node: Slate `#64748b`
  - `"extract_density"`:
    - Maps `unprocessedExtractCount` (`0` -> `#64748b`, `1–3` -> `#38bdf8`, `4–8` -> `#a855f7`, `9+` -> `#ec4899`).
- `computeLassoSelectedNodes(nodes, bounds, transform)`:
  - Converts each node's world `(x, y)` to screen `(sx, sy)` via `x * transform.k + transform.x`, or checks directly against world-mapped drag rectangle `{ minX, maxX, minY, maxY }` and returns array of enclosed node IDs.
- Floating Lasso Selection Pill in `KnowledgeGraphPage.tsx`: shows `<N> nodes selected` + `Launch Cram Session` + `Create Assessment`.

## Risks / Trade-offs

- **Pointer Conflict with Pan/Zoom in `ObsidianGraph`**: Normal drag pans the canvas. **Mitigation**: Only enter lasso draw mode when `e.shiftKey === true` on `pointerdown`/`mousedown`; draw translucent dashed marquee rect and freeze canvas pan during Shift-drag.

## Migration Plan

1. Add `TodaysHorizonBanner` to `DashboardTab` (`UX05-T01`).
2. Add `Inject Weak Concepts into Queue` in `KnowledgeGapCard` (`UX05-T02`).
3. Create `GracefulAiFallbackCard` and wire into AI prompt surfaces (`UX05-T03`).
4. Add `GraphHeatmapMode`, `resolveHeatmapNodeColor`, `computeLassoSelectedNodes`, and Shift+Drag lasso UI (`UX05-T04`).
