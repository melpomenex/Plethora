## Design

### Current State

Four UI surfaces show algorithm stats, all hardcoded for FSRS:

| Component | Hardcoded Label | Forget Curve Formula | Data Source |
|-----------|----------------|---------------------|-------------|
| `ReviewTransparencyPanel.tsx` | "FSRS Transparency" | None (just interval preview) | `card.memory_state` |
| `FSRSInspector.tsx` | "FSRS Inspector" | `R = exp(-t/S)` (FSRS) | `card.memory_state` |
| `ZenReviewMode.tsx` → `FSRSMetadata` | Comments only | None (just S/R/D/I overlay) | `card.memory_state` |
| `ItemDetailsPopover.tsx` | "Scheduling / FSRS" | None | `getAlgorithmParams()` + `previewReviewIntervals()` |

### Approach: Algorithm-Aware Components

Each component gains access to the current card's `algorithm_type` field (already present on `LearningItem`). Based on this, it:

1. **Selects the correct algorithm name** for display ("FSRS-6" or "Plethora 18").
2. **Parses the correct state** — FSRS uses `card.memory_state` (stability, difficulty, retrievability); Adaptive uses `card.algorithm_state` (parsed via existing `parseAdaptiveState()`).
3. **Uses the correct forget curve formula** — FSRS: `R = exp(-t/S)`, Adaptive: `R = 0.9^(t/S)`.

### Data Flow

```
card.algorithm_type
  ├── "fsrs" → read card.memory_state, use FSRS formula
  └── "adaptive" → parse card.algorithm_state via parseAdaptiveState(), use Adaptive formula
```

For Adaptive, the existing `adaptiveRetrievability(stability, elapsedDays)` function provides the correct formula. Elapsed days come from `card.algorithm_state.elapsed` (or computed from `card.last_review_date`).

### Adaptive-Specific Stats

Adaptive produces additional metrics not available in FSRS:
- **Reps** (`state.repetition`) — count since last lapse
- **Lapses** (`state.lapses`) — total times forgotten
- **BW deviation** (`result.bw`) — B-W metric for difficulty update (available after review)
- **SInc factor** (`result.sinc`) — stability increase factor used (available after review)

The Adaptive transparency panel shows these alongside the common metrics (stability, difficulty, retrievability).

### Forget Curve Difference

The two algorithms model forgetting differently:
- **FSRS-6**: `R = exp(-t/S)` — exponential decay where S is the days until R drops to ~37%
- **Adaptive**: `R = 0.9^(t/S)` — exponential decay where S is the days until R drops to 90% (by definition)

The `FSRSInspector`'s `calculateForgetCurve` function must branch on algorithm type to use the correct formula.

### Component Changes

**`ReviewTransparencyPanel.tsx`**
- Accept `algorithmType` or read `card.algorithm_type`
- Title: "FSRS-6 Transparency" or "Plethora 18 Transparency"
- For Adaptive: parse `card.algorithm_state`, show Adaptive difficulty (0-1 scale), stability, retrievability
- Add Adaptive-specific stats (reps, lapses) when Adaptive is active

**`FSRSInspector.tsx`**
- Rename internal references to be algorithm-agnostic (or keep filename, update labels)
- Header: "Algorithm Inspector" or "FSRS-6 Inspector" / "Adaptive Inspector"
- Forget curve: use correct formula based on algorithm
- Parameter descriptions adapt: Adaptive difficulty is 0-1 (not 1-10), Adaptive stability definition differs
- Add Adaptive-specific fields (reps, lapses) when active

**`ZenReviewMode.tsx` → `FSRSMetadata`**
- Rename to `AlgorithmMetadata` (or keep as-is since it's internal)
- Source data from correct state based on algorithm_type
- No visible label change needed (just S/R/D/I overlay)

**`ItemDetailsPopover.tsx`**
- Section header: "Scheduling / FSRS-6" or "Scheduling / Adaptive" based on item's algorithm
- Stats adapt accordingly (difficulty scale differs: FSRS 1-10 vs Adaptive 0-1)
