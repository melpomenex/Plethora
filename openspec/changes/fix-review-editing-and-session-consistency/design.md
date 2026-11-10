# Architectural Design: Fix Review Editing & Session Consistency

## Problem Diagnosis

### 1. Focus Stealing in Q&A Creator Modal
In `src/components/extracts/QACreatorPopup.tsx:21-38`:
```tsx
useEffect(() => {
    // Focus question on mount
    questionRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") onCancel();
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleSubmit();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
}, [onCancel, question, answer]);
```
`question` and `answer` are in the dependency array. When the user focuses the Answer textarea and types a single character (e.g. "T"), `setAnswer("T")` triggers a re-render.
Because `answer` changed, the effect re-runs.
The very first statement in the effect is `questionRef.current?.focus()`, which forcibly rips browser focus out of the Answer textarea and moves it to the Question field (`screenshot_12`).

### 2. Broken Tag Persistence in Deck Manager Rows
In `src/components/review/DeckManagerCardRow.tsx:263-270`:
```tsx
{/* Tags */}
{!isMobile && (
  <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-hidden hidden lg:block">
    {card.tags.length > 0 && (
      <CompactTagEditor
        target={{ type: "learning-item", id: card.id, tags: card.tags }}
        previewLimit={2}
      />
    )}
  </div>
)}
```
There are two critical failures:
1. `onTagsPersisted` is not passed to `CompactTagEditor`. When the user edits tags in the popover and clicks save, `ItemTagEditor` successfully updates SQLite, but `DeckManagerCardRow` never receives the updated tags, leaving the row displaying stale tags (`screenshot_06`).
2. If `card.tags.length === 0`, line 264 evaluates to false and `CompactTagEditor` is not rendered at all! Untagged cards have no tag UI, leaving the user with no way to add a tag to a newly created card (`screenshot_14`).

### 3. "Failed to save card" in Scroll Mode
In `src/pages/QueueScrollPage.tsx:1842`:
The inline card editor modal invocation passed partial DTO fields rather than the full canonical card model. When saving, the backend command `update_learning_item` rejected the payload due to missing version/revision tokens or null question/answer payloads.

### 4. Delete Progression Race in Review Sessions
In `src/stores/reviewStore.ts:420`:
Deleting a card called the backend delete command, but left the active session item pointer pointing to the deleted card until a review rating was submitted, or triggered an optimistic refresh that resurrected the item before SQLite sync completed (`orig_09`, `orig_10`).

## Architectural Solutions

### 1. Decouple Mount Focus from Event Handlers in `QACreatorPopup.tsx`
Split the monolithic effect into two clean effects:
```tsx
// 1. Focus question input ONCE on mount
useEffect(() => {
  questionRef.current?.focus();
}, []);

// 2. Window keyboard shortcuts using stable refs
const handleSubmitRef = useRef(handleSubmit);
handleSubmitRef.current = handleSubmit;

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      handleSubmitRef.current();
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [onCancel]);
```

### 2. Complete Tag Lifecycle & Affordance in `DeckManagerCardRow.tsx`
1. Add `onUpdateTags?: (cardId: string, tags: string[]) => void` to `DeckManagerCardRowProps`.
2. Always render the tag container. If `card.tags.length === 0`, render a subtle "+ Tag" button that opens `CompactTagEditor`:
```tsx
<div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-hidden hidden lg:block">
  {card.tags.length > 0 ? (
    <CompactTagEditor
      target={{ type: "learning-item", id: card.id, tags: card.tags }}
      onTagsPersisted={(newTags) => onUpdateTags?.(card.id, newTags)}
      previewLimit={2}
    />
  ) : (
    <button
      type="button"
      onClick={handleOpenTagEditor}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed border-border"
    >
      <Plus className="w-3 h-3" />
      <span>{t("common.addTag")}</span>
    </button>
  )}
</div>
```

### 3. Canonical Hydration in Scroll Mode
Ensure `QueueScrollPage.tsx` retrieves and passes complete `LearningItem` records into `InlineCardEditor`, including `id`, `question`, `answer`, `cloze_text`, `tags`, and `memory_state`. On save, invoke `update_learning_item` with complete payload and update local queue item state immediately.

### 4. Delete-and-Advance Review Transition
In `reviewStore.ts`:
1. When `deleteCard(cardId)` is triggered, mark `cardId` as a session tombstone.
2. Advance `currentIndex` immediately to `currentIndex + 1` (or complete session if queue is exhausted).
3. Fire background delete to SQLite. If background delete fails, alert user and rollback session state.
