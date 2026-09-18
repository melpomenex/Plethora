## Purpose

Defines how Plethora's application shell — desktop navigation rail, mobile bottom navigation, tab chrome, and adaptive surfaces — adopts the Material 3 system across window sizes while keeping desktop keyboard workflows and mobile ergonomics intact.

## ADDED Requirements

### Requirement: Token-based shell chrome

The desktop toolbar rail, tab bar, collection switcher, and mobile bottom navigation SHALL be styled exclusively from semantic tokens (surface-container roles for layering, on-surface-variant for inactive items, secondary-container for active indicators) with standard state layers, replacing hardcoded chrome colors. The rail's expand/collapse behavior, widths, and window-drag regions SHALL remain unchanged.

#### Scenario: Active destination indication

- **WHEN** the active destination is shown in the rail or bottom navigation
- **THEN** it is indicated by a tonal pill (secondary-container) plus icon/content emphasis — not by color alone — and inactive items use on-surface-variant

#### Scenario: Expansion behavior preserved

- **WHEN** the desktop rail expands on hover/focus and collapses on tab switch or outside click
- **THEN** timings and layout behavior are unchanged from the pre-Material shell

### Requirement: Width-driven adaptation

Shell layout decisions SHALL continue to be driven by available window width via the existing presentation classification (phone < 600, tablet < 1024, desktop ≥ 1024, compact-desktop), not by naive OS detection. Native phones always get the mobile shell; native tablets get mobile shell below 1024px. Platform-specific behavior remains only where it is genuinely platform-related (safe areas, hardware back, vibrancy).

#### Scenario: Resizable desktop window

- **WHEN** a desktop browser/Tauri window is resized across the 600px and 1024px boundaries
- **THEN** the shell switches presentation classes without a restart and without losing tab state

### Requirement: Surface routing rules

Surfaces SHALL be chosen by rule: Dialog for focused decisions and destructive confirmations; bottom sheet on compact/mobile presentations for contextual action sets; side sheet/inspector on expanded widths when content can coexist; menu for short immediate command lists; snackbar for transient feedback. The existing `ResponsiveDialogSheet` and `AdaptiveInspector` SHALL be the adaptive mechanism and SHALL consume the Material dialog primitive's visuals.

#### Scenario: Compact gets sheet, wide gets dialog

- **WHEN** the same responsive dialog/sheet opens at phone width and again at desktop width
- **THEN** it renders as a bottom sheet with drag handle and safe-area padding at phone width, and as a centered elevated dialog at desktop width

### Requirement: Mobile bottom navigation

The mobile bottom navigation SHALL show the primary destinations (dashboard, queue, review, documents, settings) with badge support and an overflow "More" sheet, styled from tokens with active pill indicators, and SHALL keep safe-area and keyboard-avoidance behavior.

#### Scenario: Badge and More sheet

- **WHEN** the queue has due items
- **THEN** its bottom navigation destination shows a badge count, and the More sheet lists secondary destinations with capability-disabled entries shown with reasons

### Requirement: Keyboard workflows preserved

All existing desktop keyboard workflows SHALL continue to work unchanged after restyling: shortcut store bindings, global shortcuts, tab cycling (Ctrl+Tab, Ctrl+W, Alt+arrows), command palette (Ctrl+K/P), Vimium ex-commands, review shortcuts, and reader shortcuts. Focus order SHALL remain logical in the restyled shell.

#### Scenario: Tab cycling after restyle

- **WHEN** Ctrl+Tab and Alt+Right are pressed in the desktop shell
- **THEN** tabs cycle exactly as before the Material migration

### Requirement: Z-index scale

Floating layers SHALL consume a documented z-index scale (base content < sticky chrome < overlays < dialogs < tooltips/menus < toasts < critical floating chrome such as the anchored selection toolbar), replacing arbitrary `z-[9998]`-style values in migrated components. Existing stacking contracts (selection toolbar above dialogs, toasts above bottom nav) SHALL be preserved.

#### Scenario: Selection toolbar layering preserved

- **WHEN** the reader selection toolbar is visible and a dialog opens beneath it in z-order terms
- **THEN** the selection toolbar remains visible above ambient chrome exactly as before migration
