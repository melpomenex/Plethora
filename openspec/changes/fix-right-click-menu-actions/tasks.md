## 1. Context Menu Lifecycle & Store Events

- [x] 1.1 Implement a lightweight pub/sub subscription listener pattern inside `contextMenuStore` in `src/components/common/ContextMenu.tsx`.
- [x] 1.2 Modify `useContextMenu` hook to subscribe to the store state changes, making the store the single source of truth.
- [x] 1.3 Update `contextMenuStore.showMenu` to hide all other context menus before showing the new one.

## 2. Event Listeners for Automatic Dismissal

- [x] 2.1 Register global event listeners for `mousedown`, `contextmenu`, `scroll` (with capture), `resize`, `blur`, and `visibilitychange` inside `<ContextMenu>` when it is visible.
- [x] 2.2 Add containment logic to ensure clicks on disabled items or separators do not close the menu, while clicks outside close the menu.
- [x] 2.3 Implement proper listener cleanup when the `<ContextMenu>` component unmounts.

## 3. Submenu Closing Behavior

- [x] 3.1 Modify the submenu rendering inside `<ContextMenu>` to isolate the `onClose` callback so closing a submenu does not propagate to the parent menu.
