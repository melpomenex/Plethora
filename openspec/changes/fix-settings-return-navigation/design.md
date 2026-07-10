## Context

Settings is implemented as a reusable workspace tab. Opening it through the toolbar, command palette, mobile navigation, or app events activates that singleton tab and records activation in `useTabsStore.activeTabHistory`. The store already provides `goToPreviousTab()` and ignores closed history entries. Mobile also has a global left-edge swipe that invokes this history action.

The Settings component maintains a second, local navigation layer: on compact layouts `showMobileMenu` switches between the section menu and an individual section. Its current arrow only returns to the menu, is absent on wide layouts, and is unrelated to workspace history. Consequently, the navigation model is functional in pieces but not legible or consistently coordinated. Native back currently prioritizes overlays but does not model the local Settings layer.

## Goals / Non-Goals

**Goals:**

- Make returning to the user's pre-Settings workspace location obvious from every Settings view.
- Preserve the conventional compact-layout hierarchy of section → Settings menu → prior app location.
- Reuse the existing workspace history and edge gesture rather than creating a second navigation history.
- Route button, edge-swipe, and native/system back through the same decision logic and unsaved-change guard.
- Keep the interaction accessible, localized, and safe when history entries disappear.

**Non-Goals:**

- Converting Settings into a URL-routed modal or changing its singleton-tab behavior.
- Adding forward navigation controls or changing full-width swipes between primary mobile tabs.
- Persisting the transient Settings section/menu position across launches.
- Redesigning individual settings forms or changing how settings are saved.

## Decisions

### Use workspace activation history as the return source

The return destination will be derived from the valid entry preceding the active Settings tab in `activeTabHistory`. A small store-level query/action will expose the destination metadata and perform return navigation atomically. If no valid non-Settings entry exists, the action will activate or open the Dashboard as the safe default.

This avoids storing a stale `returnTo` tab ID on the Settings tab and naturally handles Settings being reopened from different locations. Closed or moved tabs are resolved at action time. An explicit return snapshot was considered, but it duplicates the existing history model and requires extra invalidation logic.

### Show app return separately from compact section hierarchy

The Settings shell will render a persistent app-return control on both wide and compact layouts. When a destination is known, the visible or accessible label will be “Back to {destination}”; otherwise it will use a generic localized “Back to app” label. On wide layouts it belongs in the Settings sidebar/header. On compact section pages, the existing left arrow remains “Back to Settings menu,” while a separate close/return action exits Settings directly. The compact menu also displays the app-return action.

Using one ambiguous arrow for both meanings was rejected because its result would change depending on the current Settings subview without adequately communicating whether the user will remain in Settings.

### Introduce one contextual back coordinator

A lightweight, synchronous coordinator will let the mounted Settings shell register a contextual-back handler, similar to the existing overlay back stack. The handler returns whether it consumed the action. Back dispatch order will be:

1. active overlay,
2. Settings local hierarchy and unsaved-change guard,
3. workspace tab-history return,
4. Dashboard fallback.

The visible hierarchical button, mobile edge swipe, and native/system-back bridge will call this coordinator. The explicit app-return control bypasses only the local section-to-menu step, but still uses the same unsaved-change guard and workspace-return action. This keeps Settings state private to its component while avoiding DOM inspection or global duplication of `showMobileMenu`.

### Keep the gesture edge-origin and directionally locked

The existing `useEdgeSwipeBack` thresholds, left-edge origin, direction lock, and `shouldIgnoreGlobalGesture` protections will remain the gesture recognizer. Only its completion callback changes to contextual back dispatch. Settings will not add a full-width swipe because that conflicts with scrolling controls, sliders, and the existing mobile tab-cycle gesture.

The user suggested a swipe left; for platform consistency the design uses the established system-back gesture—swiping right from the left edge. This has a clearer spatial model (“reveal what was behind”) and avoids collision with the app's leftward tab-cycling gesture.

### Centralize unsaved-change gating in Settings

Settings will expose one `attemptBack(kind)` path that checks `hasChanges`, requests confirmation when needed, and only then performs the requested local or app-level action. Cancelled actions do not mutate menu state or tab histories. Existing section switching will reuse the same guard semantics so all exits behave consistently.

### Verify behavior at component and store boundaries

Store tests will cover destination lookup, invalid/closed entries, Settings exclusion, and Dashboard fallback. Settings component tests will cover the persistent controls, wide/compact hierarchy, localized accessible labels, and unsaved-change cancellation. Mobile integration tests will verify edge and native back dispatch priority without relying on pixel-perfect rendering.

## Risks / Trade-offs

- **[Two controls on compact section headers could feel crowded]** → Use an icon-only app-return/close action with a localized accessible label, retain the hierarchy arrow, and validate at the smallest supported width.
- **[A Settings tab restored at startup may have no prior history]** → Keep the control enabled and route to Dashboard rather than hiding it or doing nothing.
- **[Global edge gestures can conflict with form controls]** → Retain edge-only recognition, directional locking, and gesture-target exclusions; add regression tests for protected targets and vertical scroll.
- **[Browser history and workspace history are different concepts]** → Do not call `window.history.back()` for Settings; route only through the workspace tab store.
- **[Multiple Settings entry points may diverge]** → Derive the destination from store history at render/action time so callers do not need to supply return metadata.

## Migration Plan

1. Add and test the workspace return query/action and safe fallback.
2. Add the contextual back coordinator and route existing mobile edge/system-back completion through it.
3. Register Settings hierarchy handling and add persistent return controls and localized labels.
4. Add component and mobile integration coverage, then manually verify desktop, compact web/PWA, and native-shell layouts.

The change is frontend-only and requires no data migration. Rollback consists of reverting the coordinator wiring and Settings controls; existing tab persistence remains compatible.

## Open Questions

None. The implementation can use the existing Dashboard as the fallback and the established left-edge swipe-right gesture as the mobile back gesture.
