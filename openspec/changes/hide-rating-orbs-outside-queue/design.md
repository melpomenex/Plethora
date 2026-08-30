## Context

Plethora's `DocumentViewer` renders an inline vertical stack of glassmorphic rating orbs (Again, Hard, Good, Easy, Dismiss) on the right side of the reading surface. These orbs are designed to rate the document using FSRS scheduling and advance to the next item in the reading queue.

Previously, `DocumentViewer.tsx` used a blacklist approach to determine whether to hide these orbs:
```typescript
const shouldHideRatingOrbs = hideRatingOrbs || openedFrom === "documents";
```
And rendered them whenever:
```typescript
!shouldHideRatingOrbs && viewMode === "document" && docType !== "pdf" && docType !== "youtube" && docType !== "audio" && isDocumentInQueue
```
Where `isDocumentInQueue` checks whether the document is present in the user's queue database (`queueNav.documentGroups.some(...)`).

Because `openedFrom === "documents"` only caught documents opened directly from `DocumentsTab`, any document opened via:
- Continue Reading
- Recent documents from Toolbar
- Search / Command Palette jumps
- AI Assistant citation chips
- Restored tabs after reload
- Direct location navigation (`openDocumentAtLocation`)

evaluated `openedFrom` as `undefined`. If that document was scheduled in the queue, `isDocumentInQueue` was `true`, causing the rating orbs to appear on the reading surface. Furthermore, typing keys 1-4 in the reader triggered `handleRating` because the shortcut condition only checked `queueNav.totalDocuments > 0`. When clicked outside of an active Queue session, the rating handler cannot advance or simply does nothing, creating a confusing and broken user experience.

## Goals / Non-Goals

**Goals:**
- Hide rating orbs completely whenever the document viewer is not in an active Queue review session (`openedFrom !== "queue"`).
- Disable keyboard rating shortcuts (1-4) in `DocumentViewer` when `openedFrom !== "queue"`.
- Preserve rating orb display and functionality for documents opened from the Queue view, Queue page, and queue navigation.
- Ensure `QueueScrollPage` continues to suppress `DocumentViewer`'s inline orbs via `hideRatingOrbs={true}` since it renders its own overlay.

**Non-Goals:**
- Changing Queue Scroll Mode's `ScrollOverlayControls`.
- Modifying FSRS algorithm or backend rating endpoints.
- Redesigning the visual appearance of the rating orbs.

## Decisions

### Decision 1: Invert to Whitelist Origin Gate (`openedFrom === "queue"`)

**Choice:** Require `openedFrom === "queue"` to show rating orbs.
```typescript
const shouldHideRatingOrbs = hideRatingOrbs || openedFrom !== "queue";
```
**Rationale:** Rating and queue advancement only make sense when the user opened the document as part of a queue review session. All standalone reading contexts (library, search, recents, restored tabs) do not set `openedFrom: "queue"`. Whitelisting is safe against future tab entry points.

*Alternatives considered:*
- Adding more origins to the blacklist (e.g. `openedFrom === "documents" || openedFrom === "continue-reading" || ...`): Fragile and causes recurring leaks whenever new ways to open documents are added.

### Decision 2: Scope Keyboard Shortcuts to Queue Review

**Choice:** Update the rating shortcut listener in `DocumentViewer.tsx`:
```typescript
if (!shouldHideRatingOrbs && openedFrom === "queue" && viewMode === "document" && ...)
```
**Rationale:** Number keys 1-4 should not trigger hidden or inactive rating logic while reading documents casually.

## Risks / Trade-offs

- **[Risk]** Existing open queue tabs without `openedFrom` in persisted tab state:
  → **Mitigation:** When users open items from Queue (`QueueTab`, `QueuePage`, `useQueueNavigation`), `openedFrom: "queue"` is always explicitly set in tab data. Restored tabs without `openedFrom` default to standard reader view, which is the safer and desired behavior.
