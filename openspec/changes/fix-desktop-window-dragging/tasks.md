## 1. Shared drag helper extraction (pure refactor)

- [x] 1.1 Create `src/lib/windowDrag.ts` with `isCustomChromeDragActive()` (`isTauri()` + `platform() === "linux"`, try/catch per existing `isLinuxDesktopTauri()`) and `handleWindowDragRequest(event)` carrying over the current `handleLinuxWindowDrag` behavior: primary button only, `event.detail === 2` → `toggleMaximize()`, otherwise `getCurrentWindow().startDragging()`, rejections logged via `console.error("[WindowDrag] ...")`.
- [x] 1.2 Add the exact-target filter to `handleWindowDragRequest`: no-op unless `event.target === event.currentTarget`; defense-in-depth no-op when the target is or is inside an interactive element (`button, a, input, select, textarea, [role="button"], [contenteditable]`).
- [x] 1.3 Switch `LinuxWindowControls.tsx` to delegate to the shared helper (keep its exported surface working for existing imports) and update `TabBar.tsx` imports; verify the trailing drop-zone still drags and double-click still maximizes.
- [x] 1.4 Add Vitest coverage in `src/lib/__tests__/windowDrag.test.ts(x)`: primary vs. non-primary buttons, double-click detail, exact-target rejection, interactive-target rejection, and no-op behavior when not Tauri / not Linux (mock `isTauri`/`platform` consistent with existing test mocks).

## 2. Extend drag surfaces to the topmost chrome

- [x] 2.1 Attach `handleWindowDragRequest` to the TabBar container row so padding/gaps around the tab scroll container drag the window (tabs, scroll buttons, and window controls remain children and never trigger).
- [x] 2.2 Attach `handleWindowDragRequest` to the horizontal toolbar surface container in `src/components/Toolbar.tsx` (active only when `position === "top"`); verify all toolbar buttons, menus, and inputs receive clicks normally.
- [x] 2.3 Confirm split-pane layouts keep one draggable strip per pane without double-handling (mousedown crossing pane borders must not produce janky behavior).

## 3. Dead code removal

- [x] 3.1 Remove `.tauri-drag-region` / `.tauri-no-drag` rules from `src/index.css` after re-verifying zero usages; leave a short comment pointing contributors to `src/lib/windowDrag.ts`.

## 4. Documentation

- [x] 4.1 Write a concise doc comment on `handleWindowDragRequest` stating the convention: which elements are drag surfaces, why interactive descendants are safe, and that new chrome controls need no opt-out because of exact-target filtering.
- [x] 4.2 Add a short section to the existing developer docs location for desktop/platform notes describing the drag-surface convention and the Linux-only gating.

## 5. Manual validation matrix (desktop)

- [ ] 5.1 Linux X11 (e.g., KDE X11): drag from empty tab-strip space and toolbar-row gaps in normal state; release keeps position; no modifier pressed.
- [ ] 5.2 Linux Wayland (KDE Wayland and GNOME Wayland if available): repeat 5.1; confirm WM Meta/Alt-drag shortcuts still work alongside.
- [ ] 5.3 Maximized window: drag from empty chrome — window un-maximizes under pointer and follows it (or stays maximized where the WM provides no restore-on-drag), never stuck; double-click empty chrome toggles maximize/restore.
- [ ] 5.4 Window controls: minimize, maximize/restore, close all work; clicks on them never move the window.
- [ ] 5.5 Interactive chrome: tabs (click, switch, HTML5 reorder), toolbar buttons/menus, any header inputs operate normally during attempts to drag from them.
- [ ] 5.6 Multi-monitor + HiDPI (if available): drag across displays with different resolutions/scale factors; no jumping or offset errors; saved geometry (`tauri-plugin-window-state`) restores correctly after moving and relaunching.
- [ ] 5.7 Windows sanity: native title bar dragging unchanged; custom Linux surfaces inert.
- [ ] 5.8 macOS sanity: native title bar dragging and traffic-light controls unchanged.
- [ ] 5.9 Mobile smoke: Android build boots; no desktop drag listeners active; mobile header/layout unchanged.

## 6. Conditional fallback strip (only if step 5 finds dead zones)

- [ ] 6.1 If reliable empty drag space is unreachable in some real layout, add a Linux-gated invisible top-edge strip (~8–10 px, absolutely positioned in the desktop shell root in `MainLayout.tsx`) wired to `handleWindowDragRequest`; size it to the minimum that fixes the observed dead zone.
- [ ] 6.2 Verify the strip does not obstruct window controls, top-edge resizing (X11 and Wayland), or accessibility of underlying controls; skip this task entirely if step 5 passes.

## 7. Final verification

- [ ] 7.1 Run `npm run test:run`, `npm run lint`, and the TypeScript check; fix findings.
- [ ] 7.2 Confirm appearance parity: same themes render identical chrome before/after (no title bar reintroduced, no layout shift); run `openspec validate --change fix-desktop-window-dragging` if validating artifacts.
