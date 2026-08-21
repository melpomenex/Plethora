## Context

Plethora is Tauri 2.11 (pinned `tauri = "=2.11.0"`, `@tauri-apps/api ^2.11.0`) with React 19. Window chrome configuration is per-platform:

- `src-tauri/tauri.conf.json` — base config, `decorations: true`. macOS and Windows platform configs (`tauri.macos.conf.json`, `tauri.windows.conf.json`) only override bundle resources, so both platforms run with **native title bars**.
- `src-tauri/tauri.linux.conf.json` — `decorations: false`, `transparent: true`: Linux runs the **custom borderless chrome**. There are no runtime `set_decorations` calls in Rust; decorations are purely config-driven.

Desktop shell structure (`src/components/layout/MainLayout.tsx`): renders `Toolbar` at a user-configurable position (`top` default, or `left`/`right` via `settings.interface.toolbarPosition`) plus the tabbed workspace (`Tabs` → `SplitPaneContainer` → per-pane `TabBar` + `TabContent`). Mobile uses `MobileLayoutWrapper` gated by `useMobileShell()`.

Current drag support:

- `src/components/common/Tabs/LinuxWindowControls.tsx` exports `handleLinuxWindowDrag(event)`: on Linux desktop Tauri + primary button, double-click (`event.detail === 2`) → `toggleMaximize()`, otherwise `getCurrentWindow().startDragging()`; failures logged via `console.error` (the `runWindowAction` pattern). It also renders the custom minimize/maximize/close buttons in the top-right pane's TabBar.
- `TabBar.tsx:479-481` attaches that handler to exactly one element: the trailing empty drop-zone div (`flex-1 min-w-[30px] h-full`) after the last tab. This is the entire draggable surface today — it shrinks to ~30 px as tabs fill the strip and nothing else in the chrome drags.
- `src/index.css:156-167` defines `.tauri-drag-region` / `.tauri-no-drag` using `-webkit-app-region`. No component uses these classes, and `-webkit-app-region` is an Electron-era convention that neither WebKitGTK nor Tauri honors — dead code that misleads contributors.
- Capabilities already granted in `src-tauri/capabilities/default.json`: `core:window:allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close`.
- Geometry persistence uses `tauri-plugin-window-state` (desktop-only dependency), which saves `.window-state.json` on move/resize events — dragging updates saved state automatically.
- Platform detection helpers live in `src/lib/tauri.ts` (`isTauri()`) and `@tauri-apps/plugin-os` (`platform()`); shell selection via `useMobileShell()` / `useFormFactor()`.
- A pending (unarchived) change `improve-mobile-tauri-ui` drafts a `tauri-desktop-interface` spec whose "Native window chrome is interaction-safe" requirement anticipates this work; this change lands the behavior under its own capability.

## Goals / Non-Goals

**Goals:**

- Reliable primary-button window dragging from empty areas of the topmost custom chrome on Linux, no modifiers needed.
- One reusable, hard-to-misuse drag-surface pattern so future chrome elements can't silently break dragging again.
- Correct maximized/double-click semantics via supported APIs only.
- Automated coverage for the filtering logic Plethora owns; manual matrix for OS-level movement.

**Non-Goals:**

- Restoring native decorations on Linux or adding a visible fake title bar.
- Any visual redesign of the header, toolbar, tabs, or window controls.
- Custom pointermove coordinate math for moving the window.
- Touch/pen gesture systems beyond what mousedown-driven `startDragging()` already provides.
- Changes to mobile navigation or mobile event handling.

## Decisions

### D1: Programmatic `startDragging()` on mousedown, not the `data-tauri-drag-region` attribute

Tauri v2 supports both. The attribute works via an injected script that starts a drag when the mousedown target itself carries `data-tauri-drag-region` (descendants without the attribute don't trigger), and it handles double-click maximize. It would function on Linux. The programmatic approach wins for this repo because:

1. **It already exists and works** — `handleLinuxWindowDrag` implements exactly the required semantics (primary button, `detail === 2` maximize, error logging) and is proven in this codebase; we are extending its *coverage*, not inventing a mechanism.
2. **Platform gating** — the handler no-ops outside Linux desktop Tauri. The injected attribute script is active everywhere; keeping one explicit gate matches the repo's existing `isLinuxDesktopTauri()` convention and keeps macOS/Windows/mobile paths untouched by construction.
3. **Testability** — the filtering logic becomes plain unit-testable TypeScript; the attribute's behavior lives inside Tauri's webview injection and can't be covered by Vitest.
4. **OS delegation preserved** — `startDragging()` maps to GTK's `begin_move_drag` (X11) / `xdg_toplevel.move` (Wayland) during an active button press, so movement, multi-monitor traversal, per-monitor scaling, and WM-side un-maximize-on-drag are all handled by the OS. No coordinate math anywhere.

Fallback clause: if manual validation uncovers a compositor-specific defect in `startDragging()` (e.g., a specific Wayland compositor refusing the grab), switching the shared helper's internals to set `data-tauri-drag-region` imperatively is a contained change behind the same component API — decide then, don't pre-build both.

### D2: Exact-target drag surfaces on chrome containers ("empty space = container itself")

Adopt the rule: **a drag surface initiates a window drag only when `event.target === event.currentTarget`** (plus an interactive-element guard as defense-in-depth). Every child of a marked container — buttons, inputs, tabs, menus — therefore never triggers a drag, and any control added inside the chrome in the future is automatically excluded. This mirrors `data-tauri-drag-region` semantics without the injection layer.

Surfaces:

1. **Tab strip trailing drop-zone** (existing): keep as-is; it already satisfies exact-target semantics since the zone has no interactive children.
2. **Tab strip container row**: attach the handler so padding/border gaps around the scroll container also drag (target = row only when not landing on a tab/button).
3. **Toolbar row when `position === "top"`**: attach the handler to the horizontal toolbar surface container. Its children are buttons/groups/dividers (all interactive or exact-target-excluded); inter-group gaps and trailing space become valid drag targets. Left/right toolbar positions are vertical rails against the window edge — out of scope for top-edge dragging (native resize/drag expectations differ; not part of the reported bug).

Tabs themselves remain application-drag handles (`draggable` HTML5 tab reordering) — they are children of the scroll container, never the exact target of a marked container.

### D3: Shared helper module instead of per-component wiring

Move the drag logic from `LinuxWindowControls.tsx` into a small module (e.g., `src/lib/windowDrag.ts`, following the `lib/` conventions of `tauri.ts`/`feedback.ts`):

- `isCustomChromeDragActive()` — `isTauri() && platform() === "linux"` (extracted from the existing `isLinuxDesktopTauri()` check so Toolbar doesn't import from `components/common/Tabs/`).
- `handleWindowDragRequest(event)` — the current `handleLinuxWindowDrag` behavior plus the exact-target/interactive-target filter; exported for `onMouseDown` use.

`LinuxWindowControls.tsx` re-exports or delegates to keep its public surface stable; `TabBar.tsx` switches imports. Future chrome components call one import — the "difficult to accidentally break" property comes from the filter living in one audited place rather than scattered handlers.

### D4: Thin top-edge fallback strip — evaluate, implement only if testing demands it

The visible chrome may still leave windows where every pixel is interactive (dense toolbar + full tab strip). An absolutely-positioned, invisible strip (~8–10 px, `absolute inset-x-0 top-0 z-50`, mounted in the desktop shell root in `MainLayout.tsx`, Linux-gated) would guarantee a target without shifting layout. However, it would cover the top 8–10 px of whatever sits beneath, including button hitboxes.

Decision: treat the strip as a **conditional follow-up within this change**, not a default. Ship D2 first; run the manual matrix; add the strip only if real dead zones exist, sized to the smallest value that fixes them, and verified not to obstruct the window controls or top-edge resizing (frameless GTK windows keep native edge-resize hit regions outside the webview input region, but confirm on X11 and Wayland). This ordering prevents an accessibility/a11y regression introduced speculatively.

### D5: Remove the dead `-webkit-app-region` CSS

Delete `.tauri-drag-region` / `.tauri-no-drag` rules from `src/index.css` (no usages exist; they do nothing on any Plethora platform). Replacing them with a comment pointing at the shared helper prevents reintroduction. Grep confirms zero component usage.

### D6: Maximized, double-click, and multi-monitor semantics come from the OS

- Double-click on empty chrome → `toggleMaximize()` (already implemented; retained).
- Dragging a maximized window: `begin_move_drag`/`xdg_toplevel.move` lets KWin/Mutter/COSMIC apply their native un-maximize-and-drag (or ignore it) exactly as for native apps. Plethora adds no simulation and cannot enter a stuck state because it holds no drag state — the OS owns the modal grab.
- Multi-monitor/HiDPI: delegated entirely to the WM; no Plethora-owned coordinates exist to get wrong.
- Existing `Meta`/`Alt`+drag WM shortcuts are unaffected: the app listens only to its own chrome's mousedowns.

### D7: Failure handling follows the existing `runWindowAction` pattern

`startDragging()` rejections log via `console.error` with the `[WindowDrag]` prefix (consistent with `[LinuxWindowControls]` today, routed through `tauri-plugin-log`), never toast/dialog. The handler is synchronous fire-and-forget; UI state cannot desynchronize because none is held.

## Risks / Trade-offs

- [Risk] Wayland compositors vary in honoring `xdg_toplevel.move` from an async IPC-initiated request. → The call originates inside a genuine mousedown dispatch, which is what the protocol requires; validated explicitly on KDE Wayland, GNOME Wayland, and X11 sessions in the manual matrix. If a compositor fails, the D1 fallback clause applies.
- [Risk] Exact-target filtering makes padded containers feel inconsistent if an inner wrapper div absorbs the mousedown target. → Convention documented: marked containers must have their direct hit-testable background be the marked element; wrapper elements get `pointer-events: none` if purely decorative.
- [Risk] Toolbar-row drag could surprise users who expect click-through on dense rows. → Only non-interactive pixels respond; cursor stays default (no `grab` cursor over chrome, preserving appearance); acceptance tests cover button clicks.
- [Risk] Conditional fallback strip (D4) could cover button tops if added carelessly. → Gated behind manual-matrix evidence, minimum size, and explicit verification against window controls and edge resizing.
- [Trade-off] Linux-only implementation leaves macOS/Windows without the abstraction exercised. → Acceptable: those platforms have native title bars today; the helper's platform gate is one line to extend if custom chrome ever ships there (spec already states the scoping rule).

## Migration Plan

1. Extract the shared helper (D3) with unit tests; `TabBar`/`LinuxWindowControls` switch to it — pure refactor, behavior identical.
2. Add toolbar-row and tab-strip-container surfaces (D2).
3. Remove dead CSS (D5).
4. Run the manual validation matrix (Linux X11/Wayland primary; Windows/macOS sanity; mobile smoke).
5. Conditionally add the top-edge strip (D4) only if step 4 finds dead zones.
6. Document the convention next to the helper (doc comment) and in the developer docs location used for chrome/platform notes.

Rollback is trivial: each step is additive frontend behavior; reverting restores the previous single-surface dragging. No data, config, or schema changes.

## Open Questions

- None blocking. The D4 strip decision is deliberately deferred to manual-matrix evidence and does not change the specs (its behavior is already covered by the "at least one reliable empty draggable area remains" requirement).
