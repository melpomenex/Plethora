## Context

The app uses a custom tab system (not React Router) for navigation. Opening a document from any view calls `addTab({ type: "document-viewer", content: DocumentViewer, data: { documentId } })`. `TabWrapper` spreads `tab.data` as props onto the content component, so anything placed in `data` reaches the viewer as a prop — there is just no origin information placed there today.

Rating orbs are queue-review affordances. The inline orb set lives in `DocumentViewer.tsx` (~line 7096) and currently renders when `!hideRatingOrbs && viewMode === "document" && <not pdf/youtube/audio> && isDocumentInQueue`. `isDocumentInQueue` is derived purely from queue membership — it has no notion of *where the user opened the document*. So a document opened from the Documents view that happens to also be in the queue shows the orbs, and tapping one kicks off queue navigation (advance to next item), which is jarring outside a review session.

A second, separate orb implementation (`ScrollOverlayControls`) exists but is queue-only (Scroll Mode) and is not affected by this change.

One gotcha: the `document-viewer` tab type resolves to `DocumentViewerWrapper`, which forwards a fixed set of props to the underlying `DocumentViewer` and currently **drops** `hideRatingOrbs`. So the signal must survive the wrapper.

## Goals / Non-Goals

**Goals:**
- Hide inline rating orbs in the reader when the document was opened from the Documents (library) view, even if that document is also in the queue.
- Preserve current orb behavior for documents opened from the Queue (standard view, prev/next queue nav, and Scroll Mode).
- Keep the change minimal, client-only, and consistent with the existing tab-data-as-props pattern.

**Non-Goals:**
- Changing the separate `ScrollOverlayControls` orbs (queue-only Scroll Mode).
- Removing a user's ability to rate a Documents-opened document via other means (keyboard shortcuts, menus) — only the always-visible inline orb strip is gated. (Keyboard rating remains available as a power-user affordance.)
- Adding a new persistent setting or database column.
- Backend / FSRS / rescheduling logic changes.

## Decisions

### Decision 1: Carry an origin on the tab via `data.openedFrom`
**Choice:** Add `openedFrom: "documents" | "queue"` to the tab `data` at each call site (defaulting to `"documents"` for library-style openers, `"queue"` for queue-driven ones).

**Alternatives considered:**
- *Reuse the existing `hideRatingOrbs` boolean directly in `tab.data`.* Simpler, but loses the semantic *reason* (we may later want other origin-aware behavior — e.g. hiding the "next in queue" affordance, different defaults). An explicit origin is more extensible and self-documenting.
- *Derive origin inside the viewer from queue membership.* This is exactly the current broken behavior; membership ≠ intent.

**Why:** A single string field is cheap, self-describing, and avoids baking presentation booleans into the navigation layer. The viewer translates `openedFrom` into the hide decision at render time.

### Decision 2: Translate origin to a hide flag inside `DocumentViewer`
**Choice:** Keep `hideRatingOrbs` as the single gate the render condition reads, and derive it as `hideRatingOrbs || openedFrom === "documents"` at the top of `DocumentViewer` (memoized). Existing direct callers that already pass `hideRatingOrbs` (e.g. Scroll Mode's embedded viewer) keep working unchanged.

**Alternatives considered:**
- *Inline the `openedFrom` check directly into the 7096 render condition.* Works, but the condition is already long and the same gate may be needed in a couple of places (the orbs block and the single "mark as read" fallback button).

**Why:** One named, derived value is easier to read and keeps the render block from growing further.

### Decision 3: Forward the prop through `DocumentViewerWrapper`
**Choice:** Add `hideRatingOrbs?: boolean` (and `openedFrom?: string`) to `DocumentViewerWithAssistantProps` and pass them through to `BaseDocumentViewer` alongside the other forwarded props. This is a required fix — without it, any value placed in `tab.data` is silently dropped.

**Why:** No alternative; it's the only way the tab-data signal reaches the viewer, and the wrapper is already the pass-through for every other prop.

### Decision 4: Default other openers conservatively
**Choice:** Entry points other than the Queue (Dashboard, Continue Reading, KnowledgeSphere, Extracts, KnowledgeGraph, etc.) are left as-is / treated as library-style opens (orbs hidden when not opened from queue). The spec's defining test is the Documents-vs-Queue distinction; other surfaces already only show orbs when the doc is in the queue, and this change keeps that but biases non-queue opens toward no orbs.

**Why:** Matches user intent — the orbs are a review affordance; surfacing them only matters in the explicit review (Queue) context.

## Risks / Trade-offs

- **[Users who rate from Documents today lose the visible affordance]** → Keyboard shortcuts and any menu-based rating remain available; the spec scopes the hide to the *inline orb strip* only, not the act of rating. If this proves too aggressive, the origin list can be widened without architectural change.
- **[A stale `openedFrom` if a tab is reused / switched]** → The origin is captured at open time on the tab `data`; queue prev/next navigation within an existing queue tab already opens new tabs with its own `data`, so no cross-contamination. Worth a scenario in the spec covering queue-driven re-open.
- **[Forgetting to forward through the wrapper silently reverts behavior]** → Add the wrapper forwarding as an explicit task and assert in tasks.md that orbs are gone from a Documents-opened doc in the queue.
