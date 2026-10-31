## Context

`QueueScrollPage` owns wheel and touch paging while embedding the `AssistantPanel` beside the current document. The existing assistant-context component test mocks both leaf surfaces, so it does not cover scroll gestures that bubble from the Assistant into the page-level navigation handlers. See `proposal.md` for motivation.

## Goals / Non-Goals

**Goals:**
- Make an unintended page advance observable by placing two EPUBs in a deterministic queue.
- Assert that wheel and touch gestures originating in the Assistant leave the active EPUB and transcript scroll offset unchanged.
- Exercise Queue Scroll Mode's 300 ms post-navigation reset and assert that it leaves the Assistant transcript at its current scroll offset.

**Non-Goals:**
- Change production scroll handling or Assistant scroll restoration.
- Replace the real-browser Assistant restoration coverage.

## Decisions

- Extend `QueueScrollPage.assistantContext.test.tsx`, which already renders the real page and mocks only leaf viewer surfaces. Give the Assistant mock the same `.assistant-panel` root and an independently scrollable transcript fixture.
- Use queue-list mode with two EPUB entries so accidental paging and explicit navigation are observable. Put the EPUB scroll position at its edge before the touch gesture so the Assistant ownership guard is exercised.
- For the delayed reset case, advance to the second EPUB and wait beyond the actual 300 ms reset delay before checking the Assistant transcript offset.
- Keep this as a test-only OpenSpec change. The existing assistant-scroll-restoration contract already defines position preservation; this adds host-level regression coverage for EPUB Scroll Mode.

## Risks / Trade-offs

- [The Assistant leaf remains mocked, so this test does not exercise its anchor hook] → Existing `issue6-assistant-scroll.visual.spec.ts` tests the real Assistant and its scroll restoration; this test isolates QueueScrollPage's delayed reset and gesture ownership.
