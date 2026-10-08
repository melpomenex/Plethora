## Why

Right-click is a core desktop expectation, but Plethora only offers it on a few surfaces (document text selection, queue ⋯ button, knowledge-graph nodes, document rows). High-value objects like Review decks in the screenshot have no right-click at all, forcing users to hunt for equivalent buttons. Adding consistent, good-UX context menus everywhere they make sense improves discoverability, speeds up power-user workflows, and brings parity between mouse, keyboard, and touch.

## What Changes

- Introduce a single app-wide context-menu pattern built on the existing `ContextMenu` / `useContextMenu` store (`src/components/common/ContextMenu.tsx`) with desktop popover + mobile bottom-sheet rendering, viewport-clamped positioning, Escape/outside-click dismissal, and single-open-at-a-time behavior.
- Add right-click (and long-press / Shift+F10 / Menu-key keyboard equivalent where feasible) menus to every surface where it makes sense:
  - Review Home deck rows + tag-manager rows + header stats/filter chips (Start review, Preview cards, Rename, Edit tags, Export .apkg, Delete, Set active/clear).
  - Documents list/grid rows + folders/tags (Open, Open in new tab, Rename, Move, Tags, Export, Delete).
  - Queue items (Start review, Edit, Postpone smart, Mark done, Delete — promote existing `QueueContextMenu` actions to native right-click).
  - Podcasts / RSS / Audiobooks / Scroll Mode / Document Q&A list items (Play/open, Mark played/read, Download, Add to queue, Copy link).
  - Flashcards / learning cards where listed (Edit, Preview, Suspend, Delete).
  - Tab bar / sidebar navigation items where applicable (Close, Close others, Pin, Rename where supported).
- Every menu action dispatches to the view's existing handler — no duplicated business logic. Destructive actions keep existing confirm flows. Disabled/hidden states follow the "hide inapplicable, disable temporarily unavailable" rule.
- Menus are accessible (focus trap, arrow-key nav, ARIA `menu`/`menuitem` roles) and suppressed on text inputs / editable fields unless the field itself defines a menu.

## Capabilities

### New Capabilities
- `context-menus`: App-wide right-click context menus — shared behavior contract (trigger, positioning, dismissal, a11y, mobile fallback) plus per-surface menu contents and handler dispatch for decks, documents, queue, library (podcast/RSS/audiobook), flashcards, and tab/nav surfaces.

### Modified Capabilities
<!-- None — no existing spec's REQUIREMENTS change. `contextual-palette-actions` stays as-is; context menus reuse handlers but do not alter palette behavior. -->

## Impact

- Affected code: `src/components/common/ContextMenu.tsx`, `MobileContextMenuSheet.tsx`, `src/components/review/ReviewHome.tsx`, `ReviewDecksModal.tsx`, `src/components/documents/DocumentsView.tsx`, `src/routes/queue.tsx`, `src/pages/QueueScrollPage.tsx`, library views (podcast/RSS/audiobook/scroll-mode), tab-bar/sidebar components, study-deck + queue + document stores.
- No API, DB migration, or dependency changes expected; pure UI wiring over existing handlers/stores (`useStudyDeckStore`, `useQueueStore`, document store).
- i18n: new `contextMenu.*` keys in `en.ts`/`zh.ts`; accessibility + mobile-sheet parity required.
