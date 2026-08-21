## Why

On Linux, Plethora disables native window decorations (`decorations: false` in `src-tauri/tauri.linux.conf.json`) and renders its own custom chrome — but the only draggable surface today is the small empty drop-zone after the last tab in the tab strip (`TabBar.tsx`). Users cannot reliably click-and-drag the top of the window to move it and must fall back to window-manager shortcuts (`Meta`/`Alt` + drag), which is unacceptable for a desktop application. The custom borderless design is intentional and must be preserved; the fix is behavioral, not visual.

## What Changes

- Make empty, non-interactive areas of Plethora's top-level custom chrome behave as proper draggable window regions on Linux (the platform that actually uses custom chrome), using Tauri's supported `startDragging()` API — no modifiers required.
- Extend the existing, already-proven pattern (`handleLinuxWindowDrag` in `LinuxWindowControls.tsx`, which also implements double-click-to-maximize) into a reusable drag-surface abstraction so every top-chrome component marks its empty space consistently instead of each pane's TabBar hand-wiring one div.
- Cover the two real top-chrome layouts: the tab strip (always present) and the toolbar row when positioned at the top (user-configurable via `toolbarPosition`; currently dense with buttons and not draggable at all).
- Evaluate a thin (~8–12 px) invisible fallback drag strip along the very top edge of the desktop window for cases where visible chrome has no free space; include only if it does not cover interactive elements or hinder top-edge resizing.
- Keep all interactive chrome elements (tabs, toolbar buttons, window controls, inputs, menus) fully interactive — a click on a control must never start moving the window.
- Remove or repurpose the dead `.tauri-drag-region` CSS rules (`src/index.css`) that rely on `-webkit-app-region`, which does nothing on Linux WebKitGTK and is unused by any component.
- No change on macOS/Windows (native decorations provide dragging natively), no change on mobile, no visual redesign, no reintroduction of a native title bar.

## Capabilities

### New Capabilities

- `desktop-window-chrome`: Behavior of Plethora's custom desktop window chrome — which regions are draggable, how interactive elements inside chrome stay interactive, maximized/double-click semantics, platform scoping (custom chrome on Linux, native decorations elsewhere, none on mobile), and regression coverage for window dragging.

### Modified Capabilities

<!-- None: openspec/specs/ contains no existing desktop-window/chrome capability.
     The pending (unarchived) improve-mobile-tauri-ui change drafts a related
     tauri-desktop-interface spec; this change introduces its own focused
     capability rather than modifying an unarchived delta. -->

## Impact

- **Frontend (primary):**
  - `src/components/common/Tabs/LinuxWindowControls.tsx` — `handleLinuxWindowDrag` becomes the shared drag-initiation helper (or is wrapped by one).
  - `src/components/common/Tabs/TabBar.tsx` — keeps/relocates its drag wiring onto the new abstraction; behavior preserved.
  - `src/components/Toolbar.tsx` — gains drag handling on non-interactive space when `position === "top"` on Linux.
  - Possibly `src/components/layout/MainLayout.tsx` — if the thin top-edge fallback strip is adopted, it mounts here (desktop shell root).
  - `src/index.css` — remove/replace dead `-webkit-app-region` rules.
- **Tests:** Vitest component tests for the drag helper's event filtering (button vs. empty area, double-click, non-primary buttons, non-Linux/no-Tauri no-ops); manual validation matrix for actual OS window movement (X11/Wayland, KDE/GNOME, multi-monitor, HiDPI).
- **No backend changes:** `core:window:allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close` permissions already exist in `src-tauri/capabilities/default.json`; Tauri is pinned at 2.11.0 (`@tauri-apps/api ^2.11.0`), whose `startDragging()` delegates movement to the OS/window manager on both X11 and Wayland.
- **No impact:** mobile builds (Android/iOS configs inherit base config; drag logic gated to Linux desktop Tauri), macOS/Windows (decorations enabled → native title bar handles dragging), window-state persistence (`tauri-plugin-window-state` continues to save geometry on move).
