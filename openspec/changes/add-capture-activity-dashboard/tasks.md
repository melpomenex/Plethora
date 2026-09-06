## 1. Rust data layer

- [x] 1.1 Confirm persisted predicates for share-target and RSS captures (inspect share-target pipeline persistence and `toggle_rss_article_queued` document creation); record findings in code comments next to the classifier. If unidentifiable, rely on the `manual` fallback per design D3.
- [x] 1.2 Add `CaptureActivity` response model (camelCase serde: `window_days`, `per_day`, `by_source`, `needs_attention`) and `CaptureSource` enum (`browser-extension` | `share-target` | `rss` | `manual`) in `src-tauri/src/models/`.
- [x] 1.3 Add repository query selecting `(date_added, capture_provenance, metadata, organization)` for non-archived documents with `date_added >= now - days`.
- [x] 1.4 Implement the Rust classifier (priority: browser_extension → share-target → rss → manual) and day-bucketing with zero-filled per-day series over the window; clamp `days` to [1, 90].
- [x] 1.5 Add `get_capture_activity(days)` command wiring the query + classifier, register it in the command handler, and add unit tests for the classifier (legacy/no-provenance rows → manual; each provenance variant → its bucket; zero-fill; clamping).

## 2. TypeScript API

- [ ] 2.1 Add typed wrapper + response types for `get_capture_activity` in `src/api/analytics.ts` (or a sibling `src/api/capture-activity.ts` if analytics.ts is too review-centric), including normalization guards mirroring `getActivityData`.
- [ ] 2.2 Add unit tests for the wrapper's normalization (non-array/null guards, zero-fill passthrough).

## 3. Dashboard UI

- [x] 3.1 Create `CaptureActivityCard` component: zero-dependency sparkline (per design D5), per-source count rows, needs-attention link, loading skeleton, empty state, and inline error state with retry.
- [x] 3.2 Wire `CaptureActivityCard` into `DashboardTab` between Continue Reading and Progress; fetch on tab activation in independent state (`captureActivity` / `captureError`) so failures don't touch the main error banner.
- [x] 3.3 Make the needs-attention row open the existing `import-needs-review` tab via `addTab` (same flow as Quick Actions tiles); hide the row when count is 0.
- [x] 3.4 Respect the existing responsive/mobile behavior (compact layout under `usePresentationMode` phone mode, consistent with Continue Reading cards).

## 4. i18n

- [x] 4.1 Add `dashboard.captureActivity*` translation keys (section title, source labels for all four sources, needs-attention label, "captures this window" copy, empty state, error + retry) to all supported locale resources.

## 5. Verification

- [x] 5.1 Run `npm run test` and `npm run test:scripts`; fix any regressions.
- [ ] 5.2 Manual verification: save a link via the browser extension while the Dashboard is inactive, reactivate the Dashboard, and confirm the sparkline/source counts/needs-attention update without app restart.
- [ ] 5.3 Manual verification on fresh-install profile: section shows the empty state and the Dashboard's other sections are unaffected.
- [x] 5.4 Run `npm run bench:check` and confirm no perf-baseline or bundle-budget regressions.
