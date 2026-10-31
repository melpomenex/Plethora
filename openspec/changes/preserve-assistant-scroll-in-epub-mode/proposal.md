## Why

The Assistant transcript's scroll preservation is already specified, but Queue Scroll Mode needs a regression test while an EPUB is open. Assistant gestures must not page the reader, and Queue Scroll Mode's delayed post-navigation reset must not move the Assistant transcript to the top.

## What Changes

- Add a focused QueueScrollPage regression test for wheel and touch gestures that originate in the Assistant while viewing an EPUB.
- Add a regression test for the delayed post-navigation scroll reset, asserting that it leaves the Assistant transcript at its current position.
- Keep this test-only; the behavior is covered by existing Assistant scroll and Queue Scroll Mode contracts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None.

## Impact

- Test: `src/pages/__tests__/QueueScrollPage.assistantContext.test.tsx`
- Existing behavior contract: `openspec/changes/fix-issue-6-scheduling-and-learning-workflows/specs/assistant-scroll-restoration/spec.md`
