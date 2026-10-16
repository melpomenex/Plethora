# Session customize mobile layering verification

## Implemented behavior

- The New Queue / Customize Session dialog and the Manage Queues dialog now render through `ResponsiveDialogSheet`: portaled to `document.body`, inside the shared `.adaptive-dialog-layer` (backdrop token 1050, panel token 1051), so the scrim and surface paint above the mobile bottom navigation (`z-index: 1000`) instead of under it. Keyboard focus stays inside, Escape and the scrim dismiss, and focus returns to the trigger.
- On phone and portrait-tablet presentations the dialog is a bottom sheet bounded by the dynamic viewport; on desktop it is a centered dialog with the same control set and action order as before.
- The action area is compact-aware: a wrapping row of 44px secondary chips (Reset to Defaults, Save as New Queue, Update Queue `<active queue>`) above a full-width filled Apply Customization with Cancel as its partner; desktop keeps the single row.
- The "Save as New Queue" name entry sits in the surface's non-scrolling footer area, so the field, Save and Cancel stay above the safe-area inset while the keyboard is open.
- `.adaptive-dialog-layer` is now bounded by the visible viewport (`top: var(--app-viewport-offset-top)`, `height: var(--app-viewport-height)`) like the app shell and inspector drawer, so a bottom-anchored sheet cannot land behind the on-screen keyboard. Desktop resolves to `0 / 100dvh`, and the other consumers of that layer (extract dialog, command palette search) inherit the fix.

## Automated checks

| Check | Result |
| --- | --- |
| Focused suites: `SessionCustomizeModal`, `ReviewQueueView`, `ManageSavedQueuesModal`, `SavedQueueDropdown`, `SessionGoalField`, layering contract | 69 passed, 1 pre-existing failure (`ReviewQueueView` — "renders SavedQueueDropdown in the header and switches queue on select", also fails at HEAD) |
| `src/components/queue` + `src/components/review` directories | 352 passed, 2 failures: the pre-existing dropdown test above, and `SessionGoalField`'s scroll-container check — the latter was repointed from the wrapper `.fixed`/`.overflow-auto` lookup to `.adaptive-dialog-body` and now passes |
| `npx tsc --noEmit` | Clean |
| ESLint on every changed file | Clean |
| `npx playwright test src/visual/session-customize.visual.spec.ts` | 4 passed (phone layering + navigation inertness + keyboard-bounded name entry + desktop presentation) |
| `npx playwright test src/visual/palette-actions.visual.spec.ts` | 2 passed (opens Customize Session at 390px and 1440px) |
| `npx playwright test src/visual/rss-customization.visual.spec.ts` | 6 passed |
| `npx playwright test src/visual/material-contracts.spec.ts` | Passed (snackbar/dialog stacking contract unchanged) |
| `npm run build` | Passed |
| `npm run bench:check` | Exit 0: 57 benchmarks compared, 0 failures, bundle budget OK (entry 5 KB, total 24.5 MB). No baseline change. The reported WARNs are pre-existing stale-baseline warnings in unrelated areas |
| Layering regression probe | Lowering `--overlay-backdrop-z`/`--overlay-sheet-z` to 940/941 makes 3 of the 4 browser checks fail, including the check that a tap where a navigation destination sits never reaches it |
| Source contract probe | Temporarily reintroducing a `fixed inset-0 z-50` root into `SessionCustomizeModal` fails `queueDialogLayeringContract`; the guard passes again after reverting |

Exact commands:

```sh
npx vitest run src/components/review/__tests__/SessionCustomizeModal.test.tsx \
  src/components/review/__tests__/ReviewQueueView.test.tsx \
  src/components/review/__tests__/SessionGoalField.test.tsx \
  src/components/queue/__tests__/ManageSavedQueuesModal.test.tsx \
  src/components/queue/__tests__/SavedQueueDropdown.test.tsx \
  src/components/queue/__tests__/queueDialogLayeringContract.test.ts
npx playwright test src/visual/session-customize.visual.spec.ts
npx playwright test src/visual/palette-actions.visual.spec.ts src/visual/rss-customization.visual.spec.ts
npx tsc --noEmit && npm run build && npm run bench:check
```

## Physical-device verification

Device: Pixel 9 Pro XL (`adb-47241FDAS006KM-7WgEBV._adb-tls-connect._tcp`), 1008×2244 at 360 dpi, wireless ADB.

### Before (installed build 3.3.0, prior to this change)

Reproduced the reported defect through the palette → New Queue path: the dialog's action row sat at `y 1863–2094` while the bottom navigation occupies `y 2052–2191`, so the lower third of Cancel and Apply Customization was behind the navigation, the scrim did not dim the navigation, and the navigation remained clickable while the dialog was open.

Evidence: `mobile-screenshots/session-customize-layering/before-pixel9-narrow-toolbar.png`.

## Validation limits and unrelated failures

- Full vitest suite (`npx vitest run`, 874 files): 7134 passed, 25 failed — none attributable to this change. 5 of those failures (Toolbar, `useShareTargetDedupe` ×2, `iosCapabilitiesDoc`, `audioEditionIntegration`) fail identically with every change of this one stashed, plus the pre-existing `ReviewQueueView` dropdown test. The remaining 19 are the OCR command suite (3) and the in-progress assistant-composer work (16) that is being edited in this working tree in parallel.
- `src/visual/command-palette.visual.spec.ts` has two failures (the "view all" panel and the unavailable-assistant state) that also fail with every change of this one stashed; they are pre-existing and untouched here.
- The keyboard check resizes the visible viewport in Chromium rather than raising a real soft keyboard; the physical-device section covers the real keyboard case.
