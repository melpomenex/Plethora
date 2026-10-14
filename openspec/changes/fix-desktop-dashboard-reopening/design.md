## Context

See `proposal.md` for motivation. Desktop initialization in `MainLayout.initTabs` creates a non-closable Dashboard only when `loadTabs()` returns false and the workspace remains empty. A valid restored Queue-only session therefore bypasses Dashboard creation. The configured Default View is then opened or activated independently.

Dashboard entry points already exist: the toolbar calls `addTab`, the empty-workspace button dispatches `/dashboard` to `MainLayout`, and keyboard navigation also reaches `openTabByType`. `addTab` supports single-instance Dashboard reuse and pane activation. `activateDashboardFallback` is a separate back-navigation operation that resets history; it is not interchangeable with a normal user visit. `rehydrateTab` currently preserves serialized `closable`, so older sessions can restore a closable Dashboard despite today's canonical non-closable policy. `closeAllTabs` preserves a non-closable tab when one exists.

These reads explain the missing Dashboard after restoration, but do not establish why the reported open action fails: the current handlers appear capable of creating it. Implementation must first exercise the actual entry points with empty and restored Queue-only fixtures and capture a failing regression before choosing the handler fix. Do not claim that the restore condition alone proves the entire reported interaction failure.

## Goals / Non-Goals

**Goals:**
- Use the current tab store, canonical Dashboard definition, single-instance reuse, and pane tree for recovery.
- Make desktop bootstrap idempotent across restoration and asynchronous user navigation.
- Keep bootstrap history separate from explicit Dashboard visits.

**Non-Goals:**
- Redesigning the toolbar or tab strip, adding a new navigation surface, or changing mobile startup policy.
- Resetting saved workspaces, replacing split trees, or changing Default View semantics.
- Reusing back-navigation fallback as a general open action or rewriting navigation history infrastructure.

## Decisions

### 1. Ensure the desktop Dashboard after restoration, before Default View activation

After the restore attempt, inspect the current store rather than the render-time `tabs` snapshot. If desktop initialization has no Dashboard, add the canonical base tab through the existing bootstrap path. Preserve the restored pane tree and tabs. Continue applying Default View afterward, so Queue or another configured view stays focused. Ensure newly recovered Dashboard state is saved through normal persistence.

Keep this desktop recovery distinct from any existing shared fresh-session initialization so mobile behavior is preserved. Test the asynchronous case in which a user opens a tab while restoration is pending; recovery must use the resulting live workspace without replacing it.

Alternative: force Dashboard into every persisted session inside `loadTabs`. Rejected because that method also serves shared/mobile restore behavior and should not impose a desktop-only shell policy. Alternative: open Dashboard as the startup view. Rejected because that would override the user's preference.

### 2. Preserve normal navigation semantics for explicit reopening

Keep the toolbar, empty state, and existing desktop Dashboard shortcuts on the ordinary `addTab`/visit path, sourcing the canonical Dashboard metadata where needed. Reuse and activate an existing Dashboard in its containing pane; otherwise insert it into a valid pane and activate it. Any small shared helper introduced for this behavior must preserve the same history and persistence semantics.

Reproduce each entry point with an empty workspace and with only Queue before modifying handlers. Fix the smallest proven routing, activation, or metadata gap. The existing `activateDashboardFallback` remains dedicated to back-navigation fallback because it intentionally clears back history.

Alternative: route every open request through `activateDashboardFallback`. Rejected because it changes user navigation history. Alternative: add a new Dashboard button. Rejected because the needed controls already exist.

### 3. Normalize Dashboard closeability without migrating unrelated tab data

Use the canonical non-closable policy for restored Dashboard tabs, including older serialized tabs with `closable: true`. Limit normalization to Dashboard; retain IDs, user data, other tab policies, and pane placement. This makes existing close and close-all behavior protect the base tab consistently. Explicit reopening must still work for sessions that lack Dashboard entirely.

Alternative: clear or version-reset local storage. Rejected because the current format can express the corrected state without losing user workspace data. Alternative: depend only on pinning. Rejected because absent-Dashboard and empty workspaces still need working recovery paths.

## Risks / Trade-offs

- Restoring Dashboard could steal focus or alter history → Add it using bootstrap semantics before Default View activation, and test active pane/history outcomes.
- Repeated initialization or navigation could duplicate Dashboard → Retain the single-instance policy and test repeated opens, including an existing Dashboard in another split pane.
- Shared code could alter mobile behavior → Gate the missing-Dashboard startup policy to desktop and retain mobile regression coverage.
- Persisted legacy metadata could make Dashboard removable again → Test rehydration from `closable: true`, close-all, save, and reload.
- A UI test that invokes only the store could miss the reported broken interaction → Exercise actual toolbar and empty-state controls through the shell as well as store tests, and perform a desktop relaunch check.

## Migration Plan

No storage format or dependency change is required. Existing sessions recover in memory during normal startup and persist through existing save behavior. Rollback reverts the code changes; the saved Dashboard tab remains compatible with the current format.
