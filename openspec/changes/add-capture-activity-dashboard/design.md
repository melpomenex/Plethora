# Design: Capture Activity Dashboard

## Context

The Dashboard tab (`src/components/tabs/DashboardTab.tsx`) currently loads two
things on activation: the startup snapshot (`ensureStartup("dashboard")`,
which feeds Continue Reading) and `getDashboardStats`. Documents in
`documentStore` are **paged**, so the browser's in-memory list is not a
reliable basis for counts. On the Rust side, `Document` already persists
`capture_provenance` and `organization` as JSON columns plus `date_added`
(`src-tauri/src/models/document.rs`), and there is precedent for
per-activation analytics commands (`get_dashboard_stats`, `get_activity_data`).
Chart rendering in this app is dependency-free DOM/CSS (see
`ActivityChart`), not a chart library.

## Goals / Non-Goals

**Goals:**
- One aggregation query that returns everything the widget needs (per-day
  series, per-source totals, needs-attention count) with a bounded lookback.
- Source classification derived from existing persisted provenance — no data
  migration, no backfill.
- A widget whose failure cannot degrade the rest of the Dashboard.

**Non-Goals:**
- No changes to the startup snapshot (`StartupSnapshot` is byte-budget-bound
  and cold-start-sensitive; this widget is on-demand).
- No changes to the capture pipeline, provenance writers, or document schema
  (no new columns, no migrations).
- No drill-down list of individual captures (that's a separate change; this is
  the aggregate view).
- No per-collection filtering in v1 — capture activity is library-wide, unlike
  `getDashboardStats`.

## Decisions

### D1: Dedicated `get_capture_activity` Tauri command (not snapshot, not client-side)

**Decision**: Add `get_capture_activity(days: u32)` alongside
`get_dashboard_stats`; DashboardTab calls it on tab activation.

**Alternatives considered**:
- *Extend `StartupSnapshot` with a `captureActivity` page*: rejected — the
  snapshot is shared by every startup surface, is optimized against a 256 KB
  byte budget, and capture activity is only shown on one tab. On-demand keeps
  cold start untouched.
- *Filter the in-memory document store client-side*: rejected — documents are
  paged (`loadDocumentsPage`), so counts silently under-count on large
  libraries; correctness would depend on which page the user happened to
  load.

### D2: Classify in Rust over a window-bounded row set, not in SQL/JSON1

**Decision**: The repository query selects `(date_added, capture_provenance,
metadata, organization)` for non-archived documents with
`date_added >= now - days`, then classifies each row in plain Rust.

**Rationale**: Provenance lives in free-form JSON columns whose internal shape
has evolved (browser capture provenance, share provenance, legacy
`metadata.source`/`url` web-import fields). SQLite JSON1 aggregation would
couple the query to every historical JSON variant; a bounded row set
(30 days of captures, typically hundreds at most) classified in Rust is
simple, testable, and tolerant of shape drift. `get_activity_data` already
establishes "aggregate then shape" as the house pattern.

**Classification predicate (priority order, first match wins)**:
1. `capture_provenance.source == "browser_extension"` → `browser-extension`
2. share capture provenance present (see D3) → `share-target`
3. RSS-derived marker present (see D3) → `rss`
4. otherwise → `manual` (deliberately includes all pre-provenance documents —
   they are counted, never dropped)

### D3: Verify share/RSS markers during implementation; fallback is safe

**Decision**: The exact persisted predicate for share-target and RSS captures
is confirmed during implementation. Known candidates to check: share captures
persisted via the share-target pipeline (TS `shareProvenance`), and RSS
articles queued into the library (`toggle_rss_article_queued` path) and how
they are marked. If neither can be identified with a stable predicate, those
buckets fall into `manual` — the widget still ships correct totals, and the
predicates can be tightened later without any spec change (the source set
`manual | browser-extension | share-target | rss` is fixed; only membership
moves).

### D4: Command response shape

```jsonc
{
  "window_days": 30,
  "per_day":  [{ "date": "2026-09-05", "count": 4 }],   // one entry per day, zero-filled
  "by_source": [{ "source": "browser-extension", "count": 12 }, ...],
  "needs_attention": 2
}
```

- Wire keys are snake_case and the response models live inline in
  `commands/analytics.rs`, matching the existing `get_dashboard_stats` /
  `get_activity_data` module convention (the TS wrapper normalizes to
  camelCase). Source *values* stay kebab-case per the spec.
- `needsAttention` counts documents whose `organization.status` is
  `needs-review` or `failed`, within the same window (same row set — cheap
  and consistent with the chart the user is looking at).
- `days` is clamped server-side to [1, 90] to bound cost regardless of caller.

### D5: Widget UI — inline SVG/CSS sparkline, no new dependency

**Decision**: New `CaptureActivityCard` component rendered between Continue
Reading and Progress. Bars are plain `div`s/SVG following `ActivityChart`'s
dependency-free approach; source breakdown is a simple label+count row list.

- Needs-attention row is a link/button that opens the existing
  `import-needs-review` tab (already exported from `TabRegistry`), using the
  same `addTab` flow as the Quick Actions tiles.
- Fetch is fired alongside `loadStats()` on activation but kept in its own
  state (`captureActivity`, `captureError`) so a failure renders a retry
  affordance inside the card without touching the Dashboard's main error
  banner.
- Empty state when the library has no documents (mirrors existing
  `hasNoDocuments` handling) and when the window has zero captures.

### D6: i18n keys under the existing `dashboard.*` namespace

New keys (title, source labels, needs-attention, empty/error copy) added to
the translation resources for all supported locales, following the existing
`dashboard.welcomeBack` / `dashboard.quickActions` naming pattern.

## Risks / Trade-offs

- [Share/RSS provenance predicates may not be cleanly identifiable] →
  D3's fallback: unidentifiable captures land in `manual`; totals stay
  correct, tightening is a non-breaking follow-up.
- [Aggregation over JSON columns could get slow on very large libraries] →
  window clamp (≤ 90 days) plus `date_added >= ?` pre-filter keeps the row set
  small; no `LIKE '%…%'` over full JSON blobs beyond the bounded window.
- [Legacy `metadata` shapes cause classification misses] → every row is
  counted somewhere (`manual` is the catch-all), so counts never silently
  lose documents.
- [Extra query on every Dashboard activation] → one bounded query, same
  lifecycle as `getDashboardStats`; acceptable. If it ever matters, it can be
  memoized behind the startup snapshot later without changing the widget.

## Migration Plan

Purely additive: new command + new UI section. No schema migration, no data
backfill, no snapshot version bump. Rollback is removing the section and
command registration. Feature ships dark (no rollout flag needed) since the
section degrades to an empty state on fresh installs.

## Open Questions

- Exact share-target / RSS persisted markers — deferred to implementation per
  D3 with a safe fallback.
