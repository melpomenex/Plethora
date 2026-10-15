## 1. Responsive Baseline and Presentation Model

- [x] 1.1 Capture baseline screenshots and interaction notes for Dashboard, Queue, Review, Documents, reader, Analytics, Search/Import, and Settings at 390×844, 844×390, 820×1180, 760×560, and 1280×800.
- [x] 1.2 Add centralized presentation thresholds and a `phone | tablet | compact-desktop | desktop` classifier that incorporates native platform, screen form factor, and usable viewport width.
- [x] 1.3 Implement a reactive presentation provider/hook and expose presentation mode, native platform, pointer type, and reduced-motion state as root data attributes.
- [x] 1.4 Convert `useFormFactor` and `useMobileShell` into compatibility adapters over the shared presentation source and remove duplicate resize/orientation subscriptions.
- [x] 1.5 Add unit tests for native-phone rotation, tablet threshold changes, narrow Tauri desktop classification, resize debouncing, and cleanup.
- [x] 1.6 Add a state-preservation test proving that presentation changes do not replace the active tab or clear an in-progress form value.

## 2. Adaptive Shell, Insets, and Navigation

- [x] 2.1 Refactor `MainLayout` and `MobileLayoutWrapper` around a shared adaptive scaffold that owns shell height, safe-area consumption, fixed-control offsets, and background painting.
- [x] 2.2 Add visual-viewport CSS variables and a hook for keyboard-adjusted height/offset, with `100dvh` and safe fallbacks for browsers and Tauri WebViews.
- [x] 2.3 Consolidate mobile and shell spacing in `src/index.css` and `src/styles/mobile.css`, remove double-applied safe-area rules, and define shared z-index and fixed-control tokens.
- [x] 2.4 Update mobile navigation to reuse existing tabs, announce current state, and show the overflow destination as active when a secondary section is selected.
- [x] 2.5 Refine the mobile overflow surface with labeled secondary destinations, safe-area-aware scrolling, focus management, and system-back dismissal.
- [x] 2.6 Define overlay/back-stack ordering so modal or sheet dismissal precedes feature history, tab history, and platform navigation.
- [x] 2.7 Audit edge and between-tab gestures to ignore controls, selection surfaces, horizontal scrollers, and viewer gestures, and add visible alternatives for every essential action.
- [x] 2.8 Add navigation and shell tests for tab reuse, active overflow state, orientation changes, keyboard viewport changes, safe-area offsets, and overlay-first back handling.

## 3. Shared Adaptive Interface Primitives

- [x] 3.1 Implement an adaptive content header with prioritized title, status, primary action, secondary actions, and a compact overflow menu.
- [x] 3.2 Implement responsive dialog/sheet primitives with initial focus, focus trapping, internal scrolling, Escape/system-back handling, and focus return.
- [x] 3.3 Implement an adaptive inspector/drawer primitive for secondary panes that preserves mounted content or externally owned state across mode changes.
- [x] 3.4 Implement safe scroll-container and sticky-action primitives that account for bottom navigation, reader controls, safe-area insets, and the on-screen keyboard.
- [x] 3.5 Add coarse-pointer touch-target styles guaranteeing 44×44 CSS-pixel hit areas without inflating pointer-dense desktop layouts.
- [x] 3.6 Add shared pressed, selected, focus-visible, disabled, loading, and reduced-motion states to adaptive primitives.
- [x] 3.7 Add component tests for responsive variants, toolbar overflow, focus lifecycle, accessible names, internal scrolling, and reduced-motion behavior.

## 4. Mobile and Tablet Core-Screen Migration

- [x] 4.1 Migrate Dashboard headers, metrics, continue-reading content, and quick actions to phone, tablet, and wide arrangements without page-level horizontal overflow.
- [x] 4.2 Migrate Queue list/filter/status controls and item actions to the adaptive header, safe scroll container, and reachable mobile action patterns.
- [x] 4.3 Migrate Documents search/filter/import controls and grid/list presentations, including long titles, empty states, and bulk-action overflow.
- [x] 4.4 Migrate Review deck selection, session status, answer controls, and completion surfaces with thumb-reachable actions and tablet use of available space.
- [x] 4.5 Migrate Search/Import forms and result actions so focused fields and completion actions remain visible with the on-screen keyboard open.
- [x] 4.6 Migrate Settings navigation, grouped controls, destructive actions, and long localized labels to adaptive sections and sheets.
- [x] 4.7 Migrate Analytics cards, charts, filters, legends, and detail surfaces to responsive grids or contained scrollers with accessible data alternatives.
- [x] 4.8 Add viewport tests for each migrated screen covering primary workflow completion, no page-level horizontal overflow, and no fixed-control occlusion.

## 5. Reader, Media, and Contextual Interaction Polish

- [x] 5.1 Audit PDF, EPUB, HTML/Markdown, RSS, video, and queue-scroll viewers for safe-area, orientation, selection, zoom, and fixed-control conflicts.
- [x] 5.2 Unify reader headers and control bars with the adaptive scaffold while preserving fullscreen behavior, reading position, and existing auto-hide semantics.
- [x] 5.3 Move reader metadata, table of contents, transcript, assistant, and summary secondary panels into adaptive inspector/drawer presentations on constrained widths.
- [x] 5.4 Ensure extract creation, text selection, playback, rating, postpone, and navigation actions have visible touch alternatives and do not conflict with global gestures.
- [x] 5.5 Add regression tests for reader rotation, fullscreen entry/exit, safe-area controls, selection gestures, panel state, and reading-position preservation.

## 6. Tauri Compact Desktop and Native Window Integration

- [x] 6.1 Add a compact-desktop workspace that keeps the desktop tab model while collapsing side toolbars, tab actions, and secondary panes into rails, overflow menus, or drawers.
- [x] 6.2 Make top, left, and right toolbar positions responsive at compact widths and preserve visible access to command/search and stateful primary actions.
- [x] 6.3 Audit all `.tauri-drag-region` and `.tauri-no-drag` usage, restrict dragging to empty header regions, and verify interactive header descendants never drag the window.
- [x] 6.4 Add platform data attributes and spacing rules for macOS, Windows, and Linux native decorations without duplicating window controls.
- [x] 6.5 Stabilize the pre-React boot surface and root background for saved light/dark themes, resizing, maximize, fullscreen, and theme transitions.
- [x] 6.6 Audit themes that depend on transparency, move translucency into composed in-app surfaces where possible, and change native window transparency only after visual verification.
- [x] 6.7 Add compact-window tests for navigation, toolbar overflow, active tab, split/secondary pane preservation, keyboard workflows, and absence of two-axis page scrolling at 760×560.
- [x] 6.8 After compact tests pass, update the Tauri main window minimum to at most 760×560 and verify existing window-state recovery clamps restored geometry to a visible display.

## 7. Accessibility, Localization, and Visual Consistency

- [x] 7.1 Audit adaptive navigation, icon buttons, menus, sheets, drawers, reader controls, and compact toolbar actions for accessible names, roles, current/expanded state, and focus order.
- [x] 7.2 Verify mobile labels and overflow actions with the longest supported translations and add truncation plus accessible full-text behavior where necessary.
- [x] 7.3 Verify text contrast, focus indicators, selected states, disabled states, and touch feedback across representative light, dark, high-contrast, and glass themes.
- [x] 7.4 Add automated accessibility checks for the shell and representative core screens, then resolve all new serious or critical findings.
- [x] 7.5 Add stable visual snapshots for the adaptive shell, navigation, sheets, compact toolbar, and representative core screens in phone, tablet, compact-desktop, and desktop modes.

## 8. End-to-End Validation and Cleanup

- [x] 8.1 Add a responsive E2E matrix for 390×844 portrait phone, 844×390 landscape phone, 820×1180 tablet, 760×560 compact desktop, 1280×800 desktop, and maximized desktop.
- [x] 8.2 Cover navigation, queue action, review action, document open/read controls, import with a keyboard-sized viewport, settings change, toolbar overflow, and resize state preservation in the matrix.
- [x] 8.3 Create and execute a Tauri manual/native harness checklist for macOS, Windows, and Linux covering decorations, drag regions, minimum resize, saved geometry, startup surface, maximize, fullscreen, and theme changes.
- [x] 8.4 Run frontend type checking, linting, unit/component tests, responsive E2E tests, and the relevant Tauri checks; fix regressions introduced by the change.
- [x] 8.5 Remove superseded feature-local form-factor checks, obsolete mobile-only branches, redundant safe-area utilities, and duplicated breakpoint literals after all consumers migrate.
- [x] 8.6 Document the presentation modes, adaptive primitives, safe-area ownership rules, responsive test matrix, and guidance for future feature screens.
