## Context

The current context menu system in `src/components/common/ContextMenu.tsx` implements right-click floating menus for desktop and bottom sheets for mobile. However, the dismissal behavior is incomplete and leads to frustrating user experiences:
1. Menus do not close when the user right-clicks elsewhere on the page.
2. Menus do not close when the window is resized, scrolled, or blurred.
3. Submenus, when closed, also close their parent menus due to the propagation of the `onClose` callback in the submenu JSX.
4. Left-clicking outside closes the menu, but clicking on disabled items or separators also closes the menu.

## Goals / Non-Goals

**Goals:**
- Implement unified dismiss behaviors for the context menu: left-click outside, right-click outside, scroll, window resize, window blur, and document visibility change.
- Ensure that clicking inside the context menu on disabled items, separators, or submenu triggers does not dismiss the menu.
- Fix submenu dismissal so that closing a submenu (e.g. via Escape or clicking outside the submenu but inside the parent menu) does not prematurely close the parent menu.

**Non-Goals:**
- Complete redesign of the context menu styling.
- Changing mobile bottom sheet presentation logic (this design focuses on correct behavior and event handlers).

## Decisions

### 1. Move Event Listeners to `<ContextMenu>` Component

- **Option A (Global Event Bus):** Create a reactive context menu store with event listeners.
- **Option B (Component-Level Listeners):** Manage event listeners directly in the `<ContextMenu>` component's lifecycle using `useEffect`.
- **Selected: Option B.**
  - *Rationale:* Since `<ContextMenu>` has the actual DOM reference (`menuRef`), it can easily perform containment checks using `menuRef.current.contains(target)`. This is highly local, clean, and cleans up automatically when the component unmounts.

### 2. Events to Listen and Dismiss

We will register the following event listeners when the `<ContextMenu>` is visible:
- `mousedown` / `pointerdown` (on `document`): Closes the menu if the target is outside the menu.
- `contextmenu` (on `document`): Closes the menu if the target is outside the menu. We do not call `preventDefault()` on this document-level listener, allowing the browser/other elements to receive the right-click.
- `scroll` (on `document` with `{ capture: true }`): Closes the menu on any container scroll.
- `resize` (on `window`): Closes the menu.
- `blur` (on `window`): Closes the menu when the app loses focus.
- `visibilitychange` (on `document`): Closes the menu when the tab becomes hidden.

### 3. Isolation of Submenu `onClose`

We will modify the submenu rendering in `<ContextMenu>` so that the submenu's `onClose` only closes the submenu (by resetting the submenu state) and does not propagate to close the parent menu. Hitting Escape or clicking inside the parent menu will close the submenu but keep the parent open.

## Risks / Trade-offs

- **Risk:** Scroll events might trigger too easily, closing the menu unexpectedly.
  - *Mitigation:* This is standard operating system and web browser behavior for context menus. If needed, we can exclude micro-scrolls, but standard scroll listener is preferred.
- **Risk:** Touch events on mobile might conflict with `mousedown`.
  - *Mitigation:* Mobile uses `MobileContextMenuSheet` which has its own overlay scrim. We will ensure the desktop floating menu listeners only apply to desktop or don't interfere with the mobile bottom sheet modal.
