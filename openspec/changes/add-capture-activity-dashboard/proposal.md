# Proposal: Capture Activity Dashboard

## Why

The Dashboard tab (`src/components/tabs/DashboardTab.tsx`) only shows the
consume/review half of the capture → read → extract → review pipeline. It
never acknowledges what the user captured — links saved via the browser
extension, pages shared from mobile, RSS articles queued, or manual imports —
so the inbox side of the workflow is invisible, and reviewing/organizing
captures only happens if the user goes looking for them.

## What Changes

- Add a **Capture Activity** section to the Dashboard tab showing:
  - A **captures-per-day sparkline** (rolling window, default 30 days) so
    capture momentum is visible at a glance.
  - A **per-source breakdown** of captured items — browser extension, share
    target, RSS, and manual/local imports — with counts for the selected
    window.
  - A **needs-attention count** for captures whose Smart Tagging organization
    ended in `needs-review` or `failed`, linking to the existing
    ImportNeedsReview surface.
- Add a new Tauri command `get_capture_activity` that aggregates capture
  counts per day and per source directly from the documents table (analogous
  to the existing `get_activity_data` command), so the widget does not depend
  on the paged in-memory document list.
- The Dashboard fetches this on tab activation alongside existing dashboard
  stats; the widget renders an empty state ("No captures yet") for fresh
  installs rather than hiding the section.
- No changes to the capture pipeline itself, to the startup snapshot
  (`StartupSnapshot` stays byte-budget-bound and untouched), or to any other
  Dashboard section.

## Capabilities

### New Capabilities

- `dashboard-capture-activity`: The Dashboard's capture-activity surface —
  per-day capture sparkline, per-source breakdown, needs-attention count, the
  `get_capture_activity` data contract that feeds it, and the empty/loading/
  error states.

### Modified Capabilities

- None. No existing spec-level behavior changes; the Dashboard tab is not
  covered by any existing spec.

## Impact

- **Rust** (`src-tauri/`): new `get_capture_activity` command + repository
  query aggregating over `documents.date_added` and the
  `capture_provenance` / `metadata` JSON columns; registered in the command
  handler.
- **TypeScript API** (`src/api/analytics.ts` or a sibling module): typed
  wrapper + response types for the new command.
- **Dashboard UI** (`src/components/tabs/DashboardTab.tsx` plus a new
  `CaptureActivityCard` component): one new section between the existing
  Continue Reading and Progress sections.
- **Source classification**: derived at query time from provenance JSON
  (`browser_extension` / `share` / RSS markers), with an explicit
  `manual`/`other` bucket for everything else — no data migration, and
  pre-provenance documents are counted as manual imports rather than dropped.
- **i18n**: new translation keys for the section title, source labels, and
  empty/error states (all user-visible strings).
- **Performance gate**: the aggregation query runs once per Dashboard tab
  activation, bounded by the lookback window (30 days default) and existing
  indexes on `date_added`; no benchmark suite additions expected unless the
  implementation adds a pure helper worth baselining.
