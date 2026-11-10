# Architectural Design: Selectable Strict Manual Queue Ordering

## Problem Diagnosis & Mathematical Foundation

In the current DAQE implementation (`src-tauri/src/algorithms/daqe/terms.rs:223`), memory urgency is computed as:
$$M = 0.8 \cdot T + 0.2 \cdot P$$
where $T$ represents temporal urgency and $P$ represents canonical manual priority ($P \in [0, 1]$).
In `ranker.rs`, composite score $S(i)$ further blends $M$ with goal relevance, energy fit, topic diversity penalty, and friction penalty:
$$S(i) = w_{srs} \cdot R_{srs}(i) + w_{goal} \cdot M_{goal}(i) + w_{energy} \cdot E_{fit}(i) - w_{div} \cdot P_{interleave}(i) - w_{fric} \cdot P_{friction}(i)$$
In the frontend (`src/utils/queueScrollOrder.ts:34`), `orderScrollItemsByPriority` applies a variety guard:
```ts
if (item.type === lastType && streak >= maxSameTypeConsecutive) {
  deferred.push(item);
  continue;
}
```
This causes an item that the user set to 100% priority (position 1) to be deferred behind lower-priority items simply because it shares a type with preceding items, or because DAQE's temporal urgency or energy target overrides it.

## Architectural Decision: Selectable Queue Ordering Modes

We introduce an explicit enum in both Rust and TypeScript:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum QueueOrderingMode {
    #[default]
    Adaptive,
    StrictManual,
    SrsPriority,
}
```

```ts
export type QueueOrderingMode = "adaptive" | "strict-manual" | "srs-priority";
```

### 1. `adaptive` Mode
Retains the complete DAQE ranking pipeline and Scroll Mode variety guard. Ideal for users who want algorithmic balance, topic interleaving, and fatigue reduction.

### 2. `strict-manual` Mode
Bypasses DAQE scoring and the variety guard entirely:
1. Primary sort key: Canonical Priority $P$ descending ($P = 1.0$ is highest priority, position 1).
2. Secondary tie-breaker: Due date ascending (earlier due dates first; missing due date last).
3. Tertiary tie-breaker: Stable identity `(item_type, item_id)` ascending.
Variety guard in Scroll Mode is disabled: if the top 10 items are all documents, they appear in exact priority order without synthetic interleaving.

### 3. `srs-priority` Mode
Classical Leitner/SuperMemo style eligibility bucketing:
1. Bucket 1: Due items (`due_date <= now`), sorted by $P$ descending.
2. Bucket 2: New items (`due_date IS NULL`), sorted by $P$ descending.
3. Bucket 3: Future items (`due_date > now`), sorted by due date ascending, then $P$ descending.

## Backend Implementation Architecture

In `src-tauri/src/algorithms/daqe/ranker.rs`:
```rust
pub fn rank_with_mode(
    items: &[QueueItem],
    knobs: &DaqeKnobs,
    ctx: &RankContext<'_>,
    mode: QueueOrderingMode,
) -> Vec<RankedItem> {
    match mode {
        QueueOrderingMode::Adaptive => rank(items, knobs, ctx),
        QueueOrderingMode::StrictManual => rank_strict_manual(items, ctx.now),
        QueueOrderingMode::SrsPriority => {
            let mut order = input_order(&ranked);
            sort_by_legacy_order(&mut order, items, ctx.now);
            order.into_iter().map(|i| ranked[i].clone()).collect()
        }
    }
}
```
Where `rank_strict_manual` extracts canonical $P$, sorts by $P$ descending with zero algorithmic distortion, and constructs `RankedItem` records with clear attribution metadata (`mode: "strict-manual"`).

## Frontend Implementation Architecture

In `src/utils/queueScrollOrder.ts`:
Extend `orderScrollItemsByPriority` with a `strictManual: boolean` parameter:
```ts
export function orderScrollItemsByPriority<T extends PrioritizableScrollItem>(
  items: T[],
  maxSameTypeConsecutive: number = MAX_SAME_TYPE_CONSECUTIVE,
  strictManual: boolean = false
): T[] {
  const sorted = [...items].sort((a, b) => {
    const scoreDiff = (b.engagementScore ?? 0) - (a.engagementScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.id.localeCompare(b.id);
  });

  if (strictManual || sorted.length <= maxSameTypeConsecutive) {
    return sorted; // Zero variety deferrals
  }
  // Normal variety guard logic...
}
```

## Settings Search & UI Integration

- Location: Settings -> Review -> Queue Configuration.
- Dropdown select:
  - `Adaptive (DAQE Recommended)`
  - `Strict Manual Priority`
  - `SRS Priority (Due first)`
- Search Catalog entry:
  - ID: `setting-queue-ordering-mode`
  - Keywords: `["queue ordering", "manual priority", "strict priority", "daqe", "srs ordering"]`
  - Section: `SettingsTab.Review`

## Invariants & Safety
- **Zero Rescheduling**: Changing queue ordering mode executes in memory; it NEVER modifies database records, due dates, FSRS memory states, or intervals.
- **Determinism**: For an unchanging set of items, sorting is byte-identical and idempotent across repeated calls.
- **Safe Fallback**: If an invalid mode string is encountered in persisted settings, it defaults gracefully to `adaptive`.
