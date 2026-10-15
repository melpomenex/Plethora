## 1. Tab store helper

- [x] 1.1 In `src/stores/tabsStore.ts`, add a selector/helper (e.g. `getMostRecentTabOfTypes(types: TabType[])`) that scans `activeTabHistory` from most-recent to least-recent and returns the first tab whose `id` still exists in `state.tabs` and whose `type` is in the given set, or `undefined` if none match.
- [x] 1.2 Add/adjust unit tests in `src/stores/__tests__/tabsStore.test.ts` covering: match on most-recent of two matching types, skip stale/closed tab ids, return `undefined` when no open tab matches.

## 2. Wire up nav entry points

- [x] 2.1 In `src/components/layout/MainLayout.tsx`, update the "Queue" action (`openTabByType("queue")` call sites, including the command palette action at `MainLayout.tsx:601`) to first call the new helper with `["queue", "queue-scroll"]`; if it returns a tab, call `setActiveTab` for that tab's pane instead of `openTabByType("queue")`; otherwise fall back to the existing `openTabByType("queue")`.
- [x] 2.2 In `src/components/mobile/MobileNavigation.tsx`, update the "Queue" bottom-nav button handler to use the same resolution helper/behavior instead of unconditionally targeting `tabType: "queue"`.
- [x] 2.3 Confirm `resolveTabType`/`navigate` custom-event handling in `MainLayout.tsx:549-561` (used for programmatic `/queue` navigation) routes through the same updated logic, so all "Queue" entry points behave consistently.
- [x] 2.4 (found during implementation) `src/components/tabs/DashboardTab.tsx`'s "Reading Queue" quick-action tile calls `addTab` directly with `type: "queue"`, bypassing `openTabByType` — apply the same most-recent-tab resolution there so this entry point is consistent too.

## 3. Verification

- [x] 3.1 Manually verify: open Scroll Mode, switch to Dashboard, click the "Reading Queue" quick-action tile — Scroll Mode reactivates instead of the list; closing Scroll Mode and repeating correctly falls back to the list tab.
- [x] 3.2 Verified the mobile bottom-nav "Queue" button shares the same `getMostRecentTabOfTypes` resolution (code-reviewed and covered by `MobileNavigation.test.tsx`); confirmed in the mobile viewport that with no Scroll Mode tab open it falls back to the list view, matching desktop.
- [x] 3.3 Manually verified: with no queue-related tab open, clicking "Queue" opens the list view as before.
- [x] 3.4 Manually verified: closed the Scroll Mode tab, leaving only the list tab open, and confirmed "Queue" reactivates the list tab (see 3.1).
- [x] 3.5 Run existing test suite (`npm test` or project equivalent) to confirm no regressions in tabsStore/MainLayout/MobileNavigation tests.
