## 1. CreateAudioEditionDialog Responsive & Stacking Fixes

- [x] 1.1 Wrap `CreateAudioEditionDialog` with `createPortal(..., document.body)` with `z-[9999]` and verify it mounts to `document.body` in `CreateAudioEditionDialog.test.tsx`
- [x] 1.2 Update dialog container layout with `max-h-[min(90vh,calc(100dvh-2rem))]`, outer overlay `overflow-y-auto`, `min-h-0` flex-shrink containment on the interior content area, and responsive mobile padding (`p-4 sm:p-6`) and grid (`grid-cols-1 sm:grid-cols-3`); verify content scrolls without off-screen clipping
- [x] 1.3 Wire "Create Audio Edition" into `DocumentCard` context menu for non-audio documents in `DocumentsView.tsx` and verify invocation triggers dialog in `DocumentsView.test.tsx`

## 2. CompactTagEditor Stacking Isolation & Opacity Fixes

- [x] 2.1 Refactor `CompactTagEditor` to render the open edit panel via `createPortal(..., document.body)` with `z-[9999]` and outside tap dismissal, eliminating transform/stacking occlusion from virtualized list rows and cards; verify in `CompactTagEditor.test.tsx`
- [x] 2.2 Enforce guaranteed solid opaque background (`bg-popover` with explicit fallback opaque background color and border) and responsive viewport clamping / mobile presentation on `CompactTagEditor` so no underlying text or card content bleeds through; verify with theme checks
- [x] 2.3 Add comprehensive test coverage for `CompactTagEditor` portaled rendering, solid opacity, and dismiss interactions in `CompactTagEditor.test.tsx`

## 3. Verification & Benchmark Gate

- [x] 3.1 Run unit test suites for `CreateAudioEditionDialog`, `CompactTagEditor`, and `DocumentsView` (`npm test`) and verify all tests pass
- [x] 3.2 Run `npm run bench:check` to ensure baselines and bundle budgets pass
