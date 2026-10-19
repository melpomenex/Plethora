## 1. Remove Misplaced Scope Selector from DocumentQATab

- [x] 1.1 Remove the root `<div className="flex flex-wrap items-center gap-2 px-3 py-2">` containing `<AssistantScopeSelector>` from `src/components/tabs/DocumentQATab.tsx`, clean up unused imports if applicable, and verify the middle-left protrusion is eliminated.
- [x] 1.2 Position the `suggestSwitchToChat` action contextually beside the composer sources chip in `src/components/tabs/DocumentQATab.tsx` so users retain a clear recovery path when evidence is absent, and verify it renders without affecting sidebar width.

## 2. Test Suite & Layout Verification

- [x] 2.1 Update `src/components/tabs/__tests__/DocumentQATab.test.tsx` to remove obsolete clicks on the removed scope button and verify all 28 tests pass with `npm test src/components/tabs/__tests__/DocumentQATab.test.tsx -- --run`.
- [x] 2.2 Run typecheck with `npx tsc --noEmit` to verify zero type regressions across the codebase.
