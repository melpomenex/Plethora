## 1. Component runtime cleanup

- [x] 1.1 In `src/components/review/ReviewQueueView.tsx`, delete the Manual Browse toggle button JSX (toolbar block, ~lines 1142–1161)
- [x] 1.2 Delete the active-mode control bar JSX (position indicator + Prev/Next/Open-Selected, ~lines 1523–1553)
- [x] 1.3 Replace the conditional browse hint (~line 1520) with a single static hint, removing both `queue.manualBrowseHintActive` and `queue.manualBrowseHintInactive` references
- [x] 1.4 Revert the list container attributes (~lines 1555–1562): drop `tabIndex={isManualBrowseActive ? 0 : -1}`, `role="listbox"`, and `onKeyDown={handleQueueListKeyDown}`; keep the plain scrolling region
- [x] 1.5 Delete the `isManualBrowseActive` state (~line 188) and every reference to it (the toggle `onClick`, the control-bar conditional, the list `tabIndex`, and its entry in the global-keydown effect dependency array ~line 954)
- [x] 1.6 Delete the manual-browse helpers: `moveBrowseSelection`, `jumpBrowseSelection`, `activateSelectedItem` (~lines 797–820) and the list keydown handler `handleQueueListKeyDown` (~lines 961–988)
- [x] 1.7 Delete the Escape-exits-browse branch from the global keydown handler (~lines 941–944)
- [x] 1.8 Re-evaluate `queueListRef` (~line 230): drop it if the only remaining use is the scroll-into-view effect (~lines 850–856) and that effect is not needed for inspector UX; otherwise keep the ref + effect and remove only its focus-on-activate usage. Record the choice in the commit message.

## 2. Preserve shared selection plumbing

- [x] 2.1 Confirm `selectedId` (~line 187), `selectedIndexRef` (~line 233), the reconciliation effects (~lines 822–848), and the `data-queue-item-id` row attributes (~lines 1583, 1836) are untouched — they drive the inspector pane
- [x] 2.2 Verify the inspector pane's selected-item resolution (~lines 2057–2152 and the temporary-selection hack ~line 2221) still compiles and resolves after the browse-only code is gone

## 3. Tests

- [x] 3.1 Delete the "supports manual browse keyboard navigation and activation" test case from `src/components/review/__tests__/ReviewQueueView.test.tsx` (~lines 178–191)
- [x] 3.2 Run `npm test` for the `ReviewQueueView` suite (and any queue-view-related suites) and confirm green; remove now-dead setup/imports the deleted test introduced

## 4. i18n cleanup

- [x] 4.1 Remove the five keys from `src/lib/i18n/locales/en.ts`: `queue.manualBrowse`, `queue.manualBrowseHintActive`, `queue.manualBrowseHintInactive`, `queue.browsingPosition`, `queue.openSelected` (lines ~725, 744–745, 795–796)
- [x] 4.2 Remove the same keys from `src/lib/i18n/locales/de.ts` (~lines 4802, 4831–4833, 4838)
- [x] 4.3 Remove the same keys from `src/lib/i18n/locales/es.ts` (~lines 4799, 4828–4830, 4835)
- [x] 4.4 Remove the same keys from `src/lib/i18n/locales/fr.ts` (~lines 4815, 4844–4846, 4851)
- [x] 4.5 Remove the same keys from `src/lib/i18n/locales/ja.ts` (~lines 4718, 4747–4749, 4754)
- [x] 4.6 Remove the same keys from `src/lib/i18n/locales/zh.ts` (~lines 547, 565–566, 607–608)
- [x] 4.7 Grep `src/` for all five key names and confirm zero remaining references

## 5. Typecheck, lint, build

- [x] 5.1 Run `npm run typecheck` (or project equivalent) and resolve any unused-import / unused-var errors the removal surfaces
- [x] 5.2 Run the project lint and build; confirm no Manual Browse references remain in the bundle

## 6. OpenSpec cross-reference reconciliation

- [x] 6.1 Edit `openspec/changes/queue-multi-select-and-bulk-actions/specs/queue-multi-select/spec.md` (~lines 110–111): drop the clause coupling Escape to manual browse ("manual browse SHALL remain active until a second Escape"), preserving the multi-select Escape dismissal behavior
- [x] 6.2 Edit `openspec/changes/fix-customize-session-filters/proposal.md` (~line 8): drop the "and manual browse" clause from the statement about `selectableItems` reflecting the filtered set, keeping the filter-coverage intent
