## 1. Shared context-menu foundation

- [x] 1.1 Add `useSurfaceMenu` helper + `src/lib/contextMenus.ts` ordering/i18n/hide-vs-disable helpers reusing `ContextMenu` store, and verify `npm run test:scripts` + existing ContextMenu/articleLinks tests pass
- [x] 1.2 Add delegated list-container binding, viewport clamping, Escape/outside/scroll dismissal, single-open, and mobile-sheet mapping, and verify manual right-click/right-click-elsewhere/Escape/long-press behaves per shared-behavior spec
- [x] 1.3 Add `contextMenu.*` keys to `en.ts`/`zh.ts` plus shortcut-label wiring from the shortcut registry, and verify no missing-key warnings in dev console

## 2. Review decks (screenshot surface)

- [x] 2.1 Wire deck-row right-click menu in `ReviewHome.tsx` + `ReviewDecksModal.tsx` (Start review, Preview, Set/Clear focus, Rename, Edit tags, Export .apkg, Delete) with no selection side effect, and verify unit test asserts item order + empty-deck disabled states
- [x] 2.2 Wire Deck Tag Manager row/header menus (Remove/Copy tag; header reuses deck menu) to existing `useStudyDeckStore` mutations, and verify Rename/Edit-tags/Export/Delete run the same handler as the buttons

## 3. Documents

- [x] 3.1 Wire document row/card right-click menu in `DocumentsView.tsx` (Open, Open in new tab, Rename, Tags, Move, Export, Delete) with background-yield rule, and verify test: row menu opens without navigating, background shows no document menu
- [x] 3.2 Wire folder/tag row menus (Rename, Remove, Open filtered view), and verify picking each runs the existing folder/tag handler

## 4. Queue

- [x] 4.1 Promote `QueueContextMenu` to native row right-click (keeping ⋯ trigger) with postponability gating, and verify test: row menu equals ⋯ menu and non-postponable items hide Smart postpone
- [x] 4.2 Add explicit `target` param to postpone/mark-done handlers so right-clicked item (not now-playing) is targeted, and verify episode/item-target test passes

## 5. Library lists

- [x] 5.1 Wire podcast episode + RSS article row menus (Play/Open, Play next/Add to queue, Mark played-read/unread toggle, Download, Copy link, View show/feed, Remove/Hide) to existing handlers, and verify right-clicked (not now-playing) episode is targeted
- [x] 5.2 Wire audiobook + Scroll Mode + Document Q&A source row menus with the same pattern, and verify played/read toggle label flips with state

## 6. Flashcards, tabs/nav, hardening

- [x] 6.1 Wire flashcard/learning-card row menus (Edit, Preview, Suspend/Unsuspend, Copy front, Delete) to the existing editor/preview paths, and verify Edit opens the same dialog as the button
- [x] 6.2 Wire tab-bar (Close/Close others/Close right/Pin) and safe sidebar menus with shortcut display, and verify sidebar offers no destructive item the view lacks
- [x] 6.3 Add keyboard (Shift+F10/Menu key where supported, focus return, arrow-nav, ARIA roles) + editable-field yield (`input,textarea,[contenteditable],a,img` check), and verify axe/keyboard walkthrough passes
- [x] 6.4 Run full verification: per-surface unit tests, `npm run bench:check` green, manual right-click sweep of every surface in the proposal, and verify all spec scenarios pass
