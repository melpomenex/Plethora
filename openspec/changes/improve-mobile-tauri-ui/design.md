## Context

Incrementum renders a React 19 interface inside browser/PWA and Tauri desktop/mobile containers. The repository already has `useMobileShell`, `useFormFactor`, a mobile bottom navigation, gesture hooks, safe-area utilities, responsive CSS, and specialized mobile queue/reader components. These pieces solve important cases, but the layout contract is split between JavaScript checks, Tailwind breakpoints, global CSS, feature-local `isMobile` branches, and native-platform detection. As a result, the same viewport can receive conflicting assumptions, safe-area padding can be applied more than once, and complex desktop surfaces often degrade by compression rather than deliberate reflow.

The Tauri desktop window currently starts at 1280×800 with a 900×600 minimum, native decorations, transparency, and the same toolbar/tab layout used by the web app. The change must improve native fit and compact-window usability without destabilizing tabs, viewers, persisted window geometry, themes, browser/PWA support, or the existing mobile build.

The primary stakeholders are phone readers using touch, tablet users who rotate between modes, desktop users who resize or multitask, keyboard-driven power users, and maintainers who need one predictable responsive contract.

## Goals / Non-Goals

**Goals:**

- Make form-factor selection deterministic and shared across shell and feature code.
- Make core workflows fully usable at representative phone, tablet, compact desktop, and standard desktop sizes.
- Remove safe-area, visual-viewport, fixed-navigation, keyboard, and overlay collisions.
- Preserve task state when presentation changes across orientation or window resizing.
- Make the Tauri desktop app feel integrated with native window behavior while retaining the existing theme system.
- Add repeatable responsive and native-window validation to prevent regressions.

**Non-Goals:**

- Redesigning Incrementum's brand, replacing its theme catalog, or introducing a new component framework.
- Rewriting domain workflows, changing storage schemas, or changing Rust command contracts.
- Building separate React applications for mobile, desktop, and web.
- Making every feature available in a single implementation phase; low-traffic surfaces may adopt shared primitives after the shell and core workflows.
- Replacing native desktop decorations with fully custom cross-platform window controls unless a platform-specific spike proves that necessary.

## Decisions

### 1. Use one semantic presentation model

Introduce a shared presentation model with `phone`, `tablet`, `compact-desktop`, and `desktop` modes. `useFormFactor`/`useMobileShell` will become thin consumers of the same `usePresentationMode` source, and the root shell will expose the current mode and native platform through context plus root data attributes. Native phones remain `phone` regardless of rotation; tablets and desktop windows are viewport-driven. The initial CSS thresholds will be phone below 600 CSS px, tablet from 600–1023, compact desktop from 760–1023 when running as a desktop workspace, and desktop at 1024 and above. Thresholds will be centralized rather than repeated as literals.

The mode transition changes presentation only. Route/tab identity, pane state, reader progress, and draft form values remain owned by their existing stores/components and must not be recreated solely because the mode changed.

Alternatives considered:

- CSS media queries alone: insufficient for native-phone orientation rules and components that must change behavior, not only style.
- Feature-local `isMobile` checks: preserves current fragmentation and produces threshold drift.
- User-agent-only classification: does not respond correctly to tablet rotation or compact desktop windows.

### 2. Keep a shared shell and introduce adaptive primitives

Retain `MainLayout`, the tab store, and current feature components, but extract shared primitives for recurring responsive behavior: an adaptive app scaffold, content header/action area, responsive toolbar overflow, bottom navigation/overflow sheet, sheet-dialog, inspector/drawer, and safe scroll container. These primitives own z-index, inset consumption, fixed-control spacing, focus restoration, and reduced-motion rules.

Feature screens will compose these primitives and express priority—primary action, secondary action, content, metadata—rather than applying isolated viewport fixes. Desktop tables and multi-pane views will switch to cards, stacked regions, drawers, or contained horizontal scrollers only when the data itself genuinely requires horizontal comparison.

Alternatives considered:

- A new mobile-only component tree for every feature: risks behavior drift and doubles maintenance.
- CSS overrides on current markup: fast initially, but cannot reliably solve focus order, overflow actions, or multi-pane state.

### 3. Preserve the current mobile information architecture, but make overflow stateful

Keep Dashboard, Queue, Review, Documents, and Settings as the five persistent phone destinations to avoid disruptive navigation churn. Secondary destinations remain in a labeled overflow sheet. The overflow entry will show an active state whenever one of its destinations is active, and tab activation will always reuse an existing tab when possible. Navigation gestures remain enhancements; visible controls and menus provide equivalent actions.

Back handling follows a strict stack: dismiss the topmost modal/sheet, close a transient inspector, navigate within the active feature when it owns history, then fall back to tab history or platform behavior. Gesture recognizers will ignore interactive controls, native horizontal scrollers, and viewer gestures.

Alternatives considered:

- Put every destination in a horizontally scrolling tab bar: poor discoverability and touch precision.
- Replace Settings with a generic More item: creates unnecessary churn and hides a frequently needed native-app destination.

### 4. Consume environmental insets exactly once per layer

The root app scaffold owns window safe-area insets. Fixed navigation and fullscreen viewer layers consume their own relevant inset only when they replace the root layer. Scroll containers receive explicit top/bottom content padding tokens based on visible fixed controls. A small visual-viewport hook publishes keyboard-adjusted height/offset variables for mobile forms and overlays, using `100dvh` as the CSS baseline and `100vh` only as fallback.

Portaled overlays share a z-index scale and placement tokens. Phone dialogs use bottom sheets for short actions and near-fullscreen sheets for forms; tablet/desktop uses bounded dialogs or anchored popovers. Focus trapping, initial focus, Escape/back dismissal, and focus return are part of the primitive rather than feature-specific effects.

Alternatives considered:

- Continue combining `.safe-top`/`.safe-bottom` ad hoc: makes inset duplication difficult to audit.
- Depend only on `100dvh`: does not fully solve keyboard overlays and offset visual viewports across WebViews.

### 5. Treat compact Tauri desktop as a desktop workspace, not a phone shell

Lower the configured desktop minimum to a tested target of 760×560 and add a compact-desktop layout between the minimum and 1024 px. In compact mode the active tab remains central, side toolbars collapse into a rail or overflow, tab actions condense, and secondary panes become drawers or sequential views. Phone bottom navigation is not rendered solely because a desktop window is narrow.

The desktop keeps native decorations in the first implementation. Existing `.tauri-drag-region`/`.tauri-no-drag` rules will be audited and only applied to intentionally empty header space; interactive descendants are always excluded. Platform attributes permit macOS/Windows/Linux spacing differences without branching entire component trees. If testing finds native decorations incompatible with the intended header, custom controls remain a separately reviewed follow-up.

Alternatives considered:

- Keep the 900 px minimum: avoids some reflow but makes side-by-side desktop use unnecessarily restrictive.
- Render the phone shell below 1024 px on desktop: sacrifices desktop keyboard/tab workflows and creates surprising resize behavior.
- Remove decorations and build custom controls now: larger accessibility and platform-behavior risk than this change requires.

### 6. Stabilize Tauri startup and themed surfaces

Default to an opaque native window unless a theme explicitly requires composed transparency and has a verified opaque root/backdrop. Apply a minimal pre-React boot color derived from the persisted light/dark preference before showing the full interface, then let `ThemeProvider` install the complete theme. Resize and fullscreen transitions keep the root backdrop fixed and ensure every shell layer paints its background.

This favors visual stability over desktop-through-window effects. Transparency can remain an opt-in capability for verified themes rather than an unconditional window setting.

Alternatives considered:

- Preserve global window transparency: enables visual effects but exposes gaps and startup flashes when any layer fails to paint.
- Hard-code a dark boot surface: fixes dark themes while creating the inverse flash for light-theme users.

### 7. Validate by mode and workflow, not by isolated breakpoints

Add unit tests for presentation classification and navigation reuse, component tests for overlays/focus/overflow, and browser-driven tests at representative dimensions: 390×844 portrait phone, 844×390 landscape phone, 820×1180 tablet, 760×560 compact desktop, 1280×800 desktop, and a maximized desktop viewport. Core smoke paths cover navigation, queue action, review action, document open/read controls, import form with keyboard-sized viewport, settings, toolbar overflow, and resize state preservation.

Native-only window behavior—drag regions, decoration spacing, saved geometry, startup surface, and maximize/fullscreen repaint—will use the existing Tauri test harness or a documented manual release matrix where automation cannot inspect operating-system chrome. Visual snapshots will use stable themes and mask dynamic content.

Alternatives considered:

- Screenshot every screen at every width: high maintenance with low behavioral coverage.
- Manual QA only: insufficient for a cross-cutting shell that future feature work can easily regress.

## Risks / Trade-offs

- [Risk] Centralizing form-factor logic changes many call sites and can expose dormant layout assumptions. → Migrate the shell first, add compatibility wrappers, then update core screens in small test-backed batches.
- [Risk] Lowering the desktop minimum reveals components that assumed at least 900 px. → Do not change the Tauri minimum until compact-mode smoke tests pass at 760×560; retain 900×600 as a rollback value.
- [Risk] Sheets, drawers, and mode changes can remount feature content and lose state. → Keep domain state above adaptive presentation branches, use CSS reflow when possible, and test active tabs, drafts, reader position, and split panes through resize transitions.
- [Risk] Global touch-target rules can make dense desktop UI excessively large. → Scope touch sizing to coarse-pointer/phone contexts while preserving accessible keyboard focus and readable desktop density.
- [Risk] Gesture navigation can conflict with reader selection, carousels, or operating-system gestures. → Keep edge thresholds narrow, ignore interactive/scrollable regions, support visible alternatives, and allow feature-level gesture suppression.
- [Risk] Removing unconditional transparency may alter the appearance of glass themes. → Verify each affected theme against an opaque composed backdrop and retain controlled in-app translucency.
- [Trade-off] Five persistent mobile destinations consume significant horizontal space. → Use concise localized labels and measured spacing; if localization fails at 320 px, reduce label prominence without removing accessible names.

## Migration Plan

1. Add presentation-mode tokens/context, root data attributes, visual-viewport variables, and tests while keeping existing hooks as compatibility adapters.
2. Refactor `MainLayout`, mobile navigation, fixed-control spacing, and overlay primitives; verify current phone behavior before changing feature screens.
3. Migrate Dashboard, Queue, Review, Documents, readers/viewers, Search/Import, Analytics, and Settings to adaptive headers, actions, lists/grids, and overlays.
4. Add compact-desktop toolbar/pane behavior and platform chrome spacing; validate at 760×560 before lowering `tauri.conf.json` minimum dimensions.
5. Stabilize the native boot/background surface and run theme/startup checks on macOS, Windows, and Linux where available.
6. Add the responsive workflow matrix and native-window release checklist, fix regressions, then remove redundant feature-local media queries and obsolete mobile branches.

Rollback is presentation-only: restore the prior minimum dimensions, keep compatibility hooks mapped to the previous breakpoints, and gate the new shell primitives behind a temporary internal flag until the device matrix passes. No data rollback is required.

## Open Questions

- Confirm whether 760×560 is sufficiently usable on Windows and Linux after accounting for native decoration dimensions; raise the minimum if platform testing proves otherwise.
- Determine whether tablet landscape should default to the full desktop tab strip or a tablet-specific rail after testing with real 10–13 inch devices.
- Identify which glass themes, if any, genuinely require native window transparency rather than in-app translucent surfaces.
