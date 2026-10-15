## Why

Currently, right-click context menus do not reliably close when users perform standard dismissive actions, such as right-clicking elsewhere on the page, resizing the window, scrolling, blurring the window, or clicking on disabled items/submenus. This leaves stale menus lingering on the screen, creating a frustrating user experience.

## What Changes

- Implement robust dismiss behaviors for the context menu: close on any click (left or right) outside the menu.
- Close the context menu on window events that change layout or focus (scrolling, window resizing, window blurring, tab visibility changes).
- Avoid closing the menu when clicking on submenu triggers, disabled menu items, or separators.
- Ensure that right-clicking to open a new context menu automatically closes any other active context menus first.
- Maintain support for both desktop floating menus and mobile bottom sheets.

## Capabilities

### New Capabilities

- `context-menu-ux`: Requirements for context menu closing, dismissal, and interaction safety.

### Modified Capabilities

## Impact

- `src/components/common/ContextMenu.tsx`: Context menu hook, store, and component event handling.
- `src/components/common/MobileContextMenuSheet.tsx`: Event handling and overlay behaviors.
