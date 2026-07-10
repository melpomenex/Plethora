### Added

- **Unified responsive app-shell** — Exposes central presentation context (`phone | tablet | compact-desktop | desktop`) and insets/visual-viewport handling to adapt components responsively.
- **Adaptive layout primitives** — Implemented standard `AdaptiveContentHeader`, `ResponsiveDialogSheet`, `AdaptiveInspector`, and `SafeScrollContainer` primitives.
- **Continue Reading widget** — Renders the top 3 most recently read, in-progress documents directly on the Dashboard.

### Fixed & Improved

- **Dashboard, Queue, Documents, Review, Search, and Settings adaptive passes** — Reflowed layouts, metrics cards, side toolbars, grids, filters, and forms to adapt elegantly without horizontal scrollbars or clipping.
- **Tauri compact desktop chrome** — Restricts draggable window header areas to non-interactive regions, adjusts platform Native decoration spacings, and resolves theme boot background flashes.
- **Test suite validation** — Fixed Tauri mock exports inside documents dashboard tests, verified shell gestures, navigation stack, and viewport transitions.
