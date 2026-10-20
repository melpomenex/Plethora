## Context

See `proposal.md` for the reported behavior. `useRssSelectionMenu.tsx:301-308` reads the live selection and opens a shared surface menu. Its snapshot holds text and passage context, and action callbacks already close over that snapshot. It does not retain a DOM range for visible selection preservation. The same hook serves the inline reader (`RSSReader.tsx:3115`), full-content view (`RSSFullContentView.tsx:610`), and Story view (`StoryView.tsx:118`).

The shared menu stores opening state through React updates (`ContextMenu.tsx:85-101`), handles outside pointer events (`ContextMenu.tsx:272-337`), and renders clickable buttons and nested menus. The article hosts render sanitized HTML. These are event and rendering boundaries to inspect; source inspection alone has not established which boundary causes the reported collapse. The existing RSS selection tests open menus with a synthetic context-menu event and verify actions, without exercising a real secondary-button sequence or asserting retained selection.

## Reproduction and observed collapse boundary

Reproduced with a real mouse drag from the first to the third paragraph followed by a right-click inside the selection, on Chromium (Playwright) at 1280×900, in the actual inline reader, full-content view, and Story view. Before the repair, the menu mounted while `window.getSelection()` became collapsed (`rangeCount: 1`, `isCollapsed: true`, empty text); the selected anchor node reported `isConnected: false` even though the article's `innerHTML` string was byte-identical.

A `MutationObserver` trace pinned the boundary between the `contextmenu` dispatch and `mouseup`:

1. `contextmenu` fires with the selection intact (`anchorNode` connected, non-collapsed range).
2. The menu store update rerenders the article host.
3. The article `.rss-reading-prose` element receives a `childList` mutation removing and re-adding all paragraph nodes in the same tick as the menu root mount.
4. No `selection.removeAllRanges()` call and no `selectionchange` precedes the detachment; the browser drops the range because both endpoints are detached when `mouseup` settles.

Root cause: React 19.2.4 compares the `dangerouslySetInnerHTML` prop by object identity in `updateProperties`; every host render creates a fresh `{ __html: ... }` object, so React assigns `innerHTML` even when the sanitized string is unchanged. Menu opening is enough to rerender the host and replace every article text node.

A second, engine-specific boundary appeared in the WebKitGTK 2.54.1 smoke: React can commit the menu synchronously inside the `contextmenu` dispatch, so the menu's new document-level `contextmenu` outside-dismiss listener observes the still-bubbling opening event and closes the menu immediately. The listener now ignores an already-handled opening event (`defaultPrevented`).

Failing-stage screenshots are retained in `evidence/selection-collapsed-after-right-click-story.png` and `evidence/selection-collapsed-after-right-click-full.png`.

## Goals / Non-Goals

**Goals:** Keep selection ownership in the shared RSS hook; preserve a real browser range through menu interaction; retain the existing action snapshot and registry; use browser regression evidence to guide the smallest repair.

**Non-Goals:** Redesigning selection menus, adding actions, migrating RSS Scroll Mode's separate selection system, changing document/PDF/EPUB selection machinery, or controlling selections within the Original view's external website iframe. The visible-selection guarantee covers menu interaction through action dispatch; subsequent dialogs may take focus and keep their existing completion behavior.

## Decisions

### 1. Reproduce the complete input sequence before choosing the repair point

Extend the existing RSS Playwright harness with deterministic article text and actual mouse selection/right-click input. Observe range contents before the press, after menu mount, during submenu navigation, and before action dispatch. Include a representative unchanged-content rerender. This distinguishes native default behavior, article DOM replacement, and menu interaction effects. Synthetic context-menu tests alone cannot make that distinction.

### 2. Keep the selection snapshot local to the current RSS article

Extend the RSS capture with a cloned range and article/content identity where needed for preservation. Capture synchronously before showing the menu, require both range endpoints to belong to the current content container, and retain immutable text/passage values for action callbacks. If the reproduction shows collapse before `contextmenu`, capture during the secondary-button press using hook-provided bindings applied consistently to all three hosts. Do not intercept primary-button selection or touch selection gestures.

Preserve article text nodes across menu-only rerenders. If restoration is required, restore only a still-connected range within the same article/content and only for the active menu or Escape cancellation. Avoid continuous selection-change restoration, which could fight a user's next selection. Rebuilding the full reader selection state machine or painting a replacement highlight would add complexity without repairing the native selection contract.

### 3. Scope menu preservation to selection menus

If menu pointer defaults cause the collapse, add a narrowly scoped, opt-in preservation mechanism to the shared menu and propagate it to its submenus. Keep keyboard navigation, focus return, dismissal, and action activation working. Do not globally suppress pointer defaults or disable focus: other menus and editable controls rely on those behaviors. Continue using existing captured action arguments rather than rereading the live selection on click.

### 4. Make cancellation and invalidation explicit

Escape closes the menu while retaining a valid range for retry. An outside pointer action or replacement selection is never followed by restoration of the old range. Article/content replacement and unmount close the old menu and release retained ranges and pending snapshots. Already-dispatched actions and open dialogs retain their captured inputs and established lifecycle; invalidation prevents a later menu from reusing old input.

## Risks / Trade-offs

- Browser engines differ in secondary-button selection behavior → use real pointer input in Chromium and smoke-test the affected desktop Tauri webview; record the tested platform.
- A retained range points at replaced article nodes → validate connectivity, both endpoints, and article/content identity before restoration; invalidate when content changes.
- Broad pointer suppression could break accessibility or unrelated menus → keep preservation opt-in and run shared menu keyboard, focus, and dismissal regressions.
- A test can pass by checking action payload while the visible selection still disappears → assert non-collapsed native selection and range text at each menu stage, and inspect a screenshot while the menu/submenu is open.
- A test fixture can omit a production rendering boundary → exercise the actual inline reader, full-content view, and Story view through the existing RSS harness.

## Migration Plan

This is a frontend behavior fix with no persisted data migration or new dependency. Roll out with the regression tests and existing local performance gate. Rollback consists of reverting the selection-preservation implementation; existing article data and captured-action APIs remain compatible.

## Implementation notes

- `StoryView`, the inline reader, and `RSSFullContentView` memoize their sanitized `{ __html }` object so menu-only rerenders keep the article text nodes stable.
- `useRssSelectionMenu` captures a cloned range when the menu opens, validates both endpoints against the current content container and article identity, restores it only while the menu is active, and drops it on article/content replacement, unmount, outside dismissal, or a later menu.
- The shared `ContextMenu` gained an opt-in `preserveSelection` prop (desktop only) that prevents pointer defaults on menu and submenu buttons, plus a guard so the opening `contextmenu` cannot dismiss the menu it just opened. Keyboard navigation, Escape, focus return for other menus, and mobile sheet behavior are unchanged.

## Validation

- Chromium (Playwright 1.62.1) desktop 1280×900 and mobile viewport 390×844 with `hasTouch`: 20 browser cases pass, covering the three article hosts, forward/backward formatted selections, submenu navigation and presses, unchanged-content rerenders, Escape/reopen, outside dismissal, article/content replacement, native link/image no-selection menus, and touch tap/contextmenu behavior.
- WebKitGTK 2.54.1 (the engine behind the Linux Tauri webview), loaded through PyGObject: a simulated secondary press collapsed the platform selection before `contextmenu`; the hook restored a non-collapsed range (`text`, `rangeCount: 1`, visible client rects), the menu stayed open, and all article text nodes remained connected.
- The packaged Tauri shell was not re-launched in this session because the installed release predates the change; the WebKitGTK engine smoke above exercised the same selection/menu boundary. A manual click-through in the next packaged build remains the residual risk (WebKitGTK selection/focus behavior).
- Focused Vitest suites (`rssSelectionMenu`, shared `ContextMenu`, `MobileContextMenuSheet`, RSS customization/document/assistant) pass: 40 tests across 6 files. `tsc --noEmit` reports no errors in this change's files; the only errors came from concurrent, unrelated work (`rssListArticleCard.test.tsx`, `settingsSearch.bench.ts`) that appeared in the shared worktree during verification. `npm run bench:check` compared 60 benchmarks and the bundle budget passed; the only warnings were existing stale baselines measuring faster than recorded, so no baseline was updated (no intentional performance change).
